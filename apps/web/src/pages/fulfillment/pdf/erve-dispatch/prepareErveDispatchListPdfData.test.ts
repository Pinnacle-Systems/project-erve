import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErveDispatchView } from '../../types.js';
import { prepareErveDispatchListPdfData } from './prepareErveDispatchListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeDispatch(overrides: Partial<ErveDispatchView> = {}): ErveDispatchView {
  return {
    id: 'ed-1',
    erveDispatchNumber: 'ED/26-27/0001',
    ervePackingList: { id: 'epl-1', ervePackingListNumber: 'EIPL/26-27/0001' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    status: 'DISPATCHED',
    dispatchDate: '2026-06-30T00:00:00.000Z',
    transporter: null,
    vehicleNumber: null,
    lrNumber: null,
    remarks: null,
    dispatchedBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    dispatchedAt: '2026-06-30T00:00:00.000Z',
    lrUpdatedBy: null,
    lrUpdatedAt: null,
    deliveredBy: null,
    deliveredAt: null,
    deliveryRemarks: null,
    deliveryConfirmationSource: null,
    totalQuantity: 20,
    invoiceHandoffs: [],
    saleOrReturnLines: [],
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

function apiResponse(items: ErveDispatchView[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareErveDispatchListPdfData', () => {
  it('returns all items from a single-page response with the export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeDispatch()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareErveDispatchListPdfData();

    expect(result).toEqual([makeDispatch()]);
    expect(getMock).toHaveBeenCalledWith('/erve-dispatches', { params: { cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page and preserves order', async () => {
    const a = makeDispatch({ id: 'ed-1', erveDispatchNumber: 'ED/26-27/0001' });
    const b = makeDispatch({ id: 'ed-2', erveDispatchNumber: 'ED/26-27/0002' });
    getMock
      .mockResolvedValueOnce(apiResponse([a], { limit: 100, hasMore: true, nextCursor: 'ed-1' }))
      .mockResolvedValueOnce(apiResponse([b], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareErveDispatchListPdfData();

    expect(result).toEqual([a, b]);
    expect(getMock).toHaveBeenNthCalledWith(2, '/erve-dispatches', { params: { cursor: 'ed-1', limit: 100 } });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    const result = await prepareErveDispatchListPdfData();
    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeDispatch()], { limit: 100, hasMore: true, nextCursor: 'ed-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareErveDispatchListPdfData()).rejects.toThrow('network error');
  });
});
