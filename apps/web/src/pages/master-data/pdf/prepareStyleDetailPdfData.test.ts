import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Style } from '../types.js';
import { prepareStyleDetailPdfData } from './prepareStyleDetailPdfData.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    description: null,
    categoryDescription: null,
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: null,
    lmixNumber: null,
    hsnCode: null,
    hsnDescription: null,
    finalMrp: 499,
    royaltyPercentage: null,
    status: 'ACTIVE',
    season: { id: 's1', code: 'SS27', name: 'Spring Summer 27', financialYear: { id: 'fy1', code: 'FY27' }, displayName: 'SS27', status: 'ACTIVE' },
    sizes: [],
    factories: [],
    images: [],
    ...overrides,
  };
}

describe('prepareStyleDetailPdfData', () => {
  it('resolves the primary image at the larger detail-image dimension', async () => {
    const style = makeStyle({
      images: [
        { id: 'img-1', styleId: 'style-1', fileId: 'file-1', fileName: 'x', mimeType: 'image/jpeg', sizeBytes: 1, isPrimary: true, sortOrder: 0, createdAt: '', updatedAt: '' },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareStyleDetailPdfData(style);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }],
      { maxDimension: 480 },
    );
    expect(result.primaryImage).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('returns a placeholder and skips the network call entirely when the style has no images', async () => {
    const result = await prepareStyleDetailPdfData(makeStyle({ images: [] }));
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });
});
