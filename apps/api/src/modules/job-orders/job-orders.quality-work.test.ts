import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
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

// A minimal graph reused by every case below: one Factory, one Style/Size,
// one Process Flow with exactly Cutting (production) -> Finishing
// (production) -> Final Inspection (quality, WHILE_ASSOCIATED_ACTIVITY_ACTIVE
// on Finishing, batched/PREPARED_QUANTITY — an isProcessFlowFinalActivity
// match) so a Job Order's Final Inspection becomes AVAILABLE the moment
// Finishing starts, without needing any quality-execution/batching fixture.
async function createGraph() {
  const admin = await createTestUserAndToken({
    email: `admin-${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const factory = await createTestFactory();
  const otherFactory = await createTestFactory({ code: `OTHER-${createId()}`, name: 'Other Factory' });
  const factoryUser = await createTestUserAndToken({
    email: `factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  await prisma.userFactory.create({
    data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id },
  });
  const otherFactoryUser = await createTestUserAndToken({
    email: `other-factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  await prisma.userFactory.create({
    data: { id: createId(), userId: otherFactoryUser.userId, factoryId: otherFactory.id },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `SZ-${createId()}`, label: 'One Size', sizeType: 'AGE', sortOrder: 1 },
  });
  const financialYear = await createTestFinancialYear(new Date('2026-06-30'));
  const season = await prisma.season.create({
    data: { id: createId(), code: `QW-${createId()}`, name: 'QW Season', financialYearId: financialYear.id },
  });
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-${createId()}`,
      styleName: 'QW Style',
      finalMrp: 500,
      seasonId: season.id,
    },
  });
  await prisma.styleSize.create({ data: { id: createId(), styleId: style.id, sizeId: size.id } });
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
      code: `QW_FLOW_${createId()}`,
      name: 'QW Flow',
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
  return {
    admin,
    factory,
    otherFactory,
    factoryUserToken: factoryUser.token,
    otherFactoryUserToken: otherFactoryUser.token,
    style,
    size,
    processFlowVersionId: processFlow.versions[0]!.id,
  };
}

async function createOrderSheet(
  adminToken: string,
  graph: Awaited<ReturnType<typeof createGraph>>,
  quantity: number,
) {
  const distributor = await createTestDistributor({ code: `DIST-${createId()}` });
  const res = await request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      distributorId: distributor.id,
      poDate: '2026-06-30',
      lines: [{ styleId: graph.style.id, sizes: [{ sizeId: graph.size.id, orderedQuantity: quantity }] }],
    });
  return res.body.data.id as string;
}

// Creates a Job Order and drives it through send-to-factory + confirm, so it
// satisfies the quality-work candidate predicate (factoryConfirmationStatus
// CONFIRMED, recordOrigin LIVE_WORKFLOW, an ACTIVE QUALITY stage). Does NOT
// start any production stage, so its Final Inspection stays NOT_AVAILABLE
// and contributes nothing to the queue — a cheap "candidate that yields no
// work" filler, exactly the majority case a real queue scans past.
async function createConfirmedJobOrder(
  graph: Awaited<ReturnType<typeof createGraph>>,
  quantity: number,
  factoryId: string = graph.factory.id,
) {
  const orderSheetId = await createOrderSheet(graph.admin.token, graph, quantity);
  const created = await request(app)
    .post('/job-orders')
    .set('Authorization', `Bearer ${graph.admin.token}`)
    .send({
      orderSheetIds: [orderSheetId],
      sizes: [{ sizeId: graph.size.id, quantity }],
      factoryId,
      processFlowVersionId: graph.processFlowVersionId,
      unitPrice: '100.00',
      disclaimerText: 'Factory commercial terms apply.',
    });
  const jobOrderId = created.body.data.id as string;
  const factoryUserToken =
    factoryId === graph.otherFactory.id ? graph.otherFactoryUserToken : graph.factoryUserToken;
  const sent = await request(app)
    .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
    .set('Authorization', `Bearer ${graph.admin.token}`)
    .set('Idempotency-Key', `send-${jobOrderId}`)
    .send({ expectedVersion: created.body.data.version });
  await request(app)
    .post(`/job-orders/${jobOrderId}/actions/confirm`)
    .set('Authorization', `Bearer ${factoryUserToken}`)
    .set('Idempotency-Key', `confirm-${jobOrderId}`)
    .send({
      expectedVersion: sent.body.data.version,
      expectedDisclaimerRevision: 1,
      acknowledgeDisclaimer: true,
    });
  return { jobOrderId };
}

