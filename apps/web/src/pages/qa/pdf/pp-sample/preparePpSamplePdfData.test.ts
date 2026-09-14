import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePpSamplePdfData } from './preparePpSamplePdfData.js';
import { makeQaInspectionDetail } from './ppSampleTestFixture.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

describe('preparePpSamplePdfData', () => {
  it('resolves session and rework-task evidence images via the authenticated QA evidence endpoint', async () => {
    const detail = makeQaInspectionDetail({
      reworkTasks: [
        {
          id: 'rework-1',
          jobOrderId: 'jo-1',
          jobOrderNumber: 'JO-1001',
          jobOrderLineSizeId: 'size-1',
          styleNumber: 'STY-0001',
          styleName: 'Basic Tee',
          sizeCode: 'M',
          sizeLabel: 'Medium',
          assignedQuantity: 5,
          attemptNumber: 1,
          status: 'REWORK_REQUIRED',
          defectCategory: null,
          otherDefectDetails: null,
          defectNotes: null,
          qaRemarks: null,
          qaEvidence: [
            { id: 'evidence-rework-1', inspectionLineId: null, fileName: 'rework.jpg', contentType: 'image/jpeg', sizeBytes: 100, createdAt: '2026-01-10T11:00:00Z' },
          ],
          requestedBy: { id: 'user-1', name: 'Priya Inspector', email: 'priya@erve.local' },
          requestedAt: '2026-01-10T11:00:00Z',
          factoryNotes: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
          readyBy: null,
          readyAt: null,
          reinspectedAt: null,
          version: 1,
          updatedAt: '2026-01-10T11:00:00Z',
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(
      new Map([
        ['evidence-1', { dataUri: 'data:image/jpeg;base64,mock1' }],
        ['evidence-rework-1', { dataUri: 'data:image/jpeg;base64,mock2' }],
      ]),
    );

    await preparePpSamplePdfData(detail);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [
        { id: 'evidence-1', path: '/qa/evidence/evidence-1/content' },
        { id: 'evidence-rework-1', path: '/qa/evidence/evidence-rework-1/content' },
      ],
      { maxDimension: 400 },
    );
  });

  it('excludes non-image evidence from the resolution request', async () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          evidence: [
            { id: 'evidence-1', inspectionLineId: 'form-1', fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 100, createdAt: '2026-01-10T10:30:00Z' },
            { id: 'evidence-2', inspectionLineId: 'form-1', fileName: 'measurements.pdf', contentType: 'application/pdf', sizeBytes: 200, createdAt: '2026-01-10T10:30:00Z' },
          ],
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    await preparePpSamplePdfData(detail);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'evidence-1', path: '/qa/evidence/evidence-1/content' }],
      { maxDimension: 400 },
    );
  });

  it('skips the network call entirely when there is no evidence', async () => {
    const detail = makeQaInspectionDetail({ sessions: [{ ...makeQaInspectionDetail().sessions[0]!, evidence: [] }] });
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    await preparePpSamplePdfData(detail);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith([], { maxDimension: 400 });
  });
});
