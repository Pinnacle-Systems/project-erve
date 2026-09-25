// H3A — forward-only, re-run-safe import of the sealed historical bundle
// into ANY environment (Production, a Production-clone rehearsal, or Dev
// as a cross-check), resolving every identity from business keys only.
//
//   planH3aImport      READ-ONLY. Classifies every entity as MISSING_CREATE /
//                      EXACT_EXISTING / SAFE_BACKFILL / CONFLICT. Callers run
//                      it inside runReadOnly(), a Postgres READ ONLY
//                      transaction, so it provably cannot write, allocate a
//                      sequence value, or touch updatedAt.
//   executeH3aImport   Re-plans, refuses on ANY conflict/problem, then creates
//                      only what is missing through the normal domain
//                      services (createFactory, createSeason, createStyle,
//                      updateStyle for null-only backfill, addStyleSize,
//                      addStyleFactory, commitHistoricalJobOrders). An exact
//                      re-run is a NO_CHANGE no-op with zero writes.
//   verifyH3aImport    READ-ONLY post-import reconciliation.
//
// Never deletes, never overwrites a populated value, never rewinds a
// sequence, never creates Sizes or Process Flows, and never creates any
// live-workflow row (commitHistoricalJobOrders / importHistoricalJobOrder
// enforce the false-history guarantee).
import { prisma } from '../../../db/prisma.js';
import type { Prisma } from '../../../db/prisma.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from '../../../auth/current-user.js';
import { addStyleFactory, addStyleSize, createFactory, createSeason, createStyle, updateStyle } from '../../master-data/master-data.service.js';
import {
  commitHistoricalJobOrders,
  findImportBatchByLabel,
  planHistoricalJobOrderCommit,
  snapshotJobOrderSequences,
  verifyCommittedBatch,
  type HistoricalBatchIdentity,
  type HistoricalCommitRecord,
  type BatchVerification,
} from '../historical-job-order-commit.service.js';
import { computeStageStructureFingerprint, resolveProcessFlowVersionByStageStructure } from '../process-flow-pin.js';
import { H3A_APPROVED_DATASET, H3A_MIGRATION_VERSION, money, readVerifiedBundleFile, type BundleStyleSpec, type LoadedBundle } from './bundle.js';
import type { TargetProfile } from './target-profiles.js';

type Client = Prisma.TransactionClient | typeof prisma;

export type EntityAction = 'MISSING_CREATE' | 'EXACT_EXISTING' | 'SAFE_BACKFILL' | 'CONFLICT';

export class H3aImportError extends Error {}

/** Runs fn inside a Postgres READ ONLY transaction — any write attempt fails at the database. */
export async function runReadOnly<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return fn(tx);
    },
    { timeout: 15 * 60_000, maxWait: 60_000 },
  );
}

export interface FactoryPlan {
  canonicalName: string;
  code: string;
  name: string;
  action: EntityAction;
  factoryId: string | null;
  detail: string;
}
export interface SeasonPlan {
  code: string;
  name: string;
  financialYearCode: string;
  action: EntityAction;
  seasonId: string | null;
  financialYearId: string | null;
  detail: string;
}
export interface SizePlan {
  sourceSizeCode: string;
  targetSizeCode: string;
  action: 'EXACT_EXISTING' | 'CONFLICT';
  sizeId: string | null;
  detail: string;
}
export interface StylePlan {
  season: string;
  lmix: string;
  styleNumber: string;
  legacyReferenceNumbers: string[];
  action: EntityAction;
  styleId: string | null;
  backfill: Record<string, string>;
  sizesToCreate: string[];
  sizesExisting: number;
  mapping: 'CREATE' | 'EXACT' | 'CONFLICT';
  image: 'UPLOAD' | 'EXACT' | 'CONFLICT' | 'NONE';
  differences: string[];
}
export interface JobOrderPlan {
  legacyReferenceNumber: string;
  action: 'MISSING_CREATE' | 'EXACT_EXISTING' | 'CONFLICT';
  jobOrderId: string | null;
  jobOrderNumber: string | null;
  differences: string[];
}

export interface H3aPlan {
  plannedAt: string;
  targetProfile: string;
  bundleSha256: string;
  admin: { id: string; name: string } | null;
  processFlow: { versionId: string | null; processFlowCode: string; versionNumber: number; stageStructureFingerprint: string; fingerprint: string | null; detail: string };
  factories: FactoryPlan[];
  seasons: SeasonPlan[];
  sizes: SizePlan[];
  styles: StylePlan[];
  jobOrders: JobOrderPlan[];
  importBatch: { id: string | null; status: string | null; startedById: string | null; detail: string };
  sequences: Awaited<ReturnType<typeof snapshotJobOrderSequences>>;
  existingHistorical: { jobOrders: number; importBatches: number; historicalDocuments: number };
  counts: Record<string, Record<string, number>>;
  problems: string[];
  gateOk: boolean;
  noOp: boolean;
}

const tally = <T extends { action: string }>(rows: T[]) => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }), {});

async function resolveAdmin(client: Client, adminEmail: string | undefined, problems: string[]): Promise<CurrentUser | null> {
  const admins = await client.user.findMany({
    where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'ADMIN' } } }, ...(adminEmail ? { email: adminEmail.trim().toLowerCase() } : {}) },
    select: currentUserSelect,
  });
  if (admins.length === 1) return toCurrentUser(admins[0]!);
  problems.push(
    adminEmail
      ? `Importer "${adminEmail}" is not exactly one ACTIVE ADMIN in this database`
      : `${admins.length} ACTIVE ADMIN users exist — pass --admin-email to name the importer explicitly (never guessed)`,
  );
  return null;
}

