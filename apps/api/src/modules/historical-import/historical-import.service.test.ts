// Required coverage per the H1 plan §14/§27 for the write-only historical
// importer. Exercised only against the disposable test database — no H1 CLI
// calls this service; these are the only callers in Story H1.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { getPooledFactoryInventory } from '../job-orders/pooled-inventory.service.js';
import { importHistoricalJobOrder, type ImportHistoricalJobOrderInput } from './historical-import.service.js';
import { createTestFactory, createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function currentUserFor(userId: string, roles: CurrentUser['roles']): CurrentUser {
  return {
    id: userId,
    email: `${userId}@test.local`,
    mobile: null,
    name: 'Test User',
    status: 'ACTIVE',
    authVersion: 1,
    roles,
    distributorIds: [],
    factoryIds: [],
  };
}

async function buildFixture() {
  const admin = await createTestUserAndToken({ email: `admin-${createId()}@test.local`, password: 'pass', roles: ['ADMIN'] });
  const factory = await createTestFactory();
  const season = await prisma.season.create({
    data: { id: createId(), code: `HIST-${createId()}`, name: 'Historical fixture season', financialYearId: (await createTestFinancialYear()).id },
  });
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: `HIST-ST-${createId()}`, styleName: 'Historical Style', finalMrp: 500, seasonId: season.id },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `HIST-SZ-${createId()}`, label: '6', sizeType: 'AGE', sortOrder: 6 },
  });
  await prisma.styleSize.create({ data: { id: createId(), styleId: style.id, sizeId: size.id } });
  const processFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `HIST-FLOW-${createId()}`,
      name: 'Historical fixture flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const processFlowVersionId = processFlow.versions[0]!.id;
  const file = await prisma.file.create({
    data: { id: createId(), fileName: 'EI25001.pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `historical-import/${createId()}.pdf` },
  });
  const importBatch = await prisma.importBatch.create({
    data: { id: createId(), sourceLabel: 'AW25-SS26', startedById: admin.userId, processFlowVersionId },
  });

  return { admin, factory, style, size, processFlowVersionId, file, importBatch };
}

function baseInput(f: Awaited<ReturnType<typeof buildFixture>>): ImportHistoricalJobOrderInput {
  return {
    legacyReferenceNumber: 'EI25001',
    historicalBusinessDate: new Date('2025-08-15'),
    requiredDeliveryDate: new Date('2025-09-30'),
    factoryId: f.factory.id,
    styleId: f.style.id,
    processFlowVersionId: f.processFlowVersionId,
    importBatchId: f.importBatch.id,
    unitPrice: '336',
    sizes: [{ sizeId: f.size.id, quantity: 1008 }],
    document: {
      mode: 'create',
      documentType: 'HISTORICAL_FACTORY_ORDER',
      externalReference: 'EI25001',
      fileId: f.file.id,
      sourceSnapshot: { season: 'AW25', supplier: 'Clifton export Pvt Ltd' },
    },
  };
}

