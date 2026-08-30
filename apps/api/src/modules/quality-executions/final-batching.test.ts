import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  allocateTestDocumentSerial,
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture(preparedQuantity = 840) {
  const qa = await createTestUserAndToken({
    email: `final-${createId()}@test.local`,
    password: 'pass',
    roles: ['QA_USER', 'ADMIN'],
  });
  const factory = await createTestFactory();
  const distributor = await createTestDistributor();
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `FINAL-${createId()}`,
      styleName: 'Final style',
      finalMrp: 100,
    },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `M-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const secondSize = await prisma.size.create({
    data: { id: createId(), code: `L-${createId()}`, label: 'L', sizeType: 'ALPHA', sortOrder: 2 },
  });
  const financialYear = await createTestFinancialYear();
  const poSerial = await allocateTestDocumentSerial('PURCHASE_ORDER', financialYear.id);
  const po = await prisma.distributorPurchaseOrder.create({
    data: {
      id: createId(),
      poNumber: `PO-${createId()}`,
      distributorId: distributor.id,
      poDate: new Date(),
      purchaseMode: 'OUTRIGHT',
      status: 'SUBMITTED',
      createdBy: qa.userId,
      financialYearId: financialYear.id,
      poSerial,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          sizes: {
            create: [
              { id: createId(), sizeId: size.id, orderedQuantity: 500 },
              { id: createId(), sizeId: secondSize.id, orderedQuantity: 340 },
            ],
          },
        },
      },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const outcomeId = createId();
  const form = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `FINAL_${createId()}`,
      name: 'Final Inspection',
      versions: {
        create: {
          id: createId(),
          versionNumber: 2,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          sections: {
            create: {
              id: createId(),
              sequence: 1,
              title: 'Conclusion',
              components: {
                create: {
                  id: outcomeId,
                  sequence: 1,
                  type: 'INSPECTION_OUTCOME',
                  title: 'Inspection conclusion',
                  config: { allowedOutcomes: ['PASS', 'FAIL'] },
                },
              },
            },
          },
        },
      },
    },
    include: { versions: true },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `FINAL-FLOW-${createId()}`,
      name: 'Final batching flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const finishing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 1,
      name: 'Finishing',
      code: 'FINISHING',
    },
  });
  const final = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 2,
      name: 'Final Inspection',
      activityType: 'QUALITY',
      qualityFormVersionId: form.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: finishing.id,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  });
  const jobOrderSerial = await allocateTestDocumentSerial('JOB_ORDER', financialYear.id);
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: po.id,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: 10,
      status: 'IN_PRODUCTION',
      factoryConfirmationStatus: 'CONFIRMED',
      preparedQuantityTotal: preparedQuantity,
      createdBy: qa.userId,
      financialYearId: financialYear.id,
      jobOrderSerial,
      lines: {
        create: {
          id: createId(),
          purchaseOrderLineId: po.lines[0]!.id,
          styleId: style.id,
          orderedQuantityTotal: 840,
          preparedQuantityTotal: preparedQuantity,
          sizes: {
            create: [
              {
                id: createId(),
                purchaseOrderLineSizeId: po.lines[0]!.sizes.find((item) => item.sizeId === size.id)!
                  .id,
                sizeId: size.id,
                orderedQuantity: 500,
                preparedQuantity: Math.min(500, preparedQuantity),
              },
              {
                id: createId(),
                purchaseOrderLineSizeId: po.lines[0]!.sizes.find(
                  (item) => item.sizeId === secondSize.id,
                )!.id,
                sizeId: secondSize.id,
                orderedQuantity: 340,
                preparedQuantity: Math.max(0, preparedQuantity - 500),
              },
            ],
          },
        },
      },
      stageStatuses: {
        create: {
          id: createId(),
          processFlowVersionStageId: finishing.id,
          stageSequence: 1,
          stageNameSnapshot: 'Finishing',
          status: 'IN_PROGRESS',
          completedQuantity: 840,
        },
      },
    },
    include: { stageStatuses: true, lines: { include: { sizes: true } } },
  });
  return { qa, job, finishing, final, form, outcomeId, factory };
}

const payload = (version: number, outcomeId: string, outcome: 'PASS' | 'FAIL') => ({
  expectedVersion: version,
  checklistResponses: [],
  aqlResults: [],
  defects: [],
  correctiveActions: [],
  testResults: [],
  quantities: [],
  comments: [],
  fieldResponses: [],
  attendees: [],
  actions: [],
  signoffs: [],
  outcome: { componentId: outcomeId, value: outcome },
});
const start = (f: Awaited<ReturnType<typeof fixture>>, quantity: number, offset = 0) =>
  request(app)
    .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send({
      allocations: f.job.lines[0]!.sizes.flatMap((size) => {
        const sizeStart = f.job.lines[0]!.sizes.slice(
          0,
          f.job.lines[0]!.sizes.indexOf(size),
        ).reduce((sum, item) => sum + item.preparedQuantity, 0);
        const sizeEnd = sizeStart + size.preparedQuantity;
        const allocated = Math.max(
          0,
          Math.min(sizeEnd, offset + quantity) - Math.max(sizeStart, offset),
        );
        return allocated > 0 ? [{ jobOrderLineSizeId: size.id, quantity: allocated }] : [];
      }),
    });
const finalize = (
  f: Awaited<ReturnType<typeof fixture>>,
  execution: { id: string; version: number },
  outcome: 'PASS' | 'FAIL' = 'PASS',
) =>
  request(app)
    .post(`/quality-executions/${execution.id}/finalize`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send(payload(execution.version, f.outcomeId, outcome));

async function createFactoryUser(factoryId: string) {
  const factoryUser = await createTestUserAndToken({
    email: `factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  await prisma.userFactory.create({
    data: { id: createId(), userId: factoryUser.userId, factoryId },
  });
  return factoryUser;
}
const reworkAction = (
  action: 'acknowledge' | 'start' | 'complete',
  token: string,
  batchId: string,
  body: Record<string, unknown>,
) =>
  request(app)
    .post(`/quality-executions/final-batches/${batchId}/rework/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('Final Inspection batching and prepared coverage', () => {
  it('rejects missing, zero, negative, and non-numeric batch quantities at the API boundary', async () => {
    const f = await fixture(0);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const endpoint = `/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`;
    const invalidBodies = [
      {},
      { inspectedQuantity: 0 },
      { inspectedQuantity: -1 },
      { inspectedQuantity: 'ten' },
    ];

    for (const body of invalidBodies) {
      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send(body)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(
      await prisma.qualityActivityExecution.count({
        where: { jobOrderId: f.job.id, processFlowActivityId: f.final.id },
      }),
    ).toBe(0);
  });

  it('enforces execution/allocation quantity and release-state consistency in the database', async () => {
    const f = await fixture(10);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 10).expect(201)).body.data;

    await expect(
      prisma.qualityActivityExecution.update({
        where: { id: execution.id },
        data: { inspectedQuantity: 9 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.finalQualityBatchAllocation.update({
        where: {
          finalQualityBatchId_jobOrderLineSizeId: {
            finalQualityBatchId: execution.finalBatch.id,
            jobOrderLineSizeId: execution.finalBatch.allocations[0].jobOrderLineSizeId,
          },
        },
        data: { quantity: 9 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.finalQualityBatch.update({
        where: { id: execution.finalBatch.id },
        data: { physicalQuantity: 9 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.qaRelease.create({
        data: {
          id: createId(),
          jobOrderId: f.job.id,
          sourceQualityExecutionId: execution.id,
          finalQualityBatchId: execution.finalBatch.id,
          releasedById: f.qa.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.finalQualityBatch.update({
        where: { id: execution.finalBatch.id },
        data: {
          disposition: 'RELEASED',
          terminalById: f.qa.userId,
          terminalAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('is available while configured Finishing is active and remains available after completion', async () => {
    const f = await fixture();
    const execution = await start(f, 300).expect(201);
    expect(execution.body.data).toMatchObject({
      batchNumber: 1,
      inspectedQuantity: 300,
      qualityForm: { versionId: f.form.versions[0]!.id },
    });
    await finalize(f, execution.body.data, 'PASS').expect(200);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await start(f, 200, 300).expect(201);
  });

  it('enforces the prepared upper bound independently for every Job Order size', async () => {
    const f = await fixture(40);
    const sizes = f.job.lines[0]!.sizes;
    const first = sizes[0]!;
    const second = sizes[1]!;
    const firstSizeCode = (await prisma.size.findUniqueOrThrow({ where: { id: first.sizeId } })).code;

    const exact = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-exact-upper-bound')
      .send({
        expectedVersion: f.job.version,
        sizes: [
          { jobOrderLineSizeId: first.id, preparedQuantity: first.orderedQuantity },
          { jobOrderLineSizeId: second.id, preparedQuantity: second.orderedQuantity },
        ],
      })
      .expect(200);
    expect(exact.body.data.preparedQuantityTotal).toBe(840);

    const over = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-per-size-over-bound')
      .send({
        expectedVersion: exact.body.data.version,
        sizes: [
          { jobOrderLineSizeId: first.id, preparedQuantity: first.orderedQuantity + 1 },
          { jobOrderLineSizeId: second.id, preparedQuantity: second.orderedQuantity - 1 },
        ],
      })
      .expect(400);
    expect(over.body.error.message).toContain(`size ${firstSizeCode}`);
    expect(over.body.error.message).toContain(String(first.orderedQuantity));
  });

  it('does not reserve a physical batch until prepared quantity is authoritative', async () => {
    const f = await fixture(0);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await start(f, 300).expect(400);
    expect(await prisma.finalQualityBatch.count({ where: { jobOrderId: f.job.id } })).toBe(0);
  });

  it('records cumulative prepared quantity during production and protects committed capacity', async () => {
    const f = await fixture(40);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const sizes = f.job.lines[0]!.sizes;
    const increased = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-increase')
      .send({
        expectedVersion: f.job.version,
        sizes: sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: size.preparedQuantity > 0 ? 70 : 0,
        })),
      })
      .expect(200);
    expect(increased.body.data).toMatchObject({
      status: 'IN_PRODUCTION',
      preparedQuantityTotal: 70,
    });
    const preparedSize = sizes.find((size) => size.preparedQuantity > 0)!;
    expect(
      increased.body.data.qualityActivities[0].coverage.availableBySize.find(
        (size: { jobOrderLineSizeId: string }) => size.jobOrderLineSizeId === preparedSize.id,
      ).availableQuantity,
    ).toBe(70);
    await request(app)
      .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ allocations: [{ jobOrderLineSizeId: preparedSize.id, quantity: 50 }] })
      .expect(201);
    await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-decrease')
      .send({
        expectedVersion: increased.body.data.version,
        sizes: sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: size.id === preparedSize.id ? 49 : 0,
        })),
      })
      .expect(409);
    const exact = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-correction-to-reservation')
      .send({
        expectedVersion: increased.body.data.version,
        sizes: sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: size.id === preparedSize.id ? 50 : 0,
        })),
      })
      .expect(200);
    expect(exact.body.data.preparedQuantityTotal).toBe(50);
  });

  it('keeps prepared entry available for final correction after a WHILE-associated Production activity completes', async () => {
    const f = await fixture(40);
    await prisma.processFlowVersionStage.update({
      where: { id: f.final.id },
      data: { qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' },
    });
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const response = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'prepared-final-correction-after-completion')
      .send({
        expectedVersion: f.job.version,
        sizes: f.job.lines[0]!.sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: size.preparedQuantity > 0 ? 45 : 0,
        })),
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      preparedQuantityTotal: 45,
      preparedQuantityEntry: { available: true },
    });
  });

  it('aggregates 300 + 250 + 290 and keeps FAIL separate from physical coverage', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED' },
    });
    const quantities = [300, 250, 290];
    let last: { id: string; version: number } | undefined;
    let allocated = 0;
    for (const [index, quantity] of quantities.entries()) {
      const started = await start(f, quantity, allocated).expect(201);
      last = started.body.data;
      const finalized = await finalize(f, last!, index === 1 ? 'FAIL' : 'PASS').expect(200);
      allocated += quantity;
      expect(finalized.body.data.coverage.inspectedQuantity).toBe(
        quantities.slice(0, index + 1).reduce((a, b) => a + b, 0),
      );
    }
    const view = await request(app)
      .get(`/quality-executions/${last!.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(view.body.data.coverage).toMatchObject({
      preparedQuantity: 840,
      inspectedQuantity: 840,
      reservedForFinalQuantity: 840,
      inspectedPhysicalCoverage: 840,
      resolvedPhysicalCoverage: 590,
      physicalFinalCoverage: 840,
      releasedQuantity: 590,
      awaitingReinspectionQuantity: 250,
      remainingQuantity: 250,
      complete: false,
      coverageCompleteSoFar: false,
      finalQaComplete: false,
      reconciliationConflict: false,
      state: 'IN_PROGRESS',
      passedBatches: 2,
      failedBatches: 1,
      hasFailedBatches: true,
    });
    expect(view.body.data.coverage.batches[1]).toMatchObject({
      batchNumber: 2,
      inspectedQuantity: 250,
      outcome: 'FAIL',
    });
    expect(view.body.data.attemptNumber).toBe(1);
    expect(view.body.data.batchNumber).toBe(3);
    const job = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(job.body.data.status).toBe('IN_PRODUCTION');
    expect(job.body.data.operationalState.qualityState.label).not.toBe(
      'Final Inspection Completed',
    );
  });

  it('has no whole-job Final approval publisher', async () => {
    const f = await fixture(10);
    await request(app)
      .post(`/qa/job-orders/${f.job.id}/approve`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'obsolete-final-publisher')
      .send({ expectedVersion: f.job.version })
      .expect(404);
    const projection = await prisma.distributorPurchaseOrderLineSize.aggregate({
      where: { purchaseOrderLine: { purchaseOrderId: f.job.purchaseOrderId } },
      _sum: { qaPassedQuantity: true },
    });
    expect(projection._sum.qaPassedQuantity).toBe(0);
    expect(await prisma.qaRelease.count({ where: { jobOrderId: f.job.id } })).toBe(0);
  });

  it('reserves drafts, rejects over-allocation, and prevents prepared quantity from dropping below reservations', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED' },
    });
    const first = (await start(f, 800).expect(201)).body.data;
    await finalize(f, first).expect(200);
    const draft = (await start(f, 40, 800).expect(201)).body.data;
    expect(draft.coverage).toMatchObject({
      inspectedQuantity: 800,
      reservedForFinalQuantity: 840,
      inspectedPhysicalCoverage: 800,
      resolvedPhysicalCoverage: 800,
      physicalFinalCoverage: 800,
      availableForNewFinalBatch: 0,
      remainingQuantity: 40,
      coverageCompleteSoFar: false,
      finalQaComplete: false,
    });
    await request(app)
      .post(`/quality-executions/final-batches/${draft.finalBatch.id}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Invalid transition' })
      .expect(409);
    await start(f, 39, 800).expect(409);
    await request(app)
      .post(`/quality-executions/final-batches/${draft.finalBatch.id}/cancel`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Created against the wrong shipment' })
      .expect(200);
    const cancelled = await request(app)
      .get(`/quality-executions/${draft.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(cancelled.body.data.finalBatch.disposition).toBe('CANCELLED');

    const workedDraft = (await start(f, 40, 800).expect(201)).body.data;
    await request(app)
      .put(`/quality-executions/${workedDraft.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(payload(workedDraft.version, f.outcomeId, 'PASS'))
      .expect(200);
    await request(app)
      .post(`/quality-executions/final-batches/${workedDraft.finalBatch.id}/cancel`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Would discard persisted inspection work' })
      .expect(409);
  });

  it('reinspects the same physical batch and releases its immutable multi-size allocation exactly once', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const first = (await start(f, 600).expect(201)).body.data;
    expect(first.finalBatch.allocations).toHaveLength(2);
    const failed = await finalize(f, first, 'FAIL').expect(200);
    expect(failed.body.data.finalBatch).toMatchObject({
      id: first.finalBatch.id,
      disposition: 'AWAITING_REINSPECTION',
      release: null,
    });
    expect(failed.body.data.finalBatch.reworks).toMatchObject([
      { cycleNumber: 1, status: 'REQUIRED' },
    ]);

    await request(app)
      .post(`/quality-executions/final-batches/${first.finalBatch.id}/reinspect`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ inspectedQuantity: 1, allocations: [] })
      .expect(409);

    const factoryUser = await createFactoryUser(f.factory.id);
    await reworkAction('acknowledge', factoryUser.token, first.finalBatch.id, {
      expectedVersion: 1,
    }).expect(200);
    await reworkAction('start', factoryUser.token, first.finalBatch.id, {
      expectedVersion: 2,
    }).expect(200);
    const completed = await reworkAction('complete', factoryUser.token, first.finalBatch.id, {
      expectedVersion: 3,
      notes: 'Reworked stitching defect on collar',
    }).expect(200);
    expect(completed.body.data.reworks).toMatchObject([
      {
        cycleNumber: 1,
        status: 'COMPLETED',
        notes: 'Reworked stitching defect on collar',
        acknowledgedBy: { id: factoryUser.userId },
        startedBy: { id: factoryUser.userId },
        completedBy: { id: factoryUser.userId },
      },
    ]);

    const retry = await request(app)
      .post(`/quality-executions/final-batches/${first.finalBatch.id}/reinspect`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ inspectedQuantity: 1, allocations: [] })
      .expect(201);
    expect(retry.body.data).toMatchObject({
      attemptNumber: 2,
      batchNumber: 1,
      inspectedQuantity: 600,
      finalBatch: { id: first.finalBatch.id, physicalQuantity: 600 },
    });
    expect(retry.body.data.finalBatch.allocations).toEqual(first.finalBatch.allocations);

    const passed = await finalize(f, retry.body.data, 'PASS').expect(200);
    expect(passed.body.data.finalBatch).toMatchObject({
      disposition: 'RELEASED',
      release: { quantity: 600 },
    });
    await finalize(f, retry.body.data, 'PASS').expect(409);

    const releases = await prisma.qaRelease.findMany({
      where: { finalQualityBatchId: first.finalBatch.id },
      include: { lines: true },
    });
    expect(releases).toHaveLength(1);
    expect(
      releases[0]!.lines.map(({ jobOrderLineSizeId, quantity }) => ({
        jobOrderLineSizeId,
        quantity,
      })),
    ).toEqual(
      expect.arrayContaining(
        first.finalBatch.allocations.map(
          ({ jobOrderLineSizeId, quantity }: { jobOrderLineSizeId: string; quantity: number }) => ({
            jobOrderLineSizeId,
            quantity,
          }),
        ),
      ),
    );
    const projected = await prisma.distributorPurchaseOrderLineSize.aggregate({
      where: { purchaseOrderLine: { purchaseOrderId: f.job.purchaseOrderId } },
      _sum: { qaPassedQuantity: true },
    });
    expect(projected._sum.qaPassedQuantity).toBe(600);
    const fulfilment = await request(app)
      .get(`/purchase-orders/${f.job.purchaseOrderId}/fulfilment-summary`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(
      fulfilment.body.data.lines[0].sizes.reduce(
        (sum: number, size: { qaReleasedPendingDispatchQuantity: number }) =>
          sum + size.qaReleasedPendingDispatchQuantity,
        0,
      ),
    ).toBe(600);
  });

  it('closes a failed physical batch as permanently rejected without downstream release', async () => {
    const f = await fixture(200);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 200).expect(201)).body.data;
    await finalize(f, execution, 'FAIL').expect(200);
    await request(app)
      .post(`/quality-executions/final-batches/${execution.finalBatch.id}/cancel`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'A failed inspection is physical history' })
      .expect(409);
    const rejected = await request(app)
      .post(`/quality-executions/final-batches/${execution.finalBatch.id}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Unrecoverable construction defect' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      disposition: 'PERMANENTLY_REJECTED',
      terminalReason: 'Unrecoverable construction defect',
      release: null,
    });
    expect(await prisma.qaRelease.count({ where: { jobOrderId: f.job.id } })).toBe(0);
    await request(app)
      .post(`/quality-executions/final-batches/${execution.finalBatch.id}/reinspect`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(409);
    await request(app)
      .post(`/quality-executions/final-batches/${execution.finalBatch.id}/cancel`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Terminal batches cannot be cancelled' })
      .expect(409);
  });

  it('keeps resolution complete-so-far separate from whole-job completion while Production is active', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const released = (await start(f, 90).expect(201)).body.data;
    await finalize(f, released, 'PASS').expect(200);
    const rejected = (await start(f, 10, 90).expect(201)).body.data;
    await finalize(f, rejected, 'FAIL').expect(200);
    await request(app)
      .post(`/quality-executions/final-batches/${rejected.finalBatch.id}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Terminal reject' })
      .expect(200);

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.qualityActivities[0].coverage).toMatchObject({
      resolvedPhysicalCoverage: 100,
      coverageCompleteSoFar: true,
      finalQaComplete: false,
    });
  });

  it('marks whole-job Final QA complete after production ends with released and rejected terminal batches', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: { status: 'PRODUCTION_COMPLETE', productionCompletedAt: new Date() },
    });
    const released = (await start(f, 90).expect(201)).body.data;
    await finalize(f, released, 'PASS').expect(200);
    const rejected = (await start(f, 10, 90).expect(201)).body.data;
    await finalize(f, rejected, 'FAIL').expect(200);
    await request(app)
      .post(`/quality-executions/final-batches/${rejected.finalBatch.id}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Terminal reject' })
      .expect(200);
    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.qualityActivities[0].coverage).toMatchObject({
      releasedQuantity: 90,
      permanentlyRejectedQuantity: 10,
      awaitingReinspectionQuantity: 0,
      coverageCompleteSoFar: true,
      finalQaComplete: true,
    });
  });

  it('rolls PASS finalization back if its compatibility projection cannot be written', async () => {
    const f = await fixture(10);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 10).expect(201)).body.data;
    const allocation = execution.finalBatch.allocations[0];
    const allocatedSize = await prisma.jobOrderLineSize.findUniqueOrThrow({
      where: { id: allocation.jobOrderLineSizeId },
    });
    await prisma.distributorPurchaseOrderLineSize.update({
      where: { id: allocatedSize.purchaseOrderLineSizeId },
      data: { qaPassedQuantity: 2_147_483_647 },
    });
    await finalize(f, execution, 'PASS').expect(500);
    expect(
      await prisma.qualityActivityExecution.findUniqueOrThrow({ where: { id: execution.id } }),
    ).toMatchObject({ status: 'DRAFT', outcome: null });
    expect(
      await prisma.qaRelease.count({ where: { finalQualityBatchId: execution.finalBatch.id } }),
    ).toBe(0);
  });

  it('serializes concurrent PASS requests and publishes one release', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 100).expect(201)).body.data;
    const [one, two] = await Promise.all([
      finalize(f, execution, 'PASS'),
      finalize(f, execution, 'PASS'),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.qaRelease.count({ where: { finalQualityBatchId: execution.finalBatch.id } }),
    ).toBe(1);
  });

  it('serializes concurrent batch starts so physical reservations cannot overrun prepared quantity', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED' },
    });
    const [a, b] = await Promise.all([start(f, 60), start(f, 50)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const aggregate = await prisma.finalQualityBatch.aggregate({
      where: { jobOrderId: f.job.id, disposition: { not: 'CANCELLED' } },
      _sum: { physicalQuantity: true },
    });
    expect(aggregate._sum.physicalQuantity).toBeLessThanOrEqual(100);
  });

  it('serializes a prepared decrease against concurrent physical allocation', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const preparedSize = f.job.lines[0]!.sizes.find((size) => size.preparedQuantity > 0)!;
    const decrease = request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'concurrent-prepared-decrease')
      .send({
        expectedVersion: f.job.version,
        sizes: f.job.lines[0]!.sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: 0,
        })),
      });
    const allocation = request(app)
      .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ allocations: [{ jobOrderLineSizeId: preparedSize.id, quantity: 100 }] });
    const [decreased, allocated] = await Promise.all([decrease, allocation]);
    expect([decreased.status, allocated.status].sort()).toEqual([200, 409]);
    const currentSize = await prisma.jobOrderLineSize.findUniqueOrThrow({
      where: { id: preparedSize.id },
    });
    const reserved = await prisma.finalQualityBatchAllocation.aggregate({
      where: { jobOrderLineSizeId: preparedSize.id },
      _sum: { quantity: true },
    });
    expect(currentSize.preparedQuantity).toBeGreaterThanOrEqual(reserved._sum.quantity ?? 0);
  });
});

