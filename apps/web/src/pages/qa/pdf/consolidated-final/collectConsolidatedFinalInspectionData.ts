import type { ApiSuccessResponse, FinalQualityBatchView, QualityExecutionView } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { runWithConcurrency } from '../../../../lib/pdf/images.js';

const BATCH_FETCH_CONCURRENCY = 4;
const ATTEMPT_FETCH_CONCURRENCY = 4;

/**
 * Thrown whenever the consolidated report cannot be safely/completely assembled — a batch or
 * attempt fails to load, fails its ownership check, or the seed execution isn't Final Inspection
 * data at all. Every caller (ultimately `usePdfAction`) treats this as a recoverable export error:
 * never render a partial/misleading consolidated report (ISS-049 §9/§11).
 */
export class ConsolidatedFinalInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsolidatedFinalInspectionError';
  }
}

export interface ConsolidatedFinalBatchSnapshot {
  /** Authoritative batch-level record — physicalQuantity, allocations, disposition, release, and
   * per-attempt identity/outcome summary (inspector name, status, outcome, rejection reason). */
  batch: FinalQualityBatchView;
  /** One full `QualityExecutionView` per attempt in `batch.attempts`, same order, each fetched
   * individually — this is the only source of that attempt's own sections/responses/attachments. */
  attempts: QualityExecutionView[];
}

export interface ConsolidatedFinalInspectionSnapshot {
  /** The execution the user was viewing when they requested the consolidated export — supplies
   * Job Order/Style identity and the authoritative `coverage` used for Section D reconciliation. */
  seedExecution: QualityExecutionView;
  jobOrderId: string;
  processFlowActivityId: string;
  /** Every persisted physical batch for this Job Order + activity, sorted by batchNumber ascending,
   * including cancelled batches (discovered from `seedExecution.coverage.batches`, which already
   * carries cancelled history per ISS-048). */
  batches: ConsolidatedFinalBatchSnapshot[];
}

/**
 * Collects every persisted Final Inspection physical batch and every attempt within each batch for
 * one Job Order + process-flow activity, composed entirely from existing authorized read endpoints
 * (`GET /quality-executions/:id`, `GET /quality-executions/final-batches/:batchId`) — no new
 * backend endpoint. Each "attempt" referenced by a batch is itself a `QualityActivityExecution`
 * row, so its id is fetched again through the same `GET /quality-executions/:id` the single-
 * execution PDF already uses, to obtain that attempt's own sections/responses/attachments (the
 * batch-detail endpoint only returns attempt summaries, never full form content).
 *
 * Every fetched batch and attempt is validated against the seed execution's own jobOrderId/
 * processFlowActivityId before being trusted (never relies on batch numbers or client-supplied ids
 * alone) — a mismatch throws `ConsolidatedFinalInspectionError` rather than silently including
 * foreign data. Network/authorization failures throw the same way: a required inspection record
 * (as opposed to an optional evidence image) never degrades to a placeholder.
 */
export async function collectConsolidatedFinalInspectionData(
  seedExecution: QualityExecutionView,
): Promise<ConsolidatedFinalInspectionSnapshot> {
  if (!seedExecution.finalBatch) {
    throw new ConsolidatedFinalInspectionError(
      'This inspection record is not part of a Final Inspection physical batch.',
    );
  }
  const coverage = seedExecution.coverage;
  if (!coverage) {
    throw new ConsolidatedFinalInspectionError(
      'Physical batch coverage is unavailable for this Final Inspection activity.',
    );
  }
  const { jobOrderId, processFlowActivityId } = seedExecution;

  const batchRefs = [...coverage.batches].sort((left, right) => left.batchNumber - right.batchNumber);
  if (batchRefs.length === 0) {
    throw new ConsolidatedFinalInspectionError(
      'No Final Inspection physical batches were found for this Job Order.',
    );
  }

  const fetchedBatches = new Array<FinalQualityBatchView>(batchRefs.length);
  await runWithConcurrency(
    batchRefs.map((ref, index) => ({ ref, index })),
    BATCH_FETCH_CONCURRENCY,
    async ({ ref, index }) => {
      let batch: FinalQualityBatchView;
      try {
        batch = (
          await apiClient.get<ApiSuccessResponse<FinalQualityBatchView>>(
            `/quality-executions/final-batches/${ref.id}`,
          )
        ).data.data;
      } catch {
        throw new ConsolidatedFinalInspectionError(
          `Unable to load Final Inspection Batch ${ref.batchNumber}. The consolidated report could not be completed.`,
        );
      }
      assertOwnership(batch.jobOrderId, jobOrderId, 'A Final Inspection batch belongs to a different Job Order.');
      assertOwnership(
        batch.processFlowActivityId,
        processFlowActivityId,
        'A Final Inspection batch belongs to a different inspection activity.',
      );
      fetchedBatches[index] = batch;
    },
  );

  // Flatten every attempt across every batch into one bounded fetch pool, rather than nesting a
  // pool per batch — keeps total in-flight requests bounded regardless of batch/attempt count.
  const attemptRefs = fetchedBatches.flatMap((batch) =>
    [...batch.attempts]
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => ({ batchId: batch.id, attemptId: attempt.id, attemptNumber: attempt.attemptNumber })),
  );

  const attemptsById = new Map<string, QualityExecutionView>();
  await runWithConcurrency(attemptRefs, ATTEMPT_FETCH_CONCURRENCY, async (ref) => {
    let execution: QualityExecutionView;
    try {
      execution = (
        await apiClient.get<ApiSuccessResponse<QualityExecutionView>>(`/quality-executions/${ref.attemptId}`)
      ).data.data;
    } catch {
      throw new ConsolidatedFinalInspectionError(
        `Unable to load Attempt ${ref.attemptNumber}. The consolidated report could not be completed.`,
      );
    }
    assertOwnership(execution.jobOrderId, jobOrderId, 'An inspection attempt belongs to a different Job Order.');
    assertOwnership(
      execution.processFlowActivityId,
      processFlowActivityId,
      'An inspection attempt belongs to a different inspection activity.',
    );
    if (execution.finalBatch?.id !== ref.batchId) {
      throw new ConsolidatedFinalInspectionError(
        'An inspection attempt is not linked to its expected Final Inspection batch.',
      );
    }
    attemptsById.set(ref.attemptId, execution);
  });

  const batches: ConsolidatedFinalBatchSnapshot[] = fetchedBatches.map((batch) => ({
    batch,
    attempts: [...batch.attempts]
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => {
        const execution = attemptsById.get(attempt.id);
        if (!execution) {
          throw new ConsolidatedFinalInspectionError(
            `Attempt ${attempt.attemptNumber} of Batch ${batch.batchNumber} could not be resolved.`,
          );
        }
        return execution;
      }),
  }));

  return { seedExecution, jobOrderId, processFlowActivityId, batches };
}

function assertOwnership(
  actual: string | undefined,
  expected: string,
  message: string,
): void {
  if (actual === undefined || actual !== expected) throw new ConsolidatedFinalInspectionError(message);
}
