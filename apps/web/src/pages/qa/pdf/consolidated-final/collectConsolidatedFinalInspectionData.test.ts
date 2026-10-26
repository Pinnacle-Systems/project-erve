import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import {
  ConsolidatedFinalInspectionError,
  collectConsolidatedFinalInspectionData,
} from './collectConsolidatedFinalInspectionData.js';
import { makeAttemptExecution, makeFinalBatchView, makeRegressionFixture } from './consolidatedFinalInspectionTestFixture.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockApi(batchesById: Record<string, unknown>, attemptsById: Record<string, unknown>) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    const batchMatch = /\/quality-executions\/final-batches\/(.+)$/.exec(url);
    if (batchMatch) {
      const batch = batchesById[batchMatch[1]!];
      if (!batch) throw Object.assign(new Error('not found'), { response: { status: 404 } });
      return { data: { data: batch } };
    }
    const executionMatch = /\/quality-executions\/([^/]+)$/.exec(url);
    if (executionMatch) {
      const execution = attemptsById[executionMatch[1]!];
      if (!execution) throw Object.assign(new Error('not found'), { response: { status: 404 } });
      return { data: { data: execution } };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  });
}

describe('collectConsolidatedFinalInspectionData', () => {
  it('rejects a seed execution with no finalBatch (PPM/Inline never offer this export)', async () => {
    const seed = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
    seed.finalBatch = null;
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: seed } });
    await expect(collectConsolidatedFinalInspectionData(seed)).rejects.toThrow(ConsolidatedFinalInspectionError);
  });

  it('rejects a seed execution with no coverage', async () => {
    const seed = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
    seed.coverage = null;
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: seed } });
    await expect(collectConsolidatedFinalInspectionData(seed)).rejects.toThrow(ConsolidatedFinalInspectionError);
  });

  it('rejects when coverage reports zero physical batches', async () => {
    const seed = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
    seed.coverage = {
      preparedQuantityAuthoritative: false,
      preparedQuantity: null,
      inspectedQuantity: 0,
      remainingQuantity: null,
      complete: false,
      reconciliationConflict: false,
      state: 'UNKNOWN',
      passedBatches: 0,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [],
    };
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: seed } });
    await expect(collectConsolidatedFinalInspectionData(seed)).rejects.toThrow(ConsolidatedFinalInspectionError);
  });

  it('1: collects one physical batch with one attempt', async () => {
    const batch = makeFinalBatchView({ id: 'b1', batchNumber: 1, physicalQuantity: 10 });
    const attempt = makeAttemptExecution({ id: 'b1-attempt-1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
    const seed = { ...attempt };
    seed.coverage = {
      preparedQuantityAuthoritative: true,
      preparedQuantity: 10,
      inspectedQuantity: 10,
      remainingQuantity: 0,
      complete: true,
      reconciliationConflict: false,
      state: 'COMPLETE',
      passedBatches: 1,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [
        {
          id: 'b1',
          batchNumber: 1,
          physicalQuantity: 10,
          inspectedQuantity: 10,
          status: 'FINALIZED',
          outcome: 'PASS',
          disposition: 'RELEASED',
          finalizedAt: null,
          allocations: [],
          attemptCount: 1,
        },
      ],
    };
    // The seed's own id ('b1-attempt-1') is also the id of the one attempt inside batch `b1` —
    // register `seed` (the version carrying the custom coverage), not the plain `attempt`, so the
    // fresh seed fetch and the end-of-collection recheck both see the coverage this test asserts
    // against, exactly as the real `GET /quality-executions/:id` would.
    mockApi({ b1: batch }, { 'b1-attempt-1': seed });

    const result = await collectConsolidatedFinalInspectionData(seed);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]!.attempts).toHaveLength(1);
    expect(result.batches[0]!.attempts[0]!.id).toBe('b1-attempt-1');
  });

  it('2-4/6-8/13: collects the full §13B regression fixture — two active batches, one cancelled, deterministic order', async () => {
    const fixture = makeRegressionFixture();
    mockApi(fixture.batchesById, fixture.attemptExecutions);

    const result = await collectConsolidatedFinalInspectionData(fixture.seedExecution);

    expect(result.batches.map((b) => b.batch.batchNumber)).toEqual([1, 2, 3]);
    expect(result.batches[0]!.attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(result.batches[1]!.attempts.map((a) => a.attemptNumber)).toEqual([1]);
    expect(result.batches[2]!.batch.disposition).toBe('CANCELLED');
    expect(result.batches[2]!.attempts).toHaveLength(1);
    expect(result.batches[2]!.attempts[0]!.status).toBe('CANCELLED');
  });

  it('5: a batch with only a DRAFT attempt is collected with that attempt marked DRAFT, never a fabricated outcome', async () => {
    const batch = makeFinalBatchView({
      id: 'b1',
      batchNumber: 1,
      physicalQuantity: 30,
      disposition: 'DRAFT',
      release: null,
      attempts: [
        {
          id: 'b1-attempt-1',
          attemptNumber: 1,
          status: 'DRAFT',
          outcome: null,
          rejectionReason: null,
          startedBy: { id: 'u1', name: 'Inspector', email: 'i@test' },
          startedAt: '2026-01-01T00:00:00Z',
          finalizedBy: null,
          finalizedAt: null,
        },
      ],
    });
    const attempt = makeAttemptExecution({
      id: 'b1-attempt-1',
      finalBatchId: 'b1',
      batchNumber: 1,
      attemptNumber: 1,
      status: 'DRAFT',
      outcomeValue: null,
    });
    const seed = { ...attempt };
    seed.coverage = {
      preparedQuantityAuthoritative: true,
      preparedQuantity: 30,
      inspectedQuantity: 0,
      remainingQuantity: 30,
      complete: false,
      reconciliationConflict: false,
      state: 'IN_PROGRESS',
      passedBatches: 0,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [
        {
          id: 'b1',
          batchNumber: 1,
          physicalQuantity: 30,
          inspectedQuantity: 0,
          status: 'DRAFT',
          outcome: null,
          disposition: 'DRAFT',
          finalizedAt: null,
          allocations: [],
          attemptCount: 1,
        },
      ],
    };
    mockApi({ b1: batch }, { 'b1-attempt-1': seed });

    const result = await collectConsolidatedFinalInspectionData(seed);
    expect(result.batches[0]!.attempts[0]!.status).toBe('DRAFT');
  });

  it('10: rejects when a batch reports an unexpected cross-Job Order id', async () => {
    const fixture = makeRegressionFixture();
    const tamperedBatch1 = { ...fixture.batchesById['batch-1']!, jobOrderId: 'some-other-job-order' };
    mockApi({ ...fixture.batchesById, 'batch-1': tamperedBatch1 }, fixture.attemptExecutions);

    await expect(collectConsolidatedFinalInspectionData(fixture.seedExecution)).rejects.toThrow(
      ConsolidatedFinalInspectionError,
    );
  });

  it('10b: rejects when an attempt execution reports an unexpected cross-Job Order id', async () => {
    const fixture = makeRegressionFixture();
    const tamperedAttempt = { ...fixture.attemptExecutions['batch1-attempt1']!, jobOrderId: 'some-other-job-order' };
    mockApi(fixture.batchesById, { ...fixture.attemptExecutions, 'batch1-attempt1': tamperedAttempt });

    await expect(collectConsolidatedFinalInspectionData(fixture.seedExecution)).rejects.toThrow(
      ConsolidatedFinalInspectionError,
    );
  });

  it('11: rejects (recoverable export error) when an attempt is missing/inaccessible', async () => {
    const fixture = makeRegressionFixture();
    const attemptsWithoutOne: Record<string, unknown> = { ...fixture.attemptExecutions };
    delete attemptsWithoutOne['batch1-attempt1'];
    mockApi(fixture.batchesById, attemptsWithoutOne);

    await expect(collectConsolidatedFinalInspectionData(fixture.seedExecution)).rejects.toThrow(
      ConsolidatedFinalInspectionError,
    );
  });

  it('12: rejects (recoverable export error) on a partial batch-fetch failure, never returning a partial report', async () => {
    const fixture = makeRegressionFixture();
    const batchesWithoutOne: Record<string, unknown> = { ...fixture.batchesById };
    delete batchesWithoutOne['batch-2'];
    mockApi(batchesWithoutOne, fixture.attemptExecutions);

    await expect(collectConsolidatedFinalInspectionData(fixture.seedExecution)).rejects.toThrow(
      ConsolidatedFinalInspectionError,
    );
  });

  // ISS-049 follow-up: discovery/reconciliation must always use a *fresh* fetch, never the
  // caller's cached execution — another user may have created/cancelled/reinspected/released a
  // physical batch since the page loaded.
  describe('freshness — never trusts the caller-supplied execution for discovery/reconciliation', () => {
    const BATCH_1_ENTRY = {
      id: 'b1',
      batchNumber: 1,
      physicalQuantity: 60,
      inspectedQuantity: 60,
      status: 'FINALIZED' as const,
      outcome: 'PASS' as const,
      disposition: 'RELEASED' as const,
      finalizedAt: null,
      allocations: [],
      attemptCount: 1,
    };
    const BATCH_2_ENTRY = {
      id: 'b2',
      batchNumber: 2,
      physicalQuantity: 12,
      inspectedQuantity: 12,
      status: 'FINALIZED' as const,
      outcome: 'PASS' as const,
      disposition: 'RELEASED' as const,
      finalizedAt: null,
      allocations: [],
      attemptCount: 1,
    };

    it('cached execution reflects only Batch 1, but the fresh export-time response already has Batch 1 + Batch 2 — both are collected', async () => {
      const cached = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
      cached.coverage = {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 60,
        inspectedQuantity: 60,
        remainingQuantity: 0,
        complete: true,
        reconciliationConflict: false,
        state: 'COMPLETE',
        passedBatches: 1,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [BATCH_1_ENTRY],
      };
      const fresh = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
      fresh.coverage = {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 72,
        inspectedQuantity: 72,
        reservedForFinalQuantity: 72,
        releasedQuantity: 72,
        remainingQuantity: 0,
        complete: true,
        reconciliationConflict: false,
        state: 'COMPLETE',
        passedBatches: 2,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [BATCH_1_ENTRY, BATCH_2_ENTRY],
      };
      const batch1 = makeFinalBatchView({
        id: 'b1',
        batchNumber: 1,
        physicalQuantity: 60,
        attempts: [{ id: 'e1', attemptNumber: 1, status: 'FINALIZED', outcome: 'PASS', rejectionReason: null, startedAt: '', finalizedAt: null }],
      });
      const batch2 = makeFinalBatchView({
        id: 'b2',
        batchNumber: 2,
        physicalQuantity: 12,
        attempts: [{ id: 'e2', attemptNumber: 1, status: 'FINALIZED', outcome: 'PASS', rejectionReason: null, startedAt: '', finalizedAt: null }],
      });
      const attempt2 = makeAttemptExecution({ id: 'e2', finalBatchId: 'b2', batchNumber: 2, attemptNumber: 1 });
      mockApi({ b1: batch1, b2: batch2 }, { e1: fresh, e2: attempt2 });

      const result = await collectConsolidatedFinalInspectionData(cached);
      expect(result.batches.map((b) => b.batch.id)).toEqual(['b1', 'b2']);
    });

    it('cached coverage shows 60 released; the fresh response shows 72 — the snapshot reports 72, never the stale 60', async () => {
      const cached = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
      cached.coverage = {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 60,
        inspectedQuantity: 60,
        releasedQuantity: 60,
        remainingQuantity: 0,
        complete: true,
        reconciliationConflict: false,
        state: 'COMPLETE',
        passedBatches: 1,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [BATCH_1_ENTRY],
      };
      const fresh = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
      fresh.coverage = {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 72,
        inspectedQuantity: 72,
        reservedForFinalQuantity: 72,
        releasedQuantity: 72,
        remainingQuantity: 0,
        complete: true,
        reconciliationConflict: false,
        state: 'COMPLETE',
        passedBatches: 2,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [BATCH_1_ENTRY, BATCH_2_ENTRY],
      };
      const batch1 = makeFinalBatchView({
        id: 'b1',
        batchNumber: 1,
        physicalQuantity: 60,
        attempts: [{ id: 'e1', attemptNumber: 1, status: 'FINALIZED', outcome: 'PASS', rejectionReason: null, startedAt: '', finalizedAt: null }],
      });
      const batch2 = makeFinalBatchView({
        id: 'b2',
        batchNumber: 2,
        physicalQuantity: 12,
        attempts: [{ id: 'e2', attemptNumber: 1, status: 'FINALIZED', outcome: 'PASS', rejectionReason: null, startedAt: '', finalizedAt: null }],
      });
      const attempt2 = makeAttemptExecution({ id: 'e2', finalBatchId: 'b2', batchNumber: 2, attemptNumber: 1 });
      mockApi({ b1: batch1, b2: batch2 }, { e1: fresh, e2: attempt2 });

      const result = await collectConsolidatedFinalInspectionData(cached);
      expect(result.seedExecution.coverage!.releasedQuantity).toBe(72);
    });

    it('a failed/forbidden fresh fetch aborts immediately — never falls back to the cached execution for batch discovery', async () => {
      const cached = makeAttemptExecution({ id: 'e1', finalBatchId: 'b1', batchNumber: 1, attemptNumber: 1 });
      cached.coverage = {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 60,
        inspectedQuantity: 60,
        remainingQuantity: 0,
        complete: true,
        reconciliationConflict: false,
        state: 'COMPLETE',
        passedBatches: 1,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [BATCH_1_ENTRY],
      };
      const get = vi
        .spyOn(apiClient, 'get')
        .mockRejectedValue(Object.assign(new Error('Forbidden'), { response: { status: 403 } }));

      await expect(collectConsolidatedFinalInspectionData(cached)).rejects.toThrow(ConsolidatedFinalInspectionError);
      // Only the fresh seed fetch was ever attempted — the cached batch list was never consulted.
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('/quality-executions/e1');
    });

    it('a fresh response reporting a different execution id/Job Order/activity than the cached one is rejected', async () => {
      const cached = makeAttemptExecution({
        id: 'e1',
        jobOrderId: 'jo-1',
        processFlowActivityId: 'activity-final-1',
        finalBatchId: 'b1',
        batchNumber: 1,
        attemptNumber: 1,
      });
      const freshWrongJobOrder = makeAttemptExecution({
        id: 'e1',
        jobOrderId: 'some-other-job-order',
        processFlowActivityId: 'activity-final-1',
        finalBatchId: 'b1',
        batchNumber: 1,
        attemptNumber: 1,
      });
      vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: freshWrongJobOrder } });

      await expect(collectConsolidatedFinalInspectionData(cached)).rejects.toThrow(ConsolidatedFinalInspectionError);
    });

    it('a concurrent batch/coverage change between the fresh fetch and the end-of-collection recheck rejects the export', async () => {
      const fixture = makeRegressionFixture();
      let seedCallCount = 0;
      vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
        const batchMatch = /\/quality-executions\/final-batches\/(.+)$/.exec(url);
        if (batchMatch) return { data: { data: fixture.batchesById[batchMatch[1]!] } };
        const executionMatch = /\/quality-executions\/([^/]+)$/.exec(url);
        const id = executionMatch![1]!;
        if (id === fixture.seedExecution.id) {
          seedCallCount += 1;
          // The first two calls (the initial fresh fetch, then the attempt-level fetch this same
          // id receives while its own batch's attempts are collected) see the unchanged fixture;
          // only the final end-of-collection recheck — guaranteed to be the 3rd and last call to
          // this id — simulates another user releasing more stock in the meantime.
          if (seedCallCount <= 2) return { data: { data: fixture.seedExecution } };
          return {
            data: {
              data: {
                ...fixture.seedExecution,
                coverage: { ...fixture.seedExecution.coverage!, releasedQuantity: 999 },
              },
            },
          };
        }
        return { data: { data: fixture.attemptExecutions[id] } };
      });

      await expect(collectConsolidatedFinalInspectionData(fixture.seedExecution)).rejects.toThrow(
        ConsolidatedFinalInspectionError,
      );
      expect(seedCallCount).toBe(3);
    });
  });

  it('never fetches more than the bounded concurrency limit of batches/attempts at once', async () => {
    const fixture = makeRegressionFixture();
    let active = 0;
    let peak = 0;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const batchMatch = /\/quality-executions\/final-batches\/(.+)$/.exec(url);
      if (batchMatch) return { data: { data: fixture.batchesById[batchMatch[1]!] } };
      const executionMatch = /\/quality-executions\/([^/]+)$/.exec(url);
      return { data: { data: fixture.attemptExecutions[executionMatch![1]!] } };
    });

    await collectConsolidatedFinalInspectionData(fixture.seedExecution);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
