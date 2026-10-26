import { describe, expect, it } from 'vitest';
import { buildConsolidatedFinalInspectionViewModel } from './buildConsolidatedFinalInspectionViewModel.js';
import { makeRegressionFixture } from './consolidatedFinalInspectionTestFixture.js';
import type { ConsolidatedFinalInspectionSnapshot } from './collectConsolidatedFinalInspectionData.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

function makeSnapshot(): ConsolidatedFinalInspectionSnapshot {
  const fixture = makeRegressionFixture();
  return {
    seedExecution: fixture.seedExecution,
    jobOrderId: fixture.seedExecution.jobOrderId,
    processFlowActivityId: fixture.seedExecution.processFlowActivityId,
    batches: [
      { batch: fixture.batchesById['batch-1']!, attempts: [fixture.attemptExecutions['batch1-attempt1']!, fixture.attemptExecutions['batch1-attempt2']!] },
      { batch: fixture.batchesById['batch-2']!, attempts: [fixture.attemptExecutions['batch2-attempt1']!] },
      { batch: fixture.batchesById['batch-3']!, attempts: [fixture.attemptExecutions['batch3-attempt1']!] },
    ],
  };
}

describe('buildConsolidatedFinalInspectionViewModel — §13B physical quantity regression fixture', () => {
  it('reports the active physical quantity as 72, never 132 (60 + 60 + 12 double-count)', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.reconciliation.activePhysicalQuantity).toBe(72);
    expect(viewModel.reconciliation.activePhysicalQuantity).not.toBe(132);
  });

  it('reports released quantity as 72', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.reconciliation.releasedQuantity).toBe(72);
  });

  it('counts batch physical quantity exactly once per batch (60 for Batch 1, 12 for Batch 2), never once per attempt', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.batches[0]).toMatchObject({ batchNumber: 1, physicalQuantity: 60 });
    expect(viewModel.batches[1]).toMatchObject({ batchNumber: 2, physicalQuantity: 12 });
    expect(viewModel.summaryRows[0]).toMatchObject({ batchNumber: 1, physicalQuantity: 60 });
  });

  it('reports 4 total recorded attempts (2 + 1 + 1 cancelled-draft), distinct from active physical batch count of 2', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.reconciliation.totalAttemptCount).toBe(4);
    expect(viewModel.reconciliation.activeBatchCount).toBe(2);
    expect(viewModel.reconciliation.totalBatchCount).toBe(3);
  });

  it('cancelled Batch 3 contributes zero active physical/released quantity but is still represented', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const batch3 = viewModel.batches.find((b) => b.batchNumber === 3)!;
    expect(batch3.isCancelled).toBe(true);
    expect(batch3.releasedQuantity).toBeNull();
    // Batch 3's own physicalQuantity (20) is still shown for historical transparency, but it is
    // excluded from `reconciliation.activePhysicalQuantity` (72, not 92) because that field comes
    // straight from the server's own `coverage.reservedForFinalQuantity`, which already excludes it.
    expect(batch3.physicalQuantity).toBe(20);
    expect(viewModel.reconciliation.activePhysicalQuantity).toBe(72);
  });

  it('individual size allocations are counted once per batch, not duplicated per attempt', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.batches[0]!.allocations).toHaveLength(1);
    expect(viewModel.batches[0]!.allocations[0]).toMatchObject({ quantity: 60 });
  });
});

describe('buildConsolidatedFinalInspectionViewModel — historical fidelity', () => {
  it('Attempt 1 FAIL and Attempt 2 PASS are both preserved with their own rejection reason/remarks, never leaking between attempts', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const [attempt1, attempt2] = viewModel.batches[0]!.attempts;
    expect(attempt1).toMatchObject({
      attemptNumber: 1,
      outcomeLabel: 'FAIL',
      rejectionReason: 'Measurement out of tolerance',
      remarks: 'Shoulder seam measurement failed tolerance.',
    });
    expect(attempt2).toMatchObject({
      attemptNumber: 2,
      outcomeLabel: 'PASS',
      rejectionReason: null,
      remarks: 'Reinspection passed after rework.',
    });
  });

  it('inspector names and timestamps are attached to the correct attempt', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const [attempt1, attempt2] = viewModel.batches[0]!.attempts;
    expect(attempt1!.finalizedByName).toBe('Inspector One');
    expect(attempt2!.finalizedByName).toBe('Inspector Two');
  });

  it('a CANCELLED attempt never carries a fabricated PASS/FAIL outcome or rejection reason', () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const batch3Attempt = viewModel.batches[2]!.attempts[0]!;
    expect(batch3Attempt.outcomeLabel).toBeNull();
    expect(batch3Attempt.rejectionReason).toBeNull();
    expect(batch3Attempt.statusLabel).toBe('Cancelled');
  });

  it('never claims Final QA complete beyond what the server itself reported', () => {
    const snapshot = makeSnapshot();
    snapshot.seedExecution = { ...snapshot.seedExecution, coverage: { ...snapshot.seedExecution.coverage!, finalQaComplete: undefined } };
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot, evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    expect(viewModel.reconciliation.finalQaComplete).toBeNull();
  });
});
