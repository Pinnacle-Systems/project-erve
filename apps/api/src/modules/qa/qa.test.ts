import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x11)]);
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture(prepared = 10) {
  const qa = await createTestUserAndToken({
    email: 'qa@test.local',
    password: 'pass',
    roles: ['QA_USER'],
  });
  const factoryUser = await createTestUserAndToken({
    email: 'factory-qa@test.local',
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  const outsider = await createTestUserAndToken({
    email: 'other-qa@test.local',
    password: 'pass',
    roles: ['QA_USER'],
  });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  const otherFactory = await createTestFactory({ code: 'OTHER-QA' });
  await prisma.userFactory.create({
    data: { id: createId(), userId: qa.userId, factoryId: factory.id },
  });
  await prisma.userFactory.create({
    data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id },
  });
  await prisma.userFactory.create({
    data: { id: createId(), userId: outsider.userId, factoryId: otherFactory.id },
  });
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
  const poLineSizeId = createId();
  const poLineId = createId();
  const poId = createId();
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
              id: poLineSizeId,
              sizeId: size.id,
              orderedQuantity: prepared,
              jobOrderedQuantity: prepared,
            },
          },
        },
      },
    },
  });
  const jobOrderLineSizeId = createId();
  const jobOrderId = createId();
  await prisma.jobOrder.create({
    data: {
      id: jobOrderId,
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: poId,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      status: 'READY_FOR_QA',
      preparedQuantityTotal: prepared,
      createdBy: qa.userId,
      lines: {
        create: {
          id: createId(),
          purchaseOrderLineId: poLineId,
          styleId: style.id,
          orderedQuantityTotal: prepared,
          preparedQuantityTotal: prepared,
          status: 'READY_FOR_QA',
          sizes: {
            create: {
              id: jobOrderLineSizeId,
              purchaseOrderLineSizeId: poLineSizeId,
              sizeId: size.id,
              orderedQuantity: prepared,
              preparedQuantity: prepared,
            },
          },
        },
      },
    },
  });
  return { qa, factoryUser, outsider, jobOrderId, jobOrderLineSizeId, poLineSizeId };
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('QA workflow', () => {
  it('fully inspects and approves an authoritative quantity with retry-safe audit', async () => {
    const f = await fixture();
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-full')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] })
      .expect(201);
    const sessionId = started.body.data.sessions.find(
      (session: { status: string }) => session.status === 'DRAFT',
    ).id;
    const saved = await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-full')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            inspectedQuantity: 10,
            acceptedQuantity: 10,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
          },
        ],
      })
      .expect(200);
    const replay = await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-full')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            inspectedQuantity: 10,
            acceptedQuantity: 10,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
          },
        ],
      })
      .expect(200);
    expect(replay.body.data.totals).toEqual(saved.body.data.totals);
    const finalized = await request(app)
      .post(`/qa/inspections/${sessionId}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-full')
      .send({ expectedVersion: 2 })
      .expect(200);
    const approved = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve-full')
      .send({ expectedVersion: finalized.body.data.version })
      .expect(200);
    expect(approved.body.data.status).toBe('QA_APPROVED');
    expect(approved.body.data.totals.finalApproved).toBe(10);
    expect(
      (
        await prisma.distributorPurchaseOrderLineSize.findUniqueOrThrow({
          where: { id: f.poLineSizeId },
        })
      ).qaPassedQuantity,
    ).toBe(10);
    expect(await prisma.auditLog.count({ where: { action: 'QA_INSPECTION_SAVED' } })).toBe(1);
  });

  it('rejects over-consumption, stale concurrent edits, and idempotency payload mismatch', async () => {
    const f = await fixture(5);
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-guard')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] });
    const sessionId = started.body.data.sessions.find(
      (session: { status: string }) => session.status === 'DRAFT',
    ).id;
    await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'over')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            inspectedQuantity: 6,
            acceptedQuantity: 6,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
          },
        ],
      })
      .expect(409);
    const body = {
      expectedVersion: 1,
      lines: [
        {
          jobOrderLineSizeId: f.jobOrderLineSizeId,
          inspectedQuantity: 5,
          acceptedQuantity: 5,
          reworkQuantity: 0,
          permanentlyRejectedQuantity: 0,
        },
      ],
    };
    const results = await Promise.all([
      request(app)
        .put(`/qa/inspections/${sessionId}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', 'race-a')
        .send(body),
      request(app)
        .put(`/qa/inspections/${sessionId}`)
        .set(auth(f.qa.token))
        .set('Idempotency-Key', 'race-b')
        .send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('STALE_VERSION');
    const successfulKey = results[0]!.status === 200 ? 'race-a' : 'race-b';
    const mismatch = await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', successfulKey)
      .send({
        ...body,
        lines: [
          {
            ...body.lines[0],
            acceptedQuantity: 4,
            permanentlyRejectedQuantity: 1,
            defectCategory: 'OTHER',
          },
        ],
      });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('isolates factory scope and requires evidence for permanent rejection', async () => {
    const f = await fixture();
    await request(app)
      .get(`/qa/job-orders/${f.jobOrderId}`)
      .set(auth(f.outsider.token))
      .expect(403);
    await request(app)
      .get(`/qa/job-orders/${f.jobOrderId}`)
      .set(auth(f.factoryUser.token))
      .expect(403);
    const started = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-reject')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] });
    const sessionId = started.body.data.sessions.find(
      (session: { status: string }) => session.status === 'DRAFT',
    ).id;
    const saved = await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-reject')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            inspectedQuantity: 10,
            acceptedQuantity: 7,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 3,
            defectCategory: 'FABRIC',
          },
        ],
      })
      .expect(200);
    await request(app)
      .post(`/qa/inspections/${sessionId}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-reject')
      .send({ expectedVersion: 2 })
      .expect(400);
    expect(await prisma.qaInspectionSession.count({ where: { status: 'FINALIZED' } })).toBe(0);
    const inspectionLineId = saved.body.data.sessions.find(
      (session: { id: string }) => session.id === sessionId,
    ).lines[0].id;
    const evidence = await request(app)
      .post(`/qa/inspections/${sessionId}/evidence`)
      .set(auth(f.qa.token))
      .field('inspectionLineId', inspectionLineId)
      .attach('image', JPEG, { filename: 'fabric-defect.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(app)
      .get(`/qa/evidence/${evidence.body.data.id}/content`)
      .set(auth(f.outsider.token))
      .expect(403);
    await request(app)
      .get(`/qa/evidence/${evidence.body.data.id}/content`)
      .set(auth(f.factoryUser.token))
      .expect(200)
      .expect('Content-Type', 'image/jpeg');
    const finalized = await request(app)
      .post(`/qa/inspections/${sessionId}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-reject')
      .send({ expectedVersion: 2 })
      .expect(200);
    const approved = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve-reject')
      .send({ expectedVersion: finalized.body.data.version })
      .expect(200);
    expect(approved.body.data.totals.finalApproved).toBe(7);
    expect(approved.body.data.totals.permanentlyRejected).toBe(3);
  });

  it('hands only rejected quantity through factory rework and reinspection', async () => {
    const f = await fixture();
    const start = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-rw')
      .send({ expectedVersion: 1, sourceReworkTaskIds: [] });
    const sessionId = start.body.data.sessions.find(
      (session: { status: string }) => session.status === 'DRAFT',
    ).id;
    await request(app)
      .put(`/qa/inspections/${sessionId}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-rw')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            inspectedQuantity: 10,
            acceptedQuantity: 6,
            reworkQuantity: 4,
            permanentlyRejectedQuantity: 0,
            defectCategory: 'STITCHING',
          },
        ],
      });
    const finalized = await request(app)
      .post(`/qa/inspections/${sessionId}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-rw')
      .send({ expectedVersion: 2 });
    const task = finalized.body.data.reworkTasks[0];
    expect(task.assignedQuantity).toBe(4);
    const acknowledged = await request(app)
      .post(`/qa/rework/${task.id}/acknowledge`)
      .set(auth(f.factoryUser.token))
      .set('Idempotency-Key', 'ack-rw')
      .send({ expectedVersion: 1 })
      .expect(200);
    const current = acknowledged.body.data.reworkTasks[0];
    await request(app)
      .post(`/qa/rework/${task.id}/ready`)
      .set(auth(f.factoryUser.token))
      .set('Idempotency-Key', 'ready-rw')
      .send({ expectedVersion: current.version })
      .expect(200);
    const fresh = await request(app).get(`/qa/job-orders/${f.jobOrderId}`).set(auth(f.qa.token));
    expect(fresh.body.data.status).toBe('READY_FOR_REINSPECTION');
    expect(fresh.body.data.totals.accepted).toBe(6);
    const reinspection = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/inspections`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'start-reinspection')
      .send({ expectedVersion: fresh.body.data.version, sourceReworkTaskIds: [task.id] })
      .expect(201);
    const reinspectionSession = reinspection.body.data.sessions.find(
      (session: { status: string }) => session.status === 'DRAFT',
    );
    await request(app)
      .put(`/qa/inspections/${reinspectionSession.id}`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'save-reinspection')
      .send({
        expectedVersion: 1,
        lines: [
          {
            jobOrderLineSizeId: f.jobOrderLineSizeId,
            sourceReworkTaskId: task.id,
            inspectedQuantity: 4,
            acceptedQuantity: 4,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
          },
        ],
      })
      .expect(200);
    const reinspected = await request(app)
      .post(`/qa/inspections/${reinspectionSession.id}/finalize`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'final-reinspection')
      .send({ expectedVersion: 2 })
      .expect(200);
    const approved = await request(app)
      .post(`/qa/job-orders/${f.jobOrderId}/approve`)
      .set(auth(f.qa.token))
      .set('Idempotency-Key', 'approve-reinspection')
      .send({ expectedVersion: reinspected.body.data.version })
      .expect(200);
    expect(approved.body.data.status).toBe('QA_APPROVED');
    expect(approved.body.data.totals.finalApproved).toBe(10);
  });
});
