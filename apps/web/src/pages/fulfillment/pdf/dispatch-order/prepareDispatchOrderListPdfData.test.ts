import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaleOrder } from '../../../sale-orders/types.js';
import { prepareDispatchOrderListPdfData } from './prepareDispatchOrderListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeSaleOrder(overrides: Partial<SaleOrder> = {}): SaleOrder {
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'd1', code: 'D1', name: 'Acme Distributors', purchaseMode: 'OUTRIGHT' }],
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    financialYear: { id: 'fy1', code: '2026-27' },
    soDate: '2026-06-30T00:00:00.000Z',
    status: 'ACTIVE',
    destinationCount: 1,
    totalQuantity: 100,
    createdAt: '2026-06-30T00:00:00.000Z',
    isLocked: false,
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    remarks: null,
    distributorGroups: [],
    lines: [],
    fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 100, totalFactoryPackedQuantity: 0 },
    ...overrides,
  };
}

function apiResponse(items: SaleOrder[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareDispatchOrderListPdfData', () => {
  it('returns all items from a single-page response with the requested filters and export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeSaleOrder()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareDispatchOrderListPdfData({ search: 'EISO', factoryId: 'f1' });

    expect(result).toEqual([makeSaleOrder()]);
    expect(getMock).toHaveBeenCalledWith('/sale-orders', {
      params: { search: 'EISO', factoryId: 'f1', cursor: undefined, limit: 100 },
    });
  });

  it('fetches every remaining page using identical filters and preserves order', async () => {
    const soA = makeSaleOrder({ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' });
    const soB = makeSaleOrder({ id: 'so-2', saleOrderNumber: 'EISO/26-27/0002' });
    getMock
      .mockResolvedValueOnce(apiResponse([soA], { limit: 100, hasMore: true, nextCursor: 'so-1' }))
      .mockResolvedValueOnce(apiResponse([soB], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareDispatchOrderListPdfData({ distributorId: 'd1' });

    expect(result).toEqual([soA, soB]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/sale-orders', {
      params: { distributorId: 'd1', cursor: undefined, limit: 100 },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/sale-orders', {
      params: { distributorId: 'd1', cursor: 'so-1', limit: 100 },
    });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareDispatchOrderListPdfData({});

    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeSaleOrder()], { limit: 100, hasMore: true, nextCursor: 'so-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareDispatchOrderListPdfData({})).rejects.toThrow('network error');
  });
});
