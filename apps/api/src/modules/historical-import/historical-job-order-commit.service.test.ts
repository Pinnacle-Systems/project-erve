// H2B coverage for the controlled historical Job Order commit, rerun, and
// Dev batch reset — synthetic fixtures only (no real source data), against
// the disposable test database.
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { getFileStorage } from '../../storage/index.js';
import { uploadStyleImage } from '../master-data/style-images.service.js';
import {
  commitHistoricalJobOrders,
  HistoricalCommitConflictError,
  HistoricalCommitError,
  historicalDocumentStoragePrefix,
  planHistoricalJobOrderCommit,
  resetHistoricalImportBatch,
  verifyCommittedBatch,
  type HistoricalBatchIdentity,
  type HistoricalCommitRecord,
} from './historical-job-order-commit.service.js';
import { importHistoricalJobOrder } from './historical-import.service.js';
import { reconcileDocumentaryText } from './documentary-reconciliation.js';
import { createTestFactory, createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function sha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function syntheticPdf(ref: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% synthetic historical factory order ${ref}\n%%EOF\n`, 'latin1');
}

function syntheticPng(seed: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(17, seed),
  ]);
}

function adminUser(userId: string): CurrentUser {
  return { id: userId, email: `${userId}@test.local`, mobile: null, name: 'Importer', status: 'ACTIVE', authVersion: 1, roles: ['ADMIN'], distributorIds: [], factoryIds: [] };
}

async function buildFixture(recordCount = 2) {
  const admin = await createTestUserAndToken({ email: `admin-${createId().toLowerCase()}@test.local`, password: 'pass', roles: ['ADMIN'] });
  const factory = await createTestFactory();
  const financialYear = await createTestFinancialYear();
  const season = await prisma.season.create({ data: { id: createId(), code: `SYN-${createId()}`, name: 'Synthetic season', financialYearId: financialYear.id } });
  const sizeA = await prisma.size.create({ data: { id: createId(), code: `SYN-A-${createId()}`, label: '3', sizeType: 'AGE', sortOrder: 3 } });
  const sizeB = await prisma.size.create({ data: { id: createId(), code: `SYN-B-${createId()}`, label: '4', sizeType: 'AGE', sortOrder: 4 } });
  const flow = await prisma.processFlow.create({
    data: { id: createId(), code: `SYN-FLOW-${createId()}`, name: 'Synthetic flow', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } },
    include: { versions: true },
  });
  const processFlowVersionId = flow.versions[0]!.id;

  const records: HistoricalCommitRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    const ref = `EISYN${String(i + 1).padStart(3, '0')}`;
    const lmix = `LMIXSYN${i}`;
    const style = await prisma.style.create({
      data: { id: createId(), styleNumber: `SYN-${createId()}`, styleName: `Synthetic ${i}`, finalMrp: 999, seasonId: season.id, lmixNumber: lmix },
    });
    await prisma.styleSize.createMany({ data: [sizeA, sizeB].map((s) => ({ id: createId(), styleId: style.id, sizeId: s.id })) });
    const pdf = syntheticPdf(ref);
    const png = syntheticPng(i + 1);
    records.push({
      sourceFileName: `PO Sheet - ${ref}.pdf`,
      sourceSha256: sha(pdf),
      sourceSizeBytes: pdf.length,
      legacyReferenceNumber: ref,
      seasonCode: season.code,
      lmix,
      factoryId: factory.id,
      styleId: style.id,
      historicalBusinessDate: '2025-08-15',
      requiredDeliveryDate: '2025-09-30',
      unitPrice: '336',
      sizes: [
        { sourceSizeCode: '3', sizeId: sizeA.id, quantity: 100 + i },
        { sourceSizeCode: '4', sizeId: sizeB.id, quantity: 200 + i },
      ],
      sourceSnapshot: { synthetic: true, ref },
      migrationNotes: `Synthetic ${ref}`,
      loadSourcePdf: async () => pdf,
      image: { sha256: sha(png), fileName: `${ref}.png`, load: async () => png },
    });
  }

  const identity: HistoricalBatchIdentity = {
    sourceLabel: `SYN-${createId()}`,
    processFlowVersionId,
    provenance: {
      story: 'H2B',
      description: 'synthetic',
      sourceArchives: ['synthetic'],
      sourceManifestAggregateSha256: 'a'.repeat(64),
      parserVersion: '1.0.0',
      sourceOverridesSha256: null,
      processFlowLogicalIdentity: { processFlowCode: flow.code, versionNumber: 1, fingerprint: 'f'.repeat(64) },
    },
    counts: { total: recordCount, ready: recordCount, reviewRequired: 0, blocked: 0, duplicate: 0 },
  };
  return { admin, actor: adminUser(admin.userId), factory, season, records, identity, processFlowVersionId };
}

async function tableCounts() {
  const [jobOrders, docs, links, files, styleImages, batches] = await Promise.all([
    prisma.jobOrder.count(),
    prisma.historicalDocument.count(),
    prisma.historicalDocumentJobOrder.count(),
    prisma.file.count(),
    prisma.styleImage.count(),
    prisma.importBatch.count(),
  ]);
  return { jobOrders, docs, links, files, styleImages, batches };
}

describe('commitHistoricalJobOrders', () => {
  it('corrects only documentary fields atomically and is idempotent', async () => {
    const f = await buildFixture(1);
    const imported = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const jo = await prisma.jobOrder.findFirstOrThrow({ where: { importBatchId: imported.importBatchId } });
    const input = [{ jobOrderId: jo.id, styleId: f.records[0]!.styleId, legacyReference: jo.legacyReferenceNumber!,
      expectedDescription: null, expectedDisclaimer: null, expectedStyleName: 'Synthetic 0', styleName: 'Source style', description: 'Source description\n*ST1: specification',
      disclaimer: 'Sample: 2 Pcs\n\n*Source clause', sourceSha256: f.records[0]!.sourceSha256,
      sourceSnapshot: { sourceSha256: f.records[0]!.sourceSha256,
        effectiveFields: { description: { value: 'Source description\n*ST1: specification' }, styleName: { value: 'Source style' } },
        documentarySections: { jobOrderDisclaimer: 'Sample: 2 Pcs\n\n*Source clause' } },
    }];
    expect(await reconcileDocumentaryText(f.actor, imported.importBatchId, input)).toEqual({ stylesChanged: 1, styleNamesChanged: 1, disclaimersChanged: 1 });
    const after = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } });
    expect(after.disclaimerText).toBe(input[0]!.disclaimer);
    expect(after.jobOrderNumber).toBe(jo.jobOrderNumber);
    expect(after.requiredDeliveryDate).toEqual(jo.requiredDeliveryDate);
    expect(after.unitPrice.toString()).toBe(jo.unitPrice.toString());
    expect((await prisma.style.findUniqueOrThrow({ where: { id: input[0]!.styleId } })).styleName).toBe('Source style');
    const source = await prisma.historicalDocumentJobOrder.findFirstOrThrow({ where: { jobOrderId: jo.id }, include: { historicalDocument: true } });
    expect(source.historicalDocument.sourceSnapshot).toEqual(input[0]!.sourceSnapshot);
    expect(await reconcileDocumentaryText(f.actor, imported.importBatchId, input)).toEqual({ stylesChanged: 0, styleNamesChanged: 0, disclaimersChanged: 0 });
    await prisma.style.update({ where: { id: input[0]!.styleId }, data: { description: 'Concurrent edit' } });
    await expect(reconcileDocumentaryText(f.actor, imported.importBatchId, input)).rejects.toThrow('changed since audit');
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } })).disclaimerText).toBe(input[0]!.disclaimer);
  });

  it('imports source disclaimer verbatim on the first run and verifies it on rerun', async () => {
    const f = await buildFixture(1);
    f.records[0]!.disclaimerText = 'Fitting: 2 Pcs\nPhoto: 3 Pcs\n\n*Source commercial clause.';
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const jo = await prisma.jobOrder.findFirstOrThrow({ where: { legacyReferenceNumber: 'EISYN001' } });
    expect(jo.disclaimerText).toBe('Fitting: 2 Pcs\nPhoto: 3 Pcs\n\n*Source commercial clause.');
    const again = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    expect(again.created).toHaveLength(0);
    await prisma.jobOrder.update({ where: { id: jo.id }, data: { disclaimerText: 'wrong' } });
    const v = await verifyCommittedBatch(prisma, { sourceLabel: f.identity.sourceLabel, processFlowVersionId: f.processFlowVersionId, records: f.records });
    expect(v.mismatch).toBe(1);
  });

  it('rejects live disclaimer edits for historical origin even if its status is draft', async () => {
    const f = await buildFixture(1);
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const jo = await prisma.jobOrder.findFirstOrThrow({ where: { importBatchId: result.importBatchId } });
    await prisma.jobOrder.update({ where: { id: jo.id }, data: { status: 'DRAFT', disclaimerText: 'Source evidence' } });
    const response = await request(app).patch(`/job-orders/${jo.id}/disclaimer`)
      .set('Authorization', `Bearer ${f.admin.token}`).set('Idempotency-Key', 'historical-disclaimer')
      .send({ expectedVersion: jo.version, disclaimerText: 'Changed evidence' });
    expect(response.status).toBe(409);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: jo.id } })).disclaimerText).toBe('Source evidence');
  });

  it('first run creates one batch, the Job Orders, source evidence, audit events and images — with no workflow history', async () => {
    const f = await buildFixture();
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });

    expect(result.batchCreated).toBe(true);
    expect(result.created).toHaveLength(2);
    expect(result.images.map((i) => i.action)).toEqual(['UPLOADED', 'UPLOADED']);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.importBatchId } });
    expect(batch.status).toBe('COMPLETED');
    expect(batch.startedById).toBe(f.actor.id);
    expect(batch.processFlowVersionId).toBe(f.processFlowVersionId);
    expect(JSON.parse(batch.notes!).sourceManifestAggregateSha256).toBe('a'.repeat(64));

    const jo = await prisma.jobOrder.findFirstOrThrow({ where: { legacyReferenceNumber: 'EISYN001' }, include: { lines: { include: { sizes: true } } } });
    expect(jo.recordOrigin).toBe('HISTORICAL_IMPORT');
    expect(jo.status).toBe('PRODUCTION_COMPLETE');
    expect(jo.jobOrderNumber.startsWith('EIJOH/')).toBe(true);
    expect(jo.jobOrderSerial).toBeNull();
    expect(jo.importBatchId).toBe(batch.id);
    expect(jo.importedById).toBe(f.actor.id);
    expect(jo.lines[0]!.orderedQuantityTotal).toBe(300);
    expect(jo.lines[0]!.preparedQuantityTotal).toBe(0);

    // Source PDF went through the normal File storage, under the batch prefix, byte-exact.
    const link = await prisma.historicalDocumentJobOrder.findFirstOrThrow({ where: { jobOrderId: jo.id }, include: { historicalDocument: { include: { file: true } } } });
    expect(link.relationshipType).toBe('PRIMARY_SOURCE');
    expect(link.historicalDocument.documentType).toBe('HISTORICAL_FACTORY_ORDER');
    expect(link.historicalDocument.externalReference).toBe('EISYN001');
    expect(link.historicalDocument.file.mimeType).toBe('application/pdf');
    expect(link.historicalDocument.file.storageKey.startsWith(historicalDocumentStoragePrefix(batch.id))).toBe(true);
    const stored = await getFileStorage().read(link.historicalDocument.file.storageKey);
    expect(sha(stored)).toBe(f.records[0]!.sourceSha256);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'JobOrder', entityId: jo.id } });
    expect(audit.map((a) => a.action)).toEqual(['HISTORICAL_JOB_ORDER_IMPORTED']);
    expect(audit[0]!.actorId).toBe(f.actor.id);

    // The image service's own rule: first image of a Style becomes primary.
    const image = await prisma.styleImage.findFirstOrThrow({ where: { styleId: f.records[0]!.styleId }, include: { file: true } });
    expect(image.isPrimary).toBe(true);
    expect(image.file.checksumSha256).toBe(f.records[0]!.image!.sha256);

    const verification = await verifyCommittedBatch(prisma, { sourceLabel: f.identity.sourceLabel, processFlowVersionId: f.processFlowVersionId, records: f.records });
    expect(verification.exactMatch).toBe(2);
    expect(verification.mismatch).toBe(0);
    expect(verification.documents).toMatchObject({ historicalDocuments: 2, files: 2, primarySourceLinks: 2, duplicateLinks: 0, duplicateDocumentsPerSource: 0, duplicateFilesPerSource: 0 });
    expect(verification.auditImportEvents).toBe(2);
    expect(verification.falseHistory).toEqual({
      orderSheets: 0, acknowledgements: 0, stageStatuses: 0, seasonSnapshots: 0, qualityExecutions: 0, qaInspectionSessions: 0,
      qaReworkTasks: 0, finalQualityBatches: 0, qaReleases: 0, qaReleaseLines: 0, pooledInventoryLines: 0, pooledInventoryQuantity: 0, nonImportAuditEvents: 0,
    });
    await expect(prisma.saleOrder.count()).resolves.toBe(0);
    await expect(prisma.factoryDispatch.count()).resolves.toBe(0);
    await expect(prisma.factoryInvoice.count()).resolves.toBe(0);
    await expect(prisma.ervePackingList.count()).resolves.toBe(0);
    await expect(prisma.erveDispatch.count()).resolves.toBe(0);
    await expect(prisma.invoiceHandoff.count()).resolves.toBe(0);
  });

  it('an exact rerun creates nothing, consumes no EIJOH serial, and duplicates no document, file, link or image', async () => {
    const f = await buildFixture();
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const before = await tableCounts();
    const seqBefore = await prisma.documentSequence.findMany({ where: { documentType: 'HISTORICAL_JOB_ORDER' } });

    const rerun = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    expect(rerun.batchCreated).toBe(false);
    expect(rerun.created).toHaveLength(0);
    expect(rerun.verifiedExisting).toBe(2);
    expect(rerun.images.map((i) => i.action)).toEqual(['SKIP_ALREADY_PRESENT', 'SKIP_ALREADY_PRESENT']);
    expect(await tableCounts()).toEqual(before);
    expect(await prisma.documentSequence.findMany({ where: { documentType: 'HISTORICAL_JOB_ORDER' } })).toEqual(seqBefore);
    await expect(prisma.documentSequence.count({ where: { documentType: 'JOB_ORDER' } })).resolves.toBe(0);
  });

  it('resumes a partial batch: existing rows verify, only the missing record is created', async () => {
    const f = await buildFixture(3);
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records.slice(0, 2) });
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    expect(result.created.map((c) => c.legacyReferenceNumber)).toEqual(['EISYN003']);
    expect(result.verifiedExisting).toBe(2);
    expect(await prisma.importBatch.count()).toBe(1);
  });

  it('stops with ZERO writes when an existing legacy reference differs materially from the approved record', async () => {
    const f = await buildFixture();
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const before = await tableCounts();
    const changed = f.records.map((r, i) => (i === 1 ? { ...r, sizes: r.sizes.map((s) => ({ ...s, quantity: s.quantity + 1 })) } : r));

    await expect(commitHistoricalJobOrders(f.actor, { identity: f.identity, records: changed })).rejects.toBeInstanceOf(HistoricalCommitConflictError);
    expect(await tableCounts()).toEqual(before);
  });

  it('flags a legacy reference already held by a Job Order outside the batch as REVIEW_CONFLICT', async () => {
    const f = await buildFixture(1);
    const liveId = createId();
    await prisma.jobOrder.create({
      data: {
        id: liveId, jobOrderNumber: `EIJO/SYN/${createId()}`, factoryId: f.factory.id, processFlowVersionId: f.processFlowVersionId,
        unitPrice: 1, createdBy: f.actor.id, financialYearId: (await createTestFinancialYear()).id, legacyReferenceNumber: 'EISYN001',
      },
    });
    const plan = await planHistoricalJobOrderCommit(prisma, { importBatchId: null, processFlowVersionId: f.processFlowVersionId, records: f.records });
    expect(plan[0]!.action).toBe('REVIEW_CONFLICT');
    await expect(commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records })).rejects.toBeInstanceOf(HistoricalCommitConflictError);
    await expect(prisma.importBatch.count()).resolves.toBe(0);
  });

  it('rejects a repeated legacy reference within the approved input', async () => {
    const f = await buildFixture(2);
    const dup = [f.records[0]!, { ...f.records[1]!, legacyReferenceNumber: f.records[0]!.legacyReferenceNumber }];
    const plan = await planHistoricalJobOrderCommit(prisma, { importBatchId: null, processFlowVersionId: f.processFlowVersionId, records: dup });
    expect(plan.map((p) => p.action)).toEqual(['REVIEW_CONFLICT', 'REVIEW_CONFLICT']);
  });

  it('refuses a source PDF whose bytes no longer match the approved hash, before creating the batch', async () => {
    const f = await buildFixture(1);
    const tampered = [{ ...f.records[0]!, loadSourcePdf: async () => syntheticPdf('tampered') }];
    await expect(commitHistoricalJobOrders(f.actor, { identity: f.identity, records: tampered })).rejects.toBeInstanceOf(HistoricalCommitError);
    await expect(prisma.jobOrder.count()).resolves.toBe(0);
    await expect(prisma.historicalDocument.count()).resolves.toBe(0);
  });

  it('never replaces a different existing Style image — REVIEW_CONFLICT, image left untouched', async () => {
    const f = await buildFixture(1);
    const existing = await uploadStyleImage(f.actor, f.records[0]!.styleId, { buffer: syntheticPng(99), originalName: 'existing.png' });
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    expect(result.images[0]!.action).toBe('REVIEW_CONFLICT');
    const images = await prisma.styleImage.findMany({ where: { styleId: f.records[0]!.styleId } });
    expect(images.map((i) => i.id)).toEqual([existing.image.id]);
  });

  it('refuses a second ImportBatch reuse when the source manifest changed', async () => {
    const f = await buildFixture(1);
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const changedIdentity = { ...f.identity, provenance: { ...f.identity.provenance, sourceManifestAggregateSha256: 'b'.repeat(64) } };
    await expect(commitHistoricalJobOrders(f.actor, { identity: changedIdentity, records: f.records })).rejects.toBeInstanceOf(HistoricalCommitError);
  });

  it('requires an ADMIN actor', async () => {
    const f = await buildFixture(1);
    await expect(commitHistoricalJobOrders({ ...f.actor, roles: ['MERCHANDISER'] }, { identity: f.identity, records: f.records })).rejects.toBeInstanceOf(HistoricalCommitError);
  });
});

describe('importHistoricalJobOrder idempotency backstop', () => {
  it('refuses a second row for the same legacy reference in the same batch', async () => {
    const f = await buildFixture(1);
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const doc = await prisma.historicalDocument.findFirstOrThrow();
    const r = f.records[0]!;
    await expect(
      importHistoricalJobOrder(f.actor, {
        legacyReferenceNumber: r.legacyReferenceNumber, historicalBusinessDate: new Date('2025-08-15'), factoryId: r.factoryId, styleId: r.styleId,
        processFlowVersionId: f.processFlowVersionId, importBatchId: result.importBatchId, unitPrice: r.unitPrice,
        sizes: r.sizes.map((s) => ({ sizeId: s.sizeId, quantity: s.quantity })), document: { mode: 'existing', historicalDocumentId: doc.id },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.jobOrder.count()).resolves.toBe(1);
  });
});

describe('Job Order search over imported historical rows', () => {
  it('finds the same single row by legacy reference and by EIJOH number, and live EIJO search still works', async () => {
    const f = await buildFixture(2);
    await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const historical = await prisma.jobOrder.findFirstOrThrow({ where: { legacyReferenceNumber: 'EISYN002' } });
    const live = await prisma.jobOrder.create({
      data: {
        id: createId(), jobOrderNumber: 'EIJO/SY/0007', factoryId: f.factory.id, processFlowVersionId: f.processFlowVersionId, unitPrice: 1,
        status: 'IN_PRODUCTION', createdBy: f.actor.id, financialYearId: (await createTestFinancialYear()).id, jobOrderSerial: 7,
      },
    });

    const search = async (term: string) => {
      const res = await request(app).get('/job-orders').query({ search: term }).set('Authorization', `Bearer ${f.admin.token}`);
      expect(res.status).toBe(200);
      return (res.body.data.items ?? res.body.data).map((i: { id: string }) => i.id) as string[];
    };
    expect(await search('EISYN002')).toEqual([historical.id]);
    expect(await search(historical.jobOrderNumber)).toEqual([historical.id]);
    expect(await search('EIJO/SY/0007')).toEqual([live.id]);
  });
});

describe('resetHistoricalImportBatch', () => {
  it('removes exactly the batch-owned rows and files, keeps master data and Style images, never rewinds EIJOH, and a recommit works', async () => {
    const f = await buildFixture(2);
    const first = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const storageKeys = (await prisma.file.findMany({ where: { storageKey: { startsWith: historicalDocumentStoragePrefix(first.importBatchId) } } })).map((x) => x.storageKey);
    expect(storageKeys).toHaveLength(2);
    const masters = { styles: await prisma.style.count(), styleSizes: await prisma.styleSize.count(), sizes: await prisma.size.count(), seasons: await prisma.season.count() };

    const reset = await resetHistoricalImportBatch(f.actor, { importBatchId: first.importBatchId, expectedSourceLabel: f.identity.sourceLabel });
    expect(reset).toMatchObject({ deletedJobOrders: 2, deletedHistoricalDocuments: 2, deletedFiles: 2, deletedImportAuditEvents: 2, deletedStorageObjects: 2 });
    expect(await tableCounts()).toMatchObject({ jobOrders: 0, docs: 0, links: 0, batches: 0, styleImages: 2, files: 2 });
    await expect(prisma.jobOrderLine.count()).resolves.toBe(0);
    for (const key of storageKeys) await expect(getFileStorage().exists(key)).resolves.toBe(false);
    expect({ styles: await prisma.style.count(), styleSizes: await prisma.styleSize.count(), sizes: await prisma.size.count(), seasons: await prisma.season.count() }).toEqual(masters);
    await expect(prisma.auditLog.count({ where: { action: 'HISTORICAL_IMPORT_BATCH_RESET', entityId: first.importBatchId } })).resolves.toBe(1);
    const seq = await prisma.documentSequence.findFirstOrThrow({ where: { documentType: 'HISTORICAL_JOB_ORDER' } });
    expect(seq.lastAllocatedSerial).toBe(2);

    const again = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    expect(again.created).toHaveLength(2);
    expect(again.images.map((i) => i.action)).toEqual(['SKIP_ALREADY_PRESENT', 'SKIP_ALREADY_PRESENT']);
    expect(again.created.map((c) => c.jobOrderNumber.endsWith('0003') || c.jobOrderNumber.endsWith('0004'))).toEqual([true, true]);
  });

  it('refuses — deleting nothing — when a batch Job Order has any live workflow dependant (even a cascade-deletable one)', async () => {
    const f = await buildFixture(1);
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    // JobOrderAcknowledgement cascades on JobOrder delete, so only the
    // explicit dependant pre-check keeps a reset from silently destroying it.
    await prisma.jobOrderAcknowledgement.create({
      data: {
        id: createId(), jobOrderId: result.created[0]!.jobOrderId, jobOrderVersion: 1, disclaimerRevision: 0, disclaimerTextSnapshot: 'x',
        disclaimerSha256: 'x', factoryIdSnapshot: f.factory.id, acknowledgedByUserId: f.actor.id, acknowledgedByRole: 'ADMIN', acknowledgedAt: new Date(),
      },
    });
    await expect(resetHistoricalImportBatch(f.actor, { importBatchId: result.importBatchId, expectedSourceLabel: f.identity.sourceLabel })).rejects.toBeInstanceOf(HistoricalCommitError);
    await expect(prisma.jobOrder.count()).resolves.toBe(1);
    await expect(prisma.importBatch.count()).resolves.toBe(1);
    await expect(prisma.jobOrderAcknowledgement.count()).resolves.toBe(1);
  });

  it('requires the exact batch id AND its sourceLabel', async () => {
    const f = await buildFixture(1);
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    await expect(resetHistoricalImportBatch(f.actor, { importBatchId: result.importBatchId, expectedSourceLabel: 'OTHER' })).rejects.toBeInstanceOf(HistoricalCommitError);
    await expect(resetHistoricalImportBatch(f.actor, { importBatchId: createId(), expectedSourceLabel: f.identity.sourceLabel })).rejects.toBeInstanceOf(HistoricalCommitError);
    await expect(prisma.jobOrder.count()).resolves.toBe(1);
  });
});

describe('imported historical Job Order over the live Job Order API', () => {
  it('exposes historicalImport on detail (null for live rows) and refuses the live delivery-date edit', async () => {
    const f = await buildFixture(1);
    const result = await commitHistoricalJobOrders(f.actor, { identity: f.identity, records: f.records });
    const id = result.created[0]!.jobOrderId;

    const detail = await request(app).get(`/job-orders/${id}`).set('Authorization', `Bearer ${f.admin.token}`).expect(200);
    expect(detail.body.data.historicalImport).toMatchObject({ legacyReferenceNumber: 'EISYN001', historicalBusinessDate: '2025-08-15' });
    expect(detail.body.data.deliveryDateLocked).toBe(true);

    const res = await request(app)
      .patch(`/job-orders/${id}/delivery-date`)
      .set('Authorization', `Bearer ${f.admin.token}`)
      .set('Idempotency-Key', createId())
      .send({ requiredDeliveryDate: '2030-01-01', expectedVersion: detail.body.data.version });
    expect(res.status).toBe(409);
    const after = await prisma.jobOrder.findUniqueOrThrow({ where: { id } });
    expect(after.requiredDeliveryDate?.toISOString().slice(0, 10)).toBe('2025-09-30');

    const live = await prisma.jobOrder.create({
      data: {
        id: createId(), jobOrderNumber: 'EIJO/SY/0009', factoryId: f.factory.id, processFlowVersionId: f.processFlowVersionId, unitPrice: 1,
        status: 'SENT_TO_FACTORY', createdBy: f.actor.id, financialYearId: (await createTestFinancialYear()).id, jobOrderSerial: 9,
      },
    });
    const liveDetail = await request(app).get(`/job-orders/${live.id}`).set('Authorization', `Bearer ${f.admin.token}`).expect(200);
    expect(liveDetail.body.data.historicalImport).toBeNull();
  });
});
