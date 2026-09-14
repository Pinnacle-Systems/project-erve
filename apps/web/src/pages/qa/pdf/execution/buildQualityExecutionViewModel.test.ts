import { describe, expect, it } from 'vitest';
import { buildQualityExecutionViewModel } from './buildQualityExecutionViewModel.js';
import { makePpmQualityExecutionView, makeQualityExecutionView } from './qualityExecutionTestFixture.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

describe('buildQualityExecutionViewModel', () => {
  it('PPM: prints no outcome section at all — never a synthetic PASS/FAIL', () => {
    const viewModel = buildQualityExecutionViewModel({ execution: makePpmQualityExecutionView(), evidenceImages: new Map() }, META);
    expect(viewModel.outcome).toBeNull();
    const serialized = JSON.stringify(viewModel);
    expect(serialized).not.toMatch(/"PASS"|"FAIL"/);
  });

  it('PPM: header carries status/dates but not a fabricated outcome field value', () => {
    const viewModel = buildQualityExecutionViewModel(
      { execution: makePpmQualityExecutionView({ status: 'FINALIZED' }), evidenceImages: new Map() },
      META,
    );
    expect(viewModel.headerItems).toContainEqual({ label: 'Status', value: 'Finalized' });
    expect(viewModel.outcome).toBeNull();
  });

  it('Inline: has an outcome (its form includes INSPECTION_OUTCOME) but no finalBatch/disposition', () => {
    const viewModel = buildQualityExecutionViewModel({ execution: makeQualityExecutionView(), evidenceImages: new Map() }, META);
    expect(viewModel.outcome).toEqual({ value: 'PASS', remarks: 'Looks good', rejectionReason: null });
    expect(viewModel.finalBatch).toBeNull();
  });

  it('Inline FAIL never carries a rejection reason (only Final Inspection requires/exposes one)', () => {
    const execution = makeQualityExecutionView({
      responses: {
        ...makeQualityExecutionView().responses,
        outcome: { componentId: 'outcome-1', value: 'FAIL', remarks: null, rejectionReason: 'Should not surface' },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    expect(viewModel.outcome).toEqual({ value: 'FAIL', remarks: null, rejectionReason: null });
  });

  it('Final: populates disposition, allocations, and attempt history distinctly from PASS/FAIL', () => {
    const execution = makeQualityExecutionView({
      finalBatch: {
        id: 'batch-1',
        batchNumber: 2,
        physicalQuantity: 150,
        disposition: 'AWAITING_REINSPECTION',
        allocations: [{ jobOrderLineSizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 150 }],
        attempts: [
          {
            id: 'attempt-1',
            attemptNumber: 1,
            status: 'FINALIZED',
            outcome: 'FAIL',
            rejectionReason: 'Measurement out of tolerance',
            startedAt: '2026-01-05T09:00:00Z',
            finalizedAt: '2026-01-05T12:00:00Z',
          },
          {
            id: 'attempt-2',
            attemptNumber: 2,
            status: 'DRAFT',
            outcome: null,
            rejectionReason: null,
            startedAt: '2026-01-08T09:00:00Z',
            finalizedAt: null,
          },
        ],
        release: null,
      },
      responses: {
        ...makeQualityExecutionView().responses,
        outcome: { componentId: 'outcome-1', value: 'FAIL', remarks: null, rejectionReason: 'Measurement out of tolerance' },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);

    expect(viewModel.outcome).toEqual({
      value: 'FAIL',
      remarks: null,
      rejectionReason: 'Measurement out of tolerance',
    });
    expect(viewModel.finalBatch).toMatchObject({
      batchNumber: 2,
      physicalQuantity: 150,
      dispositionLabel: 'Awaiting Reinspection',
    });
    expect(viewModel.finalBatch?.attempts).toHaveLength(2);
    expect(viewModel.finalBatch?.attempts[0]).toMatchObject({
      attemptNumber: 1,
      outcome: 'FAIL',
      rejectionReason: 'Measurement out of tolerance',
    });
    expect(viewModel.finalBatch?.attempts[1]).toMatchObject({ attemptNumber: 2, outcome: null, rejectionReason: null });
  });

  it('Final RELEASED batch prints the released quantity distinctly, never merged with disposition', () => {
    const execution = makeQualityExecutionView({
      finalBatch: {
        id: 'batch-1',
        batchNumber: 1,
        physicalQuantity: 200,
        disposition: 'RELEASED',
        allocations: [],
        attempts: [],
        release: { id: 'release-1', releasedAt: '2026-01-09T09:00:00Z', quantity: 200 },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    expect(viewModel.finalBatch?.dispositionLabel).toBe('Released');
    expect(viewModel.finalBatch?.releasedQuantity).toBe(200);
  });

  it('Final PERMANENTLY_REJECTED keeps a distinct disposition label from RELEASED/AWAITING_REINSPECTION', () => {
    const execution = makeQualityExecutionView({
      finalBatch: {
        id: 'batch-1',
        batchNumber: 1,
        physicalQuantity: 80,
        disposition: 'PERMANENTLY_REJECTED',
        allocations: [],
        attempts: [],
        release: null,
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    expect(viewModel.finalBatch?.dispositionLabel).toBe('Permanently Rejected');
  });

  it('zero physical quantity prints as 0, not an em dash', () => {
    const execution = makeQualityExecutionView({
      finalBatch: {
        id: 'batch-1',
        batchNumber: 1,
        physicalQuantity: 0,
        disposition: 'DRAFT',
        allocations: [],
        attempts: [],
        release: null,
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    expect(viewModel.finalBatch?.physicalQuantity).toBe(0);
  });

  it('never spreads the raw execution entity — explicit header fields only, no internal identifiers leak', () => {
    const execution = { ...makeQualityExecutionView(), processFlowActivityId: 'secret-internal-id' };
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    const serialized = JSON.stringify(viewModel);
    expect(serialized).not.toContain('secret-internal-id');
  });

  it('uses the acronym-aware display name for the QA activity', () => {
    const viewModel = buildQualityExecutionViewModel({ execution: makeQualityExecutionView(), evidenceImages: new Map() }, META);
    expect(viewModel.headerItems).toContainEqual({ label: 'QA Activity', value: 'Inline QC' });
  });

  it('passes through an undefined generatedBy as-is (what useOptionalAuth()?.user?.name yields with no AuthProvider), never coerced to a string', () => {
    const viewModel = buildQualityExecutionViewModel(
      { execution: makeQualityExecutionView(), evidenceImages: new Map() },
      { generatedAt: META.generatedAt, generatedBy: undefined },
    );
    expect(viewModel.generatedBy).toBeUndefined();
  });
});
