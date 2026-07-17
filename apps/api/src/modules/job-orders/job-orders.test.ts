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
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: 'ST-JO', styleName: 'Job Style', finalMrp: 500 },
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
      lines: [
        {
          purchaseOrderLineId: graph.poLineId,
          sizes: [{ purchaseOrderLineSizeId: graph.poSizeAId, quantity }],
        },
      ],
    });
}

describe('job orders API', () => {
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
      .set('Authorization', `Bearer ${graph.admin.token}`);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.status).toBe('SENT_TO_FACTORY');
    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/send-to-factory`)
        .set('Authorization', `Bearer ${graph.admin.token}`),
    ).resolves.toMatchObject({ status: 400 });

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

    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/confirm`)
        .set('Authorization', `Bearer ${otherFactoryUser.token}`),
    ).resolves.toMatchObject({ status: 403 });
    const confirmRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/confirm`)
      .set('Authorization', `Bearer ${factoryUser.token}`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe('CONFIRMED_BY_FACTORY');
    expect(confirmRes.body.data.stages).toHaveLength(2);
    expect(confirmRes.body.data.stages[0].stageNameSnapshot).toBe('Cutting');

    const stages = confirmRes.body.data.stages;
    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .send({ stageStatusId: stages[1].id }),
    ).resolves.toMatchObject({ status: 400 });

    const firstStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .send({ stageStatusId: stages[0].id });
    expect(firstStageRes.body.data.status).toBe('IN_PRODUCTION');

    await expect(
      request(app)
        .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .send({
          sizes: [
            { jobOrderLineSizeId: createRes.body.data.lines[0].sizes[0].id, preparedQuantity: 3 },
          ],
        }),
    ).resolves.toMatchObject({ status: 400 });

    const finalStageRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/complete-stage`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .send({ stageStatusId: stages[1].id });
    expect(finalStageRes.body.data.status).toBe('PRODUCTION_COMPLETE');

    const sizeId = finalStageRes.body.data.lines[0].sizes[0].id;
    const preparedRes = await request(app)
      .post(`/job-orders/${jobOrderId}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .send({ sizes: [{ jobOrderLineSizeId: sizeId, preparedQuantity: 3 }] });
    expect(preparedRes.status).toBe(200);
    expect(preparedRes.body.data.status).toBe('READY_FOR_QA');
    expect(preparedRes.body.data.preparedQuantityTotal).toBe(3);

    const varianceRes = await request(app)
      .get(`/job-orders/${jobOrderId}/variance`)
      .set('Authorization', `Bearer ${graph.admin.token}`);
    expect(varianceRes.body.data.varianceQuantity).toBe(-1);
    await expect(prisma.auditLog.count({ where: { entityType: 'JobOrder' } })).resolves.toBe(6);
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
