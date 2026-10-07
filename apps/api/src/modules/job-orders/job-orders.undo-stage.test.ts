import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { signAccessToken } from '../../auth/jwt.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// DEMO-010: a dedicated seed graph (not job-orders.test.ts's createSeedGraph)
// with three production stages — Cutting, Printing, Finishing — so
// undo-eligibility (only the single most-recently-completed stage, only
// while the next one is NOT_STARTED) can be exercised on a middle stage
// (Printing) as well as the final one (Finishing), which carries the extra
// PRODUCTION_COMPLETE/Final-QA guard.
async function createSeedGraph() {
  const admin = await createTestUserAndToken({
    email: `undo-admin-${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const merchandiser = await createTestUserAndToken({
    email: `undo-merch-${createId()}@test.local`,
    password: 'pass',
    roles: ['MERCHANDISER'],
  });
  const factoryUser = await createTestUserAndToken({
    email: `undo-factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  await prisma.userFactory.create({
    data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `SZ-${createId()}`, label: '3', sizeType: 'AGE', sortOrder: 3 },
  });
  const financialYear = await createTestFinancialYear(new Date('2026-06-30'));
  const season = await prisma.season.create({
    data: {
      id: createId(),
      code: `UNDO-${createId()}`,
      name: 'Undo Test Season',
      financialYearId: financialYear.id,
    },
  });
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-UNDO-${createId()}`,
      styleName: 'Undo Style',
      finalMrp: 500,
      seasonId: season.id,
    },
  });
  await prisma.styleSize.create({ data: { id: createId(), styleId: style.id, sizeId: size.id } });
  await prisma.styleFactoryMapping.create({
    data: { id: createId(), styleId: style.id, factoryId: factory.id, exFactoryPrice: 199.5 },
  });
  const finalForm = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `FINAL_${createId()}`,
      name: 'Final Inspection',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });
  const cuttingId = createId();
  const printingId = createId();
  const finishingId = createId();
  const finalActivityId = createId();
  const processFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `UNDO_FLOW_${createId()}`,
      name: 'Undo Flow',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          status: 'ACTIVE',
          stages: {
            create: [
              { id: cuttingId, sequence: 1, name: 'Cutting', code: 'CUTTING' },
              { id: printingId, sequence: 2, name: 'Printing', code: 'PRINTING' },
              { id: finishingId, sequence: 3, name: 'Finishing', code: 'FINISHING' },
              {
                id: finalActivityId,
                sequence: 99,
                name: 'Final Inspection',
                code: 'FINAL',
                activityType: 'QUALITY',
                qualityFormVersionId: finalForm.versions[0]!.id,
                qualityExecutionMode: 'IN_PROCESS',
                associatedProductionActivityId: finishingId,
                qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
                executionMultiplicity: 'BATCHED',
                coverageTarget: 'PREPARED_QUANTITY',
              },
            ],
          },
        },
      },
    },
    include: { versions: true },
  });

  const poRes = await request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      distributorId: distributor.id,
      poDate: '2026-06-30',
      lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
    });

  return {
    admin,
    merchandiser,
    factoryUser,
    factory,
    style,
    finalActivityId,
    processFlowVersionId: processFlow.versions[0]!.id,
    poId: poRes.body.data.id as string,
    sizeId: size.id,
  };
}

type Graph = Awaited<ReturnType<typeof createSeedGraph>>;

async function createJobOrder(token: string, graph: Graph, quantity = 4) {
  return request(app)
    .post('/job-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderSheetIds: [graph.poId],
      sizes: [{ sizeId: graph.sizeId, quantity }],
      factoryId: graph.factory.id,
      processFlowVersionId: graph.processFlowVersionId,
      unitPrice: '199.50',
      disclaimerText: 'Factory commercial terms apply.',
    });
}

// Drives send-to-factory -> confirm, then starts+completes stages 0..throughStageIndex
// inclusive (0 = Cutting, 1 = Printing, 2 = Finishing). Returns the latest
// Job Order detail body plus the stage id list in sequence order.
async function advanceProductionTo(
  graph: Graph,
  jobOrderId: string,
  initialVersion: number,
  throughStageIndex: number,
  adminToken: string,
) {
  const sent = await request(app)
    .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', `send-${jobOrderId}`)
    .send({ expectedVersion: initialVersion })
    .expect(200);
  let current = await request(app)
    .post(`/job-orders/${jobOrderId}/actions/confirm`)
    .set('Authorization', `Bearer ${graph.factoryUser.token}`)
    .set('Idempotency-Key', `confirm-${jobOrderId}`)
    .send({
      expectedVersion: sent.body.data.version,
      expectedDisclaimerRevision: 1,
      acknowledgeDisclaimer: true,
    })
    .expect(200);

  for (let i = 0; i <= throughStageIndex; i++) {
    const stageId = current.body.data.stages[i].id;
    const started = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', `start-${jobOrderId}-${i}`)
      .send({ expectedVersion: current.body.data.version, stageStatusId: stageId })
      .expect(200);
    current = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', `complete-${jobOrderId}-${i}`)
      .send({ expectedVersion: started.body.data.version, stageStatusId: stageId })
      .expect(200);
  }
  return current.body.data;
}

describe('DEMO-010: undo a completed production stage', () => {
  it('never allows a Factory User to undo, even calling the route directly', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(graph, created.body.data.id, created.body.data.version, 0, graph.admin.token);
    const cuttingStage = jobOrder.stages[0];

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 'undo-factory-blocked')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'Factory attempt' });
    expect(res.status).toBe(403);
    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingStage.id } }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('lets Merchandiser undo within 24 hours when the next stage has not started', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
      const graph = await createSeedGraph();
      const created = await createJobOrder(graph.admin.token, graph);
      const jobOrder = await advanceProductionTo(
        graph,
        created.body.data.id,
        created.body.data.version,
        0,
        graph.admin.token,
      );
      const cuttingStage = jobOrder.stages[0];

      vi.setSystemTime(new Date('2026-07-01T23:59:59.000Z'));
      const merchToken = signAccessToken({
        sub: graph.merchandiser.userId,
        roles: ['MERCHANDISER'],
        authVersion: 1,
      });

      const res = await request(app)
        .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
        .set('Authorization', `Bearer ${merchToken}`)
        .set('Idempotency-Key', 'undo-merch-within-window')
        .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'Cutting defect found' })
        .expect(200);

      expect(res.body.data.stages[0].status).toBe('IN_PROGRESS');
      const row = await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingStage.id } });
      expect(row).toMatchObject({ status: 'IN_PROGRESS', completedBy: null, completedAt: null, remarks: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks Merchandiser from undoing after 24 hours', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
      const graph = await createSeedGraph();
      const created = await createJobOrder(graph.admin.token, graph);
      const jobOrder = await advanceProductionTo(
        graph,
        created.body.data.id,
        created.body.data.version,
        0,
        graph.admin.token,
      );
      const cuttingStage = jobOrder.stages[0];

      vi.setSystemTime(new Date('2026-07-02T00:00:00.001Z'));
      const merchToken = signAccessToken({
        sub: graph.merchandiser.userId,
        roles: ['MERCHANDISER'],
        authVersion: 1,
      });

      const res = await request(app)
        .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
        .set('Authorization', `Bearer ${merchToken}`)
        .set('Idempotency-Key', 'undo-merch-after-window')
        .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'Too late' });

      expect(res.status).toBe(403);
      expect(
        await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingStage.id } }),
      ).toMatchObject({ status: 'COMPLETED' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets Admin undo after the 24-hour Merchandiser window has passed', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
      const graph = await createSeedGraph();
      const created = await createJobOrder(graph.admin.token, graph);
      const jobOrder = await advanceProductionTo(
        graph,
        created.body.data.id,
        created.body.data.version,
        0,
        graph.admin.token,
      );
      const cuttingStage = jobOrder.stages[0];

      vi.setSystemTime(new Date('2026-07-05T00:00:00.000Z'));
      const adminToken = signAccessToken({ sub: graph.admin.userId, roles: ['ADMIN'], authVersion: 1 });

      const res = await request(app)
        .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'undo-admin-after-window')
        .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'Admin correction' })
        .expect(200);

      expect(res.body.data.stages[0].status).toBe('IN_PROGRESS');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is deterministic at the exact 24-hour boundary: allowed at 24h0m0s, blocked one millisecond later', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
      const graphA = await createSeedGraph();
      const createdA = await createJobOrder(graphA.admin.token, graphA);
      const jobOrderA = await advanceProductionTo(
        graphA,
        createdA.body.data.id,
        createdA.body.data.version,
        0,
        graphA.admin.token,
      );
      const stageA = jobOrderA.stages[0];

      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z')); // exactly 24h0m0s later
      const merchTokenA = signAccessToken({
        sub: graphA.merchandiser.userId,
        roles: ['MERCHANDISER'],
        authVersion: 1,
      });
      await request(app)
        .post(`/job-orders/${createdA.body.data.id}/actions/undo-stage`)
        .set('Authorization', `Bearer ${merchTokenA}`)
        .set('Idempotency-Key', 'undo-boundary-exact')
        .send({ expectedVersion: jobOrderA.version, stageStatusId: stageA.id, reason: 'Exactly on the line' })
        .expect(200);

      // Separate graph: same elapsed time plus 1ms must be blocked.
      vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
      const graphB = await createSeedGraph();
      const createdB = await createJobOrder(graphB.admin.token, graphB);
      const jobOrderB = await advanceProductionTo(
        graphB,
        createdB.body.data.id,
        createdB.body.data.version,
        0,
        graphB.admin.token,
      );
      const stageB = jobOrderB.stages[0];

      vi.setSystemTime(new Date('2026-07-11T00:00:00.001Z')); // 24h0m0.001s later
      const merchTokenB = signAccessToken({
        sub: graphB.merchandiser.userId,
        roles: ['MERCHANDISER'],
        authVersion: 1,
      });
      const res = await request(app)
        .post(`/job-orders/${createdB.body.data.id}/actions/undo-stage`)
        .set('Authorization', `Bearer ${merchTokenB}`)
        .set('Idempotency-Key', 'undo-boundary-over')
        .send({ expectedVersion: jobOrderB.version, stageStatusId: stageB.id, reason: 'One millisecond late' });
      expect(res.status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks both Merchandiser and Admin once the next stage has started', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    // Cutting COMPLETED, Printing started (IN_PROGRESS) but not completed.
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'send-next-stage-guard')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    let current = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 'confirm-next-stage-guard')
      .send({ expectedVersion: sent.body.data.version, expectedDisclaimerRevision: 1, acknowledgeDisclaimer: true })
      .expect(200);
    const cuttingId = current.body.data.stages[0].id;
    const started1 = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 'start-cutting-next-stage-guard')
      .send({ expectedVersion: current.body.data.version, stageStatusId: cuttingId })
      .expect(200);
    current = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 'complete-cutting-next-stage-guard')
      .send({ expectedVersion: started1.body.data.version, stageStatusId: cuttingId })
      .expect(200);
    const printingId = current.body.data.stages[1].id;
    current = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 'start-printing-next-stage-guard')
      .send({ expectedVersion: current.body.data.version, stageStatusId: printingId })
      .expect(200);

    const merchRes = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.merchandiser.token}`)
      .set('Idempotency-Key', 'undo-merch-next-stage-started')
      .send({ expectedVersion: current.body.data.version, stageStatusId: cuttingId, reason: 'Too late, started' });
    expect(merchRes.status).toBe(409);

    const adminRes = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-admin-next-stage-started')
      .send({ expectedVersion: current.body.data.version, stageStatusId: cuttingId, reason: 'Admin, still too late' });
    expect(adminRes.status).toBe(409);

    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingId } }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('requires a non-empty reason', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      0,
      graph.admin.token,
    );
    const cuttingStage = jobOrder.stages[0];

    const blank = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-blank-reason')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: '   ' });
    expect(blank.status).toBe(400);

    const missing = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-missing-reason')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id });
    expect(missing.status).toBe(400);

    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingStage.id } }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('restores the exact prior stage state and only reverses the intended stage', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    // Complete Cutting AND Printing; undo only Printing.
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      1,
      graph.admin.token,
    );
    const cuttingStage = jobOrder.stages[0];
    const printingStage = jobOrder.stages[1];
    const finishingStage = jobOrder.stages[2];

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-printing-only')
      .send({ expectedVersion: jobOrder.version, stageStatusId: printingStage.id, reason: 'Printing misalignment' })
      .expect(200);

    expect(res.body.data.stages[1].status).toBe('IN_PROGRESS');
    const cuttingRow = await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: cuttingStage.id } });
    expect(cuttingRow.status).toBe('COMPLETED');
    expect(cuttingRow.completedAt).not.toBeNull();
    const finishingRow = await prisma.jobOrderStageStatus.findUniqueOrThrow({
      where: { id: finishingStage.id },
    });
    expect(finishingRow.status).toBe('NOT_STARTED');

    // The restored state must be re-completable through the normal path.
    const recompleted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${graph.factoryUser.token}`)
      .set('Idempotency-Key', 're-complete-printing')
      .send({ expectedVersion: res.body.data.version, stageStatusId: printingStage.id })
      .expect(200);
    expect(recompleted.body.data.stages[1].status).toBe('COMPLETED');
  });

  it('records actor, role, timestamp, and reason on a successful undo', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      0,
      graph.admin.token,
    );
    const cuttingStage = jobOrder.stages[0];

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.merchandiser.token}`)
      .set('Idempotency-Key', 'undo-audit-check')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'Needs rework' })
      .expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'JobOrder', entityId: created.body.data.id, action: 'JOB_ORDER_STAGE_COMPLETION_UNDONE' },
    });
    expect(audit.actorId).toBe(graph.merchandiser.userId);
    expect(audit.createdAt).toBeInstanceOf(Date);
    expect(audit.metadata).toMatchObject({
      stageStatusId: cuttingStage.id,
      actorRole: 'MERCHANDISER',
      reason: 'Needs rework',
    });
  });

  it('rejects an unauthorized role (e.g. QA_USER) directly at the API, independent of any UI', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      0,
      graph.admin.token,
    );
    const cuttingStage = jobOrder.stages[0];
    const qaUser = await createTestUserAndToken({
      email: `undo-qa-${createId()}@test.local`,
      password: 'pass',
      roles: ['QA_USER'],
    });

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .set('Idempotency-Key', 'undo-qa-blocked')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'QA attempt' });
    expect(res.status).toBe(403);

    const unauthenticated = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Idempotency-Key', 'undo-no-auth')
      .send({ expectedVersion: jobOrder.version, stageStatusId: cuttingStage.id, reason: 'No token' });
    expect(unauthenticated.status).toBe(401);
  });

  it('refuses to undo Finishing once Final QA has already recorded a batch against it', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      2,
      graph.admin.token,
    );
    const finishingStage = jobOrder.stages[2];

    await prisma.finalQualityBatch.create({
      data: {
        id: createId(),
        jobOrderId: created.body.data.id,
        processFlowActivityId: graph.finalActivityId,
        batchNumber: 1,
        physicalQuantity: 4,
        disposition: 'DRAFT',
        createdById: graph.admin.userId,
      },
    });

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-finishing-qa-blocked')
      .send({ expectedVersion: jobOrder.version, stageStatusId: finishingStage.id, reason: 'Try after QA batch exists' });
    expect(res.status).toBe(409);
    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: finishingStage.id } }),
    ).toMatchObject({ status: 'COMPLETED' });
  });

  it('undoing Finishing reverts a manually-marked PRODUCTION_COMPLETE back to IN_PRODUCTION', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph);
    const jobOrder = await advanceProductionTo(
      graph,
      created.body.data.id,
      created.body.data.version,
      2,
      graph.admin.token,
    );
    const finishingStage = jobOrder.stages[2];
    expect(jobOrder.status).toBe('IN_PRODUCTION');

    const markedComplete = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'mark-complete-before-undo')
      .send({ expectedVersion: jobOrder.version })
      .expect(200);
    expect(markedComplete.body.data.status).toBe('PRODUCTION_COMPLETE');

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/undo-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'undo-finishing-reverts-complete')
      .send({
        expectedVersion: markedComplete.body.data.version,
        stageStatusId: finishingStage.id,
        reason: 'Finishing was not actually acceptable',
      })
      .expect(200);

    expect(res.body.data.status).toBe('IN_PRODUCTION');
    expect(res.body.data.stages[2].status).toBe('IN_PROGRESS');
    const freshJobOrder = await prisma.jobOrder.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(freshJobOrder.status).toBe('IN_PRODUCTION');
    expect(freshJobOrder.productionCompletedAt).toBeNull();
  });
});
