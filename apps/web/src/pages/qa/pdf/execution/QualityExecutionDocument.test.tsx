import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { QualityExecutionDocument } from './QualityExecutionDocument.js';
import { buildQualityExecutionViewModel } from './buildQualityExecutionViewModel.js';
import { makePpmQualityExecutionView, makeQualityExecutionView } from './qualityExecutionTestFixture.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

describe('QualityExecutionDocument', () => {
  it('renders a PPM execution (no outcome section) without throwing', async () => {
    const viewModel = buildQualityExecutionViewModel(
      { execution: makePpmQualityExecutionView(), evidenceImages: new Map() },
      META,
    );
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders an Inline execution with a PASS outcome without throwing', async () => {
    const viewModel = buildQualityExecutionViewModel(
      { execution: makeQualityExecutionView(), evidenceImages: new Map() },
      META,
    );
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders an Inline execution with a FAIL outcome without throwing', async () => {
    const execution = makeQualityExecutionView({
      responses: {
        ...makeQualityExecutionView().responses,
        outcome: { componentId: 'outcome-1', value: 'FAIL', remarks: 'Defects found', rejectionReason: null },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a Final execution with disposition, allocations, and multi-attempt history without throwing', async () => {
    const execution = makeQualityExecutionView({
      finalBatch: {
        id: 'batch-1',
        batchNumber: 2,
        physicalQuantity: 150,
        disposition: 'AWAITING_REINSPECTION',
        allocations: [
          { jobOrderLineSizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 50 },
          { jobOrderLineSizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', quantity: 100 },
        ],
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
            status: 'FINALIZED',
            outcome: 'PASS',
            rejectionReason: null,
            startedAt: '2026-01-08T09:00:00Z',
            finalizedAt: '2026-01-08T12:00:00Z',
          },
        ],
        release: { id: 'release-1', releasedAt: '2026-01-08T13:00:00Z', quantity: 150 },
      },
      responses: {
        ...makeQualityExecutionView().responses,
        outcome: { componentId: 'outcome-1', value: 'PASS', remarks: null, rejectionReason: null },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with a broken/placeholder evidence image without throwing', async () => {
    const viewModel = buildQualityExecutionViewModel(
      { execution: makeQualityExecutionView(), evidenceImages: new Map([['attachment-1', { placeholder: true }]]) },
      META,
    );
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with a resolved evidence image without throwing', async () => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const viewModel = buildQualityExecutionViewModel(
      { execution: makeQualityExecutionView(), evidenceImages: new Map([['attachment-1', { dataUri: TINY_PNG }]]) },
      META,
    );
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a long, multi-page execution (many checklist rows and attempts) without truncation-causing errors', async () => {
    const manyChecklistItems = Array.from({ length: 60 }, (_, i) => ({ key: `item-${i}`, label: `Checklist item ${i}` }));
    const manyChecklistResponses = manyChecklistItems.map((item) => ({
      componentId: 'checklist-1',
      itemKey: item.key,
      response: 'YES',
      remarks: `Remark for ${item.key}`,
    }));
    const manyAttempts = Array.from({ length: 20 }, (_, i) => ({
      id: `attempt-${i}`,
      attemptNumber: i + 1,
      status: 'FINALIZED' as const,
      outcome: (i % 2 === 0 ? 'FAIL' : 'PASS') as 'FAIL' | 'PASS',
      rejectionReason: i % 2 === 0 ? `Rejection reason ${i}` : null,
      startedAt: '2026-01-05T09:00:00Z',
      finalizedAt: '2026-01-05T12:00:00Z',
    }));
    const base = makeQualityExecutionView();
    const execution = makeQualityExecutionView({
      sections: base.sections.map((section) =>
        section.id === 'section-2'
          ? {
              ...section,
              components: section.components.map((component) =>
                component.id === 'checklist-1'
                  ? { ...component, config: { ...component.config, items: manyChecklistItems } }
                  : component,
              ),
            }
          : section,
      ),
      responses: { ...base.responses, checklistResponses: manyChecklistResponses },
      finalBatch: {
        id: 'batch-1',
        batchNumber: 1,
        physicalQuantity: 500,
        disposition: 'RELEASED',
        allocations: [],
        attempts: manyAttempts,
        release: { id: 'release-1', releasedAt: '2026-01-09T09:00:00Z', quantity: 500 },
      },
    });
    const viewModel = buildQualityExecutionViewModel({ execution, evidenceImages: new Map() }, META);
    const blob = await pdf(<QualityExecutionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  }, 30000);
});
