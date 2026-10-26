import { describe, expect, it, vi } from 'vitest';
import { resolveImagesForPdf } from '../../../../lib/pdf/images.js';
import { preparePackingAuditCartonDetailPdfImages } from './preparePackingAuditCartonDetailPdfImages.js';
import { type PackingAuditCartonDetailSource } from './buildPackingAuditCartonDetailViewModel.js';
vi.mock('../../../../lib/pdf/images.js', () => ({ resolveImagesForPdf: vi.fn() }));

describe('Packing Audit Style images', () => {
  it('deduplicates by Style UUID, uses protected content paths, and supplies missing-image fallback', async () => {
    vi.mocked(resolveImagesForPdf).mockResolvedValue(
      new Map([['file-a', { dataUri: 'data:image/png;base64,AA==' }]]),
    );
    const source = {
      lines: [
        { styleId: 'a', primaryImage: { id: 'image-a', fileId: 'file-a' } },
        { styleId: 'a', primaryImage: { id: 'image-a', fileId: 'file-a' } },
        { styleId: 'b', primaryImage: { id: 'image-b', fileId: 'file-b' } },
        { styleId: 'c', primaryImage: null },
      ],
    } as PackingAuditCartonDetailSource;
    const images = await preparePackingAuditCartonDetailPdfImages(source);
    expect(resolveImagesForPdf).toHaveBeenCalledWith(
      [
        { id: 'file-a', path: '/styles/a/images/image-a/content' },
        { id: 'file-b', path: '/styles/b/images/image-b/content' },
      ],
      { maxDimension: 160 },
    );
    expect(images.get('a')).toEqual({ dataUri: 'data:image/png;base64,AA==' });
    expect(images.get('b')).toEqual({ placeholder: true });
    expect(images.has('c')).toBe(false);
  });
});
