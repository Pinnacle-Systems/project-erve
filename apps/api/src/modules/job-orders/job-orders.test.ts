import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { signAccessToken } from '../../auth/jwt.js';
import { isProgressThresholdMet } from './job-orders.service.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { DOCUMENT_PREFIXES } from '../master-data/document-number.util.js';

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
  // Fixed date, not "now" — keeps the compact-code assertions below
  // deterministic regardless of when the suite runs.
  const financialYear = await createTestFinancialYear(new Date('2026-06-30'));
  const season = await prisma.season.create({
    data: {
      id: createId(),
      code: 'JO-TEST',
      name: 'Job Order Test Season',
      financialYearId: financialYear.id,
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
  const finishingId = createId();
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
              { id: cuttingId, sequence: 1, name: 'Cutting', code: 'CUTTING' },
              { id: finishingId, sequence: 2, name: 'Finishing', code: 'FINISHING' },
              {
                id: createId(),
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
  // No Draft->Submit step anymore — an Order Sheet is immediately eligible
  // for Job Order planning (status is already 'SUBMITTED' on creation).
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
    style,
    processFlowId: processFlow.id,
    processFlowVersionId: processFlow.versions[0]!.id,
    draftProcessFlowVersionId: draftFlow.versions[0]!.id,
    poId: po.id as string,
    poLineId: poLine.id,
    poSizeAId: poLine.sizes.find((size) => size.sizeId === sizeA.id)!.id,
    poSizeBId: poLine.sizes.find((size) => size.sizeId === sizeB.id)!.id,
    sizeAId: sizeA.id,
    sizeBId: sizeB.id,
  };
}

// Creates one additional Order Sheet (Distributor Purchase Order) sharing
// styleId/sizeId with the seed graph's Style — used by the multi-source
// (Order Sheet Phase 2) tests to build a second/third eligible source. Each
// Order Sheet gets its own Distributor (defaulting to OUTRIGHT purchase
// mode, overridable) since Purchase Mode is derived from the Distributor,
// not client-supplied.
async function createOrderSheet(
  token: string,
  graph: { style: { id: string } },
  sizes: Array<{ sizeId: string; orderedQuantity: number }>,
  overrides?: { distributorId?: string; requiredDeliveryDate?: string },
) {
  const distributorId =
    overrides?.distributorId ?? (await createTestDistributor()).id;
  const res = await request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      distributorId,
      poDate: '2026-06-30',
      requiredDeliveryDate: overrides?.requiredDeliveryDate,
      lines: [{ styleId: graph.style.id, sizes }],
    });
  const orderSheet = res.body.data;
  return {
    id: orderSheet.id as string,
    poNumber: orderSheet.poNumber as string,
    distributorId,
    lineId: orderSheet.lines[0].id as string,
    sizesBySizeId: new Map<string, string>(
      orderSheet.lines[0].sizes.map((size: { sizeId: string; id: string }) => [size.sizeId, size.id]),
    ),
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
      orderSheetIds: [graph.poId],
      sizes: [{ sizeId: graph.sizeAId, quantity }],
      factoryId: graph.factory.id,
      processFlowVersionId: graph.processFlowVersionId,
      unitPrice: '199.50',
      disclaimerText: 'Factory commercial terms apply.',
    });
}

