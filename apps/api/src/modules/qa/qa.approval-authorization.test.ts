import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { QA_CHECKLIST_ITEMS, type Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture() {
  const qa = await createTestUserAndToken({
    email: `qa-approval-${createId()}@test.local`,
    password: 'pass',
    roles: ['QA_USER'],
  });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  const size = await prisma.size.create({
    data: { id: createId(), code: `QA-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: `QA-${createId()}`, styleName: 'QA', finalMrp: 100 },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `QA-${createId()}`,
      name: 'QA',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const poId = createId(),
    poLineId = createId(),
    jobId = createId(),
    lineId = createId();
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
            create: {
              id: createId(),
              sizeId: size.id,
              orderedQuantity: 28,
              jobOrderedQuantity: 28,
            },
          },
        },
      },
    },
  });
  await prisma.jobOrder.create({
    data: {
      id: jobId,
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: poId,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: '1',
      status: 'READY_FOR_QA',
      preparedQuantityTotal: 28,
      createdBy: qa.userId,
      lines: {
        create: {
          id: lineId,
          purchaseOrderLineId: poLineId,
          styleId: style.id,
          orderedQuantityTotal: 28,
          preparedQuantityTotal: 28,
          status: 'READY_FOR_QA',
        },
      },
    },
  });
  const sizes = await Promise.all(
    [10, 10, 8].map(async (prepared, index) => {
      const s = index
        ? await prisma.size.create({
            data: {
              id: createId(),
              code: `QA-X${index}-${createId()}`,
              label: `X${index}`,
              sizeType: 'ALPHA',
              sortOrder: index + 2,
            },
          })
        : size;
      const poSize = await prisma.distributorPurchaseOrderLineSize.findFirstOrThrow({
        where: { purchaseOrderLineId: poLineId },
      });
      return prisma.jobOrderLineSize.create({
        data: {
          id: createId(),
          jobOrderLineId: lineId,
          purchaseOrderLineSizeId: index
            ? (
                await prisma.distributorPurchaseOrderLineSize.create({
                  data: {
                    id: createId(),
                    purchaseOrderLineId: poLineId,
                    sizeId: s.id,
                    orderedQuantity: prepared,
                    jobOrderedQuantity: prepared,
                  },
                })
              ).id
            : poSize.id,
          sizeId: s.id,
          orderedQuantity: prepared,
          preparedQuantity: prepared,
        },
      });
    }),
  );
  return { qa, jobId, sizes };
}
function body(version: number, accepted: number, rework = 0) {
  return {
    expectedVersion: version,
    sampleQuantity: 1,
    inspectionRemarks: 'checked',
    checklist: QA_CHECKLIST_ITEMS.map((x) => ({ itemCode: x.code, status: 'YES', remarks: null })),
    inspectedQuantity: accepted + rework,
    acceptedQuantity: accepted,
    reworkQuantity: rework,
    permanentlyRejectedQuantity: 0,
    defectCategory: rework ? 'STITCHING' : null,
    otherDefectDetails: null,
    defectNotes: null,
  };
}
async function startAndSave(
  f: Awaited<ReturnType<typeof fixture>>,
  quantities = [
    [10, 0],
    [10, 0],
    [8, 0],
  ],
) {
  const started = await request(app)
    .post(`/qa/job-orders/${f.jobId}/inspections`)
    .set(auth(f.qa.token))
    .set('Idempotency-Key', `start-${createId()}`)
    .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
    .expect(201);
  const session = started.body.data.sessions[0];
  for (const form of session.forms) {
    const index = f.sizes.findIndex((size) => size.id === form.jobOrderLineSizeId);
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${form.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', `save-${createId()}`)
      .send(body(form.version, quantities[index]![0]!, quantities[index]![1]!))
      .expect(200);
  }
  return prisma.qaInspectionSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { forms: true },
  });
}
async function finalize(
  f: Awaited<ReturnType<typeof fixture>>,
  session: { id: string; forms: { id: string; version: number }[] },
) {
  for (const form of session.forms)
    await request(app)
      .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', `final-${createId()}`)
      .send({ expectedVersion: form.version })
      .expect(200);
}

describe('QA approval aggregation', () => {
  it('rejects a draft form without mutating forms or writing an approval audit', async () => {
    const f = await fixture();
    const s = await startAndSave(f);
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${s.forms[0]!.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-a')
      .send({ expectedVersion: s.forms[0]!.version })
      .expect(200);
    const before = await prisma.qaSizeInspectionForm.findMany({
      where: { inspectionSessionId: s.id },
    });
    const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } });
    await request(app)
      .post(`/qa/job-orders/${f.jobId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve-draft')
      .send({ expectedVersion: job.version })
      .expect(409);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } })).status).not.toBe(
      'QA_APPROVED',
    );
    expect(
      await prisma.qaSizeInspectionForm.findMany({ where: { inspectionSessionId: s.id } }),
    ).toEqual(before);
    expect(
      await prisma.auditLog.count({ where: { action: 'QA_APPROVED', entityId: f.jobId } }),
    ).toBe(0);
  });
  it('rejects approval after a finalized form is reopened', async () => {
    const f = await fixture();
    const admin = await createTestUserAndToken({
      email: 'admin-reopen@test.local',
      password: 'pass',
      roles: ['ADMIN'],
    });
    const s = await startAndSave(f);
    await finalize(f, s);
    const current = await prisma.qaInspectionSession.findUniqueOrThrow({
      where: { id: s.id },
      include: { forms: true },
    });
    const b = current.forms[1]!;
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${b.id}/reopen`)
      .set(auth(admin.token))
      .set('Idempotency-Key', 'reopen')
      .send({ expectedVersion: b.version, reason: 'correction' })
      .expect(200);
    const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } });
    await request(app)
      .post(`/qa/job-orders/${f.jobId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve-reopened')
      .send({ expectedVersion: job.version })
      .expect(409);
    const forms = await prisma.qaSizeInspectionForm.findMany({
      where: { inspectionSessionId: s.id },
    });
    expect(forms.find((x) => x.id === b.id)!.status).toBe('REOPENED');
    expect(forms.filter((x) => x.id !== b.id).every((x) => x.status === 'FINALIZED')).toBe(true);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } })).status).not.toBe(
      'QA_APPROVED',
    );
  });
  it('approves fully finalized current forms without changing their contents', async () => {
    const f = await fixture();
    const s = await startAndSave(f);
    await finalize(f, s);
    const before = await prisma.qaSizeInspectionForm.findMany({
      where: { inspectionSessionId: s.id },
    });
    const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } });
    await request(app)
      .post(`/qa/job-orders/${f.jobId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve')
      .send({ expectedVersion: job.version })
      .expect(200);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } })).status).toBe(
      'QA_APPROVED',
    );
    expect(
      await prisma.qaSizeInspectionForm.findMany({ where: { inspectionSessionId: s.id } }),
    ).toEqual(before);
  });
  it('counts B reinspection once: 10 + (6 + 4) + 8 = 28 accepted', async () => {
    const f = await fixture();
    const admin = await createTestUserAndToken({
      email: 'admin-rework@test.local',
      password: 'pass',
      roles: ['ADMIN'],
    });
    const first = await startAndSave(f, [
      [10, 0],
      [6, 4],
      [8, 0],
    ]);
    await finalize(f, first);
    const task = await prisma.qaReworkTask.findFirstOrThrow();
    await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(admin.token))
      .set('Idempotency-Key', 'ack')
      .send({ expectedVersion: task.version })
      .expect(200);
    const ack = await prisma.qaReworkTask.findUniqueOrThrow({ where: { id: task.id } });
    await request(app)
      .post(`/qa/rework/${task.id}/ready`)
      .set(auth(admin.token))
      .set('Idempotency-Key', 'ready')
      .send({ expectedVersion: ack.version })
      .expect(200);
    const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } });
    const second = await request(app)
      .post(`/qa/job-orders/${f.jobId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'second')
      .send({ expectedVersion: job.version, sourceReworkTaskIds: [task.id] })
      .expect(201);
    const s2 = second.body.data.sessions.find((x: { id: string }) => x.id !== first.id)!;
    const form = s2.forms[0];
    const saved = await request(app)
      .put(`/qa/inspections/${s2.id}/forms/${form.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save2')
      .send(body(form.version, 4))
      .expect(200);
    const v = saved.body.data.sessions.find((x: { id: string }) => x.id === s2.id).forms[0].version;
    await request(app)
      .post(`/qa/inspections/${s2.id}/forms/${form.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final2')
      .send({ expectedVersion: v })
      .expect(200);
    const current = await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.jobId } });
    await request(app)
      .post(`/qa/job-orders/${f.jobId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve2')
      .send({ expectedVersion: current.version })
      .expect(200);
    const bySize = await prisma.distributorPurchaseOrderLineSize.findMany({
      orderBy: { qaPassedQuantity: 'desc' },
    });
    expect(bySize.map((x) => x.qaPassedQuantity).sort((a, b) => a - b)).toEqual([8, 10, 10]);
    expect(await prisma.qaReworkTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'REINSPECTED',
    });
    expect(
      (
        await prisma.qaInspectionSession.findUniqueOrThrow({
          where: { id: first.id },
          include: { forms: true },
        })
      ).forms.find((x) => x.id === task.sourceLineId)!.reworkQuantity,
    ).toBe(4);
  });
});

describe('QA form authorization matrix', () => {
  const roles: { role: Role; allowed: boolean }[] = [
    { role: 'ADMIN', allowed: true },
    { role: 'MERCHANDISER', allowed: true },
    { role: 'QA_USER', allowed: true },
    { role: 'FACTORY_USER', allowed: false },
    { role: 'DISTRIBUTOR', allowed: false },
    { role: 'ACCOUNTANT', allowed: false },
    { role: 'SENIOR_MANAGEMENT', allowed: false },
  ];
  it.each(roles)('$role has documented save/finalize access', async ({ role, allowed }) => {
    const f = await fixture();
    const u = await createTestUserAndToken({
      email: `${role}-matrix@test.local`,
      password: 'pass',
      roles: [role],
    });
    const start = await request(app)
      .post(`/qa/job-orders/${f.jobId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', `matrix-start-${role}`)
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const form = start.body.data.sessions[0].forms[0];
    const save = await request(app)
      .put(`/qa/inspections/${start.body.data.sessions[0].id}/forms/${form.id}`)
      .set(auth(u.token))
      .set('Idempotency-Key', `matrix-save-${role}`)
      .send(body(form.version, 10));
    expect(save.status).toBe(allowed ? 200 : 403);
    const current = allowed
      ? await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } })
      : (await request(app)
          .put(`/qa/inspections/${start.body.data.sessions[0].id}/forms/${form.id}`)
          .set(auth(f.qa.token))
          .set('Idempotency-Key', `matrix-qa-save-${role}`)
          .send(body(form.version, 10))
          .expect(200),
        await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } }));
    await request(app)
      .post(`/qa/inspections/${start.body.data.sessions[0].id}/forms/${form.id}/finalize`)
      .set(auth(u.token))
      .set('Idempotency-Key', `matrix-final-${role}`)
      .send({ expectedVersion: current.version })
      .expect(allowed ? 200 : 403);
  });
  it.each(roles)('$role reopen policy', async ({ role }) => {
    const f = await fixture();
    const admin = await createTestUserAndToken({
      email: `matrix-admin-${role}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const s = await startAndSave(f);
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${s.forms[0]!.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', `matrix-prep-${role}`)
      .send({ expectedVersion: s.forms[0]!.version })
      .expect(200);
    const form = await prisma.qaSizeInspectionForm.findUniqueOrThrow({
      where: { id: s.forms[0]!.id },
    });
    const user =
      role === 'ADMIN'
        ? admin
        : await createTestUserAndToken({
            email: `matrix-${role}-reopen@test.local`,
            password: 'pass',
            roles: [role],
          });
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${form.id}/reopen`)
      .set(auth(user.token))
      .set('Idempotency-Key', `matrix-reopen-${role}`)
      .send({ expectedVersion: form.version, reason: 'matrix' })
      .expect(['ADMIN', 'MERCHANDISER'].includes(role) ? 200 : 403);
  });
  it('rejects unauthenticated form mutations', async () => {
    const f = await fixture();
    const s = await startAndSave(f);
    const form = s.forms[0]!;
    await request(app)
      .put(`/qa/inspections/${s.id}/forms/${form.id}`)
      .set('Idempotency-Key', 'anon-save')
      .send(body(form.version, 10))
      .expect(401);
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${form.id}/finalize`)
      .set('Idempotency-Key', 'anon-final')
      .send({ expectedVersion: form.version })
      .expect(401);
    await request(app)
      .post(`/qa/inspections/${s.id}/forms/${form.id}/reopen`)
      .set('Idempotency-Key', 'anon-reopen')
      .send({ expectedVersion: form.version, reason: 'x' })
      .expect(401);
  });
});
