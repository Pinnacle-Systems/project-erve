import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import {
  allocateTestDocumentSerial,
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

type Fixture = { userId: string; jobA: string; jobB: string; sizeA: string; sizeB: string };

async function fixture(): Promise<Fixture> {
  const user = await createTestUserAndToken({ email: 'qa-db@test.local', password: 'pass', roles: ['QA_USER'] });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  const style = await prisma.style.create({ data: { id: createId(), styleNumber: `QA-DB-${createId()}`, styleName: 'QA DB', finalMrp: 100 } });
  const flow = await prisma.processFlow.create({ data: { id: createId(), code: `QA-DB-${createId()}`, name: 'QA DB', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } }, include: { versions: true } });
  const size = await prisma.size.create({ data: { id: createId(), code: `QA-DB-${createId()}`, label: 'QA DB', sizeType: 'ALPHA', sortOrder: 1 } });
  const financialYear = await createTestFinancialYear();

  async function job(): Promise<{ jobId: string; allocationId: string }> {
    const poId = createId(), poLineId = createId(), poSizeId = createId(), jobId = createId(), jobLineId = createId(), allocationId = createId();
    const poSerial = await allocateTestDocumentSerial('PURCHASE_ORDER', financialYear.id);
    await prisma.distributorPurchaseOrder.create({ data: { id: poId, poNumber: `PO-${createId()}`, distributorId: distributor.id, poDate: new Date(), purchaseMode: 'OUTRIGHT', status: 'FULLY_JOB_ORDERED', createdBy: user.userId, financialYearId: financialYear.id, poSerial, lines: { create: { id: poLineId, styleId: style.id, sizes: { create: { id: poSizeId, sizeId: size.id, orderedQuantity: 10, jobOrderedQuantity: 10 } } } } } });
    const jobOrderSerial = await allocateTestDocumentSerial('JOB_ORDER', financialYear.id);
    await prisma.jobOrder.create({ data: { id: jobId, jobOrderNumber: `JO-${createId()}`, purchaseOrderId: poId, factoryId: factory.id, processFlowVersionId: flow.versions[0]!.id, unitPrice: '1', status: 'READY_FOR_QA', preparedQuantityTotal: 10, createdBy: user.userId, financialYearId: financialYear.id, jobOrderSerial, lines: { create: { id: jobLineId, purchaseOrderLineId: poLineId, styleId: style.id, orderedQuantityTotal: 10, preparedQuantityTotal: 10, status: 'READY_FOR_QA', sizes: { create: { id: allocationId, purchaseOrderLineSizeId: poSizeId, sizeId: size.id, orderedQuantity: 10, preparedQuantity: 10 } } } } } });
    return { jobId, allocationId };
  }
  const a = await job(); const b = await job();
  return { userId: user.userId, jobA: a.jobId, jobB: b.jobId, sizeA: a.allocationId, sizeB: b.allocationId };
}

async function session(jobOrderId: string, inspectorId: string, cycleNumber = 1) {
  return prisma.qaInspectionSession.create({ data: { id: createId(), jobOrderId, inspectorId, cycleNumber } });
}

async function insertForm(args: { sessionId: string; sizeId: string; sourceReworkTaskId?: string | null; inspected?: number; accepted?: number; rework?: number; rejected?: number; defectCategory?: string | null }) {
  const id = createId(); const inspected = args.inspected ?? 0; const accepted = args.accepted ?? inspected;
  await prisma.$executeRaw`INSERT INTO "qa_size_inspection_forms" ("id", "inspection_session_id", "job_order_line_size_id", "source_rework_task_id", "status", "version", "inspected_quantity", "accepted_quantity", "rework_quantity", "permanently_rejected_quantity", "defect_category", "created_at", "updated_at") VALUES (${id}, ${args.sessionId}, ${args.sizeId}, ${args.sourceReworkTaskId ?? null}, CAST(${'DRAFT'} AS "QaInspectionStatus"), ${1}, ${inspected}, ${accepted}, ${args.rework ?? 0}, ${args.rejected ?? 0}, CAST(${args.defectCategory ?? null} AS "QaDefectCategory"), NOW(), NOW())`;
  return id;
}

