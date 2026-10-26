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
  /** A *freshly fetched* `GET /quality-executions/:id` response for the execution the user was
   * viewing (same id, re-checked against the caller's own cached copy) — never the caller's cached
   * object. Supplies Job Order/Style identity and the authoritative `coverage` used for Section D
   * reconciliation, both as of the moment collection started. */
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
 * `cachedExecution` is only ever used for its identity (id/jobOrderId/processFlowActivityId) — the
 * caller's already-rendered, potentially stale, page state. Discovery and reconciliation always
 * run against a *fresh* `GET /quality-executions/:id` fetched here (another user may have created,
 * cancelled, reinspected, or released a physical batch since the page loaded), and that fresh
 * response's identity is checked against `cachedExecution`'s before it's trusted — never falls back
 * to the cached object's own `coverage`/`finalBatch`.
 *
 * Every fetched batch and attempt is validated against the fresh seed's own jobOrderId/
 * processFlowActivityId before being trusted (never relies on batch numbers or client-supplied ids
 * alone) — a mismatch throws `ConsolidatedFinalInspectionError` rather than silently including
 * foreign data. Network/authorization failures throw the same way: a required inspection record
 * (as opposed to an optional evidence image) never degrades to a placeholder.
 *
 * Finally, because batch/attempt fetches below take real wall-clock time, a lightweight
 * end-of-collection recheck re-fetches the seed execution once more and compares a coverage
 * fingerprint against the one collection started with — a concurrent change mid-collection rejects
 * the export rather than silently rendering a report that mixes two different moments in time.
 */
export async function collectConsolidatedFinalInspectionData(
  cachedExecution: QualityExecutionView,
): Promise<ConsolidatedFinalInspectionSnapshot> {
  const seedExecution = await fetchFreshExecution(cachedExecution.id);
  assertSameIdentity(seedExecution, cachedExecution);

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

  // Lightweight end-of-collection consistency check (never a new snapshot/versioning framework):
  // re-fetch the same execution id once more and compare coverage fingerprints. Collection above
  // can take real time (one fetch per batch, one per attempt); if someone else finalized a new
  // attempt, cancelled/released/reinspected a batch, or changed coverage totals while it ran, the
  // batches/figures gathered above no longer describe one consistent moment — reject rather than
  // print a report mixing old and new state.
  const recheckExecution = await fetchFreshExecution(cachedExecution.id);
  if (coverageFingerprint(seedExecution.coverage) !== coverageFingerprint(recheckExecution.coverage)) {
    throw new ConsolidatedFinalInspectionError(
      'Final Inspection records for this Job Order changed while this report was being prepared. Please try again.',
    );
  }

  return { seedExecution, jobOrderId, processFlowActivityId, batches };
}

async function fetchFreshExecution(executionId: string): Promise<QualityExecutionView> {
  try {
    return (
      await apiClient.get<ApiSuccessResponse<QualityExecutionView>>(`/quality-executions/${executionId}`)
    ).data.data;
  } catch {
    throw new ConsolidatedFinalInspectionError(
      'Unable to load the current Final Inspection record. The consolidated report could not be completed.',
    );
  }
}

function assertSameIdentity(fresh: QualityExecutionView, cached: QualityExecutionView): void {
  if (
    fresh.id !== cached.id ||
    fresh.jobOrderId !== cached.jobOrderId ||
    fresh.processFlowActivityId !== cached.processFlowActivityId
  ) {
    throw new ConsolidatedFinalInspectionError(
      'The Final Inspection record changed identity while refreshing. The consolidated report could not be completed safely.',
    );
  }
}

/** A deterministic, order-independent string summary of everything the consolidated report's
 * batch discovery and Section D reconciliation read from `coverage` — used only to detect change
 * between two fetches of the same execution id, never persisted or compared across executions. */
function coverageFingerprint(coverage: QualityExecutionView['coverage']): string {
  if (!coverage) return 'null';
  const batches = [...coverage.batches]
    .sort((left, right) => left.batchNumber - right.batchNumber)
    .map(
      (batch) =>
        `${batch.id}:${batch.batchNumber}:${batch.physicalQuantity ?? ''}:${batch.status}:${batch.outcome ?? ''}:${batch.disposition ?? ''}:${batch.finalizedAt ?? ''}:${batch.attemptCount ?? ''}`,
    )
    .join('|');
  const totals = [
    coverage.reservedForFinalQuantity,
    coverage.releasedQuantity,
    coverage.permanentlyRejectedQuantity,
    coverage.awaitingReinspectionQuantity,
    coverage.resolvedPhysicalCoverage,
    coverage.inspectedPhysicalCoverage,
  ].join(',');
  return `${batches}::${totals}`;
}

function assertOwnership(
  actual: string | undefined,
  expected: string,
  message: string,
): void {
  if (actual === undefined || actual !== expected) throw new ConsolidatedFinalInspectionError(message);
}
