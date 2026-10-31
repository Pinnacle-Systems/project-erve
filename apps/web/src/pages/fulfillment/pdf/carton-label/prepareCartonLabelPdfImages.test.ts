import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryPackingCartonView, StylePrimaryImageView } from '@erve/types';
import { prepareCartonLabelPdfImages } from './prepareCartonLabelPdfImages.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));
afterEach(() => resolveImagesForPdfMock.mockReset());

function carton(primaryImage: StylePrimaryImageView | null = null): FactoryPackingCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: null,
    grossWeight: null,
    dimensions: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee',
        primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium',
        quantity: 10, currentDestinationId: 'dest-1' },
    ],
    auditHistory: [],
  };
}

const image: StylePrimaryImageView = {
  id: 'image-1',
  styleId: 'style-1',
  fileId: 'file-1',
  fileName: 'style.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 100,
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('prepareCartonLabelPdfImages', () => {
  it('fetches only a unique authorized carton Style image with bounded size', async () => {
    const source = carton(image);
    source.lines.push({ ...source.lines[0]!, saleOrderLineId: 'line-2', sizeId: 'size-2' });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,AA==' }]]));
    const images = await prepareCartonLabelPdfImages(source);
    expect(resolveImagesForPdfMock).toHaveBeenCalledTimes(1);
    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/image-1/content' }],
      { maxDimension: 120 },
    );
    expect(images.get('style-1')).toEqual({ dataUri: 'data:image/jpeg;base64,AA==' });
  });

  it('does not fetch when there is no Style image', async () => {
    const images = await prepareCartonLabelPdfImages(carton());
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(images.get('style-1')).toEqual({ placeholder: true });
  });

  it('uses a later Size line image when the first line has none', async () => {
    const source = carton();
    source.lines.push({ ...source.lines[0]!, sizeId: 'size-2', primaryImage: image });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,AA==' }]]));
    const images = await prepareCartonLabelPdfImages(source);
    expect(images.get('style-1')).toEqual({ dataUri: 'data:image/jpeg;base64,AA==' });
  });

  it('uses a placeholder when the authorized image cannot be resolved', async () => {
    resolveImagesForPdfMock.mockResolvedValue(new Map());
    const images = await prepareCartonLabelPdfImages(carton(image));
    expect(images.get('style-1')).toEqual({ placeholder: true });
  });
});
