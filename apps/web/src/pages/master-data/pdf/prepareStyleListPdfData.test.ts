import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Style } from '../types.js';
import { prepareStyleListPdfData } from './prepareStyleListPdfData.js';

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

describe('prepareStyleListPdfData', () => {
  it('requests only the primary (or first) image per style and maps results back by style id', async () => {
    const styleWithPrimary = makeStyle({
      id: 'a',
      images: [
        { id: 'img-2', styleId: 'a', fileId: 'file-2', fileName: 'x', mimeType: 'image/jpeg', sizeBytes: 1, isPrimary: true, sortOrder: 1, createdAt: '', updatedAt: '' },
        { id: 'img-1', styleId: 'a', fileId: 'file-1', fileName: 'x', mimeType: 'image/jpeg', sizeBytes: 1, isPrimary: false, sortOrder: 0, createdAt: '', updatedAt: '' },
      ],
    });
    const styleWithNoImages = makeStyle({ id: 'b', images: [] });

    resolveImagesForPdfMock.mockResolvedValue(
      new Map([['file-2', { dataUri: 'data:image/jpeg;base64,mock' }]]),
    );

    const result = await prepareStyleListPdfData([styleWithPrimary, styleWithNoImages]);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-2', path: '/styles/a/images/img-2/content' }],
      { maxDimension: 160 },
    );
    expect(result.images.get('a')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
    expect(result.images.get('b')).toEqual({ placeholder: true });
  });

  it('falls back to the first image when none is marked primary', async () => {
    const style = makeStyle({
      id: 'a',
      images: [
        { id: 'img-1', styleId: 'a', fileId: 'file-1', fileName: 'x', mimeType: 'image/jpeg', sizeBytes: 1, isPrimary: false, sortOrder: 0, createdAt: '', updatedAt: '' },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    await prepareStyleListPdfData([style]);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/a/images/img-1/content' }],
      { maxDimension: 160 },
    );
  });

  it('handles an empty style list without calling the image resolver with any refs', async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const result = await prepareStyleListPdfData([]);
    expect(resolveImagesForPdfMock).toHaveBeenCalledWith([], { maxDimension: 160 });
    expect(result.images.size).toBe(0);
  });
});
