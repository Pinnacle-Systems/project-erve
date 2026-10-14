import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createId } from '@erve/shared';
import type {
  MasterImportKind,
  MasterImportOutcome,
  MasterImportPlan,
  MasterImportRow,
  MasterImportResult,
} from '@erve/types';
import { z } from 'zod';
import { prisma, type Prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { createFactory, createDistributor } from './master-data.service.js';
import { createRetailStore } from './retail-stores.service.js';
import { createFactorySchema, createDistributorSchema } from './master-data.validation.js';
import { createRetailStoreSchema } from './retail-stores.validation.js';
import { parseMasterImportFile, type ParsedMasterImportRow } from './master-import.parser.js';

type Db = typeof prisma | Prisma.TransactionClient;
type MasterRecord = Record<string, unknown> & { id: string; code: string; status: string };
const version = 'business-master-import-v1';
const checksum = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const normalized = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const masterImportKindSchema = z.enum(['factories', 'distributors', 'retail-stores']);
export async function requireMasterImportActor(
  actor: CurrentUser,
  db: Db = prisma,
): Promise<CurrentUser> {
  const record = await db.user.findUnique({ where: { id: actor.id }, select: currentUserSelect });
  const current = record ? toCurrentUser(record) : undefined;
  if (
    !current ||
    current.status !== 'ACTIVE' ||
    !current.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER')
  )
    throw HttpError.forbidden(
      'Business imports require an active authorized ADMIN or MERCHANDISER',
    );
  return current;
}
function identity(kind: MasterImportKind, input: Record<string, unknown>): string {
  const fields =
    kind === 'factories'
      ? ['name']
      : kind === 'distributors'
        ? ['name', 'purchaseMode']
        : [
            'distributorId',
            'name',
            'addressLine1',
            'addressLine2',
            'city',
            'state',
            'country',
            'postalCode',
          ];
  return checksum(JSON.stringify(fields.map((field) => normalized(input[field]))));
}
async function masters(kind: MasterImportKind, db: Db): Promise<MasterRecord[]> {
  return (kind === 'factories'
    ? await db.factory.findMany()
    : kind === 'distributors'
      ? await db.distributor.findMany()
      : await db.retailStore.findMany()) as unknown as MasterRecord[];
}
function summarize(rows: MasterImportRow[]): Record<MasterImportOutcome, number> {
  const result = { CREATE: 0, SKIP_EXISTING: 0, NEEDS_REVIEW: 0, REJECTED: 0, FAILED: 0 };
  for (const row of rows) result[row.outcome]++;
  return result;
}
async function validatedInput(
  kind: MasterImportKind,
  parsed: ParsedMasterImportRow,
  db: Db,
): Promise<Record<string, string | null>> {
  if (parsed.error) throw HttpError.badRequest(parsed.error);
  if (kind === 'factories') return createFactorySchema.parse(parsed.input);
  if (kind === 'distributors') {
    if (!parsed.input.purchaseMode) {
      createDistributorSchema.omit({ purchaseMode: true }).parse(parsed.input);
      throw HttpError.conflict('Purchase Mode needs review: supply OUTRIGHT or SALE_RETURN');
    }
    return createDistributorSchema.parse(parsed.input);
  }
  const {
    distributorName: _name,
    distributorGstin: _gstin,
    distributorPurchaseMode: _mode,
    ...storeFields
  } = parsed.input;
  const base = createRetailStoreSchema.omit({ distributorId: true }).parse(storeFields);
  const name = parsed.input.distributorName;
  const gstin = parsed.input.distributorGstin;
  const mode = parsed.input.distributorPurchaseMode;
  if (mode && !['OUTRIGHT', 'SALE_RETURN'].includes(mode))
    throw HttpError.badRequest('Distributor Purchase Mode must be OUTRIGHT or SALE_RETURN');
  if (!name && !gstin)
    throw HttpError.conflict('Distributor Name or GSTIN is required for parent matching');
  const matches = (await db.distributor.findMany()).filter(
    (parent) =>
      (!name || normalized(parent.name) === normalized(name)) &&
      (!gstin || normalized(parent.gstin) === normalized(gstin)) &&
      (!mode || parent.purchaseMode === mode),
  );
  if (matches.length !== 1)
    throw HttpError.conflict(
      matches.length
        ? 'Parent Distributor is ambiguous; specify its name, GSTIN and Purchase Mode'
        : 'Parent Distributor has not been imported or does not match',
    );
  if (matches[0]!.status !== 'ACTIVE') throw HttpError.conflict('Parent Distributor is inactive');
  return { ...base, distributorId: matches[0]!.id };
}
async function classify(
  kind: MasterImportKind,
  row: MasterImportRow,
  db: Db,
  excludeId?: string,
): Promise<MasterImportRow> {
  const mapped = await db.masterImportSource.findUnique({
    where: { kind_sourceKey: { kind, sourceKey: row.sourceKey! } },
  });
  const records = (await masters(kind, db)).filter((record) => record.id !== excludeId);
  const identityMapping = await db.masterImportSource.findUnique({
    where: { kind_businessIdentity: { kind, businessIdentity: row.identity! } },
  });
  if (identityMapping && identityMapping.sourceKey !== row.sourceKey)
    return {
      ...row,
      outcome: 'NEEDS_REVIEW',
      detail: 'Business identity is already linked to another source key',
    };
  if (
    mapped &&
    (mapped.businessIdentity !== row.identity ||
      !records.some(
        (record) => record.id === mapped.masterId && identity(kind, record) === row.identity,
      ))
  )
    return {
      ...row,
      outcome: 'NEEDS_REVIEW',
      detail: 'Source key is already linked to a different or changed business identity',
    };
  const matches = records.filter((record) => identity(kind, record) === row.identity);
  if (!matches.length) return { ...row, outcome: 'CREATE' };
  if (matches.length !== 1)
    return {
      ...row,
      outcome: 'NEEDS_REVIEW',
      detail: 'Multiple existing masters match this business identity',
    };
  const existing = matches[0]!;
  const changed = Object.entries(row.input)
    .filter(
      ([field, value]) =>
        value !== null && value !== '' && normalized(existing[field]) !== normalized(value),
    )
    .map(([field]) => field);
  if (existing.status !== 'ACTIVE' || changed.length)
    return {
      ...row,
      outcome: 'NEEDS_REVIEW',
      detail: `Existing master requires review${changed.length ? ': different ' + changed.join(', ') : ': inactive'}`,
      masterId: existing.id,
      code: existing.code,
    };
  return {
    ...row,
    outcome: 'SKIP_EXISTING',
    masterId: existing.id,
    code: existing.code,
    detail: 'Exact existing business values; no update performed',
  };
}
const fingerprint = (row: MasterImportRow) =>
  checksum(JSON.stringify({ input: row.input, sourceKey: row.sourceKey, identity: row.identity }));
function confirmation(plan: Omit<MasterImportPlan, 'confirmationToken'>, actorId: string): string {
  const eligible = Object.fromEntries(
    plan.rows
      .filter((row) => row.outcome === 'CREATE')
      .map((row) => [String(row.rowNumber), fingerprint(row)]),
  );
  const payload = Buffer.from(
    JSON.stringify({
      version,
      actorId,
      kind: plan.kind,
      checksum: plan.fileChecksum,
      worksheet: plan.worksheet,
      expiresAt: Date.now() + 15 * 60_000,
      eligible,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', env.JWT_ACCESS_SECRET).update(payload).digest('base64url')}`;
}
const claimsSchema = z.object({
  version: z.literal(version),
  actorId: z.string(),
  kind: masterImportKindSchema,
  checksum: z.string(),
  worksheet: z.string(),
  expiresAt: z.number().finite(),
  eligible: z.record(z.string().regex(/^\d{1,5}$/), z.string().regex(/^[a-f0-9]{64}$/)),
});
function reviewedRows(plan: MasterImportPlan, actorId: string, token: string): Set<number> {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) throw new Error('Malformed confirmation');
    const expected = createHmac('sha256', env.JWT_ACCESS_SECRET).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new Error('Invalid signature');
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (
      claims.actorId !== actorId ||
      claims.kind !== plan.kind ||
      claims.checksum !== plan.fileChecksum ||
      claims.worksheet !== plan.worksheet ||
      Date.now() >= claims.expiresAt
    )
      throw new Error('Stale confirmation');
    for (const row of plan.rows) {
      if (
        (row.outcome === 'CREATE' ||
          (row.outcome === 'SKIP_EXISTING' &&
            claims.eligible[String(row.rowNumber)] !== undefined)) &&
        claims.eligible[String(row.rowNumber)] !== fingerprint(row)
      )
        throw new Error('Unreviewed eligible row');
    }
    return new Set(Object.keys(claims.eligible).map(Number));
  } catch {
    throw HttpError.conflict(
      'Confirmation expired or file, worksheet, actor or eligible records changed; preview again',
    );
  }
}
export async function planMasterImport(
  actor: CurrentUser,
  kind: MasterImportKind,
  buffer: Buffer,
  fileName: string,
  worksheet?: string,
): Promise<MasterImportPlan> {
  masterImportKindSchema.parse(kind);
  actor = await requireMasterImportActor(actor);
  const parsed = parseMasterImportFile(kind, buffer, fileName, worksheet);
  const rows: MasterImportRow[] = [];
  for (const source of parsed.rows) {
    let row: MasterImportRow = {
      rowNumber: source.rowNumber,
      raw: source.raw,
      sourceHeaders: parsed.headers,
      input: source.input,
      sourceKey: source.sourceKey,
      outcome: 'REJECTED',
    };
    try {
      const input = await validatedInput(kind, source, prisma);
      const businessIdentity = identity(kind, input);
      row = {
        ...row,
        input,
        identity: businessIdentity,
        sourceKey: source.sourceKey ?? `${kind}:v1:${businessIdentity}`,
      };
      if (row.sourceKey!.length > 256)
        throw HttpError.badRequest('Source Key exceeds 256 characters');
      rows.push(await classify(kind, row, prisma));
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof HttpError)) throw error;
      const detail =
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
          : error instanceof HttpError
            ? error.message
            : 'Unable to validate this row';
      rows.push({
        ...row,
        outcome:
          error instanceof HttpError && error.statusCode === 409 ? 'NEEDS_REVIEW' : 'REJECTED',
        detail,
      });
    }
  }
  for (const row of rows)
    if (
      rows.some(
        (other) =>
          other !== row &&
          ((row.identity && row.identity === other.identity) ||
            (row.sourceKey && row.sourceKey === other.sourceKey)),
      )
    ) {
      row.outcome = 'NEEDS_REVIEW';
      row.detail = 'Duplicate source key or business identity in this upload; review all copies';
    }
  const plan = {
    kind,
    fileChecksum: checksum(buffer),
    worksheet: parsed.worksheet,
    headers: parsed.headers,
    rows,
    summary: summarize(rows),
  };
  return { ...plan, confirmationToken: confirmation(plan, actor.id) };
}
export async function executeMasterImport(
  actor: CurrentUser,
  kind: MasterImportKind,
  buffer: Buffer,
  fileName: string,
  worksheet: string | undefined,
  token: string,
): Promise<MasterImportResult> {
  actor = await requireMasterImportActor(actor);
  const plan = await planMasterImport(actor, kind, buffer, fileName, worksheet);
  const reviewed = reviewedRows(plan, actor.id, token);
  const runId = createId();
  await prisma.masterImportRun.create({
    data: {
      id: runId,
      kind,
      sourceFileName: fileName,
      fileChecksum: plan.fileChecksum,
      worksheet: plan.worksheet,
      importVersion: version,
      actorUserId: actor.id,
      status: 'EXECUTING',
    },
  });
  const rows: MasterImportRow[] = [];
  const saveRow = (row: MasterImportRow, db: Db = prisma) =>
    db.masterImportRowResult.create({
      data: {
        id: createId(),
        runId,
        rowNumber: row.rowNumber,
        outcome: row.outcome,
        masterId: row.masterId,
        code: row.code,
        detail: row.detail,
        payload: json(row),
      },
    });
  try {
    for (const planned of plan.rows) {
      let row = planned;
      if (row.outcome === 'CREATE' && reviewed.has(row.rowNumber)) {
        try {
          actor = await requireMasterImportActor(actor);
          row = await classify(kind, row, prisma);
          if (row.outcome === 'CREATE') {
            const hook = async (
              tx: Prisma.TransactionClient,
              created: { id: string; code: string },
            ) => {
              await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR SHARE`;
              await requireMasterImportActor(actor, tx);
              if (kind === 'retail-stores') {
                await tx.$queryRaw`SELECT id FROM distributors WHERE id = ${row.input.distributorId!} FOR SHARE`;
                const parent = await tx.distributor.findUnique({
                  where: { id: row.input.distributorId! },
                });
                if (!parent || parent.status !== 'ACTIVE')
                  throw HttpError.conflict('Parent Distributor changed; preview again');
              }
              const current = await classify(kind, row, tx, created.id);
              if (current.outcome !== 'CREATE')
                throw HttpError.conflict(
                  'Business identity changed during creation; preview again',
                );
              await tx.masterImportSource.create({
                data: {
                  id: createId(),
                  kind,
                  sourceKey: row.sourceKey!,
                  businessIdentity: row.identity!,
                  masterId: created.id,
                  originalInput: json(row.input),
                  runId,
                },
              });
              row = { ...row, outcome: 'CREATE', masterId: created.id, code: created.code };
              await saveRow(row, tx);
            };
            const options = { onCreatedInTransaction: hook };
            if (kind === 'factories')
              await createFactory(actor, createFactorySchema.parse(row.input), options);
            else if (kind === 'distributors')
              await createDistributor(actor, createDistributorSchema.parse(row.input), options);
            else await createRetailStore(actor, createRetailStoreSchema.parse(row.input), options);
            rows.push(row);
            continue;
          }
        } catch (error) {
          const current = await classify(kind, planned, prisma);
          row =
            current.outcome === 'SKIP_EXISTING' || current.outcome === 'NEEDS_REVIEW'
              ? current
              : {
                  ...planned,
                  outcome:
                    error instanceof HttpError && error.statusCode === 409
                      ? 'NEEDS_REVIEW'
                      : 'FAILED',
                  detail:
                    error instanceof HttpError
                      ? error.message
                      : `Import failed; reference ${createId()}`,
                };
        }
      }
      if (row.outcome === 'SKIP_EXISTING') {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR SHARE`;
            await requireMasterImportActor(actor, tx);
            if (kind === 'factories')
              await tx.$queryRaw`SELECT id FROM factories WHERE id = ${row.masterId!} FOR UPDATE`;
            else if (kind === 'distributors')
              await tx.$queryRaw`SELECT id FROM distributors WHERE id = ${row.masterId!} FOR UPDATE`;
            else
              await tx.$queryRaw`SELECT id FROM retail_stores WHERE id = ${row.masterId!} FOR UPDATE`;
            const current = await classify(kind, row, tx);
            if (current.outcome !== 'SKIP_EXISTING')
              throw HttpError.conflict('Existing master changed; preview again');
            await tx.masterImportSource.upsert({
              where: { kind_sourceKey: { kind, sourceKey: row.sourceKey! } },
              update: {},
              create: {
                id: createId(),
                kind,
                sourceKey: row.sourceKey!,
                businessIdentity: row.identity!,
                masterId: row.masterId!,
                originalInput: json(row.input),
                runId,
              },
            });
            await saveRow(row, tx);
          });
          rows.push(row);
          continue;
        } catch (error) {
          row = {
            ...row,
            outcome:
              error instanceof HttpError && error.statusCode === 409 ? 'NEEDS_REVIEW' : 'FAILED',
            detail:
              error instanceof HttpError ? error.message : `Import failed; reference ${createId()}`,
          };
        }
      }
      await saveRow(row);
      rows.push(row);
    }
    const summary = summarize(rows);
    await prisma.masterImportRun.update({
      where: { id: runId },
      data: {
        status:
          summary.FAILED || summary.NEEDS_REVIEW || summary.REJECTED
            ? 'COMPLETED_WITH_EXCEPTIONS'
            : 'COMPLETED',
        summary: json(summary),
      },
    });
    return { runId, rows, summary };
  } catch (error) {
    await prisma.masterImportRun.update({ where: { id: runId }, data: { status: 'INTERRUPTED' } });
    throw error;
  }
}
export async function masterImportHistory(actor: CurrentUser, kind: MasterImportKind) {
  await requireMasterImportActor(actor);
  masterImportKindSchema.parse(kind);
  return prisma.masterImportRun.findMany({
    where: { kind },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
}
export async function masterImportRunDetail(
  actor: CurrentUser,
  kind: MasterImportKind,
  id: string,
) {
  await requireMasterImportActor(actor);
  masterImportKindSchema.parse(kind);
  const run = await prisma.masterImportRun.findFirst({
    where: { id, kind },
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!run) throw HttpError.notFound('Import run not found');
  return run;
}
