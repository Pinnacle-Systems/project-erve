import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from '../auth/current-user.js';
import { runRolesBootstrap } from './roles-bootstrap.js';
import { runAdminBootstrap } from './admin-bootstrap.js';
import { runFinancialYearBootstrap } from './financial-year-bootstrap.js';
import { runQualityBootstrap } from './quality-bootstrap.js';
import { ensureCurrentGarmentGstRuleSet } from '../modules/tax-rules/gst-rule-sets.service.js';
import { createSeason, createSize } from '../modules/master-data/master-data.service.js';
import {
  createSeasonSchema,
  createSizeSchema,
} from '../modules/master-data/master-data.validation.js';
import { createHsn } from '../modules/tax-rules/hsn.service.js';
import { createHsnSchema } from '../modules/tax-rules/hsn.validation.js';
import {
  planMasterImport,
  executeMasterImport,
  requireMasterImportActor,
} from '../modules/master-data/master-import.service.js';
import {
  planBulkStyleImport,
  parseBulkStyleImportSheet,
  executeBulkStyleImport,
} from '../modules/master-data/style-bulk-import.service.js';
import { parseMasterImportFile } from '../modules/master-data/master-import.parser.js';
import { getFileStorage } from '../storage/index.js';
import { summarizeRebuildIssues } from './disposable-rebuild-outcomes.js';
import {
  rebuildSafetySchema,
  validateRebuildSafety,
  assertRebuildPaths,
  RebuildSafetyError,
  claimRebuildDirectory,
} from './disposable-rebuild-safety.js';
import {
  sealedInputsSchema,
  loadRebuildInputs,
  rebuildChecksum,
} from './disposable-rebuild-inputs.js';

export const disposableRebuildConfigSchema = rebuildSafetySchema.merge(sealedInputsSchema).extend({
  adminEmail: z.email(),
  adminName: z.string().min(1),
  styleWorksheet: z.string().min(1).max(31),
  businessWorksheets: z
    .object({
      factories: z.string().optional(),
      distributors: z.string().optional(),
      retailStores: z.string().optional(),
    })
    .default({}),
  syntheticCorrections: z
    .array(
      z.object({ field: z.string(), reason: z.string(), sourceKey: z.string(), value: z.string() }),
    )
    .default([]),
});
export type DisposableRebuildConfig = z.infer<typeof disposableRebuildConfigSchema>;
type Loaded = Awaited<ReturnType<typeof loadRebuildInputs>>;
type Options = {
  execute: boolean;
  confirmWrite: boolean;
  repositoryRoot: string;
  developmentDatabaseUrl?: string;
};
type Deps = {
  migrate: () => Promise<void>;
  getAdminPassword: () => Promise<string>;
  afterStage?: (stage: string) => Promise<void>;
};