describe('job orders API', () => {
  it('runs Production stages as state-only, ordered activities', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createTestUserAndToken({
      email: 'state-only-factory@test.local',
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
      .set('Idempotency-Key', 'state-only-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const confirmed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'state-only-confirm')
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    const firstStage = confirmed.body.data.stages[0];
    expect(firstStage.status).toBe('NOT_STARTED');
    expect(firstStage).not.toHaveProperty('completedQuantity');
    expect(firstStage).not.toHaveProperty('progressPercent');
    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: firstStage.id } }),
    ).toMatchObject({ completedQuantity: null });

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'state-only-complete-before-start')
      .send({ expectedVersion: confirmed.body.data.version, stageStatusId: firstStage.id })
      .expect(400);

    const started = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'state-only-start')
      .send({ expectedVersion: confirmed.body.data.version, stageStatusId: firstStage.id })
      .expect(200);
    expect(started.body.data.stages[0].status).toBe('IN_PROGRESS');

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'state-only-skip-stage')
      .send({
        expectedVersion: started.body.data.version,
        stageStatusId: started.body.data.stages[1].id,
      })
      .expect(400);

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/update-production-progress`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'obsolete-progress-route')
      .send({
        expectedVersion: started.body.data.version,
        stageStatusId: firstStage.id,
        completedQuantity: 4,
      })
      .expect(404);

    const completed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'state-only-complete')
      .send({ expectedVersion: started.body.data.version, stageStatusId: firstStage.id })
      .expect(200);
    expect(completed.body.data.stages[0].status).toBe('COMPLETED');
    expect(completed.body.data.stages[1].status).toBe('NOT_STARTED');
    expect(
      await prisma.jobOrderStageStatus.findUniqueOrThrow({ where: { id: firstStage.id } }),
    ).toMatchObject({ status: 'COMPLETED', completedQuantity: null });
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

    const cuttingStarted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-cutting-start')
      .send({
        expectedVersion: confirmed.body.data.version,
        stageStatusId: confirmed.body.data.stages[0].id,
      })
      .expect(200);
    const cuttingDone = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-cutting-done')
      .send({
        expectedVersion: cuttingStarted.body.data.version,
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

    await prisma.jobOrderStageStatus.update({
      where: { id: sewing.id },
      data: { completedQuantity: 419 },
    });
    const belowThreshold = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(
      belowThreshold.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).status,
    ).toBe('NOT_AVAILABLE');

    await prisma.jobOrderStageStatus.update({
      where: { id: sewing.id },
      data: { completedQuantity: 420 },
    });
    const atThreshold = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(
      atThreshold.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === final.id,
      ).status,
    ).toBe('AVAILABLE');

    const sewingCompleted = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'quality-sewing-complete')
      .send({ expectedVersion: sewingStarted.body.data.version, stageStatusId: sewing.id })
      .expect(200);
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
    expect(response.body.data.qualityActivities).toHaveLength(2);
    expect(
      response.body.data.qualityActivities.find(
        (activity: { name: string }) => activity.name === 'Pre-Production Report',
      ).status,
    ).toBe('NOT_AVAILABLE');
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

  it('atomically prevents two concurrent Job Orders from both claiming the same Order Sheet', async () => {
    const graph = await createSeedGraph();
    const responses = await Promise.all([
      createJobOrder(graph.admin.token, graph, 7),
      createJobOrder(graph.admin.token, graph, 7),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
      select: { jobOrderId: true },
    });
    expect(po.jobOrderId).not.toBeNull();
    // Only the winner's Job Order Line was created — no double-write from the loser.
    const winnerId = responses.find((response) => response.status === 201)!.body.data.id;
    expect(po.jobOrderId).toBe(winnerId);
    expect(await prisma.jobOrderLine.count()).toBe(1);
    expect(await prisma.jobOrderLine.count({ where: { jobOrderId: winnerId } })).toBe(1);
    const balance = await prisma.distributorPurchaseOrderLineSize.findUniqueOrThrow({
      where: { id: graph.poSizeAId },
      select: { orderedQuantity: true },
    });
    expect(balance).toEqual({ orderedQuantity: 10 });
  });

  it('generates unique business numbers for concurrent job orders against different Order Sheets', async () => {
    // Two independent Order Sheets — a Job Order locks its whole Order Sheet,
    // so two concurrent Job Orders can no longer target the same one. Reuses
    // the seed graph's admin/factory/process-flow; only the second Order
    // Sheet (distributor + style + size) needs to be genuinely independent.
    const graph = await createSeedGraph();
    const secondDistributor = await createTestDistributor();
    const secondFinancialYear = await createTestFinancialYear(new Date('2026-06-30'));
    const secondSeason = await prisma.season.create({
      data: {
        id: createId(),
        code: 'JO-TEST-2',
        name: 'Job Order Test Season 2',
        financialYearId: secondFinancialYear.id,
      },
    });
    const secondStyle = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `ST-JO2-${createId()}`,
        styleName: 'Second Job Style',
        finalMrp: 500,
        styleSeasons: { create: { seasonId: secondSeason.id } },
      },
    });
    const secondSize = await prisma.size.create({
      data: { id: createId(), code: 'AGE_6', label: '6', sizeType: 'AGE', sortOrder: 6 },
    });
    await prisma.styleSize.create({
      data: { id: createId(), styleId: secondStyle.id, sizeId: secondSize.id },
    });
    const secondPoRes = await request(app)
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        distributorId: secondDistributor.id,
        poDate: '2026-06-30',
        lines: [{ styleId: secondStyle.id, sizes: [{ sizeId: secondSize.id, orderedQuantity: 5 }] }],
      });

    const [first, second] = await Promise.all([
      createJobOrder(graph.admin.token, graph, 1),
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          orderSheetIds: [secondPoRes.body.data.id],
          sizes: [{ sizeId: secondSize.id, quantity: 1 }],
          factoryId: graph.factory.id,
          processFlowVersionId: graph.processFlowVersionId,
          unitPrice: '199.50',
          disclaimerText: 'Factory commercial terms apply.',
        }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.jobOrderNumber).not.toBe(second.body.data.jobOrderNumber);
  });

  it('resolves its own Financial Year from its creation date, independent of the parent Purchase Order — a JO created 01-Apr just after a 2026-06-30-dated (FY 2026-27) PO lands in FY 2027-28', async () => {
    const graph = await createSeedGraph();
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
      include: { financialYear: true },
    });
    expect(po.financialYear.code).toBe('2026-27');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-04-01T10:00:00.000Z'));
    try {
      // The original token was minted at the real "now" and would read as
      // expired once the clock jumps forward ~8 months — mint a fresh one
      // under the faked clock instead of reusing graph.admin.token.
      const freshToken = signAccessToken({ sub: graph.admin.userId, roles: ['ADMIN'], authVersion: 1 });
      const res = await createJobOrder(freshToken, graph, 1);
      expect(res.status).toBe(201);
      expect(res.body.data.financialYear.code).toBe('2027-28');
    } finally {
      vi.useRealTimers();
    }
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

    // A factory user can never actually reach a multi-mapping state: the
    // database enforces one factory per user (see the "factory mapping"
    // suite in users.test.ts), so a second mapping row is rejected outright.
    await expect(
      prisma.userFactory.create({
        data: { id: createId(), userId: factoryUser.userId, factoryId: graph.otherFactory.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
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
    expect(historicalVersion.stages.map((stage) => stage.name)).toEqual([
      'Cutting',
      'Finishing',
      'Final Inspection',
    ]);
    expect(jobOrder.body.data.processFlowVersion.id).toBe(graph.processFlowVersionId);
  });

  it('creates a draft job order, claims (locks) the Order Sheet, and writes audit', async () => {
    const graph = await createSeedGraph();

    const res = await createJobOrder(graph.admin.token, graph, 4);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    // \d{4,}, not \d{4} — DOCUMENT_SERIAL_MIN_WIDTH is a floor, not a cap.
    expect(res.body.data.jobOrderNumber).toMatch(
      new RegExp(`^${DOCUMENT_PREFIXES.JOB_ORDER}\\/\\d{2}-\\d{2}\\/\\d{4,}$`),
    );
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

    // No jobOrderedQuantity column anymore — the whole-sheet jobOrderId
    // claim is the sole lock/eligibility signal.
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(po.jobOrderId).toBe(res.body.data.id);
    expect(po.status).toBe('SUBMITTED'); // no PARTIALLY_JOB_ORDERED/FULLY_JOB_ORDERED rollup anymore
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
        orderSheetIds: [graph.poId],
        sizes: [{ sizeId: graph.sizeAId, quantity: 1 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        ...(unitPrice === undefined ? {} : { unitPrice }),
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

  it('allows Job Order quantity to exceed the Order Sheet forecast — no remaining-balance cap', async () => {
    const graph = await createSeedGraph();
    // sizeA's Order Sheet forecast is 10; requesting 99 must still succeed —
    // Job Order quantities are independent of the Order Sheet's forecast.
    await expect(createJobOrder(graph.admin.token, graph, 99)).resolves.toMatchObject({
      status: 201,
    });
  });

  it('rejects a cancelled Order Sheet, inactive factory, inactive flow, unknown Order Sheet, and wrong size', async () => {
    const graph = await createSeedGraph();
    await prisma.distributorPurchaseOrder.update({
      where: { id: graph.poId },
      data: { status: 'CANCELLED' },
    });
    await expect(createJobOrder(graph.admin.token, graph)).resolves.toMatchObject({ status: 400 });
    await prisma.distributorPurchaseOrder.update({
      where: { id: graph.poId },
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
          orderSheetIds: [graph.poId],
          sizes: [{ sizeId: graph.sizeAId, quantity: 1 }],
          factoryId: graph.factory.id,
          processFlowVersionId: graph.draftProcessFlowVersionId,
        }),
    ).resolves.toMatchObject({ status: 400 });

    // Unknown Order Sheet id.
    await expect(
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          orderSheetIds: [createId()],
          sizes: [{ sizeId: graph.sizeAId, quantity: 1 }],
          factoryId: graph.factory.id,
          processFlowVersionId: graph.processFlowVersionId,
        }),
    ).resolves.toMatchObject({ status: 400 });
    // Size not valid for the Style.
    await expect(
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send({
          orderSheetIds: [graph.poId],
          sizes: [{ sizeId: createId(), quantity: 1 }],
          factoryId: graph.factory.id,
          processFlowVersionId: graph.processFlowVersionId,
        }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it('locks the Order Sheet once a Job Order claims it, regardless of how much of the forecast is consumed', async () => {
    const graph = await createSeedGraph();
    const res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [graph.poId],
        sizes: [
          { sizeId: graph.sizeAId, quantity: 10 },
          { sizeId: graph.sizeBId, quantity: 5 },
        ],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '199.50',
        disclaimerText: 'Factory commercial terms apply.',
      });

    expect(res.status).toBe(201);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(po.jobOrderId).toBe(res.body.data.id);
    expect(po.status).toBe('SUBMITTED'); // no FULLY_JOB_ORDERED rollup anymore

    // Locked: a second Job Order against the same Order Sheet is rejected,
    // even though this first one already consumed every forecast unit.
    const second = await createJobOrder(graph.admin.token, graph, 1);
    expect(second.status).toBe(400);
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

    const firstStageStarted = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one-start')
      .send({
        stageStatusId: stages[0].id,
        expectedVersion: confirmRes.body.data.version,
      })
      .expect(200);
    const firstStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one')
      .send({ stageStatusId: stages[0].id, expectedVersion: firstStageStarted.body.data.version });
    expect(firstStageRes.body.data.status).toBe('IN_PRODUCTION');

    const stageAudit = await request(app)
      .get(`/job-orders/${jobOrderId}/audit`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(stageAudit.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'JOB_ORDER_STAGE_STARTED',
          metadata: {
            stageStatusId: stages[0].id,
            processFlowVersionStageId: stages[0].processFlowVersionStageId,
            stageSequence: 1,
            stageName: 'Cutting',
          },
        }),
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
    expect(
      stageAudit.body.data.some((entry: { action: string }) =>
        entry.action.startsWith('QUALITY_ACTIVITY_'),
      ),
    ).toBe(false);
    expect(new Set(stageAudit.body.data.map((entry: { id: string }) => entry.id)).size).toBe(
      stageAudit.body.data.length,
    );

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-one')
      .send({ stageStatusId: stages[0].id, expectedVersion: firstStageStarted.body.data.version })
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
    ).resolves.toMatchObject({ status: 409 });

    const finalStageStarted = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-two-start')
      .send({
        stageStatusId: stages[1].id,
        expectedVersion: firstStageRes.body.data.version,
      })
      .expect(200);
    const finalStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'stage-two')
      .send({ stageStatusId: stages[1].id, expectedVersion: finalStageStarted.body.data.version });
    // Correction 3: completing the last (Finishing) stage no longer implies
    // Job Order production completion by itself — no Final QA coverage has
    // been recorded yet, so the automatic PRODUCTION_COMPLETE condition is
    // not met and the Job Order stays IN_PRODUCTION.
    expect(finalStageRes.body.data.status).toBe('IN_PRODUCTION');

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
    // Prepared quantity (3) is still short of the full planned quantity (4
    // per size across 2 sizes), so the automatic condition remains unmet.
    expect(preparedRes.body.data.status).toBe('IN_PRODUCTION');
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

  it('keeps the Final Inspection activity Available (not Missed) once Finishing completes with no Final execution yet', async () => {
    const graph = await createSeedGraph();
    const finalActivityDefinition = await prisma.processFlowVersionStage.findFirstOrThrow({
      where: { processFlowVersionId: graph.processFlowVersionId, code: 'FINAL' },
    });
    const factoryUser = await createTestUserAndToken({
      email: 'final-available-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const createRes = await createJobOrder(graph.admin.token, graph, 4);
    const jobOrderId = createRes.body.data.id;

    const sendRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'final-available-send')
      .send({ expectedVersion: createRes.body.data.version })
      .expect(200);
    const confirmRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-confirm')
      .send({
        expectedVersion: sendRes.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    const [cutting, finishing] = confirmRes.body.data.stages;

    const cuttingStarted = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-cutting-start')
      .send({ expectedVersion: confirmRes.body.data.version, stageStatusId: cutting.id })
      .expect(200);
    const cuttingDone = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-cutting-done')
      .send({ expectedVersion: cuttingStarted.body.data.version, stageStatusId: cutting.id })
      .expect(200);

    const finishingStarted = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-finishing-start')
      .send({ expectedVersion: cuttingDone.body.data.version, stageStatusId: finishing.id })
      .expect(200);
    expect(
      finishingStarted.body.data.qualityActivities.find(
        (item: { processFlowVersionStageId: string }) =>
          item.processFlowVersionStageId === finalActivityDefinition.id,
      ),
    ).toMatchObject({ status: 'AVAILABLE', eligible: true });

    const finishingDone = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-finishing-done')
      .send({ expectedVersion: finishingStarted.body.data.version, stageStatusId: finishing.id })
      .expect(200);
    const finalAfterFinishing = finishingDone.body.data.qualityActivities.find(
      (item: { processFlowVersionStageId: string }) =>
        item.processFlowVersionStageId === finalActivityDefinition.id,
    );
    expect(finalAfterFinishing).toMatchObject({ status: 'AVAILABLE', eligible: true });
    expect(finalAfterFinishing.status).not.toBe('MISSED');
    expect(finalAfterFinishing.coverage.preparedQuantityAuthoritative).toBe(false);
    expect(finalAfterFinishing.coverage.preparedQuantity).toBeNull();
    expect(finalAfterFinishing.coverage.availableForNewFinalBatch).toBeNull();

    const sizeId = finishingDone.body.data.lines[0].sizes[0].id;
    const preparedRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'final-available-prepared')
      .send({
        expectedVersion: finishingDone.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 4 }],
      })
      .expect(200);
    const finalWithPreparedQuantity = preparedRes.body.data.qualityActivities.find(
      (item: { processFlowVersionStageId: string }) =>
        item.processFlowVersionStageId === finalActivityDefinition.id,
    );
    expect(finalWithPreparedQuantity).toMatchObject({ status: 'AVAILABLE', eligible: true });
    expect(finalWithPreparedQuantity.coverage.preparedQuantityAuthoritative).toBe(true);
    expect(finalWithPreparedQuantity.coverage.preparedQuantity).toBe(4);
    expect(finalWithPreparedQuantity.coverage.availableForNewFinalBatch).toBe(4);
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
    const stage1Started = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'merch-stage-start')
      .send({
        stageStatusId: stages[0].id,
        expectedVersion: activeFactoryConfirm.body.data.version,
      })
      .expect(200);
    const stage1Res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'merch-stage')
      .send({
        stageStatusId: stages[0].id,
        expectedVersion: stage1Started.body.data.version,
      });
    expect(stage1Res.status).toBe(200);
    expect(stage1Res.body.data.status).toBe('IN_PRODUCTION');

    const stage2Started = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-stage-start')
      .send({
        stageStatusId: stages[1].id,
        expectedVersion: stage1Res.body.data.version,
      })
      .expect(200);
    const stage2Res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'admin-stage')
      .send({ stageStatusId: stages[1].id, expectedVersion: stage2Started.body.data.version });
    expect(stage2Res.status).toBe(200);
    // Correction 3: Finishing completion alone no longer implies Job Order
    // production completion — no Final QA coverage exists yet.
    expect(stage2Res.body.data.status).toBe('IN_PRODUCTION');

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
    // Still short of the full planned quantity and with no Final QA coverage
    // recorded, so the automatic condition remains unmet.
    expect(preparedRes.body.data.status).toBe('IN_PRODUCTION');

    // An unmapped QA user can view Process Flow Quality work at any factory;
    // view access depends on active QA role membership, not factory mapping.
    const qaView = await request(app)
      .get(`/job-orders/${jobOrderId}`)
      .set('Authorization', `Bearer ${qaUser.token}`);
    expect(qaView.status).toBe(200);
    expect(qaView.body.data.status).toBe('IN_PRODUCTION');

    // Production remains read-only for QA even though the same Job Order is visible.
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .set('Idempotency-Key', 'qa-stage-start-denied')
      .send({ stageStatusId: stages[0].id, expectedVersion: preparedRes.body.data.version })
      .expect(403);
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .set('Idempotency-Key', 'qa-stage-complete-denied')
      .send({ stageStatusId: stages[0].id, expectedVersion: preparedRes.body.data.version })
      .expect(403);
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .set('Idempotency-Key', 'qa-prepared-denied')
      .send({
        expectedVersion: preparedRes.body.data.version,
        sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 4 }],
      })
      .expect(403);

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
    // graph.poId is already locked by the first Job Order created above (an
    // Order Sheet maps to at most one Job Order), so this verification uses a
    // second, independent Order Sheet against the same style/factory/flow.
    await prisma.factory.update({ where: { id: graph.factory.id }, data: { status: 'ACTIVE' } });
    const firstLine = await prisma.distributorPurchaseOrderLine.findUniqueOrThrow({
      where: { id: graph.poLineId },
    });
    const sizeBRow = await prisma.distributorPurchaseOrderLineSize.findUniqueOrThrow({
      where: { id: graph.poSizeBId },
    });
    const secondPoRes = await request(app)
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        distributorId: graph.distributor.id,
        poDate: '2026-06-30',
        lines: [{ styleId: firstLine.styleId, sizes: [{ sizeId: sizeBRow.sizeId, orderedQuantity: 5 }] }],
      });
    const jo2Res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [secondPoRes.body.data.id],
        sizes: [{ sizeId: sizeBRow.sizeId, quantity: 3 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '199.50',
        disclaimerText: 'Factory commercial terms apply.',
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

// Correction 3: explicit Merchandiser "stop/accept production" action — used
// when the automatic full-quantity/full-QA-coverage rule has not (and may
// never) be met, e.g. deliberate short production.
describe('manual Job Order Production Complete (Correction 3)', () => {
  async function toInProduction(graph: Awaited<ReturnType<typeof createSeedGraph>>) {
    const factoryUser = await createTestUserAndToken({
      email: `manual-complete-factory-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const created = await createJobOrder(graph.admin.token, graph, 10);
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-send`)
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const confirmed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-confirm`)
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    const stages = confirmed.body.data.stages;
    const started = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-start-1`)
      .send({ stageStatusId: stages[0].id, expectedVersion: confirmed.body.data.version })
      .expect(200);
    const completed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-complete-1`)
      .send({ stageStatusId: stages[0].id, expectedVersion: started.body.data.version })
      .expect(200);
    expect(completed.body.data.status).toBe('IN_PRODUCTION');
    return { jobOrderId: created.body.data.id as string, version: completed.body.data.version as number, stages: completed.body.data.stages, factoryUser };
  }

  it('lets a Merchandiser mark an eligible short-produced Job Order Production Complete, recording actor and timestamp in the audit trail', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `manual-complete-merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const { jobOrderId, version } = await toInProduction(graph);

    const res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-1')
      .send({ expectedVersion: version })
      .expect(200);
    expect(res.body.data.status).toBe('PRODUCTION_COMPLETE');
    expect(res.body.data.preparedQuantityTotal).toBe(0);

    const audit = await request(app)
      .get(`/job-orders/${jobOrderId}/audit`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    const entry = audit.body.data.find(
      (item: { action: string }) => item.action === 'JOB_ORDER_PRODUCTION_COMPLETED_MANUAL',
    );
    expect(entry).toBeDefined();
    expect(entry.actor.id).toBe(merchandiser.userId);
    expect(entry.createdAt).toBeTruthy();

    // No Prepared Quantity was fabricated, no QA Release was created, and no
    // Final Quality Batch was touched.
    expect(
      await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } }),
    ).toMatchObject({ preparedQuantityTotal: 0 });
    expect(await prisma.qaRelease.count({ where: { jobOrderId } })).toBe(0);
    expect(await prisma.finalQualityBatch.count({ where: { jobOrderId } })).toBe(0);
  });

  it('rejects an unauthorized role (Factory/QA) and allows Admin as the confirmed override', async () => {
    const graph = await createSeedGraph();
    const admin = graph.admin;
    const qaUser = await createTestUserAndToken({
      email: `manual-complete-qa-${createId()}@test.local`,
      password: 'pass',
      roles: ['QA_USER'],
    });
    const { jobOrderId, version, factoryUser } = await toInProduction(graph);

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'manual-complete-factory-denied')
      .send({ expectedVersion: version })
      .expect(403);
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .set('Idempotency-Key', 'manual-complete-qa-denied')
      .send({ expectedVersion: version })
      .expect(403);

    const res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', 'manual-complete-admin')
      .send({ expectedVersion: version })
      .expect(200);
    expect(res.body.data.status).toBe('PRODUCTION_COMPLETE');
  });

  it('is unavailable while a production stage is in progress, and does not create a CLOSED status', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `manual-complete-locked-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const { jobOrderId, version, stages, factoryUser } = await toInProduction(graph);
    const finishingStarted = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-start-2`)
      .send({ stageStatusId: stages[1].id, expectedVersion: version })
      .expect(200);

    const blocked = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-blocked')
      .send({ expectedVersion: finishingStarted.body.data.version })
      .expect(409);
    expect(blocked.body.error.message).toContain('in progress');

    const completedFinishing = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-complete-2`)
      .send({ stageStatusId: stages[1].id, expectedVersion: finishingStarted.body.data.version })
      .expect(200);
    // All stages complete but no Final QA coverage recorded — still not
    // automatically complete, and now eligible for the manual action.
    expect(completedFinishing.body.data.status).toBe('IN_PRODUCTION');

    const res = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-after-finishing')
      .send({ expectedVersion: completedFinishing.body.data.version })
      .expect(200);
    expect(res.body.data.status).toBe('PRODUCTION_COMPLETE');
    expect(res.body.data.status).not.toBe('CLOSED');
  });

  it('replays idempotently and safely rejects a repeat request once already Production Complete', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `manual-complete-idem-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const { jobOrderId, version } = await toInProduction(graph);

    const first = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-replay')
      .send({ expectedVersion: version })
      .expect(200);
    const replay = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-replay')
      .send({ expectedVersion: version })
      .expect(200);
    expect(replay.body.data.status).toBe('PRODUCTION_COMPLETE');
    expect(replay.body.data.version).toBe(first.body.data.version);

    // A fresh request (new idempotency key) against the now-stale version is
    // safely rejected rather than silently repeating the transition.
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'manual-complete-again')
      .send({ expectedVersion: version })
      .expect(409);

    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'JobOrder',
          entityId: jobOrderId,
          action: 'JOB_ORDER_PRODUCTION_COMPLETED_MANUAL',
        },
      }),
    ).toBe(1);
  });

  it('concurrent qualifying requests do not produce inconsistent transitions', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `manual-complete-race-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const { jobOrderId, version } = await toInProduction(graph);

    const [one, two] = await Promise.all([
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
        .set('Authorization', `Bearer ${merchandiser.token}`)
        .set('Idempotency-Key', 'manual-complete-race-1')
        .send({ expectedVersion: version }),
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
        .set('Authorization', `Bearer ${merchandiser.token}`)
        .set('Idempotency-Key', 'manual-complete-race-2')
        .send({ expectedVersion: version }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'JobOrder',
          entityId: jobOrderId,
          action: 'JOB_ORDER_PRODUCTION_COMPLETED_MANUAL',
        },
      }),
    ).toBe(1);
  });
});

