import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareQualityExecutionPdfData } from './prepareQualityExecutionPdfData.js';
import { makeQualityExecutionView } from './qualityExecutionTestFixture.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

describe('prepareQualityExecutionPdfData', () => {
  it('resolves only image-type attachments via the authenticated attachment content endpoint', async () => {
    const execution = makeQualityExecutionView({
      attachments: [
        {
          id: 'attachment-1',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'defect.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 100,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'attachment-2',
          componentId: 'attachments-1',
          requirementKey: 'report',
          fileName: 'measurements.pdf',
          contentType: 'application/pdf',
          sizeBytes: 200,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['attachment-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareQualityExecutionPdfData(execution);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'attachment-1', path: '/quality-executions/attachments/attachment-1/content' }],
      { maxDimension: 400 },
    );
    expect(result.evidenceImages.get('attachment-1')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('skips the network call entirely when there are no image attachments', async () => {
    const execution = makeQualityExecutionView({ attachments: [] });
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    await prepareQualityExecutionPdfData(execution);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith([], { maxDimension: 400 });
  });

  it("resolves the header image from the server-resolved primaryStyle's own fileId/imageId", async () => {
    const execution = makeQualityExecutionView({
      attachments: [],
      primaryStyle: {
        consistent: true,
        style: {
          id: 'style-1',
          styleNumber: 'STY-0001',
          styleName: 'Basic Tee',
          primaryImage: {
            id: 'img-1',
            styleId: 'style-1',
            fileId: 'file-1',
            fileName: 'x',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            isPrimary: true,
            sortOrder: 0,
            createdAt: '',
            updatedAt: '',
          },
        },
      },
    });
    resolveImagesForPdfMock.mockImplementation(async (refs: Array<{ id: string }>) => {
      if (refs[0]?.id === 'file-1') return new Map([['file-1', { dataUri: 'data:image/jpeg;base64,header' }]]);
      return new Map();
    });

    const result = await prepareQualityExecutionPdfData(execution);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }],
      { maxDimension: 480 },
    );
    expect(result.primaryImage).toEqual({ dataUri: 'data:image/jpeg;base64,header' });
  });

  it('returns a plain placeholder when the Style is resolved but has no image', async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const result = await prepareQualityExecutionPdfData(makeQualityExecutionView({ attachments: [] }));
    expect(result.primaryImage).toEqual({ placeholder: true });
  });

  it("returns the explicit inconsistent marker — never a guess, never a plain placeholder — when primaryStyle.consistent is false", async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const result = await prepareQualityExecutionPdfData(
      makeQualityExecutionView({ attachments: [], primaryStyle: { consistent: false } }),
    );
    expect(result.primaryImage).toEqual({ inconsistent: true });
  });
});