/** READ-ONLY. See module comment. */
export async function planH3aImport(client: Client, loaded: LoadedBundle, profile: TargetProfile, options: { adminEmail?: string } = {}): Promise<H3aPlan> {
  const { bundle } = loaded;
  const problems: string[] = [];
  const admin = await resolveAdmin(client, options.adminEmail, problems);

  // --- Process flow: the profile's flow, accepted only on the approved stage
  // structure with exactly the profile's explicitly accepted deviations.
  const approvedFlow = bundle.provenance.approvedProcessFlow;
  const deviations = profile.processFlow.acceptedStageDeviations;
  const expectedStages = approvedFlow.stages.map((stage) => {
    const deviation = deviations.find((d) => d.sequence === stage.sequence);
    if (!deviation) return stage;
    if (stage[deviation.field] !== deviation.approvedValue) problems.push(`Profile deviation for stage ${stage.sequence} expects approved ${deviation.field}=${deviation.approvedValue}, bundle has ${stage[deviation.field]}`);
    return { ...stage, [deviation.field]: deviation.targetValue };
  });
  const expectedStructure = computeStageStructureFingerprint(expectedStages);
  let processFlow: H3aPlan['processFlow'] = {
    versionId: null,
    processFlowCode: profile.processFlow.processFlowCode,
    versionNumber: profile.processFlow.versionNumber,
    stageStructureFingerprint: expectedStructure,
    fingerprint: null,
    detail: '',
  };
  try {
    const pin = await resolveProcessFlowVersionByStageStructure(client, {
      processFlowCode: profile.processFlow.processFlowCode,
      versionNumber: profile.processFlow.versionNumber,
      stageStructureFingerprint: expectedStructure,
    });
    processFlow = {
      ...processFlow,
      versionId: pin.devProcessFlowVersionId,
      fingerprint: pin.logicalIdentity.fingerprint,
      detail:
        `ACTIVE ${profile.processFlow.processFlowCode} v${profile.processFlow.versionNumber} matches the approved v${approvedFlow.versionNumber} stage structure (${pin.logicalIdentity.stages.length} stages)` +
        (deviations.length ? ` with ${deviations.length} accepted deviation(s): ${deviations.map((d) => `stage ${d.sequence} ${d.field} ${d.approvedValue}->${d.targetValue}`).join(', ')}` : ''),
    };
  } catch (error) {
    processFlow.detail = error instanceof Error ? error.message : String(error);
    problems.push(`Process flow: ${processFlow.detail}`);
  }

  // --- Factories
  const allFactories = await client.factory.findMany({ select: { id: true, code: true, name: true, status: true } });
  const factories: FactoryPlan[] = [];
  for (const canonicalName of [...new Set(bundle.styles.map((s) => s.factory))].sort()) {
    const target = profile.factories[canonicalName];
    if (!target) {
      problems.push(`Factory "${canonicalName}": no target in profile ${profile.name}`);
      factories.push({ canonicalName, code: '', name: '', action: 'CONFLICT', factoryId: null, detail: 'No profile target' });
      continue;
    }
    const byCode = allFactories.find((f) => f.code === target.code);
    const byName = allFactories.filter((f) => f.name.trim().toLowerCase() === target.name.trim().toLowerCase());
    let row: FactoryPlan;
    if (byCode) {
      const exact = byCode.name === target.name && byCode.status === 'ACTIVE';
      row = { canonicalName, code: target.code, name: target.name, action: exact ? 'EXACT_EXISTING' : 'CONFLICT', factoryId: byCode.id, detail: exact ? 'exists (code+name, ACTIVE)' : `code ${target.code} is "${byCode.name}" (${byCode.status})` };
    } else if (byName.length > 0) {
      row = { canonicalName, code: target.code, name: target.name, action: 'CONFLICT', factoryId: null, detail: `name "${target.name}" already used by code(s) ${byName.map((f) => f.code).join(', ')}` };
    } else if (target.createIfMissing) {
      row = { canonicalName, code: target.code, name: target.name, action: 'MISSING_CREATE', factoryId: null, detail: 'absent; approved for creation' };
    } else {
      row = { canonicalName, code: target.code, name: target.name, action: 'CONFLICT', factoryId: null, detail: 'absent and not approved for creation in this profile' };
    }
    if (row.action === 'CONFLICT') problems.push(`Factory ${canonicalName}: ${row.detail}`);
    factories.push(row);
  }
  const factoryIdByCanonical = new Map(factories.filter((f) => f.factoryId).map((f) => [f.canonicalName, f.factoryId!] as const));

  // --- Seasons
  const seasons: SeasonPlan[] = [];
  for (const spec of bundle.seasons) {
    const fy = await client.financialYear.findUnique({ where: { code: spec.financialYearCode }, select: { id: true } });
    const existing = await client.season.findMany({ where: { code: spec.code }, include: { financialYear: { select: { code: true } } } });
    let row: SeasonPlan;
    if (existing.length > 1) {
      row = { ...spec, action: 'CONFLICT', seasonId: null, financialYearId: fy?.id ?? null, detail: `${existing.length} Seasons carry code ${spec.code}` };
    } else if (existing.length === 1) {
      const e = existing[0]!;
      const exact = e.name === spec.name && e.financialYear.code === spec.financialYearCode;
      row = { ...spec, action: exact ? 'EXACT_EXISTING' : 'CONFLICT', seasonId: e.id, financialYearId: e.financialYearId, detail: exact ? 'exists' : `existing is "${e.name}" in FY ${e.financialYear.code}` };
    } else if (!fy) {
      row = { ...spec, action: 'CONFLICT', seasonId: null, financialYearId: null, detail: `Financial Year ${spec.financialYearCode} does not exist (never created by this importer)` };
    } else {
      row = { ...spec, action: 'MISSING_CREATE', seasonId: null, financialYearId: fy.id, detail: 'absent; will be created' };
    }
    if (row.action === 'CONFLICT') problems.push(`Season ${spec.code}: ${row.detail}`);
    seasons.push(row);
  }
  const seasonIdByCode = new Map(seasons.filter((s) => s.seasonId).map((s) => [s.code, s.seasonId!] as const));

  // --- Sizes (resolved only, never created)
  const sizes: SizePlan[] = [];
  for (const sourceSizeCode of [...new Set(bundle.styles.flatMap((s) => s.sourceSizeCodes))].sort((a, b) => Number(a) - Number(b))) {
    const targetSizeCode = profile.sizeCodeBySource[sourceSizeCode];
    const size = targetSizeCode ? await client.size.findUnique({ where: { code: targetSizeCode }, select: { id: true, status: true } }) : null;
    const ok = size?.status === 'ACTIVE';
    const row: SizePlan = {
      sourceSizeCode,
      targetSizeCode: targetSizeCode ?? '',
      action: ok ? 'EXACT_EXISTING' : 'CONFLICT',
      sizeId: ok ? size!.id : null,
      detail: !targetSizeCode ? 'no profile mapping' : !size ? `Size ${targetSizeCode} does not exist` : ok ? 'exists (ACTIVE)' : `Size ${targetSizeCode} is ${size.status}`,
    };
    if (!ok) problems.push(`Size ${sourceSizeCode}: ${row.detail}`);
    sizes.push(row);
  }
  const sizeIdBySource = new Map(sizes.filter((s) => s.sizeId).map((s) => [s.sourceSizeCode, s.sizeId!] as const));

  // --- Styles
  const styles: StylePlan[] = [];
  for (const spec of bundle.styles) {
    styles.push(await planStyle(client, spec, { profile, seasonId: seasonIdByCode.get(spec.season) ?? null }));
  }
  for (const s of styles.filter((r) => r.action === 'CONFLICT')) problems.push(`Style ${s.styleNumber}: ${s.differences.join('; ')}`);
  const styleIdByKey = new Map(styles.filter((s) => s.styleId).map((s) => [`${s.season}|${s.lmix}`, s.styleId!] as const));

  // --- Import batch
  const importBatch: H3aPlan['importBatch'] = { id: null, status: null, startedById: null, detail: 'no batch yet — will be created' };
  let batchId: string | null = null;
  try {
    const batch = await findImportBatchByLabel(client, bundle.batchLabel);
    if (batch) {
      batchId = batch.id;
      Object.assign(importBatch, { id: batch.id, status: batch.status, startedById: batch.startedById, detail: 'existing batch for this label' });
      const notes = batch.notes ? (JSON.parse(batch.notes) as { sourceManifestAggregateSha256?: string }) : {};
      if (notes.sourceManifestAggregateSha256 !== bundle.provenance.sourceManifestAggregateSha256) problems.push(`ImportBatch ${batch.id} was created from a different source manifest`);
      if (processFlow.versionId && batch.processFlowVersionId !== processFlow.versionId) problems.push(`ImportBatch ${batch.id} is pinned to a different process flow version`);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  // --- Job Orders
  const records = buildCommitRecords(loaded, { factoryIdByCanonical, styleIdByKey, sizeIdBySource });
  const existingByRef = new Map<string, number>();
  for (const jo of await client.jobOrder.findMany({ where: { legacyReferenceNumber: { in: bundle.jobOrders.map((j) => j.legacyReferenceNumber) } }, select: { legacyReferenceNumber: true } })) {
    existingByRef.set(jo.legacyReferenceNumber!, (existingByRef.get(jo.legacyReferenceNumber!) ?? 0) + 1);
  }
  const resolvable = records.filter((r) => r.resolved);
  const commitPlan = processFlow.versionId
    ? await planHistoricalJobOrderCommit(client, { importBatchId: batchId, processFlowVersionId: processFlow.versionId, records: resolvable.map((r) => r.record) })
    : [];
  const commitPlanByRef = new Map(commitPlan.map((p) => [p.legacyReferenceNumber, p] as const));
  const jobOrders: JobOrderPlan[] = records.map(({ record, resolved }) => {
    const ref = record.legacyReferenceNumber;
    const planned = commitPlanByRef.get(ref);
    if (!resolved || !planned) {
      const count = existingByRef.get(ref) ?? 0;
      return count > 0
        ? { legacyReferenceNumber: ref, action: 'CONFLICT', jobOrderId: null, jobOrderNumber: null, differences: [`${count} Job Order(s) already carry "${ref}" but its masters do not all exist yet`] }
        : { legacyReferenceNumber: ref, action: 'MISSING_CREATE', jobOrderId: null, jobOrderNumber: null, differences: [] };
    }
    return {
      legacyReferenceNumber: ref,
      action: planned.action === 'CREATE' ? 'MISSING_CREATE' : planned.action === 'VERIFY_EXISTING' ? 'EXACT_EXISTING' : 'CONFLICT',
      jobOrderId: planned.existingJobOrderId,
      jobOrderNumber: planned.existingJobOrderNumber,
      differences: planned.differences,
    };
  });
  for (const j of jobOrders.filter((r) => r.action === 'CONFLICT')) problems.push(`Job Order ${j.legacyReferenceNumber}: ${j.differences.join('; ')}`);

  const [historicalJobOrders, importBatches, historicalDocuments] = await Promise.all([
    client.jobOrder.count({ where: { recordOrigin: 'HISTORICAL_IMPORT' } }),
    client.importBatch.count(),
    client.historicalDocument.count(),
  ]);
  const allExact = (rows: Array<{ action: string }>) => rows.every((r) => r.action === 'EXACT_EXISTING');
  const noOp =
    problems.length === 0 &&
    allExact(factories) &&
    allExact(seasons) &&
    allExact(styles) &&
    allExact(jobOrders) &&
    importBatch.status === 'COMPLETED';

  return {
    plannedAt: new Date().toISOString(),
    targetProfile: profile.name,
    bundleSha256: loaded.bundleSha256,
    admin: admin ? { id: admin.id, name: admin.name } : null,
    processFlow,
    factories,
    seasons,
    sizes,
    styles,
    jobOrders,
    importBatch,
    sequences: await snapshotJobOrderSequences(client),
    existingHistorical: { jobOrders: historicalJobOrders, importBatches, historicalDocuments },
    counts: {
      factories: tally(factories),
      seasons: tally(seasons),
      sizes: tally(sizes),
      styles: tally(styles),
      styleSizesToCreate: { total: styles.reduce((n, s) => n + s.sizesToCreate.length, 0), existing: styles.reduce((n, s) => n + s.sizesExisting, 0) },
      styleFactoryMappings: tally(styles.map((s) => ({ action: s.mapping }))),
      images: tally(styles.map((s) => ({ action: s.image }))),
      jobOrders: tally(jobOrders),
    },
    problems,
    gateOk: problems.length === 0,
    noOp,
  };
}

const STRICT_STYLE_FIELDS = ['styleNumber', 'styleName', 'description', 'colour', 'ipName', 'licensor'] as const;
const BACKFILL_STYLE_FIELDS = [
  ['categoryDescription', 'categoryDescription'],
  ['hsnCode', 'hsnCode'],
  ['hsnDescription', 'hsnDescription'],
] as const;

async function planStyle(client: Client, spec: BundleStyleSpec, ctx: { profile: TargetProfile; seasonId: string | null }): Promise<StylePlan> {
  const base: StylePlan = {
    season: spec.season,
    lmix: spec.lmix,
    styleNumber: spec.styleNumber,
    legacyReferenceNumbers: spec.legacyReferenceNumbers,
    action: 'MISSING_CREATE',
    styleId: null,
    backfill: {},
    sizesToCreate: [...spec.sourceSizeCodes],
    sizesExisting: 0,
    mapping: 'CREATE',
    image: spec.image ? 'UPLOAD' : 'NONE',
    differences: [],
  };
  const byNumber = await client.style.findUnique({ where: { styleNumber: spec.styleNumber }, select: { id: true, seasonId: true, lmixNumber: true } });
  const matches = ctx.seasonId
    ? await client.style.findMany({
        where: { seasonId: ctx.seasonId, lmixNumber: spec.lmix },
        include: {
          styleSizes: { select: { size: { select: { code: true } } } },
          styleFactoryMappings: { select: { exFactoryPrice: true, factory: { select: { code: true } } } },
          images: { select: { file: { select: { checksumSha256: true } } } },
        },
      })
    : [];
  if (matches.length > 1) return { ...base, action: 'CONFLICT', differences: [`${matches.length} Styles match Season ${spec.season} + ${spec.lmix}`] };
  if (matches.length === 0) {
    if (byNumber) return { ...base, action: 'CONFLICT', differences: [`styleNumber ${spec.styleNumber} is already used by a different Style (${byNumber.id})`] };
    return base;
  }

  const e = matches[0]!;
  const diffs: string[] = [];
  if (byNumber && byNumber.id !== e.id) diffs.push(`styleNumber ${spec.styleNumber} is held by another Style (${byNumber.id})`);
  for (const field of STRICT_STYLE_FIELDS) {
    const actual = e[field] ?? null;
    const wanted = spec[field] ?? null;
    if (actual !== wanted) diffs.push(`${field}: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(actual)}`);
  }
  if (money(e.finalMrp.toString()) !== spec.finalMrp) diffs.push(`finalMrp: expected ${spec.finalMrp}, found ${e.finalMrp.toString()}`);
  if (e.status !== 'ACTIVE') diffs.push(`status: expected ACTIVE, found ${e.status}`);

  const backfill: Record<string, string> = {};
  for (const [column, specField] of BACKFILL_STYLE_FIELDS) {
    const actual = e[column] ?? null;
    const wanted = spec[specField] ?? null;
    if (actual === wanted) continue;
    if (actual === null && wanted !== null) backfill[column] = wanted;
    else diffs.push(`${column}: approved ${JSON.stringify(wanted)}, found ${JSON.stringify(actual)} — never overwritten`);
  }

  const targetSizeCodes = spec.sourceSizeCodes.map((c) => ctx.profile.sizeCodeBySource[c] ?? `?${c}`);
  const existingSizeCodes = new Set(e.styleSizes.map((s) => s.size.code));
  const sizesToCreate = spec.sourceSizeCodes.filter((c) => !existingSizeCodes.has(ctx.profile.sizeCodeBySource[c] ?? ''));
  const extraSizes = [...existingSizeCodes].filter((c) => !targetSizeCodes.includes(c));
  if (extraSizes.length) diffs.push(`Style has size(s) outside the approved set: ${extraSizes.join(', ')}`);

  const factoryCode = ctx.profile.factories[spec.factory]?.code;
  const ownMapping = e.styleFactoryMappings.find((m) => m.factory.code === factoryCode);
  const otherMappings = e.styleFactoryMappings.filter((m) => m.factory.code !== factoryCode);
  let mapping: StylePlan['mapping'] = 'CREATE';
  if (ownMapping) {
    mapping = money(ownMapping.exFactoryPrice.toString()) === spec.exFactoryPrice ? 'EXACT' : 'CONFLICT';
    if (mapping === 'CONFLICT') diffs.push(`ex-factory rate: approved ${spec.exFactoryPrice}, found ${ownMapping.exFactoryPrice.toString()} — never overwritten`);
  }
  if (otherMappings.length) {
    mapping = 'CONFLICT';
    diffs.push(`Style is mapped to other factory(ies): ${otherMappings.map((m) => m.factory.code).join(', ')}`);
  }

  let image: StylePlan['image'] = spec.image ? 'UPLOAD' : 'NONE';
  if (spec.image) {
    if (e.images.some((i) => i.file.checksumSha256 === spec.image!.sha256)) image = 'EXACT';
    else if (e.images.length > 0) {
      image = 'CONFLICT';
      diffs.push('Style already has a different image — never replaced');
    }
  }

  const needsWork = Object.keys(backfill).length > 0 || sizesToCreate.length > 0 || mapping === 'CREATE' || image === 'UPLOAD';
  return {
    ...base,
    action: diffs.length ? 'CONFLICT' : needsWork ? 'SAFE_BACKFILL' : 'EXACT_EXISTING',
    styleId: e.id,
    backfill,
    sizesToCreate,
    sizesExisting: spec.sourceSizeCodes.length - sizesToCreate.length,
    mapping,
    image,
    differences: diffs,
  };
}

interface ResolvedIds {
  factoryIdByCanonical: Map<string, string>;
  styleIdByKey: Map<string, string>;
  sizeIdBySource: Map<string, string>;
}

/** Builds the commit records H2B's commitHistoricalJobOrders consumes, with this environment's freshly-resolved ids. */
function buildCommitRecords(loaded: LoadedBundle, ids: ResolvedIds): Array<{ record: HistoricalCommitRecord; resolved: boolean }> {
  const { bundle, bundleDir } = loaded;
  const styleByKey = new Map(bundle.styles.map((s) => [`${s.season}|${s.lmix}`, s] as const));
  return bundle.jobOrders.map((j) => {
    const style = styleByKey.get(`${j.season}|${j.lmix}`)!;
    const factoryId = ids.factoryIdByCanonical.get(j.factory);
    const styleId = ids.styleIdByKey.get(`${j.season}|${j.lmix}`);
    const sizeIds = j.sizes.map((z) => ids.sizeIdBySource.get(z.sourceSizeCode));
    const resolved = Boolean(factoryId && styleId && sizeIds.every(Boolean));
    const record: HistoricalCommitRecord = {
      sourceFileName: j.sourcePdf.fileName,
      sourceSha256: j.sourcePdf.sha256,
      sourceSizeBytes: j.sourcePdf.sizeBytes,
      legacyReferenceNumber: j.legacyReferenceNumber,
      seasonCode: j.season,
      lmix: j.lmix,
      factoryId: factoryId ?? '',
      styleId: styleId ?? '',
      historicalBusinessDate: j.historicalBusinessDate,
      requiredDeliveryDate: j.requiredDeliveryDate,
      unitPrice: j.unitPrice,
      sizes: j.sizes.map((z, i) => ({ sourceSizeCode: z.sourceSizeCode, sizeId: sizeIds[i] ?? '', quantity: z.quantity })),
      sourceSnapshot: j.sourceSnapshot as Prisma.InputJsonValue,
      migrationNotes: j.migrationNotes,
      disclaimerText: j.disclaimerText,
      styleDescription: j.styleDescription,
      styleName: j.styleName,
      loadSourcePdf: () => readVerifiedBundleFile(bundleDir, j.sourcePdf),
      image: style.image ? { sha256: style.image.sha256, fileName: style.image.fileName, load: () => readVerifiedBundleFile(bundleDir, style.image!) } : null,
    };
    return { record, resolved };
  });
}

function idsFromPlan(plan: H3aPlan): ResolvedIds {
  return {
    factoryIdByCanonical: new Map(plan.factories.filter((f) => f.factoryId).map((f) => [f.canonicalName, f.factoryId!] as const)),
    styleIdByKey: new Map(plan.styles.filter((s) => s.styleId).map((s) => [`${s.season}|${s.lmix}`, s.styleId!] as const)),
    sizeIdBySource: new Map(plan.sizes.filter((s) => s.sizeId).map((s) => [s.sourceSizeCode, s.sizeId!] as const)),
  };
}

export interface ExecuteResult {
  outcome: 'NO_CHANGE' | 'IMPORTED';
  before: H3aPlan;
  after: H3aPlan;
  created: { factories: string[]; seasons: string[]; styles: number; styleBackfills: number; styleSizes: number; styleFactoryMappings: number };
  commit: Awaited<ReturnType<typeof commitHistoricalJobOrders>> | null;
}

/** Forward-only execute. Refuses on any problem; an exact re-run is a zero-write NO_CHANGE. */
export async function executeH3aImport(
  loaded: LoadedBundle,
  profile: TargetProfile,
  options: { adminEmail?: string; applicationCommit: string | null; onProgress?: (m: string) => void },
): Promise<ExecuteResult> {
  const log = options.onProgress ?? (() => undefined);
  const before = await runReadOnly((tx) => planH3aImport(tx, loaded, profile, options));
  if (!before.gateOk) throw new H3aImportError(`Preflight gate failed — nothing written:\n  ${before.problems.join('\n  ')}`);
  const created: ExecuteResult['created'] = { factories: [], seasons: [], styles: 0, styleBackfills: 0, styleSizes: 0, styleFactoryMappings: 0 };
  if (before.noOp) return { outcome: 'NO_CHANGE', before, after: before, created, commit: null };

  const adminRecord = await prisma.user.findUniqueOrThrow({ where: { id: before.admin!.id }, select: currentUserSelect });
  const actor = toCurrentUser(adminRecord);

  for (const f of before.factories.filter((r) => r.action === 'MISSING_CREATE')) {
    await createFactory(actor, { code: f.code, name: f.name, status: 'ACTIVE' });
    created.factories.push(f.code);
    log(`Factory created: ${f.code} ${f.name}`);
  }
  for (const s of before.seasons.filter((r) => r.action === 'MISSING_CREATE')) {
    await createSeason(actor, { code: s.code, name: s.name, financialYearId: s.financialYearId!, status: 'ACTIVE' });
    created.seasons.push(s.code);
    log(`Season created: ${s.code}`);
  }

  // Fresh read-only re-plan so every id below is resolved from the database, not carried over.
  const mid = await runReadOnly((tx) => planH3aImport(tx, loaded, profile, options));
  if (!mid.gateOk) throw new H3aImportError(`Re-plan after master creation failed:\n  ${mid.problems.join('\n  ')}`);
  const ids = idsFromPlan(mid);
  const specByKey = new Map(loaded.bundle.styles.map((s) => [`${s.season}|${s.lmix}`, s] as const));
  const seasonId = new Map(mid.seasons.map((s) => [s.code, s.seasonId!] as const));

  for (const sp of mid.styles) {
    const spec = specByKey.get(`${sp.season}|${sp.lmix}`)!;
    let styleId = sp.styleId;
    if (sp.action === 'MISSING_CREATE') {
      const style = await createStyle(actor, {
        styleNumber: spec.styleNumber,
        styleName: spec.styleName,
        description: spec.description ?? undefined,
        colour: spec.colour ?? undefined,
        lmixNumber: spec.lmix,
        hsnCode: spec.hsnCode ?? undefined,
        hsnDescription: spec.hsnDescription ?? undefined,
        categoryDescription: spec.categoryDescription ?? undefined,
        ipName: spec.ipName ?? undefined,
        licensor: spec.licensor ?? undefined,
        finalMrp: Number(spec.finalMrp),
        seasonId: seasonId.get(spec.season)!,
        status: 'ACTIVE',
      });
      styleId = style.id;
      created.styles++;
    } else if (sp.action === 'SAFE_BACKFILL' && Object.keys(sp.backfill).length > 0) {
      await updateStyle(actor, styleId!, sp.backfill);
      created.styleBackfills++;
    }
    if (!styleId) throw new H3aImportError(`${sp.styleNumber}: no Style id after create`);
    for (const code of sp.sizesToCreate) {
      await addStyleSize(actor, styleId, { sizeId: ids.sizeIdBySource.get(code)! });
      created.styleSizes++;
    }
    if (sp.mapping === 'CREATE') {
      await addStyleFactory(actor, styleId, { factoryId: ids.factoryIdByCanonical.get(spec.factory)!, exFactoryPrice: Number(spec.exFactoryPrice) });
      created.styleFactoryMappings++;
    }
  }
  log(`Styles created ${created.styles}, backfilled ${created.styleBackfills}; StyleSizes ${created.styleSizes}; mappings ${created.styleFactoryMappings}`);

  const ready = await runReadOnly((tx) => planH3aImport(tx, loaded, profile, options));
  if (!ready.gateOk) throw new H3aImportError(`Re-plan before Job Orders failed:\n  ${ready.problems.join('\n  ')}`);
  const records = buildCommitRecords(loaded, idsFromPlan(ready));
  if (records.some((r) => !r.resolved)) throw new H3aImportError('Some Job Order masters are still unresolved after master creation');
  const identity = buildBatchIdentity(loaded, profile, ready, options.applicationCommit);
  const commit = await commitHistoricalJobOrders(actor, { identity, records: records.map((r) => r.record) }, { onProgress: log });
  const imageConflicts = commit.images.filter((i) => i.action === 'REVIEW_CONFLICT');
  if (imageConflicts.length) throw new H3aImportError(`Image REVIEW_CONFLICT for ${imageConflicts.map((i) => i.legacyReferenceNumber).join(', ')}`);

  const after = await runReadOnly((tx) => planH3aImport(tx, loaded, profile, options));
  if (!after.noOp) throw new H3aImportError(`Post-import re-plan is not all EXACT_EXISTING:\n  ${after.problems.join('\n  ') || JSON.stringify(after.counts)}`);
  return { outcome: 'IMPORTED', before, after, created, commit };
}

function buildBatchIdentity(loaded: LoadedBundle, profile: TargetProfile, plan: H3aPlan, applicationCommit: string | null): HistoricalBatchIdentity {
  const p = loaded.bundle.provenance;
  return {
    sourceLabel: loaded.bundle.batchLabel,
    processFlowVersionId: plan.processFlow.versionId!,
    provenance: {
      story: 'H3A',
      description: p.description,
      sourceArchives: p.sourceArchives,
      sourceManifestAggregateSha256: p.sourceManifestAggregateSha256,
      parserVersion: p.parserVersion,
      sourceOverridesSha256: p.sourceOverridesSha256,
      processFlowLogicalIdentity: { processFlowCode: plan.processFlow.processFlowCode, versionNumber: plan.processFlow.versionNumber, fingerprint: plan.processFlow.fingerprint! },
      migrationVersion: H3A_MIGRATION_VERSION,
      bundleSha256: loaded.bundleSha256,
      applicationCommit,
      targetProfile: profile.name,
      approvedProcessFlow: p.approvedProcessFlow,
    },
    counts: { total: 91, ready: 91, reviewRequired: 0, blocked: 0, duplicate: 0 },
  };
}

// ---------------------------------------------------------------------------
// Read-only verification
// ---------------------------------------------------------------------------

export interface RecordReconciliation {
  legacyReferenceNumber: string;
  jobOrderNumber: string | null;
  season: string;
  lmix: string;
  styleNumber: string;
  factory: string;
  orderedPieces: number;
  historicalBusinessDate: string;
  requiredDeliveryDate: string | null;
  finalMrp: string | null;
  exFactoryPrice: string | null;
  categoryDescription: string | null;
  hsnCode: string | null;
  hsnDescription: string | null;
  imageSha256: string | null;
  sourceDocumentSha256: string | null;
  result: 'EXACT_MATCH' | 'MISMATCH';
  differences: string[];
}

export interface H3aVerification {
  verifiedAt: string;
  plan: H3aPlan;
  batch: BatchVerification;
  records: RecordReconciliation[];
  totals: Record<string, unknown>;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

export async function verifyH3aImport(client: Client, loaded: LoadedBundle, profile: TargetProfile, options: { adminEmail?: string } = {}): Promise<H3aVerification> {
  const plan = await planH3aImport(client, loaded, profile, options);
  const ids = idsFromPlan(plan);
  const records = buildCommitRecords(loaded, ids).map((r) => r.record);
  const batch = await verifyCommittedBatch(client, { sourceLabel: loaded.bundle.batchLabel, processFlowVersionId: plan.processFlow.versionId ?? '', records });
  const styleIds = [...ids.styleIdByKey.values()];
  const styleRows = await client.style.findMany({
    where: { id: { in: styleIds } },
    include: {
      styleSizes: { select: { id: true } },
      styleFactoryMappings: { select: { exFactoryPrice: true, factory: { select: { name: true } } } },
      images: { select: { file: { select: { checksumSha256: true } } } },
      season: { select: { code: true } },
    },
  });
  const styleById = new Map(styleRows.map((s) => [s.id, s] as const));
  const perBatch = new Map(batch.perRecord.map((r) => [r.legacyReferenceNumber, r] as const));
  const stylePlanByKey = new Map<string, StylePlan>(plan.styles.map((s) => [`${s.season}|${s.lmix}`, s] as const));
  const specByKey = new Map<string, BundleStyleSpec>(loaded.bundle.styles.map((s) => [`${s.season}|${s.lmix}`, s] as const));

  const recordRows: RecordReconciliation[] = loaded.bundle.jobOrders.map((j) => {
    const key = `${j.season}|${j.lmix}`;
    const sp = stylePlanByKey.get(key)!;
    const spec = specByKey.get(key)!;
    const style = sp.styleId ? styleById.get(sp.styleId) : undefined;
    const b = perBatch.get(j.legacyReferenceNumber);
    const differences = [...(b?.differences ?? ['not found']), ...(sp.action === 'EXACT_EXISTING' ? [] : [`Style ${sp.action}: ${sp.differences.join('; ')}`])];
    const imageSha = style?.images.find((i) => i.file.checksumSha256 === spec.image?.sha256)?.file.checksumSha256 ?? null;
    if (spec.image && !imageSha) differences.push('approved image not present');
    return {
      legacyReferenceNumber: j.legacyReferenceNumber,
      jobOrderNumber: b?.jobOrderNumber ?? null,
      season: j.season,
      lmix: j.lmix,
      styleNumber: spec.styleNumber,
      factory: j.factory,
      orderedPieces: j.sizes.reduce((n, z) => n + z.quantity, 0),
      historicalBusinessDate: j.historicalBusinessDate,
      requiredDeliveryDate: j.requiredDeliveryDate,
      finalMrp: style ? style.finalMrp.toString() : null,
      exFactoryPrice: style?.styleFactoryMappings[0]?.exFactoryPrice.toString() ?? null,
      categoryDescription: style?.categoryDescription ?? null,
      hsnCode: style?.hsnCode ?? null,
      hsnDescription: style?.hsnDescription ?? null,
      imageSha256: imageSha,
      sourceDocumentSha256: b?.result === 'EXACT_MATCH' ? j.sourcePdf.sha256 : null,
      result: differences.length === 0 ? 'EXACT_MATCH' : 'MISMATCH',
      differences,
    };
  });

  const A = H3A_APPROVED_DATASET;
  const hsnDescriptionSet = styleRows.filter((s) => s.hsnDescription).length;
  const reviewNull = loaded.bundle.styles
    .filter((s) => !s.hsnDescription && s.hsnDescriptionClassification !== 'HSN_CODE_ONLY')
    .flatMap((s) => s.legacyReferenceNumbers)
    .sort();
  const totals = {
    styles: styleRows.length,
    styleSizes: styleRows.reduce((n, s) => n + s.styleSizes.length, 0),
    styleFactoryMappings: styleRows.reduce((n, s) => n + s.styleFactoryMappings.length, 0),
    imagesWithApprovedHash: recordRows.filter((r) => r.imageSha256).length,
    categoryPopulated: styleRows.filter((s) => s.categoryDescription).length,
    hsnCodePopulated: styleRows.filter((s) => s.hsnCode).length,
    hsnDescriptionPopulated: hsnDescriptionSet,
    hsnDescriptionNull: styleRows.length - hsnDescriptionSet,
    hsnDescriptionReviewNull: reviewNull,
    jobOrders: batch.jobOrderCountInBatch,
    uniqueLegacyReferences: batch.uniqueLegacyReferences,
    pieces: Object.values(batch.aggregates.bySeason).reduce((n, v) => n + v.quantity, 0),
    bySeason: batch.aggregates.bySeason,
    byFactory: batch.aggregates.byFactory,
    eijohRange: batch.jobOrderNumbers.length ? [batch.jobOrderNumbers[0], batch.jobOrderNumbers.at(-1)] : null,
  };
  const falseHistoryZero = Object.values(batch.falseHistory).every((n) => n === 0);
  const checks = [
    { name: 'gate', ok: plan.gateOk, detail: plan.problems.join('; ') || 'no problems' },
    { name: 'allExact', ok: plan.noOp, detail: JSON.stringify(plan.counts) },
    { name: 'records', ok: recordRows.every((r) => r.result === 'EXACT_MATCH') && batch.mismatch === 0, detail: `${recordRows.filter((r) => r.result === 'EXACT_MATCH').length} EXACT_MATCH / ${recordRows.filter((r) => r.result === 'MISMATCH').length} MISMATCH` },
    { name: 'counts', ok: totals.styles === A.styles && totals.styleSizes === A.styleSizes && totals.styleFactoryMappings === A.styleFactoryMappings && totals.imagesWithApprovedHash === A.images && totals.jobOrders === A.jobOrders && totals.uniqueLegacyReferences === A.jobOrders, detail: `${totals.styles} Styles / ${totals.styleSizes} StyleSizes / ${totals.styleFactoryMappings} mappings / ${totals.imagesWithApprovedHash} images / ${totals.jobOrders} JOs` },
    { name: 'pieces', ok: totals.pieces === A.pieces && Object.entries(A.bySeason).every(([k, v]) => batch.aggregates.bySeason[k]?.jobOrders === v.jobOrders && batch.aggregates.bySeason[k]?.quantity === v.pieces) && Object.entries(A.byFactory).every(([k, v]) => batch.aggregates.byFactory[profile.factories[k]!.name]?.jobOrders === v.jobOrders && batch.aggregates.byFactory[profile.factories[k]!.name]?.quantity === v.pieces), detail: `${totals.pieces} pieces` },
    { name: 'category/hsn', ok: totals.categoryPopulated === A.categoryPopulated && totals.hsnCodePopulated === A.hsnCodePopulated && totals.hsnDescriptionPopulated === A.hsnDescriptionPopulated && JSON.stringify(reviewNull) === JSON.stringify(A.hsnDescriptionReviewNull), detail: `category ${totals.categoryPopulated}, hsnCode ${totals.hsnCodePopulated}, hsnDescription ${totals.hsnDescriptionPopulated} (review null ${reviewNull.join(',')})` },
    { name: 'documents', ok: batch.documents.historicalDocuments === A.jobOrders && batch.documents.primarySourceLinks === A.jobOrders && batch.documents.duplicateLinks === 0 && batch.documents.duplicateDocumentsPerSource === 0 && batch.documents.duplicateFilesPerSource === 0, detail: JSON.stringify(batch.documents) },
    { name: 'falseHistory', ok: falseHistoryZero, detail: JSON.stringify(batch.falseHistory) },
    { name: 'batch', ok: batch.importBatchCountForLabel === 1 && batch.importBatch?.status === 'COMPLETED', detail: `${batch.importBatch?.id ?? '(none)'} ${batch.importBatch?.status ?? ''}` },
  ];
  return { verifiedAt: new Date().toISOString(), plan, batch, records: recordRows, totals, checks, ok: checks.every((c) => c.ok) };
}

// ---------------------------------------------------------------------------
// Before/after database snapshots (content hashes only — no row data, no secrets)
// ---------------------------------------------------------------------------

/** Tables the import is allowed to ADD rows to; per-row hashes are kept for these so changes to pre-existing rows are detectable. */
export const H3A_EXPECTED_INSERT_TABLES = [
  'factories', 'seasons', 'styles', 'style_sizes', 'style_factory_mappings', 'style_images', 'files',
  'job_orders', 'job_order_lines', 'job_order_line_sizes', 'historical_documents', 'historical_document_job_orders',
  'import_batches', 'audit_logs', 'document_sequences',
] as const;
/** Session bookkeeping that normal login activity changes; reported but never treated as business data. */
export const H3A_SESSION_NOISE_TABLES = ['refresh_sessions', 'users', 'job_order_idempotency_records'] as const;

export interface DatabaseSnapshot {
  capturedAt: string;
  database: string;
  tables: Record<string, { rows: number; contentHash: string }>;
  rows: Record<string, Record<string, string>>;
  sequences: Awaited<ReturnType<typeof snapshotJobOrderSequences>>;
  allSequences: Array<{ documentType: string; financialYear: string; lastAllocatedSerial: number }>;
}

export async function captureDatabaseSnapshot(client: Client): Promise<DatabaseSnapshot> {
  const [dbRow] = await client.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
  const db = dbRow?.db ?? "";
  const tableNames = (await client.$queryRawUnsafe<Array<{ tablename: string }>>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).map((t) => t.tablename);
  const tables: DatabaseSnapshot['tables'] = {};
  const rows: DatabaseSnapshot['rows'] = {};
  for (const name of tableNames) {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const [agg] = await client.$queryRawUnsafe<Array<{ n: number; h: string | null }>>(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) AS h FROM ${quoted} t`,
    );
    tables[name] = { rows: agg!.n, contentHash: agg!.h ?? '' };
    if ((H3A_EXPECTED_INSERT_TABLES as readonly string[]).includes(name)) {
      const list = await client.$queryRawUnsafe<Array<{ id: string; h: string }>>(`SELECT id::text AS id, md5(t::text) AS h FROM ${quoted} t`);
      rows[name] = Object.fromEntries(list.map((r) => [r.id, r.h]));
    }
  }
  const allSequences = (
    await client.documentSequence.findMany({ include: { financialYear: { select: { code: true } } }, orderBy: [{ documentType: 'asc' }] })
  ).map((r) => ({ documentType: r.documentType, financialYear: r.financialYear.code, lastAllocatedSerial: r.lastAllocatedSerial }));
  return { capturedAt: new Date().toISOString(), database: db, tables, rows, sequences: await snapshotJobOrderSequences(client), allSequences };
}

export interface SnapshotComparison {
  unchangedTables: string[];
  insertOnlyTables: Record<string, { added: number }>;
  sessionNoise: Record<string, { rowsBefore: number; rowsAfter: number }>;
  violations: string[];
  ok: boolean;
}

/** Pure. Any change outside expected inserts (or a modified/deleted pre-existing row anywhere) is a violation. */
export function compareSnapshots(before: DatabaseSnapshot, after: DatabaseSnapshot, allowedSequenceChange: (s: { documentType: string }) => boolean): SnapshotComparison {
  const result: SnapshotComparison = { unchangedTables: [], insertOnlyTables: {}, sessionNoise: {}, violations: [], ok: true };
  const names = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  for (const name of [...names].sort()) {
    const b = before.tables[name];
    const a = after.tables[name];
    if (!b || !a) {
      result.violations.push(`table ${name} ${b ? 'disappeared' : 'appeared'}`);
      continue;
    }
    if (b.contentHash === a.contentHash && b.rows === a.rows) {
      result.unchangedTables.push(name);
      continue;
    }
    if ((H3A_SESSION_NOISE_TABLES as readonly string[]).includes(name)) {
      result.sessionNoise[name] = { rowsBefore: b.rows, rowsAfter: a.rows };
      continue;
    }
    const beforeRows = before.rows[name];
    const afterRows = after.rows[name];
    if (!beforeRows || !afterRows) {
      result.violations.push(`table ${name} changed (${b.rows} -> ${a.rows} rows) but is not an expected-insert table`);
      continue;
    }
    let added = 0;
    for (const [id, hash] of Object.entries(beforeRows)) {
      if (!(id in afterRows)) result.violations.push(`${name} row ${id} was deleted`);
      else if (afterRows[id] !== hash && name !== 'document_sequences') result.violations.push(`${name} row ${id} was modified`);
    }
    for (const id of Object.keys(afterRows)) if (!(id in beforeRows)) added++;
    result.insertOnlyTables[name] = { added };
  }
  const key = (s: { documentType: string; financialYear: string }) => `${s.documentType}/${s.financialYear}`;
  const beforeSeq = new Map(before.allSequences.map((s) => [key(s), s.lastAllocatedSerial] as const));
  for (const s of after.allSequences) {
    const prev = beforeSeq.get(key(s));
    if (prev === s.lastAllocatedSerial) continue;
    if (prev !== undefined && s.lastAllocatedSerial < prev) result.violations.push(`sequence ${key(s)} rewound ${prev} -> ${s.lastAllocatedSerial}`);
    else if (!allowedSequenceChange(s)) result.violations.push(`sequence ${key(s)} changed ${prev ?? '(new)'} -> ${s.lastAllocatedSerial}`);
  }
  for (const [k] of beforeSeq) if (!after.allSequences.some((s) => key(s) === k)) result.violations.push(`sequence ${k} disappeared`);
  result.ok = result.violations.length === 0;
  return result;
}