// Correction 4: a Job Order may be cancelled only until production actually
// starts. Once the first Production stage reaches IN_PROGRESS,
// startProductionStage moves the Job Order straight to IN_PRODUCTION in the
// same transaction — so "status is still DRAFT / SENT_TO_FACTORY /
// CONFIRMED_BY_FACTORY" and "production has not started" are the same fact.
describe('Job Order cancellation (Correction 4)', () => {
  async function createFactoryUserFor(graph: Awaited<ReturnType<typeof createSeedGraph>>) {
    const factoryUser = await createTestUserAndToken({
      email: `cancel-factory-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    return factoryUser;
  }

  async function sendAndConfirm(
    graph: Awaited<ReturnType<typeof createSeedGraph>>,
    factoryUser: { token: string },
    created: { body: { data: { id: string; version: number } } },
  ) {
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-send`)
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    return request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-confirm`)
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
  }

  async function toInProduction(graph: Awaited<ReturnType<typeof createSeedGraph>>) {
    const factoryUser = await createFactoryUserFor(graph);
    const created = await createJobOrder(graph.admin.token, graph, 10);
    const confirmed = await sendAndConfirm(graph, factoryUser, created);
    const stages = confirmed.body.data.stages;
    const started = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${created.body.data.id}-start-1`)
      .send({ stageStatusId: stages[0].id, expectedVersion: confirmed.body.data.version })
      .expect(200);
    return {
      jobOrderId: created.body.data.id as string,
      version: started.body.data.version as number,
      stages,
      factoryUser,
    };
  }

  it('cancels a DRAFT job order', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-draft')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('cancels a SENT_TO_FACTORY job order', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-sent-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-sent')
      .send({ expectedVersion: sent.body.data.version })
      .expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('cancels a CONFIRMED_BY_FACTORY job order before production starts, as Merchandiser, recording actor and timestamp in the audit trail', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `cancel-merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const factoryUser = await createFactoryUserFor(graph);
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const confirmed = await sendAndConfirm(graph, factoryUser, created);
    expect(confirmed.body.data.status).toBe('CONFIRMED_BY_FACTORY');

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'cancel-confirmed')
      .send({ expectedVersion: confirmed.body.data.version })
      .expect(200);
    expect(res.body.data.status).toBe('CANCELLED');

    const audit = await request(app)
      .get(`/job-orders/${created.body.data.id}/audit`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    const entry = audit.body.data.find(
      (item: { action: string }) => item.action === 'JOB_ORDER_CANCELLED',
    );
    expect(entry).toBeDefined();
    expect(entry.actor.id).toBe(merchandiser.userId);
    expect(entry.createdAt).toBeTruthy();
  });

  it('allows Admin as well as Merchandiser to cancel, and rejects every other role', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createFactoryUserFor(graph);
    const qaUser = await createTestUserAndToken({
      email: `cancel-qa-${createId()}@test.local`,
      password: 'pass',
      roles: ['QA_USER'],
    });
    const accountant = await createTestUserAndToken({
      email: `cancel-acct-${createId()}@test.local`,
      password: 'pass',
      roles: ['ACCOUNTANT'],
    });
    const distributor = await createTestUserAndToken({
      email: `cancel-dist-${createId()}@test.local`,
      password: 'pass',
      roles: ['DISTRIBUTOR'],
    });
    const seniorMgmt = await createTestUserAndToken({
      email: `cancel-sm-${createId()}@test.local`,
      password: 'pass',
      roles: ['SENIOR_MANAGEMENT'],
    });
    const created = await createJobOrder(graph.admin.token, graph, 5);

    for (const unauthorized of [factoryUser, qaUser, accountant, distributor, seniorMgmt]) {
      await request(app)
        .post(`/job-orders/${created.body.data.id}/actions/cancel`)
        .set('Authorization', `Bearer ${unauthorized.token}`)
        .set('Idempotency-Key', `cancel-denied-${unauthorized.userId}`)
        .send({ expectedVersion: created.body.data.version })
        .expect(403);
    }

    const res = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-admin-ok')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('forbids cancellation once the first Production stage has started (Cutting)', async () => {
    const graph = await createSeedGraph();
    const { jobOrderId, version } = await toInProduction(graph);
    const blocked = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-after-cutting')
      .send({ expectedVersion: version })
      .expect(409);
    expect(blocked.body.error.message).toContain('production has already started');

    const stillInProduction = await prisma.jobOrder.findUniqueOrThrow({ where: { id: jobOrderId } });
    expect(stillInProduction.status).toBe('IN_PRODUCTION');
  });

  it('forbids cancellation while a later production stage is active', async () => {
    const graph = await createSeedGraph();
    const { jobOrderId, version, stages, factoryUser } = await toInProduction(graph);
    const completedFirst = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-complete-1`)
      .send({ stageStatusId: stages[0].id, expectedVersion: version })
      .expect(200);
    const startedSecond = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-start-2`)
      .send({ stageStatusId: stages[1].id, expectedVersion: completedFirst.body.data.version })
      .expect(200);
    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-later-stage')
      .send({ expectedVersion: startedSecond.body.data.version })
      .expect(409);
  });

  it('forbids cancellation once PRODUCTION_COMPLETE (manual or automatic)', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `cancel-pc-merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const { jobOrderId, version, stages, factoryUser } = await toInProduction(graph);
    const completedFirst = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-complete-a`)
      .send({ stageStatusId: stages[0].id, expectedVersion: version })
      .expect(200);
    const startedSecond = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-start-2`)
      .send({ stageStatusId: stages[1].id, expectedVersion: completedFirst.body.data.version })
      .expect(200);
    const completedFinal = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', `${jobOrderId}-complete-b`)
      .send({ stageStatusId: stages[1].id, expectedVersion: startedSecond.body.data.version })
      .expect(200);
    // Finishing stage completion alone does not automatically complete
    // production (Correction 3) — use the manual action to deliberately
    // reach PRODUCTION_COMPLETE for this test.
    expect(completedFinal.body.data.status).toBe('IN_PRODUCTION');
    const manuallyComplete = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'cancel-pc-mark')
      .send({ expectedVersion: completedFinal.body.data.version })
      .expect(200);
    expect(manuallyComplete.body.data.status).toBe('PRODUCTION_COMPLETE');

    await request(app)
      .post(`/job-orders/${jobOrderId}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-after-pc')
      .send({ expectedVersion: manuallyComplete.body.data.version })
      .expect(409);
  });

  it('replays a repeated cancellation idempotently and safely rejects a fresh attempt once already cancelled', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const first = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-replay')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const replay = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-replay')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    expect(replay.body.data.version).toBe(first.body.data.version);
    expect(replay.body.data.status).toBe('CANCELLED');

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-again-fresh-key')
      .send({ expectedVersion: created.body.data.version })
      .expect(409);

    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'JobOrder',
          entityId: created.body.data.id,
          action: 'JOB_ORDER_CANCELLED',
        },
      }),
    ).toBe(1);
  });

  it('prevents Factory confirmation, starting a production stage, and manual Production Complete on a cancelled job order', async () => {
    const graph = await createSeedGraph();
    const merchandiser = await createTestUserAndToken({
      email: `cancel-post-merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const factoryUser = await createFactoryUserFor(graph);
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'post-cancel-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const cancelled = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'post-cancel-cancel')
      .send({ expectedVersion: sent.body.data.version })
      .expect(200);

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'post-cancel-confirm')
      .send({
        expectedVersion: cancelled.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(400);

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/mark-production-complete`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .set('Idempotency-Key', 'post-cancel-mark-complete')
      .send({ expectedVersion: cancelled.body.data.version })
      .expect(409);

    const detail = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('CANCELLED');
  });

  it('prevents starting a production stage on a job order cancelled while it was CONFIRMED_BY_FACTORY', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createFactoryUserFor(graph);
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const confirmed = await sendAndConfirm(graph, factoryUser, created);
    const cancelled = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-before-stage')
      .send({ expectedVersion: confirmed.body.data.version })
      .expect(200);

    const stages = confirmed.body.data.stages;
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'cancel-blocked-start-stage')
      .send({ stageStatusId: stages[0].id, expectedVersion: cancelled.body.data.version })
      .expect(400);
  });

  it('preserves the source Order Sheet mapping and lock after cancellation — it does not become available for another Job Order', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const before = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(before.jobOrderId).toBe(created.body.data.id);

    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'cancel-preserve-mapping')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);

    const after = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: graph.poId },
    });
    expect(after.jobOrderId).toBe(created.body.data.id);

    // Attempting to create ANOTHER job order against the same (now
    // cancelled-parent's) Order Sheet still fails — the mapping was never
    // released by cancellation.
    const secondAttempt = await createJobOrder(graph.admin.token, graph, 3);
    expect(secondAttempt.status).toBe(400);
    expect(secondAttempt.body.error.message).toContain('already linked to a Job Order');

    const detail = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('CANCELLED');
    expect(detail.body.data.sourceOrderSheetCount).toBe(1);
  });

  it('a race between starting production and cancelling cannot leave a Job Order cancelled after production actually started', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createFactoryUserFor(graph);
    const merchandiser = await createTestUserAndToken({
      email: `cancel-race-merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const created = await createJobOrder(graph.admin.token, graph, 5);
    const confirmed = await sendAndConfirm(graph, factoryUser, created);
    const stages = confirmed.body.data.stages;

    const [startRes, cancelRes] = await Promise.all([
      request(app)
        .post(`/job-orders/${created.body.data.id}/actions/start-stage`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .set('Idempotency-Key', 'race-start')
        .send({ stageStatusId: stages[0].id, expectedVersion: confirmed.body.data.version }),
      request(app)
        .post(`/job-orders/${created.body.data.id}/actions/cancel`)
        .set('Authorization', `Bearer ${merchandiser.token}`)
        .set('Idempotency-Key', 'race-cancel')
        .send({ expectedVersion: confirmed.body.data.version }),
    ]);
    expect([startRes.status, cancelRes.status].sort()).toEqual([200, 409]);

    const final = await prisma.jobOrder.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { stageStatuses: true },
    });
    if (startRes.status === 200) {
      expect(final.status).toBe('IN_PRODUCTION');
      expect(final.stageStatuses.some((stage) => stage.status === 'IN_PROGRESS')).toBe(true);
    } else {
      expect(final.status).toBe('CANCELLED');
      expect(final.stageStatuses.every((stage) => stage.status === 'NOT_STARTED')).toBe(true);
    }
  });
});

