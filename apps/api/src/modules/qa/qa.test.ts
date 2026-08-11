import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { QA_CHECKLIST_ITEMS } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.alloc(17, 0x00),
]);

async function fixture() {
  const qa = await createTestUserAndToken({
    email: 'qa@test.local',
    password: 'pass',
    roles: ['QA_USER'],
  });
  const admin = await createTestUserAndToken({
    email: 'admin@test.local',
    password: 'pass',
    roles: ['ADMIN'],
  });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  const size = await prisma.size.create({
    data: { id: createId(), code: 'QA-M', label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: 'QA-STYLE', styleName: 'QA Style', finalMrp: 100 },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: 'QA-FLOW',
      name: 'QA Flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const poSizeId = createId(),
    poLineId = createId(),
    poId = createId(),
    formSizeId = createId(),
    jobOrderId = createId(),
    jobLineId = createId();
  await prisma.distributorPurchaseOrder.create({
    data: {
      id: poId,
      poNumber: `PO-${createId()}`,
      distributorId: distributor.id,
      poDate: new Date(),
      purchaseMode: 'OUTRIGHT',
      status: 'FULLY_JOB_ORDERED',
      createdBy: qa.userId,
      lines: {
        create: {
          id: poLineId,
          styleId: style.id,
          sizes: {
            create: { id: poSizeId, sizeId: size.id, orderedQuantity: 10, jobOrderedQuantity: 10 },
          },
        },
      },
    },
  });
  await prisma.jobOrder.create({
    data: {
      id: jobOrderId,
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: poId,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: '1',
      status: 'READY_FOR_QA',
      preparedQuantityTotal: 30,
      createdBy: qa.userId,
      lines: {
        create: {
          id: jobLineId,
          purchaseOrderLineId: poLineId,
          styleId: style.id,
          orderedQuantityTotal: 30,
          preparedQuantityTotal: 30,
          status: 'READY_FOR_QA',
          sizes: {
            create: {
              id: formSizeId,
              purchaseOrderLineSizeId: poSizeId,
              sizeId: size.id,
              orderedQuantity: 10,
              preparedQuantity: 10,
            },
          },
        },
      },
    },
  });
  const moreSizeIds = [1, 2].map(() => createId());
  for (const [index, id] of moreSizeIds.entries()) {
    const extraSize = await prisma.size.create({
      data: {
        id: createId(),
        code: `QA-${index}`,
        label: `QA ${index}`,
        sizeType: 'ALPHA',
        sortOrder: index + 2,
      },
    });
    const extraPoSizeId = createId();
    await prisma.distributorPurchaseOrderLineSize.create({
      data: {
        id: extraPoSizeId,
        purchaseOrderLineId: poLineId,
        sizeId: extraSize.id,
        orderedQuantity: 10,
        jobOrderedQuantity: 10,
      },
    });
    await prisma.jobOrderLineSize.create({
      data: {
        id,
        jobOrderLineId: jobLineId,
        purchaseOrderLineSizeId: extraPoSizeId,
        sizeId: extraSize.id,
        orderedQuantity: 10,
        preparedQuantity: 10,
      },
    });
  }
  return { qa, admin, factory, jobOrderId, formSizeId, formSizeIds: [formSizeId, ...moreSizeIds] };
}
function payload(version: number, accepted = 10) {
  return {
    expectedVersion: version,
    sampleQuantity: 5,
    inspectionRemarks: 'Size-specific remarks',
    checklist: QA_CHECKLIST_ITEMS.map((item, index) => ({
      itemCode: item.code,
      status: 'YES',
      remarks: index === 0 ? 'checked' : null,
    })),
    inspectedQuantity: accepted,
    acceptedQuantity: accepted,
    reworkQuantity: 0,
    permanentlyRejectedQuantity: 0,
    defectCategory: null,
    otherDefectDetails: null,
    defectNotes: null,
  };
}

describe('per-size QA form lifecycle', () => {
  it('creates, saves, finalizes and reopens only the selected size form', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const form = session.forms.find(
      (item: { jobOrderLineSizeId: string }) => item.jobOrderLineSizeId === f.formSizeId,
    );
    expect(session.forms).toHaveLength(3);
    expect(
      session.forms.map((item: { jobOrderLineSizeId: string }) => item.jobOrderLineSizeId).sort(),
    ).toEqual([...f.formSizeIds].sort());
    expect(
      session.forms.every(
        (item: { checklist: unknown[]; status: string }) =>
          item.checklist.length === 15 && item.status === 'DRAFT',
      ),
    ).toBe(true);
    const saved = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${form.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save')
      .send(payload(form.version))
      .expect(200);
    const savedForm = saved.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === form.id,
    );
    expect(savedForm.sampleQuantity).toBe(5);
    const siblings = saved.body.data.sessions[0].forms.filter(
      (item: { id: string }) => item.id !== form.id,
    );
    const savedB = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${siblings[0].id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-b')
      .send({
        ...payload(siblings[0].version, 10),
        sampleQuantity: 3,
        inspectionRemarks: 'Inspection B',
        checklist: QA_CHECKLIST_ITEMS.map((item, i) => ({
          itemCode: item.code,
          status: 'NO',
          remarks: i === 0 ? 'B remark' : null,
        })),
      })
      .expect(200);
    const formB = savedB.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === siblings[0].id,
    );
    const savedC = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${siblings[1].id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-c')
      .send({
        ...payload(siblings[1].version, 10),
        sampleQuantity: 4,
        inspectionRemarks: 'Inspection C',
        checklist: QA_CHECKLIST_ITEMS.map((item, i) => ({
          itemCode: item.code,
          status: 'AVAILABLE',
          remarks: i === 0 ? 'C remark' : null,
        })),
      })
      .expect(200);
    const formC = savedC.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === siblings[1].id,
    );
    const persisted = await prisma.qaSizeInspectionForm.findMany({
      where: { inspectionSessionId: session.id },
      include: { checklist: true },
    });
    expect(persisted.map((item) => item.sampleQuantity).sort()).toEqual([3, 4, 5]);
    expect(persisted.map((item) => item.inspectionRemarks).sort()).toEqual([
      'Inspection B',
      'Inspection C',
      'Size-specific remarks',
    ]);
    expect(
      persisted
        .map(
          (item) =>
            item.checklist.find((check) => check.itemCode === 'FABRIC_COLOUR_QUALITY')?.status,
        )
        .sort(),
    ).toEqual(['AVAILABLE', 'NO', 'YES']);
    const finalized = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-a')
      .send({ expectedVersion: savedForm.version })
      .expect(200);
    expect(finalized.body.data.sessions[0].status).toBe('DRAFT');
    expect(finalized.body.data.totals).toMatchObject({ accepted: 10, availableToInspect: 0 });
    expect(
      finalized.body.data.lines.find(
        (line: { jobOrderLineSizeId: string }) => line.jobOrderLineSizeId === f.formSizeId,
      ),
    ).toMatchObject({ acceptedQuantity: 10, availableToInspect: 0 });
    const finalB = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${formB.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-b')
      .send({ expectedVersion: formB.version })
      .expect(200);
    expect(finalB.body.data.sessions[0].status).toBe('DRAFT');
    const finalC = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${formC.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-c')
      .send({ expectedVersion: formC.version })
      .expect(200);
    expect(finalC.body.data.sessions[0].status).toBe('FINALIZED');
    const persistedFinal = await prisma.qaInspectionSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { forms: true },
    });
    expect(persistedFinal.forms.every((item) => item.status === 'FINALIZED')).toBe(true);
    const finalBForm = finalC.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === formB.id,
    );
    const reopened = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${formB.id}/reopen`)
      .set(auth(f.admin.token))
      .set('Idempotency-Key', 'reopen-b')
      .send({ expectedVersion: finalBForm.version, reason: 'Correction' })
      .expect(200);
    expect(reopened.body.data.sessions[0].status).toBe('DRAFT');
    expect(
      reopened.body.data.sessions[0].forms.find((item: { id: string }) => item.id === formB.id)
        .status,
    ).toBe('REOPENED');
    const reopenedB = reopened.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === formB.id,
    );
    const resavedB = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${formB.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'resave-b')
      .send({
        ...payload(reopenedB.version, 10),
        sampleQuantity: 3,
        inspectionRemarks: 'Inspection B corrected',
        checklist: QA_CHECKLIST_ITEMS.map((item, i) => ({
          itemCode: item.code,
          status: 'NO',
          remarks: i === 0 ? 'B remark' : null,
        })),
      })
      .expect(200);
    const refinalB = resavedB.body.data.sessions[0].forms.find(
      (item: { id: string }) => item.id === formB.id,
    );
    const refinalized = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${formB.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'refinal-b')
      .send({ expectedVersion: refinalB.version })
      .expect(200);
    expect(refinalized.body.data.sessions[0].status).toBe('FINALIZED');
  });

  it('rejects finalizing an empty persisted size form', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-empty-finalize')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const form = session.forms[0];

    const response = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'empty-finalize')
      .send({ expectedVersion: form.version })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Size inspection form is incomplete',
    });
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sampleQuantity' }),
        expect.objectContaining({ field: 'checklist' }),
        expect.objectContaining({ field: 'quantities' }),
      ]),
    );
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: 'DRAFT', sampleQuantity: null, inspectedQuantity: 0 });
  });

  it('saves an incomplete defect draft but requires its category before finalization', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-incomplete-defect-draft')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const form = session.forms[0];
    const saved = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${form.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-incomplete-defect-draft')
      .send({
        ...payload(form.version),
        acceptedQuantity: 9,
        reworkQuantity: 1,
        defectCategory: null,
      })
      .expect(200);
    const savedForm = saved.body.data.sessions[0].forms.find(
      (candidate: { id: string }) => candidate.id === form.id,
    );

    const blocked = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'finalize-incomplete-defect-draft')
      .send({ expectedVersion: savedForm.version })
      .expect(400);

    expect(blocked.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Size inspection form is incomplete',
    });
    expect(blocked.body.error.details.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'defectCategory' })]),
    );
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: 'DRAFT', reworkQuantity: 1, defectCategory: null });
  });

  it('keeps retired session-wide mutation routes unavailable', async () => {
    const f = await fixture();
    await request(app)
      .put('/qa/inspections/old')
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'old-save')
      .send({})
      .expect(404);
    await request(app)
      .post('/qa/inspections/old/finalize')
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'old-final')
      .send({})
      .expect(404);
    await request(app)
      .post('/qa/inspections/old/reopen')
      .set(auth(f.admin.token))
      .set('Idempotency-Key', 'old-reopen')
      .send({})
      .expect(404);
  });

  it('rejects stale saves without staling sibling forms, and no-op saves do not increment version or audit', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-concurrency')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b] = session.forms;
    const first = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-current')
      .send(payload(a.version))
      .expect(200);
    const current = first.body.data.sessions[0].forms.find(
      (form: { id: string }) => form.id === a.id,
    );
    expect(current.version).toBe(a.version + 1);
    const stale = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-stale')
      .send({ ...payload(a.version), inspectionRemarks: 'stale write' })
      .expect(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }))
        .inspectionRemarks,
    ).toBe('Size-specific remarks');
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } })).version,
    ).toBe(b.version);
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${b.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-b-current')
      .send(payload(b.version, 9))
      .expect(200);
    const auditsBefore = await prisma.auditLog.count({
      where: { action: 'QA_SIZE_FORM_SAVED', entityId: a.id },
    });
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-noop')
      .send({ ...payload(current.version), inspectionRemarks: '  Size-specific remarks  ' })
      .expect(200);
    const noOp = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } });
    expect(noOp.version).toBe(current.version);
    expect(
      await prisma.auditLog.count({ where: { action: 'QA_SIZE_FORM_SAVED', entityId: a.id } }),
    ).toBe(auditsBefore);
  });

  it('rejects stale finalize and reopen requests without duplicate side effects or sibling changes', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-lifecycle-concurrency')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b, c] = session.forms;
    const saved = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-finalize')
      .send(payload(a.version))
      .expect(200);
    const aSaved = saved.body.data.sessions[0].forms.find(
      (form: { id: string }) => form.id === a.id,
    );
    await request(app)
      .post(`/qa/inspections/${session.id}/forms/${a.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-current')
      .send({ expectedVersion: aSaved.version })
      .expect(200);
    const finalized = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } });
    const auditCount = await prisma.auditLog.count({
      where: { action: 'QA_SIZE_FORM_FINALIZED', entityId: a.id },
    });
    const staleFinalize = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${a.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-stale')
      .send({ expectedVersion: aSaved.version })
      .expect(409);
    expect(staleFinalize.body.error.code).toBe('STALE_VERSION');
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }),
    ).toMatchObject({ status: 'FINALIZED', version: finalized.version });
    expect(
      await prisma.auditLog.count({ where: { action: 'QA_SIZE_FORM_FINALIZED', entityId: a.id } }),
    ).toBe(auditCount);
    const bVersion = (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } }))
      .version;
    const cVersion = (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: c.id } }))
      .version;
    await request(app)
      .post(`/qa/inspections/${session.id}/forms/${a.id}/reopen`)
      .set(auth(f.admin.token))
      .set('Idempotency-Key', 'reopen-current')
      .send({ expectedVersion: finalized.version, reason: 'Correction' })
      .expect(200);
    const reopened = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } });
    const staleReopen = await request(app)
      .post(`/qa/inspections/${session.id}/forms/${a.id}/reopen`)
      .set(auth(f.admin.token))
      .set('Idempotency-Key', 'reopen-stale')
      .send({ expectedVersion: finalized.version, reason: 'Correction' })
      .expect(409);
    expect(staleReopen.body.error.code).toBe('STALE_VERSION');
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }),
    ).toMatchObject({ status: 'REOPENED', version: reopened.version });
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } })).version,
    ).toBe(bVersion);
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: c.id } })).version,
    ).toBe(cVersion);
  });

  it('returns structured validation issues and preserves forms on invalid quantities', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-validation')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b] = session.forms;
    const beforeA = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } });
    const beforeB = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } });
    const invalid = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'invalid-reconcile')
      .send({
        ...payload(a.version),
        acceptedQuantity: 10,
        reworkQuantity: 10,
        permanentlyRejectedQuantity: 10,
      })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.details.issues[0]).toMatchObject({
      qaSizeInspectionFormId: a.id,
      field: 'form',
      message: expect.any(String),
    });
    for (const field of [
      'acceptedQuantity',
      'reworkQuantity',
      'permanentlyRejectedQuantity',
    ] as const)
      await request(app)
        .put(`/qa/inspections/${session.id}/forms/${a.id}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', `invalid-${field}`)
        .send({ ...payload(a.version), [field]: -1 })
        .expect(400);
    for (const field of [
      'acceptedQuantity',
      'reworkQuantity',
      'permanentlyRejectedQuantity',
    ] as const)
      await request(app)
        .put(`/qa/inspections/${session.id}/forms/${a.id}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', `fractional-${field}`)
        .send({ ...payload(a.version), [field]: 0.5 })
        .expect(400);
    const overflow = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'invalid-capacity')
      .send(payload(a.version, 11))
      .expect(400);
    expect(overflow.body.error.details.issues[0]).toMatchObject({
      qaSizeInspectionFormId: a.id,
      jobOrderLineSizeId: f.formSizeId,
      field: 'quantities',
    });
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }),
    ).toMatchObject({ version: beforeA.version, inspectedQuantity: beforeA.inspectedQuantity });
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } }),
    ).toMatchObject({ version: beforeB.version });
    expect(
      await prisma.auditLog.count({ where: { action: 'QA_SIZE_FORM_SAVED', entityId: a.id } }),
    ).toBe(0);
  });

  it('allows incomplete OTHER drafts while enforcing meaningful finalized details in PostgreSQL', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-db-other')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const formId = started.body.data.sessions[0].forms[0].id as string;
    const setOther = (details: string | null) => prisma.$executeRaw`
      UPDATE "qa_size_inspection_forms" SET "defect_category" = CAST(${'OTHER'} AS "QaDefectCategory"), "other_defect_details" = ${details} WHERE "id" = ${formId}`;
    await expect(setOther(null)).resolves.toBeGreaterThan(0);
    await expect(
      prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "status" = CAST(${'FINALIZED'} AS "QaInspectionStatus") WHERE "id" = ${formId}`,
    ).rejects.toThrow();
    for (const details of ['', '   ', '\t', '\n', '\r', ' \t\r\n '])
      await expect(setOther(details)).rejects.toThrow();
    await expect(setOther('Broken seam\nnear cuff')).resolves.toBeGreaterThan(0);
    await expect(
      prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "defect_category" = CAST(${'FABRIC'} AS "QaDefectCategory"), "other_defect_details" = ${null} WHERE "id" = ${formId}`,
    ).resolves.toBeGreaterThan(0);
    await expect(
      prisma.$executeRaw`UPDATE "qa_size_inspection_forms" SET "other_defect_details" = ${'retained'} WHERE "id" = ${formId}`,
    ).rejects.toThrow();
    await expect(setOther(null)).resolves.toBeGreaterThan(0);
    await expect(setOther('Meaningful')).resolves.toBeGreaterThan(0);
  });

  it('normalizes meaningful OTHER details and clears them on a non-OTHER save', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-api-other')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b] = session.forms;
    const saved = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-other')
      .send({
        ...payload(a.version),
        acceptedQuantity: 9,
        reworkQuantity: 1,
        defectCategory: 'OTHER',
        otherDefectDetails: '  Broken seam\nnear cuff  ',
      })
      .expect(200);
    const other = saved.body.data.sessions[0].forms.find(
      (form: { id: string }) => form.id === a.id,
    );
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }))
        .otherDefectDetails,
    ).toBe('Broken seam\nnear cuff');
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'clear-other')
      .send({ ...payload(other.version), defectCategory: 'FABRIC', otherDefectDetails: null })
      .expect(200);
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: a.id } }))
        .otherDefectDetails,
    ).toBeNull();
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } })).version,
    ).toBe(b.version);
    const incompleteOther = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${b.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'draft-other-without-details')
      .send({
        ...payload(b.version),
        acceptedQuantity: 9,
        reworkQuantity: 1,
        defectCategory: 'OTHER',
        otherDefectDetails: null,
      })
      .expect(200);
    const incompleteOtherVersion = incompleteOther.body.data.sessions[0].forms.find(
      (form: { id: string }) => form.id === b.id,
    ).version;
    for (const details of ['', ' ', '\t', '\n', ' \t\n '])
      await request(app)
        .put(`/qa/inspections/${session.id}/forms/${b.id}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', `bad-other-${JSON.stringify(details)}`)
        .send({
          ...payload(incompleteOtherVersion),
          acceptedQuantity: 9,
          reworkQuantity: 1,
          defectCategory: 'OTHER',
          otherDefectDetails: details,
        })
        .expect(400);
  });

  it('requires evidence on the permanently rejected form, not a sibling or session', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-evidence')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b] = session.forms;
    const saved = await request(app)
      .put(`/qa/inspections/${session.id}/forms/${a.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-reject-a')
      .send({
        ...payload(a.version),
        acceptedQuantity: 9,
        permanentlyRejectedQuantity: 1,
        defectCategory: 'FABRIC',
      })
      .expect(200);
    const version = saved.body.data.sessions[0].forms.find(
      (form: { id: string }) => form.id === a.id,
    ).version;
    const finalize = (key: string) =>
      request(app)
        .post(`/qa/inspections/${session.id}/forms/${a.id}/finalize`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', key)
        .send({ expectedVersion: version });
    await finalize('reject-no-evidence').expect(400);
    const addEvidence = async (formId: string | null) => {
      const fileId = createId();
      await prisma.file.create({
        data: {
          id: fileId,
          fileName: 'proof.png',
          mimeType: 'image/png',
          sizeBytes: 1,
          storageKey: `test/${fileId}`,
          uploadedById: f.qa.userId,
        },
      });
      return prisma.qaEvidence.create({
        data: {
          id: createId(),
          inspectionSessionId: session.id,
          inspectionLineId: formId,
          fileId,
          checksumSha256: createId(),
        },
      });
    };
    await addEvidence(b.id);
    await finalize('reject-sibling-evidence').expect(400);
    await addEvidence(null);
    await finalize('reject-session-evidence').expect(400);
    const own = await addEvidence(a.id);
    expect(own.inspectionLineId).toBe(a.id);
    await finalize('reject-own-evidence').expect(200);
    expect(
      await prisma.qaReworkTask.count({ where: { jobOrderLineSizeId: a.jobOrderLineSizeId } }),
    ).toBe(0);
  });

  it('allows the same image to be attached independently to different size forms', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-cross-size-evidence')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const session = started.body.data.sessions[0];
    const [a, b] = session.forms;
    const upload = (formId: string) =>
      request(app)
        .post(`/qa/inspections/${session.id}/evidence`)
        .set(auth(f.qa.token))
        .field('inspectionLineId', formId)
        .attach('image', PNG, { filename: 'same-proof.png', contentType: 'image/png' });

    const evidenceA = await upload(a.id).expect(201);
    const evidenceB = await upload(b.id).expect(201);
    const duplicateB = await upload(b.id).expect(200);

    expect(evidenceA.body.data.inspectionLineId).toBe(a.id);
    expect(evidenceB.body.data.inspectionLineId).toBe(b.id);
    expect(evidenceB.body.data.id).not.toBe(evidenceA.body.data.id);
    expect(duplicateB.body.data.id).toBe(evidenceB.body.data.id);
    const refreshed = await request(app)
      .get(`/qa/job-orders/${f.jobOrderId}`)
      .set(auth(f.qa.token))
      .expect(200);
    expect(refreshed.body.data.sessions[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: evidenceA.body.data.id, inspectionLineId: a.id }),
        expect.objectContaining({ id: evidenceB.body.data.id, inspectionLineId: b.id }),
      ]),
    );
  });

  it('creates one B rework task, reinspects it, and appends a second failed cycle', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-rework')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const first = started.body.data.sessions[0];
    const [a, b, c] = first.forms;
    const save = async (form: { id: string; version: number }, body: object, key: string) =>
      request(app)
        .put(`/qa/inspections/${first.id}/forms/${form.id}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', key)
        .send({ ...payload(form.version), ...body })
        .expect(200);
    const detail = await save(a, {}, 'save-rework-a');
    const aCurrent = detail.body.data.sessions[0].forms.find((x: { id: string }) => x.id === a.id);
    const savedB = await save(
      b,
      { acceptedQuantity: 5, reworkQuantity: 5, defectCategory: 'STITCHING' },
      'save-rework-b',
    );
    const bCurrent = savedB.body.data.sessions[0].forms.find((x: { id: string }) => x.id === b.id);
    const savedC = await save(c, {}, 'save-rework-c');
    const cCurrent = savedC.body.data.sessions[0].forms.find((x: { id: string }) => x.id === c.id);
    await request(app)
      .post(`/qa/inspections/${first.id}/forms/${a.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-rework-a')
      .send({ expectedVersion: aCurrent.version })
      .expect(200);
    await request(app)
      .post(`/qa/inspections/${first.id}/forms/${c.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-rework-c')
      .send({ expectedVersion: cCurrent.version })
      .expect(200);
    await request(app)
      .post(`/qa/inspections/${first.id}/forms/${b.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-rework-b')
      .send({ expectedVersion: bCurrent.version })
      .expect(200);
    const task = await prisma.qaReworkTask.findUniqueOrThrow({ where: { sourceLineId: b.id } });
    expect(task).toMatchObject({
      jobOrderLineSizeId: b.jobOrderLineSizeId,
      assignedQuantity: 5,
      sourceLineId: b.id,
    });
    expect(await prisma.qaReworkTask.count({ where: { jobOrderId: f.jobOrderId } })).toBe(1);
    expect(await prisma.jobOrder.count()).toBe(1);
    const originalJobOrderNumber = (
      await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobOrderId } })
    ).jobOrderNumber;
    const factoryUser = await createTestUserAndToken({
      email: 'factory-rework@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: f.factory.id },
    });
    const wrongFactory = await createTestFactory();
    const wrongFactoryUser = await createTestUserAndToken({
      email: 'wrong-factory-rework@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: wrongFactoryUser.userId, factoryId: wrongFactory.id },
    });
    const factoryDetail = await request(app)
      .get(`/job-orders/${f.jobOrderId}`)
      .set(auth(factoryUser.token))
      .expect(200);
    expect(factoryDetail.body.data).toMatchObject({
      id: f.jobOrderId,
      jobOrderNumber: originalJobOrderNumber,
      reworkTasks: [
        expect.objectContaining({
          id: task.id,
          assignedQuantity: 5,
          status: 'REWORK_REQUIRED',
          qaRemarks: 'Size-specific remarks',
          defectCategory: 'STITCHING',
          requestedBy: expect.objectContaining({ id: f.qa.userId }),
        }),
      ],
    });
    await request(app)
      .get(`/job-orders/${f.jobOrderId}`)
      .set(auth(wrongFactoryUser.token))
      .expect(403);
    await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(wrongFactoryUser.token))
      .set('Idempotency-Key', 'wrong-factory-ack')
      .send({ expectedVersion: task.version })
      .expect(403);
    await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'qa-cannot-ack')
      .send({ expectedVersion: task.version })
      .expect(403);
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'QA_SIZE_FORM_FINALIZED', entityId: b.id },
      }),
    ).toBeTruthy();
    await request(app)
      .post(`/qa/inspections/${first.id}/forms/${b.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-rework-b-stale')
      .send({ expectedVersion: bCurrent.version })
      .expect(409);
    expect(await prisma.qaReworkTask.count({ where: { jobOrderId: f.jobOrderId } })).toBe(1);
    await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(factoryUser.token))
      .set('Idempotency-Key', 'ack-b')
      .send({ expectedVersion: task.version, notes: 'Rework accepted by the line supervisor' })
      .expect(200);
    const acknowledged = await prisma.qaReworkTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(acknowledged).toMatchObject({
      status: 'ACKNOWLEDGED',
      acknowledgedById: factoryUser.userId,
      notes: 'Rework accepted by the line supervisor',
    });
    await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(factoryUser.token))
      .set('Idempotency-Key', 'ack-b-duplicate')
      .send({ expectedVersion: task.version })
      .expect(409);
    await request(app)
      .patch(`/qa/rework/${task.id}/notes`)
      .set(auth(factoryUser.token))
      .set('Idempotency-Key', 'notes-b')
      .send({ expectedVersion: acknowledged.version, notes: 'Seams corrected and checked' })
      .expect(200);
    const noted = await prisma.qaReworkTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(noted.notes).toBe('Seams corrected and checked');
    const ready = await request(app)
      .post(`/qa/rework/${task.id}/ready`)
      .set(auth(factoryUser.token))
      .set('Idempotency-Key', 'ready-b')
      .send({ expectedVersion: noted.version })
      .expect(200);
    await request(app)
      .post(`/qa/rework/${task.id}/ready`)
      .set(auth(factoryUser.token))
      .set('Idempotency-Key', 'ready-b-duplicate')
      .send({ expectedVersion: noted.version })
      .expect(409);
    expect(await prisma.jobOrder.count()).toBe(1);
    expect(
      (await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobOrderId } })).jobOrderNumber,
    ).toBe(originalJobOrderNumber);
    expect(
      await prisma.auditLog.findMany({
        where: {
          entityType: 'JobOrder',
          entityId: f.jobOrderId,
          action: {
            in: [
              'QA_REWORK_REQUESTED',
              'QA_REWORK_ACKNOWLEDGE',
              'QA_REWORK_NOTES',
              'QA_REWORK_READY',
            ],
          },
        },
      }),
    ).toHaveLength(4);
    const second = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-reinspection-b')
      .send({ expectedVersion: ready.body.data.version, sourceReworkTaskIds: [task.id] })
      .expect(201);
    const cycle2 = second.body.data.sessions.find((s: { id: string }) => s.id !== first.id);
    expect(cycle2.forms).toHaveLength(1);
    expect(cycle2.forms[0]).toMatchObject({
      jobOrderLineSizeId: b.jobOrderLineSizeId,
      sourceReworkTaskId: task.id,
    });
    expect(
      (await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } })).status,
    ).toBe('FINALIZED');
    const reForm = cycle2.forms[0];
    const resaved = await request(app)
      .put(`/qa/inspections/${cycle2.id}/forms/${reForm.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-reinspection-b')
      .send({
        ...payload(reForm.version, 5),
        acceptedQuantity: 3,
        reworkQuantity: 2,
        defectCategory: 'FINISHING',
        defectNotes: 'Cuff finish still uneven',
      })
      .expect(200);
    const reVersion = resaved.body.data.sessions.find((s: { id: string }) => s.id === cycle2.id)
      .forms[0].version;
    await request(app)
      .post(`/qa/inspections/${cycle2.id}/forms/${reForm.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-reinspection-b')
      .send({ expectedVersion: reVersion })
      .expect(200);
    expect((await prisma.qaReworkTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'REINSPECTED',
    );
    const cycles = await prisma.qaReworkTask.findMany({
      where: { jobOrderId: f.jobOrderId, jobOrderLineSizeId: b.jobOrderLineSizeId },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(cycles).toHaveLength(2);
    expect(cycles[1]).toMatchObject({
      attemptNumber: 2,
      assignedQuantity: 2,
      status: 'REWORK_REQUIRED',
    });
    expect(
      await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: b.id } }),
    ).toMatchObject({
      status: 'FINALIZED',
      reworkQuantity: 5,
      defectCategory: 'STITCHING',
    });
  });
});
