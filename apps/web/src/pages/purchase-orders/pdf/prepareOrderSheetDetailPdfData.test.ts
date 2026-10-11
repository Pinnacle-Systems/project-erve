import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder } from '../types.js';
import { prepareOrderSheetDetailPdfData } from './prepareOrderSheetDetailPdfData.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function makePO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    version: 1,
    poNumber: 'EIOS/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    financialYear: { id: 'fy1', code: 'FY27' },
    poDate: '2026-09-01T00:00:00.000Z',
    requiredDeliveryDate: null,
    purchaseMode: 'OUTRIGHT',
    status: 'DRAFT',
    jobOrderId: null,
    lockedByJobOrder: null,
    totalOrderedQuantity: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    merchandiser: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    remarks: null,
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: 'STY-0001',
        styleName: 'Basic Tee',
        primaryImage: null,
        lineStatus: 'ACTIVE',
        remarks: null,
        seasonSnapshots: [],
        totalOrderedQuantity: 0,
        sizes: [],
      },
    ],
    ...overrides,
  };
}

describe('prepareOrderSheetDetailPdfData', () => {
  it('resolves the one line\'s primary image at the detail-image dimension', async () => {
    const po = makePO({
      lines: [
        {
          ...makePO().lines[0]!,
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
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareOrderSheetDetailPdfData(po);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }],
      { maxDimension: 480 },
    );
    expect(result.primaryImage).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('returns a placeholder and skips the network call entirely when the line has no image', async () => {
    const result = await prepareOrderSheetDetailPdfData(makePO());
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });
});
