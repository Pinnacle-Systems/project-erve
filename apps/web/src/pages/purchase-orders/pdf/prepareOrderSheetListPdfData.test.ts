import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrderDetail } from '@erve/types';
import { prepareOrderSheetListPdfData } from './prepareOrderSheetListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeOrder(overrides: Partial<PurchaseOrderDetail> = {}): PurchaseOrderDetail {
  return {
    id: 'po-1',
    poNumber: 'EIOS/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    financialYear: { id: 'fy1', code: '2026-27' },
    poDate: '2026-04-01T00:00:00.000Z',
    requiredDeliveryDate: null,
    purchaseMode: 'OUTRIGHT',
    status: 'SUBMITTED',
    jobOrderId: null,
    lockedByJobOrder: null,
    totalOrderedQuantity: 100,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    merchandiser: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    remarks: null,
    lines: [],
    ...overrides,
  };
}

function apiResponse(items: PurchaseOrderDetail[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareOrderSheetListPdfData', () => {
  it('returns all items from a single-page response with the requested filters and export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeOrder()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareOrderSheetListPdfData({ search: 'EIOS', distributorId: 'd1' });

    expect(result).toEqual([makeOrder()]);
    expect(getMock).toHaveBeenCalledWith('/purchase-orders', {
      params: { search: 'EIOS', distributorId: 'd1', cursor: undefined, limit: 100 },
    });
  });

  it('fetches every remaining page using identical filters and preserves order', async () => {
    const orderA = makeOrder({ id: 'po-1', poNumber: 'EIOS/26-27/0001' });
    const orderB = makeOrder({ id: 'po-2', poNumber: 'EIOS/26-27/0002' });
    getMock
      .mockResolvedValueOnce(apiResponse([orderA], { limit: 100, hasMore: true, nextCursor: 'po-1' }))
      .mockResolvedValueOnce(apiResponse([orderB], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareOrderSheetListPdfData({ purchaseMode: 'OUTRIGHT' });

    expect(result).toEqual([orderA, orderB]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/purchase-orders', {
      params: { purchaseMode: 'OUTRIGHT', cursor: undefined, limit: 100 },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/purchase-orders', {
      params: { purchaseMode: 'OUTRIGHT', cursor: 'po-1', limit: 100 },
    });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareOrderSheetListPdfData({});

    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeOrder()], { limit: 100, hasMore: true, nextCursor: 'po-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareOrderSheetListPdfData({})).rejects.toThrow('network error');
  });
});
