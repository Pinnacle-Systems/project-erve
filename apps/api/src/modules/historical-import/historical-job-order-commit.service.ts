// H2B — controlled Dev commit of approved historical Job Orders, their
// source-document evidence, and their Style images.
//
// Environment/artifact-agnostic: callers (the dev-target-guarded CLI in
// ../../cli/historical-import-commit.ts, or DB-backed tests with synthetic
// fixtures) hand in already-resolved records plus byte loaders. This module
// never reads the source archive or artifacts itself.
//
// Atomicity model — RECORD-ATOMIC WITH EXPLICIT BATCH RECONCILIATION:
//   - importHistoricalJobOrder (H1) already wraps one Job Order + its line/
//     sizes + HistoricalDocument + join row + audit event in one
//     transaction, and nests no further; the source PDF File row is created
//     just before it (store-then-metadata, like uploadStyleImage) and is
//     reused on retry if that transaction then failed.
//   - The WHOLE batch is planned before the first write: any REVIEW_CONFLICT
//     stops the run with zero writes.
//   - A mid-run failure stops immediately (never skip-and-continue); the
//     ImportBatch stays IN_PROGRESS, so partial state is visible, and an
//     exact rerun VERIFIES what exists and CREATES only the remainder.
//   - The batch becomes COMPLETED only after every record re-verifies.
//   Whole-batch atomicity was rejected: the H1 service owns its own
//   transaction, source files live outside the database anyway, and a
//   91-row one-time Dev import gains nothing from a long single transaction
//   that rerun-by-verification doesn't already give.
import { createHash } from 'node:crypto';
import { createId } from '@erve/shared';
import type { Prisma } from '../../db/prisma.js';
import { prisma } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { getFileStorage } from '../../storage/index.js';
import { sanitizeDisplayFileName } from '../../storage/image-sniff.js';
import { uploadStyleImage } from '../master-data/style-images.service.js';
import { getPooledFactoryInventory } from '../job-orders/pooled-inventory.service.js';
import { importHistoricalJobOrder } from './historical-import.service.js';
import { reconcileImage } from './reconciliation.service.js';

type Client = Prisma.TransactionClient | typeof prisma;

export class HistoricalCommitError extends Error {}

/** Storage prefix for batch-owned source evidence. Reset only ever deletes files under its own batch's prefix. */
export function historicalDocumentStoragePrefix(importBatchId: string): string {
  return `historical-documents/${importBatchId}/`;
}

export interface HistoricalBatchProvenance {
  story: 'H2B';
  description: string;
  sourceArchives: string[];
  sourceManifestAggregateSha256: string;
  parserVersion: string;
  sourceOverridesSha256: string | null;
  processFlowLogicalIdentity: { processFlowCode: string; versionNumber: number; fingerprint: string };
}

export interface HistoricalBatchIdentity {
  /** Stable batch identity, e.g. "AW25-SS26" — at most one ImportBatch may ever carry it. */
  sourceLabel: string;
  processFlowVersionId: string;
  provenance: HistoricalBatchProvenance;
  counts: { total: number; ready: number; reviewRequired: number; blocked: number; duplicate: number };
}

export interface HistoricalCommitRecord {
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  legacyReferenceNumber: string;
  seasonCode: string;
  lmix: string;
  factoryId: string;
  styleId: string;
  /** YYYY-MM-DD */
  historicalBusinessDate: string;
  /** YYYY-MM-DD */
  requiredDeliveryDate: string | null;
  unitPrice: string;
  sizes: Array<{ sourceSizeCode: string; sizeId: string; quantity: number }>;
  sourceSnapshot: Prisma.InputJsonValue;
  migrationNotes: string;
  disclaimerText?: string | null;
  styleDescription?: string;
  styleName?: string;
  loadSourcePdf: () => Promise<Buffer>;
  /** null when no approved image candidate exists for this record. */
  image: { sha256: string; fileName: string; load: () => Promise<Buffer> } | null;
}

export type JobOrderPlanAction = 'CREATE' | 'VERIFY_EXISTING' | 'REVIEW_CONFLICT';

