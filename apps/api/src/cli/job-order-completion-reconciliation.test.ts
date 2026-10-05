import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import {
  createTestFactory,
  createTestFinancialYear,
  createTestSeason,
  createTestUserAndToken,
  resetDatabase,
} from '../test/helpers.js';
import {
  executeCompletionReconciliation,
  loadReconciliationCandidateRows,
  planCompletionReconciliation,
  summarizeReconciliationPlan,
} from './job-order-completion-reconciliation.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function seed(options: {
  orderedQuantityTotal?: number;
  preparedQuantityTotal?: number;
  batches?: Array<{ physicalQuantity: number; disposition: 'RELEASED' | 'PERMANENTLY_REJECTED' | 'AWAITING_REINSPECTION' | 'CANCELLED' }>;
  finalStageStatus?: 'IN_PROGRESS' | 'NOT_STARTED' | 'COMPLETED';
  jobOrderStatus?: 'PRODUCTION_COMPLETE' | 'IN_PRODUCTION';
  productionCompletedAt?: Date | null;
  secondStageStatus?: 'IN_PROGRESS' | 'NOT_STARTED' | 'COMPLETED';
}) {
  const {
    orderedQuantityTotal = 60,
    preparedQuantityTotal = 60,
    batches = [{ physicalQuantity: 60, disposition: 'PERMANENTLY_REJECTED' }],
    finalStageStatus = 'IN_PROGRESS',
    jobOrderStatus = 'PRODUCTION_COMPLETE',
    productionCompletedAt = null,
    secondStageStatus,
  } = options;

  const user = await createTestUserAndToken({
    email: `reconcile-${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const factory = await createTestFactory();
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `RECON-${createId()}`,
      styleName: 'Reconciliation style',
      finalMrp: 100,
      seasonId: (await createTestSeason()).id,
    },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `SZ-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const form = await prisma.qualityForm.create({
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
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `RECON-FLOW-${createId()}`,
      name: 'Reconciliation flow',
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
  const finalActivity = await prisma.processFlowVersionStage.create({
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
  const financialYear = await createTestFinancialYear();
  const stageStatuses = [
    {
      id: createId(),
      processFlowVersionStageId: finishing.id,
      stageSequence: 1,
      stageNameSnapshot: 'Finishing',
      status: finalStageStatus,
    },
  ];
  if (secondStageStatus) {
    const extraStage = await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: flow.versions[0]!.id,
        sequence: 0,
        name: 'Cutting',
        code: 'CUTTING',
      },
    });
    stageStatuses.unshift({
      id: createId(),
      processFlowVersionStageId: extraStage.id,
      stageSequence: 0,
      stageNameSnapshot: 'Cutting',
      status: secondStageStatus,
    });
  }
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-RECON-${createId()}`,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: 10,
      status: jobOrderStatus,
      factoryConfirmationStatus: 'CONFIRMED',
      preparedQuantityTotal,
      productionCompletedAt,
      createdBy: user.userId,
      financialYearId: financialYear.id,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          orderedQuantityTotal,
          preparedQuantityTotal,
          sizes: {
            create: [{ id: createId(), sizeId: size.id, orderedQuantity: orderedQuantityTotal, preparedQuantity: preparedQuantityTotal }],
          },
        },
      },
      stageStatuses: { create: stageStatuses },
    },
    include: { stageStatuses: true },
  });
  for (const [index, batch] of batches.entries()) {
    await prisma.finalQualityBatch.create({
      data: {
        id: createId(),
        jobOrderId: job.id,
        processFlowActivityId: finalActivity.id,
        batchNumber: index + 1,
        physicalQuantity: batch.physicalQuantity,
        disposition: batch.disposition,
        createdById: user.userId,
        ...(batch.disposition === 'AWAITING_REINSPECTION'
          ? {}
          : { terminalById: user.userId, terminalAt: new Date() }),
      },
    });
  }
  return { job, user, finishing };
}

describe('Job Order completion reconciliation (DEMO-013 + DEMO-017 repair)', () => {
  it('finds and repairs a Job Order stuck with status=PRODUCTION_COMPLETE, productionCompletedAt=null, and the final stage solely IN_PROGRESS', async () => {
    const { job } = await seed({});
    const plan = planCompletionReconciliation(await loadReconciliationCandidateRows());
    expect(summarizeReconciliationPlan(plan)).toMatchObject({ totalInspected: 1, repairable: 1 });
    expect(plan.candidates).toMatchObject([
      { jobOrderId: job.id, preparedQuantityTotal: 60, resolvedPhysicalCoverage: 60 },
    ]);

    const operator = await createTestUserAndToken({
      email: `operator-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const result = await executeCompletionReconciliation(plan.candidates, operator.userId);
    expect(result).toEqual({ repaired: [job.id], skippedStale: [] });

    const repaired = await prisma.jobOrder.findUniqueOrThrow({
      where: { id: job.id },
      include: { stageStatuses: true },
    });
    expect(repaired.status).toBe('PRODUCTION_COMPLETE');
    expect(repaired.productionCompletedAt).not.toBeNull();
    expect(repaired.stageStatuses).toMatchObject([
      { status: 'COMPLETED', completedBy: null },
    ]);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'JobOrder', entityId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      'JOB_ORDER_PRODUCTION_COMPLETION_BACKFILLED',
      'JOB_ORDER_STAGE_COMPLETED_AUTOMATIC',
    ]);
    expect(audits[0]!.actorId).toBe(operator.userId);
  });

  it('does not touch a Job Order that is not yet stuck (productionCompletedAt already set)', async () => {
    await seed({ productionCompletedAt: new Date(), finalStageStatus: 'COMPLETED' });
    const rows = await loadReconciliationCandidateRows();
    expect(rows).toHaveLength(0);
  });

  it('is not fooled by status alone: a quantity mismatch is skipped, not repaired', async () => {
    await seed({ orderedQuantityTotal: 60, preparedQuantityTotal: 50, batches: [{ physicalQuantity: 50, disposition: 'PERMANENTLY_REJECTED' }] });
    const plan = planCompletionReconciliation(await loadReconciliationCandidateRows());
    expect(summarizeReconciliationPlan(plan)).toMatchObject({ repairable: 0, PREPARED_QUANTITY_MISMATCH: 1 });
  });

  it('skips a Job Order whose Final QA coverage is not actually fully resolved', async () => {
    await seed({
      batches: [
        { physicalQuantity: 30, disposition: 'PERMANENTLY_REJECTED' },
        { physicalQuantity: 30, disposition: 'AWAITING_REINSPECTION' },
      ],
    });
    const plan = planCompletionReconciliation(await loadReconciliationCandidateRows());
    expect(summarizeReconciliationPlan(plan)).toMatchObject({ repairable: 0, FINAL_QA_NOT_FULLY_RESOLVED: 1 });
  });

  it('skips a Job Order with more than one stage still open rather than guessing which to complete', async () => {
    await seed({ secondStageStatus: 'IN_PROGRESS' });
    const plan = planCompletionReconciliation(await loadReconciliationCandidateRows());
    expect(summarizeReconciliationPlan(plan)).toMatchObject({ repairable: 0, FINAL_STAGE_NOT_SOLELY_OPEN: 1 });
  });

  it('skips a candidate that changed since planning instead of forcing the write', async () => {
    const { job, finishing } = await seed({});
    const plan = planCompletionReconciliation(await loadReconciliationCandidateRows());
    // Someone else resolves it (e.g. a real factory user) between plan and execute.
    await prisma.jobOrderStageStatus.updateMany({
      where: { jobOrderId: job.id, processFlowVersionStageId: finishing.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const operator = await createTestUserAndToken({
      email: `operator-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const result = await executeCompletionReconciliation(plan.candidates, operator.userId);
    expect(result).toEqual({ repaired: [], skippedStale: [job.id] });
  });
});