// Same as above, but additionally starts Cutting -> completes Cutting ->
// starts Finishing, so Final Inspection becomes AVAILABLE (a real,
// actionable quality-work item).
async function createJobOrderWithAvailableQualityWork(
  graph: Awaited<ReturnType<typeof createGraph>>,
  quantity: number,
  factoryId: string = graph.factory.id,
) {
  const { jobOrderId } = await createConfirmedJobOrder(graph, quantity, factoryId);
  const factoryUserToken =
    factoryId === graph.otherFactory.id ? graph.otherFactoryUserToken : graph.factoryUserToken;
  const detail = await request(app)
    .get(`/job-orders/${jobOrderId}`)
    .set('Authorization', `Bearer ${graph.admin.token}`);
  const stages = detail.body.data.stages as Array<{ id: string; stageSequence: number }>;
  const cutting = stages.find((stage) => stage.stageSequence === 1)!;
  const finishing = stages.find((stage) => stage.stageSequence === 2)!;
  const started = await request(app)
    .post(`/job-orders/${jobOrderId}/actions/start-stage`)
    .set('Authorization', `Bearer ${factoryUserToken}`)
    .set('Idempotency-Key', `start-cutting-${jobOrderId}`)
    .send({ expectedVersion: detail.body.data.version, stageStatusId: cutting.id });
  const completed = await request(app)
    .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
    .set('Authorization', `Bearer ${factoryUserToken}`)
    .set('Idempotency-Key', `complete-cutting-${jobOrderId}`)
    .send({ expectedVersion: started.body.data.version, stageStatusId: cutting.id });
  await request(app)
    .post(`/job-orders/${jobOrderId}/actions/start-stage`)
    .set('Authorization', `Bearer ${factoryUserToken}`)
    .set('Idempotency-Key', `start-finishing-${jobOrderId}`)
    .send({ expectedVersion: completed.body.data.version, stageStatusId: finishing.id });
  return { jobOrderId };
}

function qaToken(roles: Array<'ADMIN' | 'QA_USER'>) {
  return createTestUserAndToken({ email: `qa-${createId()}@test.local`, password: 'pass', roles });
}

describe('GET /job-orders/quality-work (QW1 pagination)', () => {
  it('pages through every eligible activity with a stable cursor and no duplicates or omissions', async () => {
    const graph = await createGraph();
    const { jobOrderId: id1 } = await createJobOrderWithAvailableQualityWork(graph, 4);
    const { jobOrderId: id2 } = await createJobOrderWithAvailableQualityWork(graph, 4);
    const { jobOrderId: id3 } = await createJobOrderWithAvailableQualityWork(graph, 4);
    const qa = await qaToken(['QA_USER']);

    const page1 = await request(app)
      .get('/job-orders/quality-work')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.pageInfo.hasMore).toBe(true);
    expect(page1.body.data.pageInfo.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get('/job-orders/quality-work')
      .query({ limit: 2, cursor: page1.body.data.pageInfo.nextCursor })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.pageInfo.hasMore).toBe(false);
    expect(page2.body.data.pageInfo.nextCursor).toBeNull();

    const allIds = [...page1.body.data.items, ...page2.body.data.items].map(
      (item: { jobOrderId: string }) => item.jobOrderId,
    );
    expect(new Set(allIds)).toEqual(new Set([id1, id2, id3]));
  }, 60000);

  it('filters by status, factory and search server-side', async () => {
    const graph = await createGraph();
    const { jobOrderId: availableId } = await createJobOrderWithAvailableQualityWork(graph, 4);
    // A confirmed-but-not-started Job Order is a candidate that yields no
    // queue rows at all (Final Inspection stays NOT_AVAILABLE) — it must
    // never appear regardless of filter.
    await createConfirmedJobOrder(graph, 4);
    const { jobOrderId: otherFactoryId } = await createJobOrderWithAvailableQualityWork(
      graph,
      4,
      graph.otherFactory.id,
    );
    const qa = await qaToken(['QA_USER']);

    const byStatus = await request(app)
      .get('/job-orders/quality-work')
      .query({ status: 'AVAILABLE', limit: 50 })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    const statusIds = byStatus.body.data.items.map((item: { jobOrderId: string }) => item.jobOrderId);
    expect(statusIds.sort()).toEqual([availableId, otherFactoryId].sort());

    const byFactory = await request(app)
      .get('/job-orders/quality-work')
      .query({ factoryId: graph.factory.id, limit: 50 })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    expect(
      byFactory.body.data.items.map((item: { jobOrderId: string }) => item.jobOrderId),
    ).toEqual([availableId]);

    const jobOrderNumber = (
      await request(app)
        .get(`/job-orders/${availableId}`)
        .set('Authorization', `Bearer ${graph.admin.token}`)
    ).body.data.jobOrderNumber as string;
    const bySearch = await request(app)
      .get('/job-orders/quality-work')
      .query({ search: jobOrderNumber, limit: 50 })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    expect(
      bySearch.body.data.items.map((item: { jobOrderId: string }) => item.jobOrderId),
    ).toEqual([availableId]);
  }, 60000);

  it('rejects a non-QA-operations role', async () => {
    const graph = await createGraph();
    await request(app)
      .get('/job-orders/quality-work')
      .set('Authorization', `Bearer ${graph.factoryUserToken}`)
      .expect(403);
  });

  it('rejects an invalid cursor', async () => {
    const qa = await qaToken(['QA_USER']);
    await request(app)
      .get('/job-orders/quality-work')
      .query({ cursor: 'not-a-real-cursor' })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(400);
  });
});