export interface JobOrderPlanEntry {
  legacyReferenceNumber: string;
  action: JobOrderPlanAction;
  existingJobOrderId: string | null;
  existingJobOrderNumber: string | null;
  differences: string[];
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const existingJobOrderInclude = {
  lines: { include: { sizes: true, style: { select: { description: true, styleName: true, lmixNumber: true, season: { select: { code: true } } } } } },
  historicalDocuments: { include: { historicalDocument: { include: { file: true } } } },
} satisfies Prisma.JobOrderInclude;
type ExistingJobOrder = Prisma.JobOrderGetPayload<{ include: typeof existingJobOrderInclude }>;

/**
 * Field-by-field comparison of a persisted historical Job Order against its
 * approved record. Used both to decide VERIFY_EXISTING vs REVIEW_CONFLICT
 * before writing and for post-import EXACT_MATCH/MISMATCH reconciliation —
 * one definition of "the same approved record", never two.
 */
export function compareJobOrderToRecord(
  jobOrder: ExistingJobOrder,
  record: HistoricalCommitRecord,
  expected: { importBatchId: string | null; processFlowVersionId: string },
): string[] {
  const diffs: string[] = [];
  const check = (field: string, actual: unknown, wanted: unknown) => {
    if (actual !== wanted) diffs.push(`${field}: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(actual)}`);
  };
  check('recordOrigin', jobOrder.recordOrigin, 'HISTORICAL_IMPORT');
  check('status', jobOrder.status, 'PRODUCTION_COMPLETE');
  check('importBatchId', jobOrder.importBatchId, expected.importBatchId);
  check('processFlowVersionId', jobOrder.processFlowVersionId, expected.processFlowVersionId);
  check('factoryId', jobOrder.factoryId, record.factoryId);
  check('historicalBusinessDate', isoDate(jobOrder.historicalBusinessDate), record.historicalBusinessDate);
  check('requiredDeliveryDate', isoDate(jobOrder.requiredDeliveryDate), record.requiredDeliveryDate);
  check('unitPrice', Number(jobOrder.unitPrice.toString()), Number(record.unitPrice));
  check('jobOrderSerial', jobOrder.jobOrderSerial, null);
  if (record.disclaimerText !== undefined) check('disclaimerText', jobOrder.disclaimerText, record.disclaimerText);

  if (jobOrder.lines.length !== 1) {
    diffs.push(`lines: expected exactly 1, found ${jobOrder.lines.length}`);
  } else {
    const line = jobOrder.lines[0]!;
    check('styleId', line.styleId, record.styleId);
    if (record.styleDescription !== undefined) check('style.description', line.style.description, record.styleDescription);
    if (record.styleName !== undefined) check('style.styleName', line.style.styleName, record.styleName);
    check('season', line.style.season?.code ?? null, record.seasonCode);
    check('lmix', line.style.lmixNumber, record.lmix);
    const expectedTotal = record.sizes.reduce((sum, s) => sum + s.quantity, 0);
    check('orderedQuantityTotal', line.orderedQuantityTotal, expectedTotal);
    check('preparedQuantityTotal', line.preparedQuantityTotal, 0);
    const actualSizes = new Map(line.sizes.map((s) => [s.sizeId, s.orderedQuantity] as const));
    if (actualSizes.size !== record.sizes.length) diffs.push(`sizes: expected ${record.sizes.length} size rows, found ${actualSizes.size}`);
    for (const size of record.sizes) {
      check(`size ${size.sourceSizeCode} orderedQuantity`, actualSizes.get(size.sizeId) ?? null, size.quantity);
    }
    for (const size of line.sizes) {
      if (size.preparedQuantity !== 0) diffs.push(`size ${size.sizeId} preparedQuantity: expected 0, found ${size.preparedQuantity}`);
    }
  }

  const primarySources = jobOrder.historicalDocuments.filter((link) => link.relationshipType === 'PRIMARY_SOURCE');
  if (primarySources.length !== 1) {
    diffs.push(`PRIMARY_SOURCE documents: expected exactly 1, found ${primarySources.length}`);
  } else {
    const doc = primarySources[0]!.historicalDocument;
    check('source document type', doc.documentType, 'HISTORICAL_FACTORY_ORDER');
    check('source document sha256', doc.file.checksumSha256, record.sourceSha256);
    check('source document importBatchId', doc.importBatchId, expected.importBatchId);
  }
  return diffs;
}

export async function findImportBatchByLabel(client: Client, sourceLabel: string) {
  const batches = await client.importBatch.findMany({ where: { sourceLabel } });
  if (batches.length > 1) {
    throw new HistoricalCommitError(`${batches.length} ImportBatch rows carry sourceLabel "${sourceLabel}" — refusing to guess which one`);
  }
  return batches[0] ?? null;
}

/**
 * Read-only. Classifies every record before any write: CREATE when no Job
 * Order carries its legacyReferenceNumber, VERIFY_EXISTING when exactly one
 * does and it is field-for-field the same approved record in this batch,
 * REVIEW_CONFLICT otherwise (including any repeat within the input).
 */
export async function planHistoricalJobOrderCommit(
  client: Client,
  input: { importBatchId: string | null; processFlowVersionId: string; records: HistoricalCommitRecord[] },
): Promise<JobOrderPlanEntry[]> {
  const refs = input.records.map((r) => r.legacyReferenceNumber);
  const inputCounts = new Map<string, number>();
  for (const ref of refs) inputCounts.set(ref, (inputCounts.get(ref) ?? 0) + 1);

  const existing = await client.jobOrder.findMany({
    where: { legacyReferenceNumber: { in: refs } },
    include: existingJobOrderInclude,
  });
  const existingByRef = new Map<string, ExistingJobOrder[]>();
  for (const jo of existing) {
    const list = existingByRef.get(jo.legacyReferenceNumber!) ?? [];
    list.push(jo);
    existingByRef.set(jo.legacyReferenceNumber!, list);
  }

  return input.records.map((record) => {
    const ref = record.legacyReferenceNumber;
    const base = { legacyReferenceNumber: ref, existingJobOrderId: null, existingJobOrderNumber: null };
    if ((inputCounts.get(ref) ?? 0) > 1) {
      return { ...base, action: 'REVIEW_CONFLICT', differences: [`"${ref}" appears ${inputCounts.get(ref)} times in the approved input`] };
    }
    const matches = existingByRef.get(ref) ?? [];
    if (matches.length === 0) return { ...base, action: 'CREATE', differences: [] };
    if (matches.length > 1) {
      return { ...base, action: 'REVIEW_CONFLICT', differences: [`${matches.length} existing Job Orders already carry "${ref}"`] };
    }
    const jo = matches[0]!;
    const differences = compareJobOrderToRecord(jo, record, {
      importBatchId: input.importBatchId,
      processFlowVersionId: input.processFlowVersionId,
    });
    return {
      legacyReferenceNumber: ref,
      action: differences.length === 0 ? 'VERIFY_EXISTING' : 'REVIEW_CONFLICT',
      existingJobOrderId: jo.id,
      existingJobOrderNumber: jo.jobOrderNumber,
      differences,
    };
  });
}

function parseBatchProvenance(notes: string | null): Partial<HistoricalBatchProvenance> | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as Partial<HistoricalBatchProvenance>;
  } catch {
    return null;
  }
}

