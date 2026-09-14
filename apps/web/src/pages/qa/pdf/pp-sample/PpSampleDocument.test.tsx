import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PpSampleDocument } from './PpSampleDocument.js';
import { buildPpSampleViewModel } from './buildPpSampleViewModel.js';
import { makeQaInspectionDetail } from './ppSampleTestFixture.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

describe('PpSampleDocument', () => {
  it('renders a PASS session without throwing', async () => {
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map() }, META);
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a FAIL session without throwing', async () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          processFlowPpSample: {
            executionId: 'execution-1',
            processFlowActivityId: 'activity-1',
            qualityFormVersionId: 'version-1',
            sampleQuantity: 3,
            decision: 'FAIL',
          },
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with resolved evidence images without throwing', async () => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const images = new Map([['evidence-1', { dataUri: TINY_PNG }]]);
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: images }, META);
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with a broken/placeholder evidence image without throwing', async () => {
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map() }, META);
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with no inspection history without throwing', async () => {
    const viewModel = buildPpSampleViewModel(
      { detail: makeQaInspectionDetail({ sessions: [] }), evidenceImages: new Map() },
      META,
    );
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a long, multi-page document (many sizes/cycles/evidence items) without truncation-causing errors', async () => {
    const baseSession = makeQaInspectionDetail().sessions[0]!;
    const manySessions = Array.from({ length: 3 }, (_, cycleIndex) => ({
      ...baseSession,
      id: `session-${cycleIndex}`,
      cycleNumber: cycleIndex + 1,
      forms: Array.from({ length: 4 }, (_, sizeIndex) => ({
        ...baseSession.forms[0]!,
        id: `form-${cycleIndex}-${sizeIndex}`,
        sizeLabel: `Size ${sizeIndex}`,
        checklist: baseSession.forms[0]!.checklist.concat(
          Array.from({ length: 8 }, (_, i) => ({
            itemCode: `EXTRA_ITEM_${i}` as never,
            status: 'YES' as const,
            remarks: `Remark ${i}`,
          })),
        ),
      })),
      evidence: Array.from({ length: 3 }, (_, i) => ({
        id: `evidence-${cycleIndex}-${i}`,
        inspectionLineId: null,
        fileName: `photo-${i}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1000,
        createdAt: '2026-01-10T10:30:00Z',
      })),
    }));
    const detail = makeQaInspectionDetail({ sessions: manySessions });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    const blob = await pdf(<PpSampleDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  }, 30000);
});
