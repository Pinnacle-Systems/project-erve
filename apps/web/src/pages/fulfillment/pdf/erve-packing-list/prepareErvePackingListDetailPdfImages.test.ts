import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareErvePackingListDetailPdfImages } from './prepareErvePackingListDetailPdfImages.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';
import type { StylePrimaryImageView } from '../../types.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function makeImage(overrides: Partial<StylePrimaryImageView> = {}): StylePrimaryImageView {
  return {
    id: 'img-1',
    styleId: 'style-0',
    fileId: 'file-1',
    fileName: 'x.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1,
    isPrimary: true,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('prepareErvePackingListDetailPdfImages', () => {
  it('skips the network call entirely when no Style in the packing list has an uploaded image', async () => {
    const packingList = packingListFixture(1, 2, 2);
    const result = await prepareErvePackingListDetailPdfImages(packingList);
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('resolves each distinct Style exactly once, re-keyed by Style UUID (never the file id resolveImagesForPdf itself uses)', async () => {
    const packingList = packingListFixture(3, 1, 1, [makeImage({ styleId: 'style-0', fileId: 'file-1', id: 'img-1' })]);
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareErvePackingListDetailPdfImages(packingList);

    // 3 cartons + the Style/Size Summary all reference the same Style — exactly one fetch.
    expect(resolveImagesForPdfMock).toHaveBeenCalledTimes(1);
    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-0/images/img-1/content' }],
      { maxDimension: 160 },
    );
    expect(result.get('style-0')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('resolves two distinct Styles to their own distinct images, never swapped', async () => {
    const packingList = packingListFixture(1, 2, 1, [
      makeImage({ styleId: 'style-0', fileId: 'file-a', id: 'img-a' }),
      makeImage({ styleId: 'style-1', fileId: 'file-b', id: 'img-b' }),
    ]);
    resolveImagesForPdfMock.mockResolvedValue(
      new Map([
        ['file-a', { dataUri: 'data:image/jpeg;base64,A' }],
        ['file-b', { dataUri: 'data:image/jpeg;base64,B' }],
      ]),
    );

    const result = await prepareErvePackingListDetailPdfImages(packingList);

    expect(result.get('style-0')).toEqual({ dataUri: 'data:image/jpeg;base64,A' });
    expect(result.get('style-1')).toEqual({ dataUri: 'data:image/jpeg;base64,B' });
  });

  it('falls back to a placeholder for a Style whose image failed to resolve, without failing the whole export', async () => {
    const packingList = packingListFixture(1, 1, 1, [makeImage({ styleId: 'style-0', fileId: 'file-1' })]);
    resolveImagesForPdfMock.mockResolvedValue(new Map()); // resolveImagesForPdf itself never throws — a failed fetch degrades to this.

    const result = await prepareErvePackingListDetailPdfImages(packingList);

    expect(result.get('style-0')).toEqual({ placeholder: true });
  });
});
