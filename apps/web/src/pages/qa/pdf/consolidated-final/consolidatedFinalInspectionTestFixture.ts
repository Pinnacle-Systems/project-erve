import type { FinalQualityBatchView, QualityExecutionView } from '@erve/types';
import { makeQualityExecutionView } from '../execution/qualityExecutionTestFixture.js';

/**
 * Shared fixture builders for the consolidated Final Inspection PDF (collector/view-model/document
 * tests) — deliberately independent from `qualityExecutionTestFixture.ts`'s own Final-batch
 * fixtures (only reuses `makeQualityExecutionView` as the base shape for a per-attempt execution),
 * so a future change to the single-execution PDF's fixtures can't silently change what this report
 * exercises.
 */

export interface MakeFinalBatchViewOptions {
  id: string;
  jobOrderId?: string;
  processFlowActivityId?: string;
  batchNumber: number;
  physicalQuantity: number;
  disposition?: FinalQualityBatchView['disposition'];
  attempts?: FinalQualityBatchView['attempts'];
  release?: FinalQualityBatchView['release'];
  allocations?: FinalQualityBatchView['allocations'];
}

const DEFAULT_JOB_ORDER_ID = 'jo-1';
const DEFAULT_ACTIVITY_ID = 'activity-final-1';

export function makeFinalBatchView(options: MakeFinalBatchViewOptions): FinalQualityBatchView {
  return {
    id: options.id,
    jobOrderId: options.jobOrderId ?? DEFAULT_JOB_ORDER_ID,
    processFlowActivityId: options.processFlowActivityId ?? DEFAULT_ACTIVITY_ID,
    batchNumber: options.batchNumber,
    physicalQuantity: options.physicalQuantity,
    disposition: options.disposition ?? 'RELEASED',
    createdBy: { id: 'user-1', name: 'QA Manager', email: 'qa@erve.test' },
    createdAt: '2026-01-01T08:00:00Z',
    terminalBy: null,
    terminalAt: null,
    terminalReason: null,
    allocations: options.allocations ?? [
      { jobOrderLineSizeId: `${options.id}-size-1`, sizeCode: 'M', sizeLabel: 'Medium', quantity: options.physicalQuantity },
    ],
    attempts: options.attempts ?? [
      {
        id: `${options.id}-attempt-1`,
        attemptNumber: 1,
        status: 'FINALIZED',
        outcome: 'PASS',
        rejectionReason: null,
        startedBy: { id: 'user-2', name: 'Inspector One', email: 'inspector1@erve.test' },
        startedAt: '2026-01-02T09:00:00Z',
        finalizedBy: { id: 'user-2', name: 'Inspector One', email: 'inspector1@erve.test' },
        finalizedAt: '2026-01-02T11:00:00Z',
      },
    ],
    release:
      options.release !== undefined
        ? options.release
        : options.disposition === 'RELEASED' || options.disposition === undefined
          ? { id: `${options.id}-release`, releasedAt: '2026-01-02T12:00:00Z', quantity: options.physicalQuantity }
          : null,
  };
}

export interface MakeAttemptExecutionOptions {
  id: string;
  jobOrderId?: string;
  processFlowActivityId?: string;
  finalBatchId: string;
  batchNumber: number;
  attemptNumber: number;
  status?: QualityExecutionView['status'];
  outcomeValue?: 'PASS' | 'FAIL' | null;
  rejectionReason?: string | null;
  remarks?: string | null;
  attachments?: QualityExecutionView['attachments'];
}

/** A full per-attempt `QualityExecutionView`, as returned by `GET /quality-executions/:id`. */
export function makeAttemptExecution(options: MakeAttemptExecutionOptions): QualityExecutionView {
  const base = makeQualityExecutionView({
    id: options.id,
    jobOrderId: options.jobOrderId ?? DEFAULT_JOB_ORDER_ID,
    processFlowActivityId: options.processFlowActivityId ?? DEFAULT_ACTIVITY_ID,
    attemptNumber: options.attemptNumber,
    batchNumber: options.batchNumber,
    status: options.status ?? 'FINALIZED',
    attachments: options.attachments ?? [],
  });
  return {
    ...base,
    finalBatch: {
      id: options.finalBatchId,
      batchNumber: options.batchNumber,
      physicalQuantity: 0,
      disposition: 'DRAFT',
      allocations: [],
      attempts: [],
      release: null,
    },
    responses: {
      ...base.responses,
      outcome:
        options.outcomeValue === undefined
          ? base.responses.outcome
          : options.outcomeValue === null
            ? null
            : { componentId: 'outcome-1', value: options.outcomeValue, remarks: options.remarks ?? null, rejectionReason: options.rejectionReason ?? null },
    },
  };
}