describe('Factory rework for failed Final Quality batches', () => {
  async function failedBatch(preparedQuantity = 100) {
    const f = await fixture(preparedQuantity);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, preparedQuantity).expect(201)).body.data;
    const failed = await finalize(f, execution, 'FAIL').expect(200);
    return { f, batchId: failed.body.data.finalBatch.id as string };
  }

  it('opens rework cycle 1 as REQUIRED on FAIL, keeping the batch reserved with no release', async () => {
    const { f, batchId } = await failedBatch(100);
    const batch = await prisma.finalQualityBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { reworks: true, release: true },
    });
    expect(batch.disposition).toBe('AWAITING_REINSPECTION');
    expect(batch.release).toBeNull();
    expect(batch.reworks).toMatchObject([{ cycleNumber: 1, status: 'REQUIRED' }]);
    const coverage = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(coverage.body.data.qualityActivities[0].coverage).toMatchObject({
      reservedForFinalQuantity: 100,
      availableForNewFinalBatch: 0,
    });
  });

  it('only the mapped Factory User (or ADMIN) may acknowledge/start/complete rework — not QA, not another factory', async () => {
    const { f, batchId } = await failedBatch();
    const qaOnly = await createTestUserAndToken({
      email: `qa-only-${createId()}@test.local`,
      password: 'pass',
      roles: ['QA_USER'],
    });
    const wrongFactory = await createTestFactory();
    const wrongFactoryUser = await createFactoryUser(wrongFactory.id);
    const mappedFactoryUser = await createFactoryUser(f.factory.id);

    await reworkAction('acknowledge', qaOnly.token, batchId, { expectedVersion: 1 }).expect(403);
    await reworkAction('acknowledge', wrongFactoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(403);
    await reworkAction('acknowledge', mappedFactoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
  });

  it('enforces the acknowledge -> start -> complete order and requires notes to complete', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);

    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 1 }).expect(409);
    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 1,
      notes: 'skip ahead',
    }).expect(409);

    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 2,
    }).expect(409);

    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 2,
    }).expect(400);
    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 2 }).expect(200);
    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 3,
      notes: 'Corrected the seam allowance and reinforced stitching',
    }).expect(200);
  });

  it('rejects a stale expectedVersion and does not apply a duplicate transition', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
    const stale = await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    const rework = await prisma.finalQualityBatchRework.findFirstOrThrow({
      where: { finalQualityBatchId: batchId },
    });
    expect(rework.version).toBe(2);
  });

  it('blocks QA reinspection until the current rework cycle is COMPLETED, then allows it', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    const reinspect = () =>
      request(app)
        .post(`/quality-executions/final-batches/${batchId}/reinspect`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({ inspectedQuantity: 1, allocations: [] });

    await reinspect().expect(409);
    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
    await reinspect().expect(409);
    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 2 }).expect(200);
    await reinspect().expect(409);
    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 3,
      notes: 'Corrective action complete',
    }).expect(200);
    await reinspect().expect(201);
  });

  it('opens a fresh rework cycle 2 on a repeat FAIL without mutating the completed cycle 1, preserving full history', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 2 }).expect(200);
    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 3,
      notes: 'First corrective pass',
    }).expect(200);

    const retry = (
      await request(app)
        .post(`/quality-executions/final-batches/${batchId}/reinspect`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({ inspectedQuantity: 1, allocations: [] })
        .expect(201)
    ).body.data;
    const failedAgain = await finalize(f, retry, 'FAIL').expect(200);
    expect(failedAgain.body.data.finalBatch.reworks).toMatchObject([
      { cycleNumber: 1, status: 'COMPLETED', notes: 'First corrective pass' },
      { cycleNumber: 2, status: 'REQUIRED', notes: null },
    ]);

    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 1 }).expect(409);
    const cycle1 = await prisma.finalQualityBatchRework.findFirstOrThrow({
      where: { finalQualityBatchId: batchId, cycleNumber: 1 },
    });
    expect(cycle1.status).toBe('COMPLETED');
    expect(cycle1.version).toBe(4);
  });

  it('leaves prepared/reserved/available capacity unchanged across an entire rework + reinspection cycle', async () => {
    const { f, batchId } = await failedBatch(170);
    const factoryUser = await createFactoryUser(f.factory.id);
    const coverageOf = async () => {
      const detail = await request(app)
        .get(`/job-orders/${f.job.id}`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .expect(200);
      return detail.body.data.qualityActivities[0].coverage;
    };
    const before = await coverageOf();

    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);
    await reworkAction('start', factoryUser.token, batchId, { expectedVersion: 2 }).expect(200);
    await reworkAction('complete', factoryUser.token, batchId, {
      expectedVersion: 3,
      notes: 'Reworked',
    }).expect(200);
    await request(app)
      .post(`/quality-executions/final-batches/${batchId}/reinspect`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ inspectedQuantity: 1, allocations: [] })
      .expect(201);

    const after = await coverageOf();
    expect(after).toMatchObject({
      preparedQuantity: before.preparedQuantity,
      reservedForFinalQuantity: before.reservedForFinalQuantity,
      availableForNewFinalBatch: before.availableForNewFinalBatch,
    });
    expect(before.preparedQuantity).toBe(170);
    expect(before.reservedForFinalQuantity).toBe(170);
    expect(before.availableForNewFinalBatch).toBe(0);
  });

  it('surfaces the open rework on the mapped Factory User\'s Job Order detail, and lets them view (but not another factory) the batch directly', async () => {
    const { f, batchId } = await failedBatch();
    const wrongFactory = await createTestFactory();
    const wrongFactoryUser = await createFactoryUser(wrongFactory.id);
    const mappedFactoryUser = await createFactoryUser(f.factory.id);

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${mappedFactoryUser.token}`)
      .expect(200);
    expect(detail.body.data.finalBatchReworks).toMatchObject([
      { finalQualityBatchId: batchId, cycleNumber: 1, status: 'REQUIRED' },
    ]);

    await request(app)
      .get(`/quality-executions/final-batches/${batchId}`)
      .set('Authorization', `Bearer ${wrongFactoryUser.token}`)
      .expect(403);
    await request(app)
      .get(`/quality-executions/final-batches/${batchId}`)
      .set('Authorization', `Bearer ${mappedFactoryUser.token}`)
      .expect(200);
  });

  it('permanently rejecting a batch preserves rework history and still creates no release', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    await reworkAction('acknowledge', factoryUser.token, batchId, {
      expectedVersion: 1,
    }).expect(200);

    await request(app)
      .post(`/quality-executions/final-batches/${batchId}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Unrecoverable fabric defect' })
      .expect(200);

    const batch = await prisma.finalQualityBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { reworks: true, release: true },
    });
    expect(batch.disposition).toBe('PERMANENTLY_REJECTED');
    expect(batch.release).toBeNull();
    expect(batch.reworks).toMatchObject([{ cycleNumber: 1, status: 'ACKNOWLEDGED' }]);
  });
});
