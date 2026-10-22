import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackingListView, StylePrimaryImageView } from '@erve/types';
import { prepareFactoryPackingListPdfImages } from './prepareFactoryPackingListPdfImages.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function image(overrides: Partial<StylePrimaryImageView> = {}): StylePrimaryImageView {
  return {
    id: 'img-1',
    styleId: 'style-1',
    fileId: 'file-1',
    fileName: 'classic-tee.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    isPrimary: true,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function packingList(overrides: Partial<PackingListView> = {}): PackingListView {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One' }],
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatch: null,
    destinations: [
      {
        id: 'dest-1',
        distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
        label: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        addressLine1: '123 Test Street',
        addressLine2: null,
        city: 'Chennai',
        state: 'TN',
        country: 'India',
        postalCode: null,
        gstin: null,
        canMoveDistributor: true,
        lines: [],
        cartons: [],
      },
    ],
    retiredCartons: [],
    ...overrides,
  };
}

describe('prepareFactoryPackingListPdfImages', () => {
  it('resolves one thumbnail per distinct Style found on destination lines', async () => {
    const primaryImage = image();
    const list = packingList({
      destinations: [
        {
          ...packingList().destinations[0]!,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
          ],
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareFactoryPackingListPdfImages(list);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith([{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }]);
    expect(result.get('style-1')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('falls back to a carton line image when the destination line omits it (mirrors PackingListPage.tsx)', async () => {
    const primaryImage = image();
    const list = packingList({
      destinations: [
        {
          ...packingList().destinations[0]!,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
          ],
          cartons: [
            {
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
              auditState: 'NOT_INSPECTED',
              retired: false,
              retiredAt: null,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
              lines: [
                { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, currentDestinationId: 'dest-1' },
              ],
              auditHistory: [],
            },
          ],
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareFactoryPackingListPdfImages(list);

    expect(result.get('style-1')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('returns an explicit placeholder — never an absent entry — for a Style with no uploaded image, and skips the network call entirely when nothing needs fetching', async () => {
    const list = packingList({
      destinations: [
        {
          ...packingList().destinations[0]!,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
          ],
        },
      ],
    });

    const result = await prepareFactoryPackingListPdfImages(list);

    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.get('style-1')).toEqual({ placeholder: true });
  });

  it('degrades a failed/slow image fetch to a placeholder rather than throwing (resolveImagesForPdf already degrades internally)', async () => {
    const primaryImage = image();
    const list = packingList({
      destinations: [
        {
          ...packingList().destinations[0]!,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
          ],
        },
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map());

    const result = await prepareFactoryPackingListPdfImages(list);

    expect(result.get('style-1')).toEqual({ placeholder: true });
  });

  it('dedupes a Style repeated across destinations, cartons and retired cartons into a single fetch', async () => {
    const primaryImage = image();
    const baseCarton = {
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
      auditState: 'NOT_INSPECTED' as const,
      retired: false,
      retiredAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, currentDestinationId: 'dest-1' },
      ],
      auditHistory: [],
    };
    const list = packingList({
      destinations: [
        {
          ...packingList().destinations[0]!,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
          ],
          cartons: [baseCarton],
        },
      ],
      retiredCartons: [{ ...baseCarton, id: 'carton-2', retired: true, retiredAt: '2026-09-05T00:00:00.000Z' }],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    await prepareFactoryPackingListPdfImages(list);

    expect(resolveImagesForPdfMock).toHaveBeenCalledTimes(1);
    expect(resolveImagesForPdfMock).toHaveBeenCalledWith([{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }]);
  });
});