describe('importHistoricalJobOrder', () => {
  it('requires an ADMIN actor', async () => {
    const f = await buildFixture();
    const nonAdmin = await createTestUserAndToken({ email: `merch-${createId()}@test.local`, password: 'pass', roles: ['MERCHANDISER'] });
    await expect(
      importHistoricalJobOrder(currentUserFor(nonAdmin.userId, ['MERCHANDISER']), baseInput(f)),
    ).rejects.toThrow(HttpError);
  });

  it('creates a HISTORICAL_IMPORT row at PRODUCTION_COMPLETE with the pinned Process Flow Version, zero Order Sheets, and independent dates', async () => {
    const f = await buildFixture();
    const before = new Date();
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));

    const jobOrder = await prisma.jobOrder.findUniqueOrThrow({ where: { id: result.jobOrderId } });
    expect(jobOrder.recordOrigin).toBe('HISTORICAL_IMPORT');
    expect(jobOrder.status).toBe('PRODUCTION_COMPLETE');
    expect(jobOrder.processFlowVersionId).toBe(f.processFlowVersionId);
    expect(jobOrder.legacyReferenceNumber).toBe('EI25001');
    expect(jobOrder.historicalBusinessDate?.toISOString().slice(0, 10)).toBe('2025-08-15');
    expect(jobOrder.requiredDeliveryDate?.toISOString().slice(0, 10)).toBe('2025-09-30');
    // financialYearId follows import createdAt, NOT historicalBusinessDate
    // (2025-08-15) — see the service's own comment and H1 plan §2.1.
    const financialYear = await prisma.financialYear.findUniqueOrThrow({ where: { id: jobOrder.financialYearId } });
    expect(jobOrder.createdAt.getTime() >= financialYear.startDate.getTime()).toBe(true);
    expect(jobOrder.createdAt.getTime() <= financialYear.endDate.getTime()).toBe(true);
    // Zero Order Sheets: no DistributorPurchaseOrder ever references this Job Order.
    const claimedOrderSheets = await prisma.distributorPurchaseOrder.count({ where: { jobOrderId: result.jobOrderId } });
    expect(claimedOrderSheets).toBe(0);
    // jobOrderSerial stays NULL; jobOrderNumber comes from the isolated EIJOH sequence.
    expect(jobOrder.jobOrderSerial).toBeNull();
    expect(jobOrder.jobOrderNumber.startsWith('EIJOH/')).toBe(true);
    // Import metadata: true current timestamp, not backdated to historicalBusinessDate.
    expect(jobOrder.importedById).toBe(f.admin.userId);
    expect(jobOrder.importedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(jobOrder.createdBy).toBe(f.admin.userId);
  });

  it('persists ordered quantities only, never prepared/QA/dispatched quantities', async () => {
    const f = await buildFixture();
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));
    const line = await prisma.jobOrderLine.findFirstOrThrow({ where: { jobOrderId: result.jobOrderId }, include: { sizes: true } });
    expect(line.orderedQuantityTotal).toBe(1008);
    expect(line.preparedQuantityTotal).toBe(0);
    expect(line.sizes).toHaveLength(1);
    expect(line.sizes[0]!.orderedQuantity).toBe(1008);
    expect(line.sizes[0]!.preparedQuantity).toBe(0);
  });

  it('attaches the source HistoricalDocument via the join table', async () => {
    const f = await buildFixture();
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));
    const link = await prisma.historicalDocumentJobOrder.findFirstOrThrow({ where: { jobOrderId: result.jobOrderId } });
    expect(link.historicalDocumentId).toBe(result.historicalDocumentId);
    expect(link.relationshipType).toBe('PRIMARY_SOURCE');
    const doc = await prisma.historicalDocument.findUniqueOrThrow({ where: { id: result.historicalDocumentId } });
    expect(doc.fileId).toBe(f.file.id);
    expect(doc.importBatchId).toBe(f.importBatch.id);
    expect(doc.addedById).toBe(f.admin.userId);
  });

  it('records a HISTORICAL_JOB_ORDER_IMPORTED audit event with a true current timestamp', async () => {
    const f = await buildFixture();
    const before = new Date();
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: result.jobOrderId, action: 'HISTORICAL_JOB_ORDER_IMPORTED' } });
    expect(entry.actorId).toBe(f.admin.userId);
    expect(entry.entityType).toBe('JobOrder');
    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('creates no live production/QA/inventory/dispatch execution records', async () => {
    const f = await buildFixture();
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));

    await expect(prisma.jobOrderAcknowledgement.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.jobOrderStageStatus.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.qaInspectionSession.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.qaReworkTask.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.finalQualityBatch.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.qaRelease.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);
    await expect(prisma.qualityActivityExecution.count({ where: { jobOrderId: result.jobOrderId } })).resolves.toBe(0);

    // Pooled dispatchable inventory (Factory+Style+Size) is purely
    // QaReleaseLine-derived (see pooled-inventory.service.ts) — a real
    // end-to-end proof that the historical ordered quantity contributes
    // zero dispatchable stock, not just an absence-of-rows assertion.
    const pool = await getPooledFactoryInventory(prisma, { factoryId: f.factory.id, styleId: f.style.id, sizeId: f.size.id });
    expect(pool).toEqual([]);
  });

  it('leaves the live EIJO/JOB_ORDER DocumentSequence high-water mark unchanged', async () => {
    const f = await buildFixture();
    const before = await prisma.documentSequence.findMany({ where: { documentType: 'JOB_ORDER' } });
    expect(before).toEqual([]); // resetDatabase clears DocumentSequence — a fresh baseline

    await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f));

    // No JOB_ORDER sequence row should have been created or advanced by a
    // historical import — only a HISTORICAL_JOB_ORDER row should exist.
    const afterJobOrder = await prisma.documentSequence.findMany({ where: { documentType: 'JOB_ORDER' } });
    expect(afterJobOrder).toEqual([]);
    const historicalSequences = await prisma.documentSequence.findMany({ where: { documentType: 'HISTORICAL_JOB_ORDER' } });
    expect(historicalSequences).toHaveLength(1);
    expect(historicalSequences[0]!.lastAllocatedSerial).toBe(1);
  });

  it('requires the Process Flow Version to be ACTIVE', async () => {
    const f = await buildFixture();
    await prisma.processFlowVersion.update({ where: { id: f.processFlowVersionId }, data: { status: 'RETIRED' } });
    await expect(
      importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), baseInput(f)),
    ).rejects.toThrow(HttpError);
  });

  it('requires the Job Order to reference the same Process Flow Version pinned on its Import Batch', async () => {
    const f = await buildFixture();
    const otherFlow = await prisma.processFlow.create({
      data: { id: createId(), code: `OTHER-${createId()}`, name: 'Other flow', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } },
      include: { versions: true },
    });
    const input = { ...baseInput(f), processFlowVersionId: otherFlow.versions[0]!.id };
    await expect(importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), input)).rejects.toThrow(HttpError);
  });

  it('rejects a size that is not a valid StyleSize for the Style (reuses live createJobOrderLine validation)', async () => {
    const f = await buildFixture();
    const otherSize = await prisma.size.create({ data: { id: createId(), code: `OTHER-SZ-${createId()}`, label: '9', sizeType: 'AGE', sortOrder: 9 } });
    const input = { ...baseInput(f), sizes: [{ sizeId: otherSize.id, quantity: 10 }] };
    await expect(importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), input)).rejects.toThrow(HttpError);
  });

  it('links to an existing HistoricalDocument instead of creating a new one when mode is "existing"', async () => {
    const f = await buildFixture();
    const existingDoc = await prisma.historicalDocument.create({
      data: {
        id: createId(),
        documentType: 'HISTORICAL_FACTORY_ORDER',
        fileId: f.file.id,
        sourceSnapshot: { note: 'shared document' },
        addedById: f.admin.userId,
        importBatchId: f.importBatch.id,
      },
    });
    const input: ImportHistoricalJobOrderInput = {
      ...baseInput(f),
      document: { mode: 'existing', historicalDocumentId: existingDoc.id },
    };
    const result = await importHistoricalJobOrder(currentUserFor(f.admin.userId, ['ADMIN']), input);
    expect(result.historicalDocumentId).toBe(existingDoc.id);
    expect(await prisma.historicalDocument.count()).toBe(1);
  });
});
