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
          styleId: style.id,
          orderedQuantityTotal: 840,
          preparedQuantityTotal: preparedQuantity,
          sizes: {
            create: [
              {
                id: createId(),
                sizeId: size.id,
                orderedQuantity: 500,
                preparedQuantity: Math.min(500, preparedQuantity),
              },
              {
                id: createId(),
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
  // Order Sheet Phase 2: the Order Sheet <-> Job Order relationship is the
  // Order Sheet's own jobOrderId claim, not a field on JobOrder.
  await prisma.distributorPurchaseOrder.update({
    where: { id: po.id },
    data: { jobOrderId: job.id },
  });
  return { qa, job, finishing, final, form, outcomeId, factory, poId: po.id };
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
const reinspect = (f: Awaited<ReturnType<typeof fixture>>, batchId: string) =>
  request(app)
    .post(`/quality-executions/final-batches/${batchId}/reinspect`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send({ inspectedQuantity: 1, allocations: [] });

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

    // No internal Factory Rework state gates this — QA can start reinspecting
    // the same failed batch immediately once the (offline, physical)
    // correction is ready.
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

  // Correction 3: automatic Job Order PRODUCTION_COMPLETE — independent of
  // whether Finishing itself has been marked complete, driven purely by
  // preparedQuantityTotal === orderedQuantityTotal plus every non-cancelled
  // Final batch reaching a resolved disposition (RELEASED or
  // PERMANENTLY_REJECTED).
  it('does not automatically complete the Job Order when the full planned quantity is prepared but not fully inspected', async () => {
    const f = await fixture(840);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 500).expect(201)).body.data;
    await finalize(f, execution, 'PASS').expect(200);

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('IN_PRODUCTION');
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'JobOrder', action: 'JOB_ORDER_PRODUCTION_COMPLETED_AUTOMATIC' },
      }),
    ).toBe(0);
  });

  it('automatically marks the Job Order PRODUCTION_COMPLETE once the full planned quantity is prepared and fully resolved through Final QA, exactly once', async () => {
    const f = await fixture(840);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const first = (await start(f, 500).expect(201)).body.data;
    await finalize(f, first, 'PASS').expect(200);
    const second = (await start(f, 340, 500).expect(201)).body.data;
    const finalized = await finalize(f, second, 'PASS').expect(200);
    expect(finalized.body.data.finalBatch.disposition).toBe('RELEASED');

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('PRODUCTION_COMPLETE');
    // Final-QA-passed quantity is unaffected — released exactly as before.
    expect(await prisma.qaRelease.count({ where: { jobOrderId: f.job.id } })).toBe(2);
    const autoCompletionAudits = await prisma.auditLog.findMany({
      where: {
        entityType: 'JobOrder',
        entityId: f.job.id,
        action: 'JOB_ORDER_PRODUCTION_COMPLETED_AUTOMATIC',
      },
    });
    expect(autoCompletionAudits).toHaveLength(1);

    // A later event that re-triggers recalculation (here, a no-op Prepared
    // Quantity save) must not duplicate the automatic-completion audit
    // entry or otherwise disturb the now-terminal status.
    await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', 'no-op-recalculation-trigger')
      .send({
        expectedVersion: detail.body.data.version,
        sizes: f.job.lines[0]!.sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: size.orderedQuantity,
        })),
      })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'JobOrder',
          entityId: f.job.id,
          action: 'JOB_ORDER_PRODUCTION_COMPLETED_AUTOMATIC',
        },
      }),
    ).toBe(1);
  });

  it('treats a Permanently Rejected batch as a resolved production/inspection outcome (not a forced PASS) for automatic completion', async () => {
    const f = await fixture(840);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const released = (await start(f, 500).expect(201)).body.data;
    await finalize(f, released, 'PASS').expect(200);
    const failed = (await start(f, 340, 500).expect(201)).body.data;
    await finalize(f, failed, 'FAIL').expect(200);

    // Still AWAITING_REINSPECTION — unresolved, so not yet complete.
    const midway = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(midway.body.data.status).toBe('IN_PRODUCTION');

    await request(app)
      .post(`/quality-executions/final-batches/${failed.finalBatch.id}/permanently-reject`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ reason: 'Unrecoverable construction defect' })
      .expect(200);

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('PRODUCTION_COMPLETE');

    // The permanently-rejected 340 units never became QA-passed inventory —
    // only the 500 PASS units were ever released.
    const releases = await prisma.qaRelease.findMany({
      where: { jobOrderId: f.job.id },
      include: { lines: true },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]!.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(500);
  });

  it('does not automatically complete a short-produced Job Order, and raises no tolerance error', async () => {
    const f = await fixture(500); // 500 prepared of 840 ordered — deliberately short
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const execution = (await start(f, 500).expect(201)).body.data;
    const finalized = await finalize(f, execution, 'PASS').expect(200);
    expect(finalized.body.data.finalBatch.disposition).toBe('RELEASED');

    const detail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(detail.body.data.status).toBe('IN_PRODUCTION');
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

// Factory Rework was removed as an internal ERVE workflow: physical
// correction happens with the Factory, outside the application. QA
// reinspection eligibility is derived only from the batch's own
// disposition and its Final Inspection attempt history — see
// startFinalBatchReinspection in quality-executions.service.ts.
describe('Final QA reinspection of a failed batch (no Factory Rework workflow)', () => {
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

  it('a FAIL leaves the batch awaiting reinspection, releases zero stock, and keeps its allocation attached', async () => {
    const { f, batchId } = await failedBatch(100);
    const batch = await prisma.finalQualityBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { release: true, allocations: true },
    });
    expect(batch.disposition).toBe('AWAITING_REINSPECTION');
    expect(batch.release).toBeNull();
    expect(batch.allocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(100);
    expect(await prisma.qaRelease.count({ where: { finalQualityBatchId: batchId } })).toBe(0);

    const coverage = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(coverage.body.data.qualityActivities[0].coverage).toMatchObject({
      reservedForFinalQuantity: 100,
      availableForNewFinalBatch: 0,
      releasedQuantity: 0,
    });
  });

  it('lets QA start reinspection immediately on the same batch, with no Prepared Quantity consumed a second time', async () => {
    const { f, batchId } = await failedBatch(170);
    const coverageOf = async () => {
      const detail = await request(app)
        .get(`/job-orders/${f.job.id}`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .expect(200);
      return detail.body.data.qualityActivities[0].coverage;
    };
    const before = await coverageOf();

    const retry = (await reinspect(f, batchId).expect(201)).body.data;
    expect(retry.finalBatch.id).toBe(batchId);
    expect(retry.attemptNumber).toBe(2);

    const after = await coverageOf();
    expect(after).toMatchObject({
      preparedQuantity: before.preparedQuantity,
      reservedForFinalQuantity: before.reservedForFinalQuantity,
      availableForNewFinalBatch: before.availableForNewFinalBatch,
    });
    expect(
      await prisma.finalQualityBatch.count({ where: { jobOrderId: f.job.id } }),
    ).toBe(1);
  });

  it('retains every prior FAIL attempt across FAIL -> FAIL -> PASS and releases stock exactly once, only on the final PASS', async () => {
    const { f, batchId } = await failedBatch(60);
    const secondAttempt = (await reinspect(f, batchId).expect(201)).body.data;
    await finalize(f, secondAttempt, 'FAIL').expect(200);
    const thirdAttempt = (await reinspect(f, batchId).expect(201)).body.data;
    const passed = await finalize(f, thirdAttempt, 'PASS').expect(200);

    expect(passed.body.data.finalBatch).toMatchObject({
      disposition: 'RELEASED',
      release: { quantity: 60 },
    });
    expect(passed.body.data.finalBatch.attempts).toMatchObject([
      { attemptNumber: 1, status: 'FINALIZED', outcome: 'FAIL' },
      { attemptNumber: 2, status: 'FINALIZED', outcome: 'FAIL' },
      { attemptNumber: 3, status: 'FINALIZED', outcome: 'PASS' },
    ]);
    const releases = await prisma.qaRelease.findMany({ where: { finalQualityBatchId: batchId } });
    expect(releases).toHaveLength(1);
  });

  it('cannot double-release a batch under concurrent duplicate finalize PASS requests', async () => {
    const { f, batchId } = await failedBatch(50);
    const retry = (await reinspect(f, batchId).expect(201)).body.data;
    const body = payload(retry.version, f.outcomeId, 'PASS');
    const [first, second] = await Promise.all([
      request(app)
        .post(`/quality-executions/${retry.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send(body),
      request(app)
        .post(`/quality-executions/${retry.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send(body),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const releases = await prisma.qaRelease.findMany({
      where: { finalQualityBatchId: batchId },
      include: { lines: true },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]!.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(50);
  });

  it('cannot reinspect a batch that has already been released', async () => {
    const { f, batchId } = await failedBatch(40);
    const retry = (await reinspect(f, batchId).expect(201)).body.data;
    await finalize(f, retry, 'PASS').expect(200);
    await reinspect(f, batchId).expect(409);
  });

  it('cannot start a second reinspection while another attempt is still Draft/In Progress', async () => {
    const { f, batchId } = await failedBatch(30);
    await reinspect(f, batchId).expect(201);
    await reinspect(f, batchId).expect(409);
  });

  it('cannot reinspect a batch with no prior finalized FAIL', async () => {
    const f = await fixture(80);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const draftExecution = (await start(f, 80).expect(201)).body.data;
    await reinspect(f, draftExecution.finalBatch.id).expect(409);
  });

  it('does not allow a Factory User (or other unauthorized role) to start reinspection', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    const merchandiser = await createTestUserAndToken({
      email: `merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    await request(app)
      .post(`/quality-executions/final-batches/${batchId}/reinspect`)
      .set('Authorization', `Bearer ${factoryUser.token}`)
      .send({ inspectedQuantity: 1, allocations: [] })
      .expect(403);
    await request(app)
      .post(`/quality-executions/final-batches/${batchId}/reinspect`)
      .set('Authorization', `Bearer ${merchandiser.token}`)
      .send({ inspectedQuantity: 1, allocations: [] })
      .expect(403);
  });

  it('exposes no Factory Rework endpoints for a failed batch', async () => {
    const { f, batchId } = await failedBatch();
    const factoryUser = await createFactoryUser(f.factory.id);
    for (const action of ['acknowledge', 'start', 'complete']) {
      await request(app)
        .post(`/quality-executions/final-batches/${batchId}/rework/${action}`)
        .set('Authorization', `Bearer ${factoryUser.token}`)
        .send({ expectedVersion: 1 })
        .expect(404);
    }
  });
});