/** Creates the batch once; afterwards only ever reuses it, and only if its pinned flow and source manifest are unchanged. */
export async function ensureImportBatch(actor: CurrentUser, identity: HistoricalBatchIdentity) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('historical_import_batch:' || ${identity.sourceLabel}, 0))::text`;
    const existing = await findImportBatchByLabel(tx, identity.sourceLabel);
    if (existing) {
      const provenance = parseBatchProvenance(existing.notes);
      if (existing.processFlowVersionId !== identity.processFlowVersionId) {
        throw new HistoricalCommitError(`Existing ImportBatch ${existing.id} is pinned to a different Process Flow Version — refusing to reuse it`);
      }
      if (provenance?.sourceManifestAggregateSha256 !== identity.provenance.sourceManifestAggregateSha256) {
        throw new HistoricalCommitError(`Existing ImportBatch ${existing.id} was created from a different source manifest — refusing to reuse it`);
      }
      return { batch: existing, created: false };
    }
    const batch = await tx.importBatch.create({
      data: {
        id: createId(),
        sourceLabel: identity.sourceLabel,
        startedById: actor.id,
        status: 'IN_PROGRESS',
        processFlowVersionId: identity.processFlowVersionId,
        notes: JSON.stringify(identity.provenance),
        totalSourceDocuments: identity.counts.total,
        readyCount: identity.counts.ready,
        reviewRequiredCount: identity.counts.reviewRequired,
        blockedCount: identity.counts.blocked,
        duplicateCount: identity.counts.duplicate,
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'HISTORICAL_IMPORT_BATCH_CREATED',
        entityType: 'ImportBatch',
        entityId: batch.id,
        metadata: { sourceLabel: batch.sourceLabel, sourceManifestAggregateSha256: identity.provenance.sourceManifestAggregateSha256 },
      },
      tx,
    );
    return { batch, created: true };
  });
}

async function loadVerifiedSourcePdf(record: HistoricalCommitRecord): Promise<Buffer> {
  const buffer = await record.loadSourcePdf();
  const actual = sha256Hex(buffer);
  if (actual !== record.sourceSha256 || buffer.length !== record.sourceSizeBytes) {
    throw new HistoricalCommitError(
      `Source PDF for ${record.legacyReferenceNumber} (${record.sourceFileName}) does not match the approved manifest ` +
        `(sha256 ${actual.slice(0, 12)}..., ${buffer.length} bytes)`,
    );
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HistoricalCommitError(`Source file for ${record.legacyReferenceNumber} is not a PDF`);
  }
  return buffer;
}

export type SourceFileOutcome = 'CREATED' | 'REUSED_ORPHAN';

/**
 * Stores the verified source PDF through the app's normal FileStorage and
 * File table, under this batch's own storage prefix. A File left behind by
 * an earlier failed Job Order transaction (same batch, same bytes, no
 * HistoricalDocument yet) is reused instead of duplicated.
 */
async function ensureSourceFile(actor: CurrentUser, importBatchId: string, record: HistoricalCommitRecord) {
  const buffer = await loadVerifiedSourcePdf(record);
  const prefix = historicalDocumentStoragePrefix(importBatchId);
  const storage = getFileStorage();

  const orphan = await prisma.file.findFirst({
    where: {
      checksumSha256: record.sourceSha256,
      sizeBytes: buffer.length,
      storageKey: { startsWith: prefix },
      historicalDocuments: { none: {} },
    },
  });
  if (orphan) {
    if (!(await storage.exists(orphan.storageKey))) await storage.put(orphan.storageKey, buffer);
    return { fileId: orphan.id, outcome: 'REUSED_ORPHAN' as SourceFileOutcome };
  }

  const fileId = createId();
  const storageKey = `${prefix}${fileId}.pdf`;
  await storage.put(storageKey, buffer);
  try {
    await prisma.file.create({
      data: {
        id: fileId,
        fileName: sanitizeDisplayFileName(record.sourceFileName, 'pdf'),
        mimeType: 'application/pdf',
        sizeBytes: buffer.length,
        storageKey,
        checksumSha256: record.sourceSha256,
        uploadedById: actor.id,
      },
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  return { fileId, outcome: 'CREATED' as SourceFileOutcome };
}

export type ImageAction = 'UPLOADED' | 'SKIP_ALREADY_PRESENT' | 'REVIEW_CONFLICT' | 'NO_APPROVED_IMAGE';

export interface ImageOutcome {
  legacyReferenceNumber: string;
  styleId: string;
  action: ImageAction;
  note: string;
}

/**
 * Normal StyleImage path only (uploadStyleImage): exact-hash dedup, the
 * service's own first-image-becomes-primary rule, never a replacement. A
 * different existing image is REVIEW_CONFLICT and left untouched.
 */
export async function applyStyleImages(actor: CurrentUser, records: HistoricalCommitRecord[]): Promise<ImageOutcome[]> {
  const outcomes: ImageOutcome[] = [];
  for (const record of records) {
    const base = { legacyReferenceNumber: record.legacyReferenceNumber, styleId: record.styleId };
    if (!record.image) {
      outcomes.push({ ...base, action: 'NO_APPROVED_IMAGE', note: 'No approved image candidate for this record' });
      continue;
    }
    const disposition = await reconcileImage(
      prisma,
      { method: 'EMBEDDED_IMAGE', pageNumber: 1, imageBytes: null, widthPx: null, heightPx: null, sha256: record.image.sha256, notes: [] },
      record.styleId,
    );
    if (disposition.disposition === 'SKIP_ALREADY_PRESENT') {
      outcomes.push({ ...base, action: 'SKIP_ALREADY_PRESENT', note: disposition.note });
      continue;
    }
    if (disposition.disposition !== 'UPLOAD') {
      outcomes.push({ ...base, action: 'REVIEW_CONFLICT', note: disposition.note });
      continue;
    }
    const buffer = await record.image.load();
    const actual = sha256Hex(buffer);
    if (actual !== record.image.sha256) {
      throw new HistoricalCommitError(
        `Approved image for ${record.legacyReferenceNumber} does not match its approved hash (found ${actual.slice(0, 12)}...) — refusing to upload`,
      );
    }
    const result = await uploadStyleImage(actor, record.styleId, { buffer, originalName: record.image.fileName });
    outcomes.push({
      ...base,
      action: result.created ? 'UPLOADED' : 'SKIP_ALREADY_PRESENT',
      note: result.created ? `Uploaded (isPrimary=${result.image.isPrimary})` : 'Identical image already present',
    });
  }
  return outcomes;
}

export interface CommitResult {
  importBatchId: string;
  batchCreated: boolean;
  created: Array<{ legacyReferenceNumber: string; jobOrderId: string; jobOrderNumber: string; sourceFile: SourceFileOutcome }>;
  verifiedExisting: number;
  images: ImageOutcome[];
  batchStatus: 'COMPLETED';
}

export class HistoricalCommitConflictError extends HistoricalCommitError {
  constructor(readonly plan: JobOrderPlanEntry[]) {
    const conflicts = plan.filter((p) => p.action === 'REVIEW_CONFLICT');
    super(
      `${conflicts.length} REVIEW_CONFLICT record(s) — nothing was written:\n` +
        conflicts.map((c) => `  ${c.legacyReferenceNumber}: ${c.differences.join('; ')}`).join('\n'),
    );
  }
}

export async function commitHistoricalJobOrders(
  actor: CurrentUser,
  input: { identity: HistoricalBatchIdentity; records: HistoricalCommitRecord[] },
  hooks: { onProgress?: (message: string) => void } = {},
): Promise<CommitResult> {
  if (!actor.roles.includes('ADMIN')) throw new HistoricalCommitError('Only an ADMIN may commit historical Job Orders');
  const log = hooks.onProgress ?? (() => undefined);

  // 1. Plan everything before writing anything.
  const existingBatch = await findImportBatchByLabel(prisma, input.identity.sourceLabel);
  const plan = await planHistoricalJobOrderCommit(prisma, {
    importBatchId: existingBatch?.id ?? null,
    processFlowVersionId: input.identity.processFlowVersionId,
    records: input.records,
  });
  if (plan.some((p) => p.action === 'REVIEW_CONFLICT')) throw new HistoricalCommitConflictError(plan);

  // 2. One batch, created once.
  const { batch, created: batchCreated } = await ensureImportBatch(actor, input.identity);
  log(`ImportBatch ${batch.id} (${batchCreated ? 'created' : 'reused'})`);

  // 3. Record-atomic Job Order import; stop on the first failure.
  const created: CommitResult['created'] = [];
  for (let i = 0; i < input.records.length; i++) {
    const record = input.records[i]!;
    if (plan[i]!.action !== 'CREATE') continue;
    const { fileId, outcome } = await ensureSourceFile(actor, batch.id, record);
    const result = await importHistoricalJobOrder(actor, {
      legacyReferenceNumber: record.legacyReferenceNumber,
      historicalBusinessDate: toDate(record.historicalBusinessDate),
      requiredDeliveryDate: record.requiredDeliveryDate ? toDate(record.requiredDeliveryDate) : null,
      factoryId: record.factoryId,
      styleId: record.styleId,
      processFlowVersionId: input.identity.processFlowVersionId,
      importBatchId: batch.id,
      unitPrice: record.unitPrice,
      sizes: record.sizes.map((s) => ({ sizeId: s.sizeId, quantity: s.quantity })),
      document: {
        mode: 'create',
        documentType: 'HISTORICAL_FACTORY_ORDER',
        externalReference: record.legacyReferenceNumber,
        documentDate: toDate(record.historicalBusinessDate),
        fileId,
        sourceSnapshot: record.sourceSnapshot,
        notes: `Original historical factory order PDF (${record.sourceFileName})`,
        relationshipType: 'PRIMARY_SOURCE',
      },
      migrationNotes: record.migrationNotes,
      disclaimerText: record.disclaimerText,
    });
    created.push({ legacyReferenceNumber: record.legacyReferenceNumber, jobOrderId: result.jobOrderId, jobOrderNumber: result.jobOrderNumber, sourceFile: outcome });
    log(`  CREATE ${record.legacyReferenceNumber} -> ${result.jobOrderNumber}`);
  }

  // 4. Re-verify the whole batch before declaring it complete.
  const after = await planHistoricalJobOrderCommit(prisma, {
    importBatchId: batch.id,
    processFlowVersionId: input.identity.processFlowVersionId,
    records: input.records,
  });
  const unverified = after.filter((p) => p.action !== 'VERIFY_EXISTING');
  if (unverified.length > 0) {
    throw new HistoricalCommitError(
      `Post-commit verification failed for ${unverified.length} record(s); ImportBatch ${batch.id} left IN_PROGRESS:\n` +
        unverified.map((u) => `  ${u.legacyReferenceNumber}: ${u.action} ${u.differences.join('; ')}`).join('\n'),
    );
  }
  if (batch.status !== 'COMPLETED') {
    await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }

  // 5. Style images through the normal StyleImage service.
  const images = await applyStyleImages(actor, input.records);

  return {
    importBatchId: batch.id,
    batchCreated,
    created,
    verifiedExisting: plan.filter((p) => p.action === 'VERIFY_EXISTING').length,
    images,
    batchStatus: 'COMPLETED',
  };
}

// ---------------------------------------------------------------------------
// Read-only post-import reconciliation
// ---------------------------------------------------------------------------

export interface FalseHistoryCounts {
  orderSheets: number;
  acknowledgements: number;
  stageStatuses: number;
  seasonSnapshots: number;
  qualityExecutions: number;
  qaInspectionSessions: number;
  qaReworkTasks: number;
  finalQualityBatches: number;
  qaReleases: number;
  qaReleaseLines: number;
  pooledInventoryLines: number;
  pooledInventoryQuantity: number;
  nonImportAuditEvents: number;
}

export async function countFalseHistoryForJobOrders(client: Client, jobOrderIds: string[], pairs: Array<{ factoryId: string; styleId: string }>): Promise<FalseHistoryCounts> {
  const byJo = { jobOrderId: { in: jobOrderIds } };
  const [orderSheets, acknowledgements, stageStatuses, seasonSnapshots, qualityExecutions, qaInspectionSessions, qaReworkTasks, finalQualityBatches, qaReleases, qaReleaseLines, nonImportAuditEvents] =
    await Promise.all([
      client.distributorPurchaseOrder.count({ where: byJo }),
      client.jobOrderAcknowledgement.count({ where: byJo }),
      client.jobOrderStageStatus.count({ where: byJo }),
      client.jobOrderSeasonSnapshot.count({ where: byJo }),
      client.qualityActivityExecution.count({ where: byJo }),
      client.qaInspectionSession.count({ where: byJo }),
      client.qaReworkTask.count({ where: byJo }),
      client.finalQualityBatch.count({ where: byJo }),
      client.qaRelease.count({ where: byJo }),
      client.qaReleaseLine.count({ where: { jobOrderLineSize: { jobOrderLine: byJo } } }),
      client.auditLog.count({ where: { entityType: 'JobOrder', entityId: { in: jobOrderIds }, action: { not: 'HISTORICAL_JOB_ORDER_IMPORTED' } } }),
    ]);
  let pooledInventoryLines = 0;
  let pooledInventoryQuantity = 0;
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.factoryId}|${pair.styleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Same service Dispatch Order allocation reads.
    const pool = await getPooledFactoryInventory(client, pair);
    pooledInventoryLines += pool.length;
    pooledInventoryQuantity += pool.reduce((sum, line) => sum + line.availableQuantity, 0);
  }
  return {
    orderSheets,
    acknowledgements,
    stageStatuses,
    seasonSnapshots,
    qualityExecutions,
    qaInspectionSessions,
    qaReworkTasks,
    finalQualityBatches,
    qaReleases,
    qaReleaseLines,
    pooledInventoryLines,
    pooledInventoryQuantity,
    nonImportAuditEvents,
  };
}

/** Whole-table counts of every downstream workflow model — compared before/after a commit, the delta must be all zeros. */
export async function snapshotDownstreamTableCounts(client: Client) {
  const [saleOrders, stockAllocations, factoryDispatches, factoryPackingCartons, factoryPackingCartonAudits, factoryInvoices, ervePackingLists, erveDispatches, invoiceHandoffs, distributorSalesReports, distributorReturns, returnedStockLots, qaReleases, qaReleaseLines, finalQualityBatches, qualityActivityExecutions, jobOrderAcknowledgements, jobOrderStageStatuses, distributorPurchaseOrders] =
    await Promise.all([
      client.saleOrder.count(),
      client.stockAllocation.count(),
      client.factoryDispatch.count(),
      client.factoryPackingCarton.count(),
      client.factoryPackingCartonAudit.count(),
      client.factoryInvoice.count(),
      client.ervePackingList.count(),
      client.erveDispatch.count(),
      client.invoiceHandoff.count(),
      client.distributorSalesReport.count(),
      client.distributorReturn.count(),
      client.returnedStockLot.count(),
      client.qaRelease.count(),
      client.qaReleaseLine.count(),
      client.finalQualityBatch.count(),
      client.qualityActivityExecution.count(),
      client.jobOrderAcknowledgement.count(),
      client.jobOrderStageStatus.count(),
      client.distributorPurchaseOrder.count(),
    ]);
  return {
    dispatchOrders_saleOrders: saleOrders,
    stockAllocations,
    factoryDispatches,
    factoryPackingCartons,
    factoryPackingCartonAudits,
    factoryInvoices,
    ervePackingLists,
    erveDispatches,
    invoiceHandoffs,
    distributorSalesReports,
    distributorReturns,
    returnedStockLots,
    qaReleases,
    qaReleaseLines,
    finalQualityBatches,
    qualityActivityExecutions,
    jobOrderAcknowledgements,
    jobOrderStageStatuses,
    orderSheets_distributorPurchaseOrders: distributorPurchaseOrders,
  };
}

export async function snapshotJobOrderSequences(client: Client) {
  const rows = await client.documentSequence.findMany({
    where: { documentType: { in: ['JOB_ORDER', 'HISTORICAL_JOB_ORDER'] } },
    include: { financialYear: { select: { code: true } } },
    orderBy: [{ documentType: 'asc' }],
  });
  return rows.map((r) => ({ documentType: r.documentType, financialYear: r.financialYear.code, lastAllocatedSerial: r.lastAllocatedSerial }));
}

export interface BatchVerification {
  importBatch: { id: string; sourceLabel: string; status: string; startedById: string; completedAt: string | null } | null;
  importBatchCountForLabel: number;
  jobOrderCountInBatch: number;
  uniqueLegacyReferences: number;
  perRecord: Array<{ legacyReferenceNumber: string; jobOrderNumber: string | null; result: 'EXACT_MATCH' | 'MISMATCH'; differences: string[] }>;
  exactMatch: number;
  mismatch: number;
  importerIds: string[];
  jobOrderNumbers: string[];
  documents: { historicalDocuments: number; files: number; primarySourceLinks: number; duplicateLinks: number; duplicateDocumentsPerSource: number; duplicateFilesPerSource: number };
  auditImportEvents: number;
  falseHistory: FalseHistoryCounts;
  aggregates: {
    bySeason: Record<string, { jobOrders: number; quantity: number }>;
    byFactory: Record<string, { jobOrders: number; quantity: number }>;
  };
}

export async function verifyCommittedBatch(
  client: Client,
  input: { sourceLabel: string; processFlowVersionId: string; records: HistoricalCommitRecord[] },
): Promise<BatchVerification> {
  const batches = await client.importBatch.findMany({ where: { sourceLabel: input.sourceLabel } });
  const batch = batches.length === 1 ? batches[0]! : null;
  const jobOrders = batch
    ? await client.jobOrder.findMany({ where: { importBatchId: batch.id }, include: { ...existingJobOrderInclude, factory: { select: { name: true } } } })
    : [];
  const byRef = new Map(jobOrders.map((jo) => [jo.legacyReferenceNumber!, jo] as const));

  const perRecord = input.records.map((record) => {
    const jo = byRef.get(record.legacyReferenceNumber);
    if (!jo) return { legacyReferenceNumber: record.legacyReferenceNumber, jobOrderNumber: null, result: 'MISMATCH' as const, differences: ['No Job Order in this batch'] };
    const differences = compareJobOrderToRecord(jo, record, { importBatchId: batch!.id, processFlowVersionId: input.processFlowVersionId });
    return { legacyReferenceNumber: record.legacyReferenceNumber, jobOrderNumber: jo.jobOrderNumber, result: differences.length === 0 ? ('EXACT_MATCH' as const) : ('MISMATCH' as const), differences };
  });

  const jobOrderIds = jobOrders.map((jo) => jo.id);
  const docs = batch ? await client.historicalDocument.findMany({ where: { importBatchId: batch.id }, include: { file: true, jobOrders: true } }) : [];
  const links = docs.flatMap((d) => d.jobOrders);
  const linkKeys = links.map((l) => `${l.historicalDocumentId}|${l.jobOrderId}`);
  const docsPerSource = new Map<string, number>();
  for (const d of docs) docsPerSource.set(d.file.checksumSha256 ?? d.id, (docsPerSource.get(d.file.checksumSha256 ?? d.id) ?? 0) + 1);
  const files = batch ? await client.file.findMany({ where: { storageKey: { startsWith: historicalDocumentStoragePrefix(batch.id) } } }) : [];
  const filesPerSource = new Map<string, number>();
  for (const f of files) filesPerSource.set(f.checksumSha256 ?? f.id, (filesPerSource.get(f.checksumSha256 ?? f.id) ?? 0) + 1);

  const bySeason: BatchVerification['aggregates']['bySeason'] = {};
  const byFactory: BatchVerification['aggregates']['byFactory'] = {};
  for (const jo of jobOrders) {
    const qty = jo.lines.reduce((sum, l) => sum + l.orderedQuantityTotal, 0);
    const season = jo.lines[0]?.style.season?.code ?? '(none)';
    bySeason[season] = { jobOrders: (bySeason[season]?.jobOrders ?? 0) + 1, quantity: (bySeason[season]?.quantity ?? 0) + qty };
    byFactory[jo.factory.name] = { jobOrders: (byFactory[jo.factory.name]?.jobOrders ?? 0) + 1, quantity: (byFactory[jo.factory.name]?.quantity ?? 0) + qty };
  }

  return {
    importBatch: batch
      ? { id: batch.id, sourceLabel: batch.sourceLabel, status: batch.status, startedById: batch.startedById, completedAt: batch.completedAt?.toISOString() ?? null }
      : null,
    importBatchCountForLabel: batches.length,
    jobOrderCountInBatch: jobOrders.length,
    uniqueLegacyReferences: new Set(jobOrders.map((jo) => jo.legacyReferenceNumber)).size,
    perRecord,
    exactMatch: perRecord.filter((r) => r.result === 'EXACT_MATCH').length,
    mismatch: perRecord.filter((r) => r.result === 'MISMATCH').length + Math.max(0, jobOrders.length - input.records.length),
    importerIds: [...new Set(jobOrders.map((jo) => jo.importedById ?? '(null)'))],
    jobOrderNumbers: jobOrders.map((jo) => jo.jobOrderNumber).sort(),
    documents: {
      historicalDocuments: docs.length,
      files: files.length,
      primarySourceLinks: links.filter((l) => l.relationshipType === 'PRIMARY_SOURCE').length,
      duplicateLinks: linkKeys.length - new Set(linkKeys).size,
      duplicateDocumentsPerSource: [...docsPerSource.values()].filter((n) => n > 1).length,
      duplicateFilesPerSource: [...filesPerSource.values()].filter((n) => n > 1).length,
    },
    auditImportEvents: jobOrderIds.length
      ? await client.auditLog.count({ where: { action: 'HISTORICAL_JOB_ORDER_IMPORTED', entityType: 'JobOrder', entityId: { in: jobOrderIds } } })
      : 0,
    falseHistory: await countFalseHistoryForJobOrders(
      client,
      jobOrderIds,
      jobOrders.map((jo) => ({ factoryId: jo.factoryId, styleId: jo.lines[0]?.styleId ?? '' })),
    ),
    aggregates: { bySeason, byFactory },
  };
}

// ---------------------------------------------------------------------------
// Dev-only batch reset
// ---------------------------------------------------------------------------

export interface ResetResult {
  importBatchId: string;
  deletedJobOrders: number;
  deletedHistoricalDocuments: number;
  deletedFiles: number;
  deletedImportAuditEvents: number;
  deletedStorageObjects: number;
}

/**
 * Removes exactly what one H2B batch created, dependency-safe, in one
 * transaction: its import audit events, its historical Job Orders (lines/
 * sizes/document links cascade), its HistoricalDocuments, the Files under
 * its own storage prefix, then the ImportBatch itself. Refuses — writing
 * nothing — if any batch Job Order is not HISTORICAL_IMPORT, has ANY live
 * workflow dependant, or a batch document/file is referenced from outside
 * the batch. Never touches Seasons/Styles/Sizes/StyleSizes/Style<->Factory
 * mappings or Style images (H2A master data), and never rewinds the
 * HISTORICAL_JOB_ORDER sequence (numbers are never reissued). Leaves one
 * HISTORICAL_IMPORT_BATCH_RESET audit event as the record that it happened.
 */
export async function resetHistoricalImportBatch(
  actor: CurrentUser,
  input: { importBatchId: string; expectedSourceLabel: string },
): Promise<ResetResult> {
  if (!actor.roles.includes('ADMIN')) throw new HistoricalCommitError('Only an ADMIN may reset a historical import batch');
  const prefix = historicalDocumentStoragePrefix(input.importBatchId);

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: input.importBatchId } });
    if (!batch) throw new HistoricalCommitError(`ImportBatch ${input.importBatchId} not found`);
    if (batch.sourceLabel !== input.expectedSourceLabel) {
      throw new HistoricalCommitError(`ImportBatch ${batch.id} has sourceLabel "${batch.sourceLabel}", not "${input.expectedSourceLabel}" — refusing`);
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('historical_import_batch:' || ${batch.sourceLabel}, 0))::text`;

    const jobOrders = await tx.jobOrder.findMany({ where: { importBatchId: batch.id }, select: { id: true, recordOrigin: true, factoryId: true, lines: { select: { styleId: true } } } });
    const nonHistorical = jobOrders.filter((jo) => jo.recordOrigin !== 'HISTORICAL_IMPORT');
    if (nonHistorical.length > 0) throw new HistoricalCommitError(`${nonHistorical.length} Job Order(s) in this batch are not HISTORICAL_IMPORT — refusing`);
    const jobOrderIds = jobOrders.map((jo) => jo.id);

    const dependants = await countFalseHistoryForJobOrders(tx, jobOrderIds, []);
    const blocking = Object.entries(dependants).filter(([key, n]) => key !== 'nonImportAuditEvents' && n > 0);
    if (blocking.length > 0) {
      throw new HistoricalCommitError(`Batch Job Orders have live workflow dependants (${blocking.map(([k, n]) => `${k}=${n}`).join(', ')}) — refusing`);
    }
    if (dependants.nonImportAuditEvents > 0) {
      throw new HistoricalCommitError(`${dependants.nonImportAuditEvents} non-import audit event(s) reference batch Job Orders — refusing`);
    }

    const docs = await tx.historicalDocument.findMany({ where: { importBatchId: batch.id }, include: { jobOrders: { select: { jobOrderId: true } } } });
    const foreignLinks = docs.flatMap((d) => d.jobOrders).filter((l) => !jobOrderIds.includes(l.jobOrderId));
    if (foreignLinks.length > 0) throw new HistoricalCommitError(`${foreignLinks.length} batch document link(s) point outside the batch — refusing`);
    const batchJobOrderLinksToForeignDocs = await tx.historicalDocumentJobOrder.count({
      where: { jobOrderId: { in: jobOrderIds }, historicalDocument: { OR: [{ importBatchId: null }, { importBatchId: { not: batch.id } }] } },
    });
    if (batchJobOrderLinksToForeignDocs > 0) throw new HistoricalCommitError('Batch Job Orders link to documents outside the batch — refusing');

    const files = await tx.file.findMany({
      where: { storageKey: { startsWith: prefix } },
      include: { _count: { select: { styleImages: true, qaEvidence: true, qualityAttachments: true } }, historicalDocuments: { select: { importBatchId: true } } },
    });
    const foreignFileUse = files.filter(
      (f) => f._count.styleImages + f._count.qaEvidence + f._count.qualityAttachments > 0 || f.historicalDocuments.some((d) => d.importBatchId !== batch.id),
    );
    if (foreignFileUse.length > 0) throw new HistoricalCommitError(`${foreignFileUse.length} batch file(s) are referenced outside the batch — refusing`);
    const docFileIds = new Set(docs.map((d) => d.fileId));
    const filesOutsidePrefix = [...docFileIds].filter((id) => !files.some((f) => f.id === id));
    if (filesOutsidePrefix.length > 0) throw new HistoricalCommitError(`${filesOutsidePrefix.length} batch document file(s) live outside the batch storage prefix — refusing`);

    const deletedAudit = await tx.auditLog.deleteMany({
      where: { action: 'HISTORICAL_JOB_ORDER_IMPORTED', entityType: 'JobOrder', entityId: { in: jobOrderIds } },
    });
    const deletedJobOrders = await tx.jobOrder.deleteMany({ where: { id: { in: jobOrderIds } } });
    const deletedDocs = await tx.historicalDocument.deleteMany({ where: { importBatchId: batch.id } });
    const deletedFiles = await tx.file.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
    await tx.importBatch.delete({ where: { id: batch.id } });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'HISTORICAL_IMPORT_BATCH_RESET',
        entityType: 'ImportBatch',
        entityId: batch.id,
        metadata: {
          sourceLabel: batch.sourceLabel,
          deletedJobOrders: deletedJobOrders.count,
          deletedHistoricalDocuments: deletedDocs.count,
          deletedFiles: deletedFiles.count,
          deletedImportAuditEvents: deletedAudit.count,
        },
      },
      tx,
    );
    return {
      storageKeys: files.map((f) => f.storageKey),
      counts: {
        importBatchId: batch.id,
        deletedJobOrders: deletedJobOrders.count,
        deletedHistoricalDocuments: deletedDocs.count,
        deletedFiles: deletedFiles.count,
        deletedImportAuditEvents: deletedAudit.count,
      },
    };
  });

  // Database state is authoritative; storage cleanup happens only after
  // the metadata delete committed.
  let deletedStorageObjects = 0;
  const storage = getFileStorage();
  for (const key of result.storageKeys) {
    if (await storage.delete(key).catch(() => false)) deletedStorageObjects++;
  }
  return { ...result.counts, deletedStorageObjects };
}