/**
 * The §13B regression fixture: Batch 1 (60 pcs, FAIL then PASS), Batch 2 (12 pcs, one PASS), and a
 * cancelled Batch 3 (20 pcs, one cancelled DRAFT attempt) — the exact shape the spec's own
 * reconciliation example uses to prove the report prints 72, never 132.
 */
export function makeRegressionFixture() {
  const coverage: QualityExecutionView['coverage'] = {
    preparedQuantityAuthoritative: true,
    preparedQuantity: 72,
    inspectedQuantity: 72,
    inspectionActivityQuantity: 72,
    reservedForFinalQuantity: 72,
    inspectedPhysicalCoverage: 72,
    resolvedPhysicalCoverage: 72,
    physicalFinalCoverage: 72,
    releasedQuantity: 72,
    permanentlyRejectedQuantity: 0,
    awaitingReinspectionQuantity: 0,
    remainingQuantity: 0,
    availableForNewFinalBatch: 0,
    complete: true,
    coverageCompleteSoFar: true,
    finalQaComplete: true,
    reconciliationConflict: false,
    state: 'COMPLETE',
    passedBatches: 2,
    failedBatches: 1,
    hasFailedBatches: true,
    batches: [
      {
        id: 'batch-1',
        batchNumber: 1,
        physicalQuantity: 60,
        inspectedQuantity: 60,
        status: 'FINALIZED',
        outcome: 'PASS',
        disposition: 'RELEASED',
        finalizedAt: '2026-01-02T11:00:00Z',
        allocations: [{ jobOrderLineSizeId: 'batch-1-size-1', quantity: 60 }],
        attemptCount: 2,
      },
      {
        id: 'batch-2',
        batchNumber: 2,
        physicalQuantity: 12,
        inspectedQuantity: 12,
        status: 'FINALIZED',
        outcome: 'PASS',
        disposition: 'RELEASED',
        finalizedAt: '2026-01-03T11:00:00Z',
        allocations: [{ jobOrderLineSizeId: 'batch-2-size-1', quantity: 12 }],
        attemptCount: 1,
      },
      {
        id: 'batch-3',
        batchNumber: 3,
        physicalQuantity: 20,
        inspectedQuantity: 0,
        status: 'CANCELLED',
        outcome: null,
        disposition: 'CANCELLED',
        finalizedAt: null,
        allocations: [{ jobOrderLineSizeId: 'batch-3-size-1', quantity: 20 }],
        attemptCount: 1,
      },
    ],
  };

  const batch1 = makeFinalBatchView({
    id: 'batch-1',
    batchNumber: 1,
    physicalQuantity: 60,
    disposition: 'RELEASED',
    attempts: [
      {
        id: 'batch1-attempt1',
        attemptNumber: 1,
        status: 'FINALIZED',
        outcome: 'FAIL',
        rejectionReason: 'Measurement out of tolerance',
        startedBy: { id: 'user-2', name: 'Inspector One', email: 'inspector1@erve.test' },
        startedAt: '2026-01-01T09:00:00Z',
        finalizedBy: { id: 'user-2', name: 'Inspector One', email: 'inspector1@erve.test' },
        finalizedAt: '2026-01-01T11:00:00Z',
      },
      {
        id: 'batch1-attempt2',
        attemptNumber: 2,
        status: 'FINALIZED',
        outcome: 'PASS',
        rejectionReason: null,
        startedBy: { id: 'user-3', name: 'Inspector Two', email: 'inspector2@erve.test' },
        startedAt: '2026-01-02T09:00:00Z',
        finalizedBy: { id: 'user-3', name: 'Inspector Two', email: 'inspector2@erve.test' },
        finalizedAt: '2026-01-02T11:00:00Z',
      },
    ],
  });
  const batch2 = makeFinalBatchView({
    id: 'batch-2',
    batchNumber: 2,
    physicalQuantity: 12,
    disposition: 'RELEASED',
    attempts: [
      {
        id: 'batch2-attempt1',
        attemptNumber: 1,
        status: 'FINALIZED',
        outcome: 'PASS',
        rejectionReason: null,
        startedBy: { id: 'user-3', name: 'Inspector Two', email: 'inspector2@erve.test' },
        startedAt: '2026-01-03T09:00:00Z',
        finalizedBy: { id: 'user-3', name: 'Inspector Two', email: 'inspector2@erve.test' },
        finalizedAt: '2026-01-03T11:00:00Z',
      },
    ],
  });
  const batch3 = makeFinalBatchView({
    id: 'batch-3',
    batchNumber: 3,
    physicalQuantity: 20,
    disposition: 'CANCELLED',
    release: null,
    attempts: [
      {
        id: 'batch3-attempt1',
        attemptNumber: 1,
        status: 'CANCELLED',
        outcome: null,
        rejectionReason: null,
        startedBy: { id: 'user-2', name: 'Inspector One', email: 'inspector1@erve.test' },
        startedAt: '2026-01-04T09:00:00Z',
        finalizedBy: null,
        finalizedAt: null,
      },
    ],
  });

  const attemptExecutions: Record<string, QualityExecutionView> = {
    'batch1-attempt1': makeAttemptExecution({
      id: 'batch1-attempt1',
      finalBatchId: 'batch-1',
      batchNumber: 1,
      attemptNumber: 1,
      outcomeValue: 'FAIL',
      rejectionReason: 'Measurement out of tolerance',
      remarks: 'Shoulder seam measurement failed tolerance.',
      attachments: [
        {
          id: 'evidence-1a',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'batch1-attempt1-defect.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
          createdAt: '2026-01-01T10:00:00Z',
        },
      ],
    }),
    // This is also the §13B fixture's seed execution (the one the user was "viewing" when they
    // requested the export) — its own `coverage` is set below, once, so the object the mocked
    // `GET /quality-executions/batch1-attempt2` returns is identical to `seedExecution` and a
    // fresh re-fetch of it is trivially consistent in every "happy path" collector test.
    'batch1-attempt2': makeAttemptExecution({
      id: 'batch1-attempt2',
      finalBatchId: 'batch-1',
      batchNumber: 1,
      attemptNumber: 2,
      outcomeValue: 'PASS',
      remarks: 'Reinspection passed after rework.',
      attachments: [
        {
          id: 'evidence-1b',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'batch1-attempt2-pass.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
          createdAt: '2026-01-02T10:00:00Z',
        },
      ],
    }),
    'batch2-attempt1': makeAttemptExecution({
      id: 'batch2-attempt1',
      finalBatchId: 'batch-2',
      batchNumber: 2,
      attemptNumber: 1,
      outcomeValue: 'PASS',
      remarks: 'Clean first-pass inspection.',
      attachments: [
        {
          id: 'evidence-2a',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'batch2-attempt1-pass.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
          createdAt: '2026-01-03T10:00:00Z',
        },
      ],
    }),
    'batch3-attempt1': makeAttemptExecution({
      id: 'batch3-attempt1',
      finalBatchId: 'batch-3',
      batchNumber: 3,
      attemptNumber: 1,
      status: 'CANCELLED',
      outcomeValue: null,
      attachments: [],
    }),
  };

  const batchesById: Record<string, FinalQualityBatchView> = { 'batch-1': batch1, 'batch-2': batch2, 'batch-3': batch3 };

  // Same object the mocked `GET /quality-executions/batch1-attempt2` serves from
  // `attemptExecutions` — a fresh re-fetch of the seed is therefore identical to the seed itself
  // in every test that doesn't deliberately simulate a concurrent change.
  const seedExecution = attemptExecutions['batch1-attempt2']!;
  seedExecution.coverage = coverage;

  return {
    seedExecution,
    batchesById,
    attemptExecutions,
  };
}