function records(file: { buffer: Buffer }) {
  const book = XLSX.read(file.buffer, { type: 'buffer', raw: true });
  return XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[book.SheetNames[0]!]!, {
    raw: false,
    defval: '',
  });
}
export async function readDisposableDatabaseIdentity() {
  const [target] = await prisma.$queryRaw<
    Array<{ name: string; address: string; owner: string | null }>
  >`
    SELECT current_database() AS name, inet_server_addr()::text AS address,
      shobj_description(oid, 'pg_database') AS owner FROM pg_database WHERE datname = current_database()`;
  return target;
}
async function targetStatus(config: DisposableRebuildConfig) {
  const target = await readDisposableDatabaseIdentity();
  if (target?.name !== config.databaseName || target.address !== config.expectedServerAddress)
    throw new RebuildSafetyError(
      'Live database identity/address does not match the verified disposable target',
    );
  const owner = databaseOwner(config);
  const [objects] = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','S')`;
  if (target.owner !== owner && (target.owner || objects!.count !== 0n))
    throw new RebuildSafetyError(
      'Target is neither empty nor owned by this disposable rebuild; refusing all writes',
    );
  return {
    name: target.name,
    address: target.address,
    owned: target.owner === owner,
    schemaObjects: Number(objects!.count),
  };
}
function databaseOwner(config: DisposableRebuildConfig) {
  return `erve-disposable-rebuild:v1:${config.disposableId}:${rebuildChecksum(JSON.stringify([path.resolve(config.reportRoot), path.resolve(config.mediaRoot)]))}`;
}
async function inspectRoot(root: string, owner: string, allowOwnedContents: boolean) {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!entries.length) return;
  if (!entries.includes('disposable-owner.json'))
    throw new RebuildSafetyError('Output/media directory has unowned contents');
  const marker = JSON.parse(await readFile(path.join(root, 'disposable-owner.json'), 'utf8'));
  if (marker.owner !== owner || marker.root !== path.resolve(root))
    throw new RebuildSafetyError('Output/media ownership does not match this rebuild');
  if (!allowOwnedContents && entries.some((entry) => entry !== 'disposable-owner.json'))
    throw new RebuildSafetyError(
      'Fresh database cannot reuse media or reports from an earlier target',
    );
}
async function claimRoots(config: DisposableRebuildConfig) {
  const owner = `${config.databaseName}:${config.disposableId}`;
  for (const root of [config.reportRoot, config.mediaRoot]) {
    await claimRebuildDirectory(root, owner);
  }
}
export async function planDisposableRebuild(config: unknown, options: Options) {
  const parsed = disposableRebuildConfigSchema.parse(config);
  validateRebuildSafety(parsed, {
    ...options,
    databaseUrl: env.DATABASE_URL,
    nodeEnv: env.NODE_ENV,
  });
  if (path.resolve(env.FILE_STORAGE_DIR) !== path.resolve(parsed.mediaRoot))
    throw new RebuildSafetyError('FILE_STORAGE_DIR must exactly match the isolated media root');
  await assertRebuildPaths(parsed);
  const loaded = await loadRebuildInputs(parsed);
  const sourcePreview = {
    references: {
      seasons: records(loaded.files.seasons).length,
      sizes: records(loaded.files.sizes).length,
    },
    business: Object.fromEntries(
      (
        [
          ['factories', 'factories'],
          ['distributors', 'distributors'],
          ['retailStores', 'retail-stores'],
        ] as const
      ).map(([name, kind]) => {
        const file = loaded.files[name];
        const rows = parseMasterImportFile(
          kind,
          file.buffer,
          file.fileName,
          parsed.businessWorksheets[name],
        ).rows;
        return [
          kind,
          {
            sourceRows: rows.length,
            cachedOrOversizedErrors: rows.filter((row) => row.error).length,
          },
        ];
      }),
    ),
    styles: {
      sourceRows: parseBulkStyleImportSheet(loaded.files.styles.buffer, parsed.styleWorksheet)
        .length,
    },
    dependencyValidation: 'Live domain matching occurs after system bootstrap during execution',
  };
  const target = await targetStatus(parsed);
  const owner = `${parsed.databaseName}:${parsed.disposableId}`;
  await inspectRoot(parsed.reportRoot, owner, target.owned);
  await inspectRoot(parsed.mediaRoot, owner, target.owned);
  return { config: parsed, target, loaded, sourcePreview };
}
async function references(actor: CurrentUser, loaded: Loaded, worksheet: string) {
  const outcomes: Array<{ kind: string; key: string; outcome: string; detail?: string }> = [];
  for (const [index, row] of records(loaded.files.sizes).entries()) {
    try {
      const input = createSizeSchema.parse({
        code: row.Code,
        label: row.Label,
        sizeType: row['Size Type'],
        sortOrder: row['Sort Order'] || index + 1,
      });
      const existing = await prisma.size.findUnique({ where: { code: input.code } });
      if (
        existing &&
        (existing.label !== input.label ||
          existing.sizeType !== input.sizeType ||
          existing.sortOrder !== input.sortOrder ||
          existing.status !== 'ACTIVE')
      )
        throw HttpError.conflict('Existing Size values differ');
      if (!existing) await createSize(actor, input);
      outcomes.push({
        kind: 'Size',
        key: input.code,
        outcome: existing ? 'SKIP_EXISTING' : 'CREATE',
      });
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof HttpError)) throw error;
      outcomes.push({
        kind: 'Size',
        key: row.Code ?? '',
        outcome: 'NEEDS_REVIEW',
        detail: error instanceof z.ZodError ? 'Size values require correction' : error.message,
      });
    }
  }
  for (const row of records(loaded.files.seasons)) {
    try {
      if (!row['Financial Year']) throw HttpError.conflict('Season Financial Year needs review');
      const fy = await prisma.financialYear.findUnique({ where: { code: row['Financial Year'] } });
      if (!fy) throw HttpError.conflict('Season Financial Year is outside the bootstrap window');
      const input = createSeasonSchema.parse({
        code: row.Code,
        name: row.Name,
        financialYearId: fy.id,
      });
      const existing = await prisma.season.findFirst({
        where: { code: input.code, financialYearId: fy.id },
      });
      if (existing && (existing.name !== input.name || existing.status !== 'ACTIVE'))
        throw HttpError.conflict('Existing Season values differ');
      if (!existing) await createSeason(actor, input);
      outcomes.push({
        kind: 'Season',
        key: `${input.code}:${fy.code}`,
        outcome: existing ? 'SKIP_EXISTING' : 'CREATE',
      });
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof HttpError)) throw error;
      outcomes.push({
        kind: 'Season',
        key: row.Code ?? '',
        outcome: 'NEEDS_REVIEW',
        detail: error instanceof z.ZodError ? 'Season values require correction' : error.message,
      });
    }
  }
  // HSN codes are copied from the sealed Style sheet, never inferred or invented.
  const book = XLSX.read(loaded.files.styles.buffer, { type: 'buffer', raw: true });
  if (!book.Sheets[worksheet])
    throw HttpError.badRequest('Selected Style worksheet does not exist');
  const styleRows = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[worksheet]!, {
    raw: false,
    defval: '',
  });
  for (const code of new Set(styleRows.map((row) => row['HSN Code']?.trim()).filter(Boolean))) {
    try {
      const input = createHsnSchema.parse({ code });
      const existing = await prisma.hsn.findUnique({ where: { code: input.code } });
      if (existing && existing.status !== 'ACTIVE')
        throw HttpError.conflict('Existing HSN is inactive');
      if (!existing) await createHsn(actor, input);
      outcomes.push({
        kind: 'HSN',
        key: input.code,
        outcome: existing ? 'SKIP_EXISTING' : 'CREATE',
      });
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof HttpError)) throw error;
      outcomes.push({
        kind: 'HSN',
        key: code!,
        outcome: 'NEEDS_REVIEW',
        detail: 'Source HSN is invalid or existing HSN requires review',
      });
    }
  }
  return outcomes;
}
export async function disposableBusinessSnapshot() {
  const [factories, distributors, stores, seasons, sizes, styles, images] = await Promise.all([
    prisma.factory.findMany({ orderBy: { code: 'asc' } }),
    prisma.distributor.findMany({ orderBy: { code: 'asc' } }),
    prisma.retailStore.findMany({ include: { distributor: true }, orderBy: { code: 'asc' } }),
    prisma.season.findMany({ include: { financialYear: true }, orderBy: { code: 'asc' } }),
    prisma.size.findMany({ orderBy: { code: 'asc' } }),
    prisma.style.findMany({
      include: {
        season: { include: { financialYear: true } },
        styleSizes: { include: { size: true } },
        styleFactoryMappings: { include: { factory: true } },
      },
      orderBy: { styleNumber: 'asc' },
    }),
    prisma.styleImage.findMany({
      include: { style: true, file: true },
      orderBy: [{ styleId: 'asc' }, { sortOrder: 'asc' }],
    }),
  ]);
  const withoutIds = (record: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(record).filter(
        ([key]) =>
          ![
            'id',
            'createdAt',
            'updatedAt',
            'distributor',
            'season',
            'styleSizes',
            'styleFactoryMappings',
          ].includes(key) && !key.endsWith('Id'),
      ),
    );
  const media = [];
  for (const image of images) {
    const bytes = await getFileStorage().read(image.file.storageKey);
    const actual = rebuildChecksum(bytes);
    if (!image.file.checksumSha256 || actual !== image.file.checksumSha256)
      throw new RebuildSafetyError('Stored Style image checksum verification failed');
    media.push({
      styleNumber: image.style.styleNumber,
      sortOrder: image.sortOrder,
      primary: image.isPrimary,
      sha256: actual,
    });
  }
  media.sort((a, b) => a.styleNumber.localeCompare(b.styleNumber) || a.sortOrder - b.sortOrder);
  const business = {
    factories: factories.map((factory) => withoutIds(factory)),
    distributors: distributors.map((distributor) => withoutIds(distributor)),
    stores: stores.map((store) => ({
      ...withoutIds(store),
      distributor: {
        code: store.distributor.code,
        name: store.distributor.name,
        purchaseMode: store.distributor.purchaseMode,
      },
    })),
    seasons: seasons.map((season) => ({
      code: season.code,
      name: season.name,
      status: season.status,
      financialYear: season.financialYear.code,
      barcodeSerial: season.barcodeSerial,
    })),
    sizes: sizes.map((size) => withoutIds(size)),
    styles: styles.map((style) => ({
      ...withoutIds(style),
      styleNumber: style.styleNumber,
      name: style.styleName,
      lmixNumber: style.lmixNumber,
      finalMrp: String(style.finalMrp),
      status: style.status,
      season: style.season.code,
      financialYear: style.season.financialYear.code,
      sizes: style.styleSizes
        .map((size) => ({ code: size.size.code, barcode: size.barcode, status: size.status }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      factories: style.styleFactoryMappings
        .map((mapping) => ({
          code: mapping.factory.code,
          price: String(mapping.exFactoryPrice),
          status: mapping.status,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    })),
    media,
  };
  return {
    version: 'business-snapshot-v1',
    counts: {
      factories: factories.length,
      distributors: distributors.length,
      stores: stores.length,
      seasons: seasons.length,
      sizes: sizes.length,
      styles: styles.length,
      barcodes: styles.reduce((count, style) => count + style.styleSizes.length, 0),
      images: images.length,
    },
    checksum: rebuildChecksum(JSON.stringify(business)),
    business,
  };
}
export async function executeDisposableRebuild(config: unknown, options: Options, deps: Deps) {
  const planned = await planDisposableRebuild(config, { ...options, execute: true });
  const report: Record<string, unknown> = {
    version: 'disposable-rebuild-v1',
    target: planned.target,
    manifestSha256: planned.loaded.manifestSha256,
    inputChecksums: Object.fromEntries(
      Object.entries(planned.loaded.files).map(([name, file]) => [name, file.sha256]),
    ),
    syntheticCorrections: planned.config.syntheticCorrections,
    stages: [],
    startedAt: new Date().toISOString(),
    status: 'EXECUTING',
  };
  const reportPath = path.join(planned.config.reportRoot, `run-${randomUUID()}.json`);
  return prisma.$transaction(
    async (lock) => {
      const [acquired] = await lock.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended('erve-disposable-rebuild', 0)) AS locked`;
      if (!acquired?.locked) throw new RebuildSafetyError('Another rebuild owns this target');
      const current = await targetStatus(planned.config);
      await assertRebuildPaths(planned.config);
      await inspectRoot(
        planned.config.reportRoot,
        `${planned.config.databaseName}:${planned.config.disposableId}`,
        current.owned,
      );
      await inspectRoot(
        planned.config.mediaRoot,
        `${planned.config.databaseName}:${planned.config.disposableId}`,
        current.owned,
      );
      await claimRoots(planned.config);
      // Persist ownership independently of the long-lived advisory-lock transaction,
      // so process interruption cannot roll back the marker after masters committed.
      if (!current.owned)
        await prisma.$executeRawUnsafe(
          `COMMENT ON DATABASE "${planned.config.databaseName}" IS '${databaseOwner(planned.config)}'`,
        );
      const stages = report.stages as Array<{ stage: string; result: unknown }>;
      const stage = async (name: string, action: () => Promise<unknown>) => {
        const result = await action();
        stages.push({ stage: name, result });
        await writeFile(reportPath, JSON.stringify(report, null, 2));
        await deps.afterStage?.(name);
        return result;
      };
      try {
        await stage('migrations', deps.migrate);
        const bootstrapOptions = { nodeEnv: env.NODE_ENV, confirmProduction: false };
        await stage('roles', () =>
          runRolesBootstrap(bootstrapOptions, { databaseUrl: env.DATABASE_URL }),
        );
        const admin = await runAdminBootstrap(
          {
            ...bootstrapOptions,
            email: planned.config.adminEmail,
            name: planned.config.adminName,
            resetPassword: false,
            getPassword: deps.getAdminPassword,
          },
          { databaseUrl: env.DATABASE_URL },
        );
        await stage('admin', async () => admin);
        const actor = toCurrentUser(
          await prisma.user.findUniqueOrThrow({
            where: { id: admin.userId },
            select: currentUserSelect,
          }),
        );
        await requireMasterImportActor(actor);
        await stage('financial-years', () =>
          runFinancialYearBootstrap(bootstrapOptions, { databaseUrl: env.DATABASE_URL }),
        );
        await stage('quality', () =>
          runQualityBootstrap(bootstrapOptions, { databaseUrl: env.DATABASE_URL }),
        );
        await stage('gst-definitions', () => ensureCurrentGarmentGstRuleSet(null));
        await stage('references', () =>
          references(actor, planned.loaded, planned.config.styleWorksheet),
        );
        for (const [name, kind] of [
          ['factories', 'factories'],
          ['distributors', 'distributors'],
          ['retailStores', 'retail-stores'],
        ] as const) {
          const file = planned.loaded.files[name];
          await stage(kind, async () => {
            const plan = await planMasterImport(
              actor,
              kind,
              file.buffer,
              file.fileName,
              planned.config.businessWorksheets[name],
            );
            return executeMasterImport(
              actor,
              kind,
              file.buffer,
              file.fileName,
              planned.config.businessWorksheets[name],
              plan.confirmationToken,
            );
          });
        }
        const styles = planned.loaded.files.styles;
        await stage('styles', async () => {
          const plan = await planBulkStyleImport(styles.buffer, planned.config.styleWorksheet);
          return {
            preview: plan.rows.map((row) => ({
              rowNumber: row.rowNumber,
              status: row.status,
              reason: row.reason,
              detail: row.detail,
            })),
            warnings: plan.fileLevelImageWarnings,
            execution: await executeBulkStyleImport(actor, plan, styles.fileName),
          };
        });
        report.snapshot = await disposableBusinessSnapshot();
        report.schemaRevision =
          await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
        const issues = summarizeRebuildIssues(stages);
        report.issues = issues;
        const importExceptions = issues.exceptions > 0 || issues.failures > 0;
        report.status = issues.failures
          ? 'COMPLETED_WITH_FAILURES'
          : importExceptions
            ? 'COMPLETED_WITH_EXCEPTIONS'
            : 'COMPLETED';
        report.readiness = {
          engineering: issues.failures ? 'NEEDS_ATTENTION' : 'VERIFIED_FOR_THIS_RUN',
          business:
            importExceptions ||
            planned.config.syntheticCorrections.length ||
            Number(
              planned.loaded.manifest.counts &&
                typeof planned.loaded.manifest.counts === 'object' &&
                'exceptions' in planned.loaded.manifest.counts
                ? planned.loaded.manifest.counts.exceptions
                : 0,
            )
              ? 'NEEDS_REVIEW'
              : 'SOURCE_ROWS_LOADED',
          activation: 'NOT_AUTHORIZED',
        };
      } catch (error) {
        report.status = 'INTERRUPTED';
        report.error =
          'Rebuild interrupted; inspect recorded stages and retry the sealed inputs on this owned target';
        await writeFile(reportPath, JSON.stringify(report, null, 2));
        throw error;
      }
      report.completedAt = new Date().toISOString();
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      return { reportPath, report };
    },
    { timeout: 2 * 60 * 60 * 1000 },
  );
}