describe('normalized QA database invariants', () => {
  it('rejects cross-Job-Order size ownership through the ownership trigger', async () => {
    const f = await fixture(); const s = await session(f.jobA, f.userId);
    await expect(insertForm({ sessionId: s.id, sizeId: f.sizeB })).rejects.toThrow(/QA inspection size allocation must belong/i);
  });

  it('enforces session and JobOrderLineSize foreign keys', async () => {
    const f = await fixture(); const s = await session(f.jobA, f.userId);
    await expect(insertForm({ sessionId: createId(), sizeId: f.sizeA })).rejects.toThrow();
    await expect(insertForm({ sessionId: s.id, sizeId: createId() })).rejects.toThrow();
  });

  it('enforces the normalized session-and-size unique index', async () => {
    const f = await fixture(); const s = await session(f.jobA, f.userId);
    await insertForm({ sessionId: s.id, sizeId: f.sizeA });
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'qa_size_inspection_forms' AND indexdef LIKE '%UNIQUE%inspection_session_id%job_order_line_size_id%'`;
    expect(indexes).toHaveLength(1);
    await expect(insertForm({ sessionId: s.id, sizeId: f.sizeA })).rejects.toThrow();
  });

  it('keeps checklist rows owned by one form without cross-form overwrite', async () => {
    const f = await fixture(); const s = await session(f.jobA, f.userId); const a = await insertForm({ sessionId: s.id, sizeId: f.sizeA });
    const s2 = await session(f.jobB, f.userId); const b = await insertForm({ sessionId: s2.id, sizeId: f.sizeB });
    const itemA = createId(), itemB = createId();
    await prisma.$executeRaw`INSERT INTO "qa_size_inspection_checklist_items" ("id", "inspection_form_id", "item_code", "created_at", "updated_at") VALUES (${itemA}, ${a}, ${'FABRIC'}, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "qa_size_inspection_checklist_items" ("id", "inspection_form_id", "item_code", "created_at", "updated_at") VALUES (${itemB}, ${b}, ${'FABRIC'}, NOW(), NOW())`;
    await expect(prisma.$executeRaw`UPDATE "qa_size_inspection_checklist_items" SET "inspection_form_id" = ${a} WHERE "id" = ${itemB}`).rejects.toThrow();
    expect(await prisma.qaSizeInspectionChecklistItem.findUniqueOrThrow({ where: { id: itemA } })).toMatchObject({ inspectionFormId: a, itemCode: 'FABRIC' });
    expect(await prisma.qaSizeInspectionChecklistItem.findUniqueOrThrow({ where: { id: itemB } })).toMatchObject({ inspectionFormId: b, itemCode: 'FABRIC' });
  });

  it('enforces first-pass prepared capacity in PostgreSQL', async () => {
    const f = await fixture(); const first = await session(f.jobA, f.userId, 1); const second = await session(f.jobA, f.userId, 2);
    await expect(insertForm({ sessionId: first.id, sizeId: f.sizeA, inspected: 10 })).resolves.toBeTruthy();
    await expect(insertForm({ sessionId: second.id, sizeId: f.sizeA, inspected: 1 })).rejects.toThrow(/QA prepared quantity over-consumed/i);
  });

  it('enforces reinspection capacity from its source rework task in PostgreSQL', async () => {
    const f = await fixture(); const sourceSession = await session(f.jobA, f.userId, 1); const source = await insertForm({ sessionId: sourceSession.id, sizeId: f.sizeA, inspected: 5, accepted: 0, rework: 5, defectCategory: 'STITCHING' });
    const taskId = createId();
    await prisma.qaReworkTask.create({ data: { id: taskId, jobOrderId: f.jobA, jobOrderLineSizeId: f.sizeA, sourceLineId: source, attemptNumber: 1, assignedQuantity: 5 } });
    const reinspectionSession = await session(f.jobA, f.userId, 2);
    await expect(insertForm({ sessionId: reinspectionSession.id, sizeId: f.sizeA, sourceReworkTaskId: taskId, inspected: 5 })).resolves.toBeTruthy();
    const nextSession = await session(f.jobA, f.userId, 3);
    await expect(insertForm({ sessionId: nextSession.id, sizeId: f.sizeA, sourceReworkTaskId: taskId, inspected: 1 })).rejects.toThrow(/QA rework quantity over-consumed/i);
  });

  it('retains the direct OTHER details database constraint', async () => {
    const f = await fixture(); const s = await session(f.jobA, f.userId); const form = await insertForm({ sessionId: s.id, sizeId: f.sizeA });
    await expect(prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "defect_category" = CAST(${'OTHER'} AS "QaDefectCategory"), "other_defect_details" = ${null} WHERE "id" = ${form}`).resolves.toBeGreaterThan(0);
    await expect(prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "defect_category" = CAST(${'OTHER'} AS "QaDefectCategory"), "other_defect_details" = ${' \t '} WHERE "id" = ${form}`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "defect_category" = CAST(${'FABRIC'} AS "QaDefectCategory"), "other_defect_details" = ${'must clear'} WHERE "id" = ${form}`).rejects.toThrow();
  });

  it('regression-checks active QA functions and ownership-trigger metadata', async () => {
    const functions = await prisma.$queryRaw<Array<{ proname: string; definition: string }>>`SELECT p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.proname LIKE 'enforce_qa_%'`;
    expect(functions.filter((fn) => fn.definition.includes('qa_inspection_lines'))).toHaveLength(0);
    expect(functions.find((fn) => fn.proname === 'enforce_qa_first_pass_capacity')?.definition).toContain('qa_size_inspection_forms');
    expect(functions.find((fn) => fn.proname === 'enforce_qa_reinspection_capacity')?.definition).toContain('qa_size_inspection_forms');
    const triggers = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT t.tgenabled::text AS tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'qa_size_inspection_forms' AND t.tgname = 'qa_size_inspection_form_job_order_match' AND NOT t.tgisinternal`;
    expect(triggers).toEqual([{ tgenabled: 'O' }]);
  });
});