describe('GET /job-orders/quality-work/summary (QW1 summary parity)', () => {
  it('derives factual status counts through the same evaluation path as the list, with no synthetic pending bucket', async () => {
    const graph = await createGraph();
    await createJobOrderWithAvailableQualityWork(graph, 4);
    await createJobOrderWithAvailableQualityWork(graph, 4);
    await createConfirmedJobOrder(graph, 4);
    const qa = await qaToken(['QA_USER']);

    const summary = await request(app)
      .get('/job-orders/quality-work/summary')
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);
    const list = await request(app)
      .get('/job-orders/quality-work')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${qa.token}`)
      .expect(200);

    expect(summary.body.data).not.toHaveProperty('pending');
    expect(summary.body.data.byStatus).not.toHaveProperty('NOT_AVAILABLE');
    expect(summary.body.data.byStatus.AVAILABLE).toBe(2);
    expect(
      list.body.data.items.filter((item: { activity: { status: string } }) => item.activity.status === 'AVAILABLE')
        .length,
    ).toBe(summary.body.data.byStatus.AVAILABLE);
    expect(summary.body.data.reconciliationConflict).toBe(0);
  }, 60000);
});

describe('QW1 regression: an eligible item beyond the old top-100 candidate window remains reachable', () => {
  it('finds the oldest eligible activity across paginated requests even with 105 newer candidates ahead of it', async () => {
    const graph = await createGraph();
    // Created FIRST -> smallest id -> sorts LAST in the id-desc candidate
    // scan the old `take: 100, orderBy: updatedAt desc` window would have
    // pushed this out of (a newer JO's updatedAt always wins that ordering).
    const { jobOrderId: targetId } = await createJobOrderWithAvailableQualityWork(graph, 4);

    const FILLER_COUNT = 105;
    for (let index = 0; index < FILLER_COUNT; index += 1) {
      await createConfirmedJobOrder(graph, 4);
    }

    const qa = await qaToken(['QA_USER']);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 50) {
      guard += 1;
      const page = await request(app)
        .get('/job-orders/quality-work')
        .query(cursor ? { limit: 10, cursor } : { limit: 10 })
        .set('Authorization', `Bearer ${qa.token}`)
        .expect(200);
      for (const item of page.body.data.items as Array<{ jobOrderId: string }>) {
        seen.add(item.jobOrderId);
      }
      hasMore = page.body.data.pageInfo.hasMore;
      cursor = page.body.data.pageInfo.nextCursor ?? undefined;
    }

    expect(seen.has(targetId)).toBe(true);
  }, 300000);
});
