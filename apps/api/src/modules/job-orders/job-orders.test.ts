import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { isProgressThresholdMet } from './job-orders.service.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();

describe('Production percentage eligibility arithmetic', () => {
  it('uses exact decimal-safe boundaries driven by configuration', () => {
    expect(isProgressThresholdMet(419, 840, new Prisma.Decimal('50'))).toBe(false);
    expect(isProgressThresholdMet(420, 840, new Prisma.Decimal('50'))).toBe(true);
    expect(isProgressThresholdMet(251, 840, new Prisma.Decimal('30'))).toBe(false);
    expect(isProgressThresholdMet(252, 840, new Prisma.Decimal('30'))).toBe(true);
    expect(isProgressThresholdMet(504, 840, new Prisma.Decimal('60'))).toBe(true);
  });
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSeedGraph() {
  const admin = await createTestUserAndToken({
    email: 'admin-job@test.local',
    password: 'pass',
    roles: ['ADMIN'],
  });
  const distributor = await createTestDistributor();
  const factory = await createTestFactory();
  const otherFactory = await createTestFactory({ code: 'OTHER', name: 'Other Factory' });
  const sizeA = await prisma.size.create({
    data: { id: createId(), code: 'AGE_3', label: '3', sizeType: 'AGE', sortOrder: 3 },
  });
  const sizeB = await prisma.size.create({
    data: { id: createId(), code: 'AGE_4', label: '4', sizeType: 'AGE', sortOrder: 4 },
  });
  const season = await prisma.season.create({
    data: {
      id: createId(),
      code: 'JO-TEST',
      name: 'Job Order Test Season',
      financialYear: '26-27',
    },
  });
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: 'ST-JO',
      styleName: 'Job Style',
      finalMrp: 500,
      styleSeasons: { create: { seasonId: season.id } },
    },
  });
  await prisma.styleSize.createMany({
    data: [
      { id: createId(), styleId: style.id, sizeId: sizeA.id },
      { id: createId(), styleId: style.id, sizeId: sizeB.id },
    ],
  });
  const processFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: 'JO_FLOW',
      name: 'Job Flow',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          status: 'ACTIVE',
          stages: {
            create: [
              { id: createId(), sequence: 1, name: 'Cutting' },
              { id: createId(), sequence: 2, name: 'Sewing' },
            ],
          },
        },
      },
    },
    include: { versions: true },
  });
  const draftFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: 'DRAFT_FLOW',
      name: 'Draft Flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'DRAFT' } },
    },
    include: { versions: true },
  });

  const poRes = await request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      distributorId: distributor.id,
      poDate: '2026-06-30',
      purchaseMode: 'OUTRIGHT',
      lines: [
        {
          styleId: style.id,
          sizes: [
            { sizeId: sizeA.id, orderedQuantity: 10 },
            { sizeId: sizeB.id, orderedQuantity: 5 },
          ],
        },
      ],
    });
  const po = poRes.body.data;
  await request(app)
    .post(`/purchase-orders/${po.id}/actions/submit`)
    .set('Authorization', `Bearer ${admin.token}`);
  const freshPo = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
    where: { id: po.id },
    include: { lines: { include: { sizes: true } } },
  });
  const poLine = freshPo.lines[0]!;

  return {
    admin,
    distributor,
    factory,
    otherFactory,
    processFlowId: processFlow.id,
    processFlowVersionId: processFlow.versions[0]!.id,
    draftProcessFlowVersionId: draftFlow.versions[0]!.id,
    poId: po.id as string,
    poLineId: poLine.id,
    poSizeAId: poLine.sizes.find((size) => size.sizeId === sizeA.id)!.id,
    poSizeBId: poLine.sizes.find((size) => size.sizeId === sizeB.id)!.id,
  };
}

async function createJobOrder(
  token: string,
  graph: Awaited<ReturnType<typeof createSeedGraph>>,
  quantity = 4,
) {
  return request(app)
    .post('/job-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      purchaseOrderId: graph.poId,
      factoryId: graph.factory.id,
      processFlowVersionId: graph.processFlowVersionId,
      unitPrice: '199.50',
      disclaimerText: 'Factory commercial terms apply.',
      lines: [
        {
          purchaseOrderLineId: graph.poLineId,
          sizes: [{ purchaseOrderLineSizeId: graph.poSizeAId, quantity }],
        },
      ],
    });
}

