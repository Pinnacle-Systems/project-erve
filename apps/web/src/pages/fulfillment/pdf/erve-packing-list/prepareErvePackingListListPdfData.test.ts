import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErvePackingListSummary } from '../../types.js';
import { prepareErvePackingListListPdfData } from './prepareErvePackingListListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makePackingList(overrides: Partial<ErvePackingListSummary> = {}): ErvePackingListSummary {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    saleOrder: null,
    destination: {
      label: 'Mumbai Warehouse',
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '400001',
    },
    status: 'OPEN',
    createdBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    createdAt: '2026-06-30T00:00:00.000Z',
    cartonCount: 2,
    totalQuantity: 50,
    sourceFactories: [{ id: 'f1', code: 'F1', name: 'Acme Factory' }],
    sourceDispatchOrders: [{ id: 'so1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    ...overrides,
  };
}

function apiResponse(items: ErvePackingListSummary[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareErvePackingListListPdfData', () => {
  it('returns all items from a single-page response with the export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makePackingList()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareErvePackingListListPdfData();

    expect(result).toEqual([makePackingList()]);
    expect(getMock).toHaveBeenCalledWith('/erve-packing-lists', { params: { cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page and preserves order', async () => {
    const a = makePackingList({ id: 'epl-1', ervePackingListNumber: 'EIPL/26-27/0001' });
    const b = makePackingList({ id: 'epl-2', ervePackingListNumber: 'EIPL/26-27/0002' });
    getMock
      .mockResolvedValueOnce(apiResponse([a], { limit: 100, hasMore: true, nextCursor: 'epl-1' }))
      .mockResolvedValueOnce(apiResponse([b], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareErvePackingListListPdfData();

    expect(result).toEqual([a, b]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/erve-packing-lists', { params: { cursor: undefined, limit: 100 } });
    expect(getMock).toHaveBeenNthCalledWith(2, '/erve-packing-lists', { params: { cursor: 'epl-1', limit: 100 } });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareErvePackingListListPdfData();

    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makePackingList()], { limit: 100, hasMore: true, nextCursor: 'epl-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareErvePackingListListPdfData()).rejects.toThrow('network error');
  });
});