describe('multi-source Order Sheet job orders (Order Sheet Phase 2)', () => {
  it('creates a job order from multiple Order Sheets sharing one Style (different Distributors and Purchase Modes) and sums the combined forecast per size', async () => {
    const graph = await createSeedGraph();
    const saleReturnDistributor = await createTestDistributor({ purchaseMode: 'SALE_RETURN' });
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
      { sizeId: graph.sizeBId, orderedQuantity: 5 },
    ]);
    const sheetB = await createOrderSheet(
      graph.admin.token,
      graph,
      [{ sizeId: graph.sizeAId, orderedQuantity: 20 }],
      { distributorId: saleReturnDistributor.id },
    );
    const sheetC = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeBId, orderedQuantity: 8 },
    ]);

    const res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id, sheetB.id, sheetC.id],
        // The Job Order's OWN production plan (Phase 2.1) — one flat entry
        // per size, entirely independent of any source's own forecast/
        // quantity. Deliberately NOT the sum of any source's numbers.
        sizes: [
          { sizeId: graph.sizeAId, quantity: 18 },
          { sizeId: graph.sizeBId, quantity: 7 },
        ],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '199.50',
        disclaimerText: 'Factory commercial terms apply.',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sourceOrderSheetCount).toBe(3);
    // Exactly ONE production line for the whole Job Order, never one per
    // source Order Sheet (Phase 2.1).
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].sizes).toHaveLength(2);
    expect(res.body.data.orderedQuantityTotal).toBe(18 + 7);

    const sourceIds = res.body.data.sourceOrderSheets
      .map((source: { id: string }) => source.id)
      .sort();
    expect(sourceIds).toEqual([sheetA.id, sheetB.id, sheetC.id].sort());
    const sheetBView = res.body.data.sourceOrderSheets.find(
      (source: { id: string }) => source.id === sheetB.id,
    );
    expect(sheetBView.purchaseMode).toBe('SALE_RETURN');
    expect(sheetBView.distributor.id).toBe(saleReturnDistributor.id);
    const sheetAView = res.body.data.sourceOrderSheets.find(
      (source: { id: string }) => source.id === sheetA.id,
    );
    expect(sheetAView.purchaseMode).toBe('OUTRIGHT');

    // Combined forecast sums each Order Sheet's OWN forecast (not the Job
    // Order's own production quantities) per size across all sources.
    const forecastBySize = Object.fromEntries(
      res.body.data.combinedForecast.map((entry: { sizeId: string; forecastQuantity: number }) => [
        entry.sizeId,
        entry.forecastQuantity,
      ]),
    );
    expect(forecastBySize[graph.sizeAId]).toBe(10 + 20); // sheetA + sheetB
    expect(forecastBySize[graph.sizeBId]).toBe(5 + 8); // sheetA + sheetC

    for (const sheet of [sheetA, sheetB, sheetC]) {
      const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
        where: { id: sheet.id },
      });
      expect(po.jobOrderId).toBe(res.body.data.id);
    }
  });

  it('rejects Order Sheets with different Styles', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const otherFinancialYear = await createTestFinancialYear(new Date('2026-06-30'));
    const otherSeason = await prisma.season.create({
      data: {
        id: createId(),
        code: `OTHER-SEASON-${createId()}`,
        name: 'Other Style Season',
        financialYearId: otherFinancialYear.id,
      },
    });
    const otherStyle = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `ST-OTHER-${createId()}`,
        styleName: 'Other Style',
        finalMrp: 500,
        styleSeasons: { create: { seasonId: otherSeason.id } },
      },
    });
    const otherSize = await prisma.size.create({
      data: { id: createId(), code: `OTHER_SZ_${createId()}`, label: 'OS', sizeType: 'ALPHA', sortOrder: 1 },
    });
    await prisma.styleSize.create({
      data: { id: createId(), styleId: otherStyle.id, sizeId: otherSize.id },
    });
    const sheetB = await createOrderSheet(graph.admin.token, { style: otherStyle }, [
      { sizeId: otherSize.id, orderedQuantity: 10 },
    ]);

    const res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id, sheetB.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 5 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      });
    expect(res.status).toBe(400);
    expect(await prisma.jobOrder.count()).toBe(0);
  });

  it('rejects duplicate Order Sheet ids within one request', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const res = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id, sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 3 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      });
    expect(res.status).toBe(400);
  });

  it('rejects an already-mapped or cancelled Order Sheet among the selected sources', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetB = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);

    await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 2 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      })
      .expect(201);

    const mappedAttempt = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 1 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      });
    expect(mappedAttempt.status).toBe(400);

    await prisma.distributorPurchaseOrder.update({
      where: { id: sheetB.id },
      data: { status: 'CANCELLED' },
    });
    const cancelledAttempt = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetB.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 1 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      });
    expect(cancelledAttempt.status).toBe(400);
  });

  it('atomically claims all selected Order Sheets; a losing concurrent request leaves its non-conflicting Order Sheet unclaimed', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetB = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetC = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);

    const requestPayload = (orderSheetIds: string[]) => ({
      orderSheetIds,
      sizes: [{ sizeId: graph.sizeAId, quantity: 2 }],
      factoryId: graph.factory.id,
      processFlowVersionId: graph.processFlowVersionId,
      unitPrice: '100',
    });

    const [first, second] = await Promise.all([
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send(requestPayload([sheetA.id, sheetB.id])),
      request(app)
        .post('/job-orders')
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .send(requestPayload([sheetB.id, sheetC.id])),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    expect(loser.status).toBe(409);

    const winnerSourceIds: string[] = winner.body.data.sourceOrderSheets.map(
      (source: { id: string }) => source.id,
    );
    for (const id of winnerSourceIds) {
      const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id } });
      expect(po.jobOrderId).toBe(winner.body.data.id);
    }

    // The loser's OTHER (non-conflicting) Order Sheet — the one the winner
    // never touched — rolled all the way back with the rest of the loser's
    // transaction: still fully unclaimed and available, not partially mapped.
    const loserOnlyId = winnerSourceIds.includes(sheetA.id) ? sheetC.id : sheetA.id;
    const loserOnly = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: loserOnlyId },
    });
    expect(loserOnly.jobOrderId).toBeNull();
  });

  it('updateDraftJobOrderSources: adding a source changes the Combined Forecast but never the Production Plan (§8/§9)', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetB = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 15 },
    ]);

    const created = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 4 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      })
      .expect(201);
    expect(created.body.data.lines).toHaveLength(1);
    const originalLineId = created.body.data.lines[0].id;

    const updated = await request(app)
      .patch(`/job-orders/${created.body.data.id}/sources`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'add-source-1')
      .send({
        expectedVersion: created.body.data.version,
        add: [sheetB.id],
        remove: [],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.sourceOrderSheetCount).toBe(2);
    // Still exactly the SAME single production line — adding a source never
    // creates another one, and its quantity is completely untouched.
    expect(updated.body.data.lines).toHaveLength(1);
    expect(updated.body.data.lines[0].id).toBe(originalLineId);
    expect(updated.body.data.orderedQuantityTotal).toBe(4);
    // Combined Forecast DOES change (now reflects both sources) — it is
    // purely informational and independent of the Production Plan.
    const forecastA = updated.body.data.combinedForecast.find(
      (entry: { sizeId: string }) => entry.sizeId === graph.sizeAId,
    );
    expect(forecastA.forecastQuantity).toBe(10 + 15);

    const poB = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: sheetB.id },
    });
    expect(poB.jobOrderId).toBe(created.body.data.id);
  });

  it('updateDraftJobOrderSources: removing a source releases its Order Sheet but never changes the Production Plan (§8/§9)', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetB = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 15 },
    ]);

    const created = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id, sheetB.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 10 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      })
      .expect(201);

    const updated = await request(app)
      .patch(`/job-orders/${created.body.data.id}/sources`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'remove-source-1')
      .send({ expectedVersion: created.body.data.version, add: [], remove: [sheetB.id] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.sourceOrderSheetCount).toBe(1);
    expect(updated.body.data.lines).toHaveLength(1);
    // The Production Plan quantity (10) is NOT reduced just because a
    // source with its own smaller forecast (well, larger here) was removed.
    expect(updated.body.data.orderedQuantityTotal).toBe(10);

    const releasedPo = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: sheetB.id },
    });
    expect(releasedPo.jobOrderId).toBeNull();

    const reused = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetB.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 3 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      });
    expect(reused.status).toBe(201);
  });

  it('updateDraftJobOrderSources: rejects removing the last remaining source Order Sheet', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const created = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 4 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      })
      .expect(201);

    const res = await request(app)
      .patch(`/job-orders/${created.body.data.id}/sources`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'remove-last-1')
      .send({ expectedVersion: created.body.data.version, add: [], remove: [sheetA.id] });
    expect(res.status).toBe(400);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: sheetA.id } });
    expect(po.jobOrderId).toBe(created.body.data.id);
  });

  it('updateDraftJobOrderSources: rejects adding an Order Sheet of a different Style', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const otherFinancialYear = await createTestFinancialYear(new Date('2026-06-30'));
    const otherSeason = await prisma.season.create({
      data: {
        id: createId(),
        code: `OTHER-SEASON2-${createId()}`,
        name: 'Other Style 2 Season',
        financialYearId: otherFinancialYear.id,
      },
    });
    const otherStyle = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `ST-OTHER2-${createId()}`,
        styleName: 'Other Style 2',
        finalMrp: 500,
        styleSeasons: { create: { seasonId: otherSeason.id } },
      },
    });
    const otherSize = await prisma.size.create({
      data: {
        id: createId(),
        code: `OTHER_SZ2_${createId()}`,
        label: 'OS2',
        sizeType: 'ALPHA',
        sortOrder: 1,
      },
    });
    await prisma.styleSize.create({
      data: { id: createId(), styleId: otherStyle.id, sizeId: otherSize.id },
    });
    const otherSheet = await createOrderSheet(graph.admin.token, { style: otherStyle }, [
      { sizeId: otherSize.id, orderedQuantity: 10 },
    ]);

    const created = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 4 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
      })
      .expect(201);

    const res = await request(app)
      .patch(`/job-orders/${created.body.data.id}/sources`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'add-wrong-style-1')
      .send({
        expectedVersion: created.body.data.version,
        add: [otherSheet.id],
        remove: [],
      });
    expect(res.status).toBe(400);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: otherSheet.id },
    });
    expect(po.jobOrderId).toBeNull();
  });

  it('updateDraftJobOrderSources: freezes the mapping once the Job Order is sent to factory', async () => {
    const graph = await createSeedGraph();
    const sheetA = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const sheetB = await createOrderSheet(graph.admin.token, graph, [
      { sizeId: graph.sizeAId, orderedQuantity: 10 },
    ]);
    const created = await request(app)
      .post('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .send({
        orderSheetIds: [sheetA.id],
        sizes: [{ sizeId: graph.sizeAId, quantity: 4 }],
        factoryId: graph.factory.id,
        processFlowVersionId: graph.processFlowVersionId,
        unitPrice: '100',
        disclaimerText: 'Factory commercial terms apply.',
      })
      .expect(201);
    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'freeze-send-1')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);

    const res = await request(app)
      .patch(`/job-orders/${created.body.data.id}/sources`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'freeze-add-1')
      .send({
        expectedVersion: sent.body.data.version,
        add: [sheetB.id],
        remove: [],
      });
    expect(res.status).toBe(409);

    const unchanged = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(unchanged.body.data.sourceOrderSheetCount).toBe(1);
    const poB = await prisma.distributorPurchaseOrder.findUniqueOrThrow({
      where: { id: sheetB.id },
    });
    expect(poB.jobOrderId).toBeNull();
  });

  it('updateJobOrderDeliveryDate: editable pre-confirmation, locked (409) once the factory confirms', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createTestUserAndToken({
      email: 'delivery-date-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });

    const created = await createJobOrder(graph.admin.token, graph, 4);
    expect(created.body.data.deliveryDateLocked).toBe(false);

    const updated = await request(app)
      .patch(`/job-orders/${created.body.data.id}/delivery-date`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'delivery-date-1')
      .send({ expectedVersion: created.body.data.version, requiredDeliveryDate: '2026-08-15' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.requiredDeliveryDate).toContain('2026-08-15');

    const sent = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'delivery-date-send')
      .send({ expectedVersion: updated.body.data.version })
      .expect(200);
    const confirmed = await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .set('Idempotency-Key', 'delivery-date-confirm')
      .send({
        expectedVersion: sent.body.data.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    expect(confirmed.body.data.deliveryDateLocked).toBe(true);

    const lockedAttempt = await request(app)
      .patch(`/job-orders/${created.body.data.id}/delivery-date`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'delivery-date-2')
      .send({ expectedVersion: confirmed.body.data.version, requiredDeliveryDate: '2026-09-01' });
    expect(lockedAttempt.status).toBe(409);

    const unchanged = await prisma.jobOrder.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(unchanged.requiredDeliveryDate?.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('hides source Order Sheet provenance from Factory/QA viewers but shows it to Admin/Merchandiser, in both detail and list', async () => {
    const graph = await createSeedGraph();
    const factoryUser = await createTestUserAndToken({
      email: 'visibility-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryUser.userId, factoryId: graph.factory.id },
    });
    const qaUser = await createTestUserAndToken({
      email: 'visibility-qa@test.local',
      password: 'pass',
      roles: ['QA_USER'],
    });

    const created = await createJobOrder(graph.admin.token, graph, 4);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', 'visibility-send')
      .send({ expectedVersion: created.body.data.version })
      .expect(200);

    const adminDetail = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(adminDetail.body.data.sourceOrderSheets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: graph.poId })]),
    );
    expect(adminDetail.body.data.combinedForecast).toBeDefined();

    const factoryDetail = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(factoryDetail.body.data.sourceOrderSheets).toBeUndefined();
    expect(factoryDetail.body.data.combinedForecast).toBeUndefined();
    expect(JSON.stringify(factoryDetail.body.data)).not.toContain('distributor');
    expect(JSON.stringify(factoryDetail.body.data)).not.toContain('poNumber');
    expect(JSON.stringify(factoryDetail.body.data)).not.toContain('jobOrderedQuantity');

    const qaDetail = await request(app)
      .get(`/job-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${qaUser.token}`)
      .expect(200);
    expect(qaDetail.body.data.sourceOrderSheets).toBeUndefined();
    expect(qaDetail.body.data.combinedForecast).toBeUndefined();

    const assignedTasks = await request(app)
      .get('/job-orders/assigned-tasks')
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    expect(assignedTasks.body.data.items.length).toBeGreaterThan(0);
    expect(assignedTasks.body.data.items[0]).not.toHaveProperty('distributor');
    expect(assignedTasks.body.data.items[0]).not.toHaveProperty('purchaseOrderNumber');
    expect(JSON.stringify(assignedTasks.body.data)).not.toContain('poNumber');

    const adminList = await request(app)
      .get('/job-orders')
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    const adminListed = adminList.body.data.items.find(
      (item: { id: string }) => item.id === created.body.data.id,
    );
    expect(adminListed.sourceOrderSheets).toBeDefined();

    const factoryList = await request(app)
      .get('/job-orders')
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .expect(200);
    const factoryListed = factoryList.body.data.items.find(
      (item: { id: string }) => item.id === created.body.data.id,
    );
    expect(factoryListed.sourceOrderSheets).toBeUndefined();
  });

  it('never exposes the removed jobOrderedQuantity field anywhere in Job Order or Order Sheet responses', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('jobOrderedQuantity');

    const poDetail = await request(app)
      .get(`/purchase-orders/${graph.poId}`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .expect(200);
    expect(JSON.stringify(poDetail.body)).not.toContain('jobOrderedQuantity');
  });
});