describe('job orders API', () => {
  it('tracks monotonic, versioned Production progress without implicitly completing a stage', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createTestUserAndToken({
      email: 'progress-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const created = await createJobOrder(graph.admin.token, graph, 4);
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'progress-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const confirmed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-confirm')
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    const stage = confirmed.body.data.stages[0];
    expect(stage).toMatchObject({
      plannedQuantity: 4,
      completedQuantity: 0,
      remainingQuantity: 4,
      progressPercent: 0,
    });

    const started = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-start')
      .send({ expectedVersion: confirmed.body.data.version, stageStatusId: stage.id })
      .expect(200);
    expect(started.body.data.stages[0].status).toBe('IN_PROGRESS');

    const first = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-one')
      .send({
        expectedVersion: started.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 2,
      })
      .expect(200);
    expect(first.body.data.stages[0]).toMatchObject({
      status: 'IN_PROGRESS',
      completedQuantity: 2,
      remainingQuantity: 2,
      progressPercent: 50,
    });

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-bypass-next-stage')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: confirmed.body.data.stages[1].id,
      })
      .expect(400);

    const noOp = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-noop')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 2,
      })
      .expect(200);
    expect(noOp.body.data.version).toBe(first.body.data.version);
    expect(
      await prisma.auditLog.count({ where: { action: 'JOB_ORDER_STAGE_PROGRESS_UPDATED' } }),
    ).toBe(1);

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-decrease')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 1,
      })
      .expect(400);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-over')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 5,
      })
      .expect(400);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-negative')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: -1,
      })
      .expect(400);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-stale')
      .send({
        expectedVersion: started.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 3,
      })
      .expect(409);

    const full = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-full')
      .send({
        expectedVersion: first.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 4,
      })
      .expect(200);
    expect(full.body.data.stages[0]).toMatchObject({
      status: 'IN_PROGRESS',
      completedQuantity: 4,
      remainingQuantity: 0,
      progressPercent: 100,
    });
    expect(full.body.data.status).toBe('IN_PRODUCTION');

    const wrongFactory = await createTestUserAndToken({
      email: 'progress-wrong@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: wrongFactory.userId, factoryId: graph.otherFactory.id },
    });
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${wrongFactory.token}`)
      .set('Idempotency-Key', 'progress-wrong-factory')
      .send({
        expectedVersion: full.body.data.version,
        stageStatusId: stage.id,
        completedQuantity: 4,
      })
      .expect(403);

    const explicitlyCompleted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'progress-explicit-complete')
      .send({ expectedVersion: full.body.data.version, stageStatusId: stage.id })
      .expect(200);
    expect(explicitlyCompleted.body.data.stages[0]).toMatchObject({
      status: 'COMPLETED',
      completedQuantity: 4,
      progressPercent: 100,
    });
    expect(explicitlyCompleted.body.data.stages[1].status).toBe('NOT_STARTED');

    await expect(
      prisma.jobOrderStageStatus.update({
        where: { id: stage.id },
        data: { completedQuantity: -1 },
      }),
    ).rejects.toThrow();
    const foreignActivity = await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: graph.draftProcessFlowVersionId,
        sequence: 1,
        name: 'Foreign Production',
      },
    });
    await expect(
      prisma.jobOrderStageStatus.create({
        data: {
          id: createId(),
          jobOrderId: created.body.data.id,
          processFlowVersionStageId: foreignActivity.id,
          stageSequence: 99,
          stageNameSnapshot: foreignActivity.name,
        },
      }),
    ).rejects.toThrow(/assigned Process Flow version/);

    const historicalStageId = explicitlyCompleted.body.data.stages[1].id;
    await prisma.jobOrderStageStatus.update({
      where: { id: historicalStageId },
      data: { completedQuantity: null },
    });
    const historicalView = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(historicalView.body.data.stages[1]).toMatchObject({
      completedQuantity: null,
      remainingQuantity: null,
      progressPercent: null,
    });
    const historicalCompletion = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'historical-progress-completion')
      .send({
        expectedVersion: historicalView.body.data.version,
        stageStatusId: historicalStageId,
      })
      .expect(200);
    expect(historicalCompletion.body.data.stages[1]).toMatchObject({
      status: 'COMPLETED',
      completedQuantity: 4,
      remainingQuantity: 0,
      progressPercent: 100,
    });
  });

  it('derives Inline, percentage, and sequential Quality availability from exact versioned definitions', async () => {
    const graph = await createSeedGraph();
    await prisma.distributorPurchaseOrderLineSize.update({
      where: { id: graph.poSizeAId },
      data: { orderedQuantity: 840 },
    });
    const created = await createJobOrder(graph.admin.token, graph, 840);
    const production = await prisma.processFlowVersionStage.findMany({
      where: { processFlowVersionId: graph.processFlowVersionId },
      orderBy: { sequence: 'asc' },
    });
    await prisma.processFlowVersionStage.update({
      where: { id: production[1]!.id },
      data: { sequence: 4 },
    });
    const form = await prisma.qualityForm.create({
      data: { id: createId(), code: 'RUNTIME_QA', name: 'Runtime Inspection' },
    });
    const formV1 = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 1,
        activityType: 'INSPECTION',
        executionScope: 'JOB_ORDER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const [gate, inline, final, postSewingGate] = await Promise.all([
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: graph.processFlowVersionId,
          sequence: 2,
          name: 'Cutting Gate',
          activityType: 'QUALITY',
          qualityFormVersionId: formV1.id,
          qualityExecutionMode: 'SEQUENTIAL_GATE',
          gateSatisfactionRequirement: 'FINALIZED',
          executionMultiplicity: 'SINGLE',
        },
      }),
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: graph.processFlowVersionId,
          sequence: 5,
          name: 'Inline Inspection',
          activityType: 'QUALITY',
          qualityFormVersionId: formV1.id,
          qualityExecutionMode: 'IN_PROCESS',
          executionMultiplicity: 'SINGLE',
          associatedProductionActivityId: production[1]!.id,
          qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
        },
      }),
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: graph.processFlowVersionId,
          sequence: 6,
          name: 'Final Inspection',
          activityType: 'QUALITY',
          qualityFormVersionId: formV1.id,
          qualityExecutionMode: 'IN_PROCESS',
          executionMultiplicity: 'SINGLE',
          associatedProductionActivityId: production[1]!.id,
          qualityAvailabilityPolicy: 'PROGRESS_PERCENTAGE',
          progressThresholdPercent: '50',
        },
      }),
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: graph.processFlowVersionId,
          sequence: 7,
          name: 'Post Sewing Gate',
          activityType: 'QUALITY',
          qualityFormVersionId: formV1.id,
          qualityExecutionMode: 'SEQUENTIAL_GATE',
          gateSatisfactionRequirement: 'FINALIZED',
          executionMultiplicity: 'SINGLE',
        },
      }),
    ]);
    const factoryUser = await createTestUserAndToken({
      email: 'quality-runtime-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'quality-runtime-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const confirmed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-runtime-confirm')
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    expect(confirmed.body.data.qualityActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ processFlowVersionStageId: gate.id, status: 'NOT_AVAILABLE' }),
        expect.objectContaining({
          processFlowVersionStageId: inline.id,
          status: 'NOT_AVAILABLE',
          qualityFormVersion: { id: formV1.id, versionNumber: 1 },
        }),
        expect.objectContaining({
          processFlowVersionStageId: final.id,
          status: 'NOT_AVAILABLE',
          progressThresholdPercent: '50.00',
        }),
      ]),
    );

    const cuttingProgress = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-cutting-progress')
      .send({
        expectedVersion: confirmed.body.data.version,
        stageStatusId: confirmed.body.data.stages[0].id,
        completedQuantity: 840,
      })
      .expect(200);
    const cuttingDone = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-cutting-done')
      .send({
        expectedVersion: cuttingProgress.body.data.version,
        stageStatusId: confirmed.body.data.stages[0].id,
      })
      .expect(200);
    expect(
      cuttingDone.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) => item.processFlowVersionStageId === gate.id,
      ).status,
    ).toBe('AVAILABLE');
    await prisma.qualityActivityExecution.create({
      data: {
        id: createId(),
        jobOrderId: created.body.data.id,
        processFlowActivityId: gate.id,
        qualityFormVersionId: formV1.id,
        attemptNumber: 1,
        batchNumber: 1,
        status: 'FINALIZED',
        startedById: graph.admin.userId,
        finalizedById: graph.admin.userId,
        finalizedAt: new Date(),
      },
    });
    const sewing = cuttingDone.body.data.stages[1];
    const sewingStarted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-sewing-start')
      .send({ expectedVersion: cuttingDone.body.data.version, stageStatusId: sewing.id })
      .expect(200);
    expect(
      sewingStarted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === inline.id,
      ),
    ).toMatchObject({ status: 'AVAILABLE', eligible: true });
    expect(
      sewingStarted.body.data.qualityActivities.every(
        (item: { status: string }) => item.status !== 'IN_PROGRESS',
      ),
    ).toBe(true);
    expect(
      sewingStarted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === postSewingGate.id,
      ).status,
    ).toBe('NOT_AVAILABLE');

    const at300 = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-300')
      .send({
        expectedVersion: sewingStarted.body.data.version,
        stageStatusId: sewing.id,
        completedQuantity: 300,
      })
      .expect(200);
    const concurrencyVersion = at300.body.data.version;
    const requestA = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-concurrency-a')
      .send({
        expectedVersion: concurrencyVersion,
        stageStatusId: sewing.id,
        completedQuantity: 400,
      })
      .expect(200);
    const requestB = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-concurrency-b')
      .send({
        expectedVersion: concurrencyVersion,
        stageStatusId: sewing.id,
        completedQuantity: 350,
      })
      .expect(409);
    expect(requestB.body.error.code).toBe('STALE_VERSION');
    const afterConcurrency = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(afterConcurrency.body.data.stages[1].completedQuantity).toBe(400);

    const at419 = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-419')
      .send({
        expectedVersion: requestA.body.data.version,
        stageStatusId: sewing.id,
        completedQuantity: 419,
      })
      .expect(200);
    expect(
      at419.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).status,
    ).toBe('NOT_AVAILABLE');
    const at420 = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-420')
      .send({
        expectedVersion: at419.body.data.version,
        stageStatusId: sewing.id,
        completedQuantity: 420,
      })
      .expect(200);
    expect(
      at420.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).status,
    ).toBe('AVAILABLE');
    const at839 = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-839')
      .send({
        expectedVersion: at420.body.data.version,
        stageStatusId: sewing.id,
        completedQuantity: 839,
      })
      .expect(200);
    const sewingCompleted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-complete-839')
      .send({ expectedVersion: at839.body.data.version, stageStatusId: sewing.id })
      .expect(200);
    expect(
      sewingCompleted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).status,
    ).toBe('AVAILABLE');
    expect(sewingCompleted.body.data.stages[1].completedQuantity).toBe(840);
    expect(
      sewingCompleted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === inline.id,
      ).status,
    ).toBe('MISSED');
    expect(
      sewingCompleted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === postSewingGate.id,
      ).status,
    ).toBe('AVAILABLE');

    await prisma.qualityFormVersion.update({
      where: { id: formV1.id },
      data: { status: 'RETIRED' },
    });
    await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 2,
        activityType: 'INSPECTION',
        executionScope: 'JOB_ORDER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const reread = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(
      reread.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).qualityFormVersion,
    ).toEqual({ id: formV1.id, versionNumber: 1 });
  });
  it('assigns a semantically supported Quality-enabled Process Flow without starting Quality work', async () => {
    const graph = await createSeedGraph();
    const qualityForm = await prisma.qualityForm.create({
      data: { id: createId(), code: 'SUPPORTED_PPM', name: 'Consolidated pre-production report' },
    });
    const qualityFormVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: qualityForm.id,
        versionNumber: 1,
        activityType: 'MEETING',
        executionScope: 'JOB_ORDER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: graph.processFlowVersionId,
        sequence: 3,
        name: 'Pre-Production Report',
        activityType: 'QUALITY',
        qualityFormVersionId: qualityFormVersion.id,
        qualityExecutionMode: 'SEQUENTIAL_GATE',
        gateSatisfactionRequirement: 'FINALIZED',
        executionMultiplicity: 'SINGLE',
      },
    });

    const response = await createJobOrder(graph.admin.token, graph);
    expect(response.status).toBe(201);
    expect(response.body.data.qualityActivities).toHaveLength(1);
    expect(response.body.data.qualityActivities[0].status).toBe('NOT_AVAILABLE');
    expect(
      await prisma.qualityActivityExecution.count({ where: { jobOrderId: response.body.data.id } }),
    ).toBe(0);
  });

  it('rejects assignment of an unsupported Quality-enabled Process Flow with an actionable reason', async () => {
    const graph = await createSeedGraph();
    const qualityForm = await prisma.qualityForm.create({
      data: { id: createId(), code: 'JO_QUALITY_GUARD', name: 'Job Order Quality Guard' },
    });
    const qualityFormVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: qualityForm.id,
        versionNumber: 1,
        activityType: 'INSPECTION',
        executionScope: 'JOB_ORDER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: graph.processFlowVersionId,
        sequence: 3,
        name: 'Quality Gate',
        activityType: 'QUALITY',
        qualityFormVersionId: qualityFormVersion.id,
        qualityExecutionMode: 'SEQUENTIAL_GATE',
        gateSatisfactionRequirement: 'FINALIZED',
        executionMultiplicity: 'SINGLE',
      },
    });

    const response = await createJobOrder(graph.admin.token, graph);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain(
      'Quality activity "Quality Gate" uses an unsupported runtime pattern',
    );
    expect(await prisma.jobOrder.count()).toBe(0);
  });

  it('atomically prevents concurrent PO over-allocation', async () => {
    const graph = await createSeedGraph();
    const responses = await Promise.all([
      createJobOrder(graph.admin.token, graph, 7),
      createJobOrder(graph.admin.token, graph, 7),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const balance = await prisma.distributorPurchaseOrderLineSize.findUniqueOrThrow({
      where: { id: graph.poSizeAId },
      select: { orderedQuantity: true, jobOrderedQuantity: true },
    });
    expect(balance).toEqual({ orderedQuantity: 10, jobOrderedQuantity: 7 });
  });

  it('generates unique business numbers for concurrent job orders', async () => {
    const graph = await createSeedGraph();
    const [first, second] = await Promise.all([
      createJobOrder(graph.admin.token, graph, 1),
      createJobOrder(graph.admin.token, graph, 1),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.jobOrderNumber).not.toBe(second.body.data.jobOrderNumber);
  });

  it('returns a stable stale-version conflict before mutating', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 1);
    const response = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'stale-send')
      .send({ expectedVersion: created.body.data.version + 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_VERSION');
    expect(await prisma.auditLog.count({ where: { action: 'JOB_ORDER_SENT_TO_FACTORY' } })).toBe(0);
  });

  it('returns compact tasks only for a factory user with exactly one authorized mapping', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 2);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'assigned-task-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const factoryUser = await createTestUserAndToken({
      email: 'tasks@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });

    const unmapped = await request(app)
      .get('/job-orders/assigned-tasks')
      .set('Authorization', `Bearer ${factoryUser.token}`);
    expect(unmapped.status).toBe(403);
    expect(unmapped.body.error.code).toBe('FACTORY_MAPPING_REQUIRED');

    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const assigned = await request(app)
      .get('/job-orders/assigned-tasks')
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(assigned.body.data.items).toHaveLength(1);
    expect(assigned.body.data.items[0]).toMatchObject({
      id: created.body.data.id,
      jobOrderNumber: created.body.data.jobOrderNumber,
      actionRequired: true,
    });
    expect(assigned.body.data.items[0].lines).toBeUndefined();

    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.otherFactory.id },
    });
    const ambiguous = await request(app)
      .get('/job-orders/assigned-tasks')
      .set('Authorization', `Bearer ${factoryUser.token}`);
    expect(ambiguous.status).toBe(403);
    expect(ambiguous.body.error.code).toBe('FACTORY_MAPPING_AMBIGUOUS');
  });

  it('retains its assigned historical process-flow version when a newer version is activated', async () => {
    const graph = await createSeedGraph();
    const createdJobOrder = await createJobOrder(graph.admin.token, graph, 4);
    expect(createdJobOrder.status).toBe(201);

    const version2 = await request(app)
      .post(`/process-flows/${graph.processFlowId}/versions`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({ copyFromVersionId: graph.processFlowVersionId })
      .then((response) => response.body.data);
    await request(app)
      .put(`/process-flow-versions/${version2.id}/stages`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({ stages: [{ name: 'Cutting' }, { name: 'Packing' }] })
      .expect(200);
    await request(app)
      .post(`/process-flow-versions/${version2.id}/activate`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);

    const historicalVersion = await prisma.processFlowVersion.findUniqueOrThrow({
      where: { id: graph.processFlowVersionId },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });
    const jobOrder = await request(app)
      .get(`/job-orders/${createdJobOrder.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);

    expect(historicalVersion.status).toBe('RETIRED');
    expect(historicalVersion.stages.map((stage) => stage.name)).toEqual(['Cutting', 'Sewing']);
    expect(jobOrder.body.data.processFlowVersion.id).toBe(graph.processFlowVersionId);
  });

  it('creates a draft job order, increments PO balance, rolls PO status, and writes audit', async () => {
    const graph = await createSeedGraph();

    const res = await createJobOrder(graph.admin.token, graph, 4);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.jobOrderNumber).toMatch(/^JO-\d{4}-\d{6}$/);
    expect(res.body.data.orderedQuantityTotal).toBe(4);
    expect(res.body.data.unitPrice).toBe(199.5);
    expect(res.body.data.seasonSnapshots).toEqual([
      expect.objectContaining({
        code: 'JO-TEST',
        name: 'Job Order Test Season',
        financialYear: '26-27',
      }),
    ]);
    const persisted = await prisma.jobOrder.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(persisted.unitPrice.toFixed(2)).toBe('199.50');

    const poSize = await prisma.distributorPurchaseOrderLineSize.findUniqueOrThrow({
      where: { id: graph.poSizeAId },
    });
    expect(poSize.jobOrderedQuantity).toBe(4);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(po.status).toBe('PARTIALLY_JOB_ORDERED');
    await expect(prisma.auditLog.count({ where: { action: 'JOB_ORDER_CREATED' } })).resolves.toBe(
      1,
    );
  });

  it.each([undefined, 0, -1, 'Infinity'])('rejects invalid unit prices (%s)', async (unitPrice) => {
    const graph = await createSeedGraph();
    const response = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        purchaseOrderId: graph.poId,
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        ...(unitPrice === undefined ? {} : { unitPrice }),
        lines: [
          {
            purchaseOrderLineId: graph.poLineId,
            sizes: [{ purchaseOrderLineSizeId: graph.poSizeAId, quantity: 1 }],
          },
        ],
      });
    expect(response.status).toBe(400);
  });

  it('enforces a positive non-null unit price at the database boundary', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 1);
    await expect(
      prisma.$executeRaw`UPDATE "job_orders" SET "unit_price" = NULL WHERE "id" = ${created.body.data.id}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "job_orders" SET "unit_price" = 0 WHERE "id" = ${created.body.data.id}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "job_orders" SET "unit_price" = -1 WHERE "id" = ${created.body.data.id}`,
    ).rejects.toThrow();
  });

  it('rejects DRAFT PO, inactive factory, inactive flow, excess quantity, wrong line, and wrong size', async () => {
    const graph = await createSeedGraph();
    const draftPo = await prisma.distributorPurchaseOrder.update({
      where: { id: graph.poId },
      data: { status: 'DRAFT' },
    });
    await expect(createJobOrder(graph.admin.token, graph)).resolves.toMatchObject({ status: 400 });
    await prisma.distributorPurchaseOrder.update({
      where: { id: draftPo.id },
      data: { status: 'SUBMITTED' },
    });

    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'INACTIVE' } });
    await expect(createJobOrder(graph.admin.token, graph)).resolves.toMatchObject({ status: 400 });
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'ACTIVE' } });

    await expect(
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          purchaseOrderId: graph.poId,
          factoryId: graph.factory.id,
          processFlowVersionId: graph.draftProcessFlowVersionId,
          lines: [
            {
              purchaseOrderLineId: graph.poLineId,
              sizes: [{ purchaseOrderLineSizeId: graph.poSizeAId, quantity: 1 }],
            },
          ],
        }),
    ).resolves.toMatchObject({ status: 400 });

    await expect(createJobOrder(graph.admin.token, graph, 99)).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          purchaseOrderId: graph.poId,
          factoryId: graph.factory.id,
          processFlowVersionId: graph.processFlowVersionId,
          lines: [
            {
              purchaseOrderLineId: createId(),
              sizes: [{ purchaseOrderLineSizeId: graph.poSizeAId, quantity: 1 }],
            },
          ],
        }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          purchaseOrderId: graph.poId,
          factoryId: graph.factory.id,
          processFlowVersionId: graph.processFlowVersionId,
          lines: [
            {
              purchaseOrderLineId: graph.poLineId,
              sizes: [{ purchaseOrderLineSizeId: createId(), quantity: 1 }],
            },
          ],
        }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it('moves PO to fully job ordered when all quantities are consumed', async () => {
    const graph = await createSeedGraph();
    const res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        purchaseOrderId: graph.poId,
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '199.50',
        disclaimerText: 'Factory commercial terms apply.',
        lines: [
          {
            purchaseOrderLineId: graph.poLineId,
            sizes: [
              { purchaseOrderLineSizeId: graph.poSizeAId, quantity: 10 },
              { purchaseOrderLineSizeId: graph.poSizeBId, quantity: 5 },
            ],
          },
        ],
      });

    expect(res.status).toBe(201);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(po.status).toBe('FULLY_JOB_ORDERED');
  });

  it('runs send, confirm, stage completion, prepared quantity, and variance workflow', async () => {
    const graph = await createSeedGraph();
    const createRes = await createJobOrder(graph.admin.token, graph, 4);
    const jobOrderId = createRes.body.data.id;

    const sendRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'workflow-send')
      .send({ expectedVersion: createRes.body.data.version });
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.status).toBe('SENT_TO_FACTORY');
    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .set('Idempotency-Key', 'workflow-send')
        .send({ expectedVersion: createRes.body.data.version }),
    ).resolves.toMatchObject({ status: 200 });

    const factoryUser = await createTestUserAndToken({
      email: 'factory-job@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const otherFactoryUser = await createTestUserAndToken({
      email: 'other-factory-job@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: otherFactoryUser.userId, factoryId: graph.otherFactory.id },
    });

    await request(app)
      .get(`/job-orders/${jobOrderId}`)
      .set('Authorization', `Bearer ${otherFactoryUser.token}`)
      .expect(403);

    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/confirm`)
        .set('Authorization', `Bearer ${otherFactoryUser.token}`)
        .set('Idempotency-Key', 'wrong-confirm')
        .send({
          expectedVersion: sendRes.body.data.version,
          expectedDisclaimerRevision: 1,
          acknowledgeDisclaimer: true,
        }),
    ).resolves.toMatchObject({ status: 403 });
    const confirmRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'workflow-confirm')
      .send({
        expectedVersion: sendRes.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe('CONFIRMED_BY_FACTORY');
    expect(confirmRes.body.data.stages).toHaveLength(2);
    expect(confirmRes.body.data.stages[0].stageNameSnapshot).toBe('Cutting');
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'workflow-confirm')
      .send({
        expectedVersion: sendRes.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);

    const stages = confirmRes.body.data.stages;
    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .set('Idempotency-Key', 'wrong-stage')
        .send({ stageStatusId: stages[1].id, expectedVersion: confirmRes.body.data.version }),
    ).resolves.toMatchObject({ status: 400 });

    const firstStageProgress = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one-progress')
      .send({
        stageStatusId: stages[0].id,
        completedQuantity: 4,
        expectedVersion: confirmRes.body.data.version,
      })
      .expect(200);
    const firstStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one')
      .send({ stageStatusId: stages[0].id, expectedVersion: firstStageProgress.body.data.version });
    expect(firstStageRes.body.data.status).toBe('IN_PRODUCTION');

    const stageAudit = await request(app)
      .get(`/job-orders/${jobOrderId}/audit`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(stageAudit.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'JOB_ORDER_STAGE_COMPLETED',
          metadata: {
            stageStatusId: stages[0].id,
            processFlowVersionStageId: stages[0].processFlowVersionStageId,
            stageSequence: 1,
            stageName: 'Cutting',
          },
        }),
      ]),
    );

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one')
      .send({ stageStatusId: stages[0].id, expectedVersion: firstStageProgress.body.data.version })
      .expect(200);

    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .set('Idempotency-Key', 'prepared-too-early')
        .send({
          expectedVersion: firstStageRes.body.data.version,
          sizes: [
            { jobOrderLineSizeId: createRes.body.data.lines[0].sizes[0].id, preparedQuantity: 3 },
          ],
        }),
    ).resolves.toMatchObject({ status: 400 });

    const finalStageProgress = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-two-progress')
      .send({
        stageStatusId: stages[1].id,
        completedQuantity: 4,
        expectedVersion: firstStageRes.body.data.version,
      })
      .expect(200);
    const finalStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-two')
      .send({ stageStatusId: stages[1].id, expectedVersion: finalStageProgress.body.data.version });
    expect(finalStageRes.body.data.status).toBe('PRODUCTION_COMPLETE');

    const sizeId = finalStageRes.body.data.lines[0].sizes[0].id;
    const preparedRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'prepared-final')
      .send({
        expectedVersion: finalStageRes.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 3 }],
      });
    expect(preparedRes.status).toBe(200);
    expect(preparedRes.body.data.status).toBe('READY_FOR_QA');
    expect(preparedRes.body.data.preparedQuantityTotal).toBe(3);
    const preparedReplay = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'prepared-final')
      .send({
        expectedVersion: finalStageRes.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 3 }],
      })
      .expect(200);
    expect(preparedReplay.body.data.preparedQuantityTotal).toBe(3);

    const varianceRes = await request(app)
      .get(`/job-orders/${jobOrderId}/variance`)
      .set('Authorization', `Bearer ${graph.admin.token}`);
    expect(varianceRes.body.data.varianceQuantity).toBe(-1);
    await expect(prisma.auditLog.count({ where: { entityType: 'JobOrder' } })).resolves.toBe(9);
  });

  it('blocks sending to a deactivated factory while keeping the existing job order readable', async () => {
    const graph = await createSeedGraph();
    const createRes = await createJobOrder(graph.admin.token, graph, 4);
    const jobOrderId = createRes.body.data.id;
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'INACTIVE' } });

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'inactive-send')
      .send({ expectedVersion: createRes.body.data.version })
      .expect(409);
    const detail = await request(app)
      .get(`/job-orders/${jobOrderId}`)
      .set('Authorization', `Bearer ${graph.admin.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe('DRAFT');
  });

  it('blocks factory workflow mutations on a deactivated factory while preserving admin/merchandiser resolution, global QA visibility, and immediate restoration on reactivation', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: 'merch-job@test.local',
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const qaUser = await createTestUserAndToken({
      email: 'qa-job@test.local',
      password: 'pass',
      roles: ['QA_USER'],
    });
    const factoryUser = await createTestUserAndToken({
      email: 'factory-suspend@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const otherFactoryUser = await createTestUserAndToken({
      email: 'other-factory-suspend@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: otherFactoryUser.userId, factoryId: graph.otherFactory.id },
    });

    const createRes = await createJobOrder(graph.admin.token, graph, 4);
    const jobOrderId = createRes.body.data.id;
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'deactivation-send')
      .send({ expectedVersion: createRes.body.data.version })
      .expect(200);

    // ERVE-018 regression: a merchandiser can manage job-order setup, but can
    // never make the factory-only acknowledgement/confirmation transition.
    const merchandiserRole = await prisma.userRole.findFirst({
      where: { userId: merchandiser.userId, role: { name: 'MERCHANDISER' } },
    });
    expect(merchandiserRole).not.toBeNull();
    const beforeMerchandiserConfirm = await prisma.jobOrder.findUniqueOrThrow({
      where: { id: jobOrderId },
      select: {
        status: true,
        factoryConfirmationStatus: true,
        confirmedBy: true,
        confirmedAt: true,
      },
    });
    expect(beforeMerchandiserConfirm).toMatchObject({
      status: 'SENT_TO_FACTORY',
      factoryConfirmationStatus: 'PENDING',
      confirmedBy: null,
      confirmedAt: null,
    });
    const confirmationAuditWhere = {
      entityType: 'JobOrder',
      entityId: jobOrderId,
      action: { in: ['JOB_ORDER_DISCLAIMER_ACKNOWLEDGED', 'JOB_ORDER_FACTORY_CONFIRMED'] },
    };
    expect(await prisma.jobOrderAcknowledgement.count({ where: { jobOrderId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: confirmationAuditWhere })).toBe(0);

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'merchandiser-confirm-denied')
      .send({
        expectedVersion: createRes.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(403);

    const afterMerchandiserConfirm = await prisma.jobOrder.findUniqueOrThrow({
      where: { id: jobOrderId },
      select: {
        status: true,
        factoryConfirmationStatus: true,
        confirmedBy: true,
        confirmedAt: true,
      },
    });
    expect(afterMerchandiserConfirm).toEqual(beforeMerchandiserConfirm);
    expect(await prisma.jobOrderAcknowledgement.count({ where: { jobOrderId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: confirmationAuditWhere })).toBe(0);

    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'INACTIVE' } });

    // A mapped factory user can no longer advance production at their now-inactive factory.
    const factoryUserConfirm = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'inactive-confirm')
      .send({
        expectedVersion: createRes.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      });
    expect(factoryUserConfirm.status).toBe(409);
    expect(factoryUserConfirm.body.error.message).toMatch(/inactive/i);

    // A factory user mapped to a different factory is still rejected on role grounds, not factory status.
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${otherFactoryUser.token}`)
      .set('Idempotency-Key', 'other-confirm')
      .send({
        expectedVersion: createRes.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(403);

    // No new job order can be assigned to the inactive factory while existing work is unresolved.
    await expect(createJobOrder(graph.admin.token, graph, 1)).resolves.toMatchObject({
      status: 400,
    });

    // ADMIN cannot impersonate a factory acknowledgement.
    const confirmRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-confirm')
      .send({
        expectedVersion: createRes.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      });
    expect(confirmRes.status).toBe(403);

    // Confirm while the factory is active, then suspend it to exercise the
    // workflow actions that must remain unavailable to factory users.
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'ACTIVE' } });
    const activeFactoryConfirm = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'active-confirm-before-suspension')
      .send({
        expectedVersion: createRes.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      });
    expect(activeFactoryConfirm.status).toBe(200);
    const stages = activeFactoryConfirm.body.data.stages;
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'INACTIVE' } });

    // The mapped factory user remains blocked at the next workflow step too.
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'inactive-stage')
      .send({
        stageStatusId: stages[0].id,
        expectedVersion: activeFactoryConfirm.body.data.version,
      })
      .expect(409);

    // MERCHANDISER retains its normal control over the existing job order.
    const stage1Progress = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'merch-stage-progress')
      .send({
        stageStatusId: stages[0].id,
        completedQuantity: 4,
        expectedVersion: activeFactoryConfirm.body.data.version,
      })
      .expect(200);
    const stage1Res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'merch-stage')
      .send({
        stageStatusId: stages[0].id,
        expectedVersion: stage1Progress.body.data.version,
      });
    expect(stage1Res.status).toBe(200);
    expect(stage1Res.body.data.status).toBe('IN_PRODUCTION');

    const stage2Progress = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-stage-progress')
      .send({
        stageStatusId: stages[1].id,
        completedQuantity: 4,
        expectedVersion: stage1Res.body.data.version,
      })
      .expect(200);
    const stage2Res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-stage')
      .send({ stageStatusId: stages[1].id, expectedVersion: stage2Progress.body.data.version });
    expect(stage2Res.status).toBe(200);
    expect(stage2Res.body.data.status).toBe('PRODUCTION_COMPLETE');

    const sizeId = stage2Res.body.data.lines[0].sizes[0].id;
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'inactive-prepared')
      .send({
        expectedVersion: stage2Res.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 3 }],
      })
      .expect(409);

    const preparedRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-prepared')
      .send({
        expectedVersion: stage2Res.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 3 }],
      });
    expect(preparedRes.status).toBe(200);
    expect(preparedRes.body.data.status).toBe('READY_FOR_QA');

    // An unmapped QA user can inspect already-prepared quantities at any factory;
    // view access depends on active QA role membership, not factory mapping.
    const qaView = await request(app)
      .get(`/job-orders/${jobOrderId}`)
      .set('Authorization', `Bearer ${qaUser.token}`);
    expect(qaView.status).toBe(200);
    expect(qaView.body.data.status).toBe('READY_FOR_QA');

    // Existing history remains fully readable through every read endpoint.
    await request(app)
      .get(`/job-orders/${jobOrderId}/stages`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    await request(app)
      .get(`/job-orders/${jobOrderId}/variance`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    await request(app)
      .get('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);

    // Reactivation restores the factory user's mapped workflow access immediately.
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'ACTIVE' } });
    const jo2Res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        purchaseOrderId: graph.poId,
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '199.50',
        disclaimerText: 'Factory commercial terms apply.',
        lines: [
          {
            purchaseOrderLineId: graph.poLineId,
            sizes: [{ purchaseOrderLineSizeId: graph.poSizeBId, quantity: 3 }],
          },
        ],
      });
    expect(jo2Res.status).toBe(201);
    await request(app)
      .post(`/job-orders/${jo2Res.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'restored-send')
      .send({ expectedVersion: jo2Res.body.data.version })
      .expect(200);
    const restoredConfirm = await request(app)
      .post(`/job-orders/${jo2Res.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'restored-confirm')
      .send({
        expectedVersion: jo2Res.body.data.version + 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      });
    expect(restoredConfirm.status).toBe(200);
    expect(restoredConfirm.body.data.status).toBe('CONFIRMED_BY_FACTORY');
  });

  it('blocks distributor access to job orders', async () => {
    const graph = await createSeedGraph();
    const createRes = await createJobOrder(graph.admin.token, graph, 2);
    const distributorUser = await createTestUserAndToken({
      email: 'dist-job@test.local',
      password: 'pass',
      roles: ['DISTRIBUTOR'],
    });
    await prisma.userDistributor.create({
      data: { id: createId(), userId: distributorUser.userId, distributorId: graph.distributor.id },
    });

    const listRes = await request(app)
      .get('/job-orders')
      .set('Authorization', `Bearer ${distributorUser.token}`);
    const detailRes = await request(app)
      .get(`/job-orders/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${distributorUser.token}`);
    expect(listRes.status).toBe(403);
    expect(detailRes.status).toBe(403);
  });
});
