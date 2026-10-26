import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareConsolidatedFinalInspectionPdfData } from './prepareConsolidatedFinalInspectionPdfData.js';
import { makeRegressionFixture } from './consolidatedFinalInspectionTestFixture.js';
import type { ConsolidatedFinalInspectionSnapshot } from './collectConsolidatedFinalInspectionData.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

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

describe('prepareConsolidatedFinalInspectionPdfData', () => {
  it('flattens image-type attachments across every attempt in every batch into one resolution call', async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    await prepareConsolidatedFinalInspectionPdfData(makeSnapshot());

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        { id: 'evidence-1a', path: '/quality-executions/attachments/evidence-1a/content' },
        { id: 'evidence-1b', path: '/quality-executions/attachments/evidence-1b/content' },
        { id: 'evidence-2a', path: '/quality-executions/attachments/evidence-2a/content' },
      ]),
      expect.objectContaining({ maxDimension: 400, concurrency: 4 }),
    );
    const [refs] = resolveImagesForPdfMock.mock.calls[0]!;
    expect((refs as unknown[]).length).toBe(3);
  });

  it('skips the network call when no attempt carries an image attachment', async () => {
    const snapshot = makeSnapshot();
    snapshot.batches.forEach((b) => b.attempts.forEach((a) => (a.attachments = [])));
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    await prepareConsolidatedFinalInspectionPdfData(snapshot);

    expect(resolveImagesForPdfMock).toHaveBeenNthCalledWith(1, [], expect.objectContaining({ maxDimension: 400 }));
  });

  it("returns the explicit inconsistent marker when the seed execution's primaryStyle disagrees", async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const snapshot = makeSnapshot();
    snapshot.seedExecution = { ...snapshot.seedExecution, primaryStyle: { consistent: false } };

    const result = await prepareConsolidatedFinalInspectionPdfData(snapshot);
    expect(result.primaryImage).toEqual({ inconsistent: true });
  });

  it('returns a placeholder when the Style has no primary image', async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const result = await prepareConsolidatedFinalInspectionPdfData(makeSnapshot());
    expect(result.primaryImage).toEqual({ placeholder: true });
  });
});