describe('Job Order Production Plan (Order Sheet Phase 2.1)', () => {
  function updatePlan(
    token: string,
    id: string,
    body: { expectedVersion: number; sizes: Array<{ sizeId: string; quantity: number }> },
  ) {
    return request(app)
      .patch(`/job-orders/${id}/production-plan`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', createId())
      .send(body);
  }

  it('replaces the production plan and records a before/after audit entry', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);
    expect(created.body.data.lines[0].orderedQuantityTotal).toBe(4);

    const updated = await updatePlan(graph.admin.token, created.body.data.id, {
      expectedVersion: created.body.data.version,
      sizes: [
        { sizeId: graph.sizeAId, quantity: 6 },
        { sizeId: graph.sizeBId, quantity: 3 },
      ],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.lines).toHaveLength(1);
    expect(updated.body.data.orderedQuantityTotal).toBe(9);
    const sizeA = updated.body.data.lines[0].sizes.find((s: { sizeId: string }) => s.sizeId === graph.sizeAId);
    expect(sizeA.orderedQuantity).toBe(6);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'JOB_ORDER_PRODUCTION_PLAN_UPDATED', entityId: created.body.data.id },
    });
    expect(audit.metadata).toMatchObject({
      before: [{ sizeId: graph.sizeAId, quantity: 4 }],
      after: expect.arrayContaining([
        { sizeId: graph.sizeAId, sizeCode: 'AGE_3', quantity: 6 },
        { sizeId: graph.sizeBId, sizeCode: 'AGE_4', quantity: 3 },
      ]),
    });
  });

  it('rejects a production-plan update once the job order leaves DRAFT', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);
    await request(app)
      .post(`/job-orders/${created.body.data.id}/actions/send-to-factory`)
      .set('Authorization', `Bearer ${graph.admin.token}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: created.body.data.version })
      .expect(200);

    const res = await updatePlan(graph.admin.token, created.body.data.id, {
      expectedVersion: created.body.data.version + 1,
      sizes: [{ sizeId: graph.sizeAId, quantity: 9 }],
    });
    expect(res.status).toBe(409);
  });

  it('rejects duplicate sizeIds, an empty plan, and an all-zero plan', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);

    await expect(
      updatePlan(graph.admin.token, created.body.data.id, {
        expectedVersion: created.body.data.version,
        sizes: [
          { sizeId: graph.sizeAId, quantity: 1 },
          { sizeId: graph.sizeAId, quantity: 2 },
        ],
      }),
    ).resolves.toMatchObject({ status: 400 });

    await expect(
      request(app)
        .patch(`/job-orders/${created.body.data.id}/production-plan`)
        .set('Authorization', `Bearer ${graph.admin.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: created.body.data.version, sizes: [] }),
    ).resolves.toMatchObject({ status: 400 });

    await expect(
      updatePlan(graph.admin.token, created.body.data.id, {
        expectedVersion: created.body.data.version,
        sizes: [{ sizeId: graph.sizeAId, quantity: 0 }],
      }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it('rejects a sizeId whose underlying Size is globally inactive', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);
    const inactiveSize = await prisma.size.create({
      data: { id: createId(), code: `INACTIVE-${createId()}`, label: 'Inactive', sizeType: 'AGE', sortOrder: 9 },
    });
    await prisma.styleSize.create({
      data: { id: createId(), styleId: graph.style.id, sizeId: inactiveSize.id },
    });
    await prisma.size.update({ where: { id: inactiveSize.id }, data: { status: 'INACTIVE' } });

    const res = await updatePlan(graph.admin.token, created.body.data.id, {
      expectedVersion: created.body.data.version,
      sizes: [
        { sizeId: graph.sizeAId, quantity: 4 },
        { sizeId: inactiveSize.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a sizeId whose StyleSize mapping is inactive', async () => {
    const graph = await createSeedGraph();
    const created = await createJobOrder(graph.admin.token, graph, 4);
    const newSize = await prisma.size.create({
      data: { id: createId(), code: `MAPPED-${createId()}`, label: 'Mapped', sizeType: 'AGE', sortOrder: 9 },
    });
    await prisma.styleSize.create({
      data: { id: createId(), styleId: graph.style.id, sizeId: newSize.id, status: 'INACTIVE' },
    });

    const res = await updatePlan(graph.admin.token, created.body.data.id, {
      expectedVersion: created.body.data.version,
      sizes: [
        { sizeId: graph.sizeAId, quantity: 4 },
        { sizeId: newSize.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it.each(['hard-deleted', 'status INACTIVE'] as const)(
    'preserves an existing production-plan size once its StyleSize mapping becomes invalid (%s), accepts a same-quantity resubmission, and rejects a different quantity',
    async (mode) => {
      const graph = await createSeedGraph();
      const created = await createJobOrder(graph.admin.token, graph, 4);
      const plan = await updatePlan(graph.admin.token, created.body.data.id, {
        expectedVersion: created.body.data.version,
        sizes: [
          { sizeId: graph.sizeAId, quantity: 4 },
          { sizeId: graph.sizeBId, quantity: 5 },
        ],
      }).then((res) => {
        expect(res.status).toBe(200);
        return res.body.data;
      });

      const styleSizeB = await prisma.styleSize.findFirstOrThrow({
        where: { styleId: graph.style.id, sizeId: graph.sizeBId },
      });
      if (mode === 'hard-deleted') {
        await prisma.styleSize.delete({ where: { id: styleSizeB.id } });
      } else {
        await prisma.styleSize.update({ where: { id: styleSizeB.id }, data: { status: 'INACTIVE' } });
      }

      // Omitted entirely — preserved unchanged, not dropped.
      const omitted = await updatePlan(graph.admin.token, plan.id, {
        expectedVersion: plan.version,
        sizes: [{ sizeId: graph.sizeAId, quantity: 6 }],
      });
      expect(omitted.status).toBe(200);
      const sizeBAfterOmit = omitted.body.data.lines[0].sizes.find(
        (s: { sizeId: string }) => s.sizeId === graph.sizeBId,
      );
      expect(sizeBAfterOmit.orderedQuantity).toBe(5);

      // Resubmitted with the SAME quantity — accepted as a no-op.
      const sameQuantity = await updatePlan(graph.admin.token, plan.id, {
        expectedVersion: omitted.body.data.version,
        sizes: [
          { sizeId: graph.sizeAId, quantity: 6 },
          { sizeId: graph.sizeBId, quantity: 5 },
        ],
      });
      expect(sameQuantity.status).toBe(200);

      // Resubmitted with a DIFFERENT quantity — rejected, never silently
      // applied.
      const differentQuantity = await updatePlan(graph.admin.token, plan.id, {
        expectedVersion: sameQuantity.body.data.version,
        sizes: [
          { sizeId: graph.sizeAId, quantity: 6 },
          { sizeId: graph.sizeBId, quantity: 8 },
        ],
      });
      expect(differentQuantity.status).toBe(400);
    },
  );
});
