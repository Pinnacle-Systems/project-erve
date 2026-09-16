import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceHandoffView } from '../../types.js';
import { prepareInvoiceHandoffListPdfData } from './prepareInvoiceHandoffListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeHandoff(overrides: Partial<InvoiceHandoffView> = {}): InvoiceHandoffView {
  return {
    id: 'ih-1',
    erveDispatch: { id: 'ed1', erveDispatchNumber: 'ED/26-27/0001', dispatchDate: '2026-06-30T00:00:00.000Z' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'OUTRIGHT',
    saleOrderLineId: 'sol1',
    style: { styleNumber: 'ST-1', styleName: 'Shirt' },
    size: { sizeCode: 'M', sizeLabel: 'Medium' },
    quantity: 20,
    status: 'PENDING_TALLY',
    tallyInvoiceNumber: null,
    tallyInvoiceDate: null,
    tallyVoucherReference: null,
    remarks: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

function apiResponse(items: InvoiceHandoffView[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareInvoiceHandoffListPdfData', () => {
  it('returns all items from a single-page response with the requested status filter', async () => {
    getMock.mockResolvedValue(apiResponse([makeHandoff()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareInvoiceHandoffListPdfData({ status: 'PENDING_TALLY' });

    expect(result).toEqual([makeHandoff()]);
    expect(getMock).toHaveBeenCalledWith('/invoice-handoffs', { params: { status: 'PENDING_TALLY', cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page using identical filters and preserves order', async () => {
    const a = makeHandoff({ id: 'ih-1' });
    const b = makeHandoff({ id: 'ih-2' });
    getMock
      .mockResolvedValueOnce(apiResponse([a], { limit: 100, hasMore: true, nextCursor: 'ih-1' }))
      .mockResolvedValueOnce(apiResponse([b], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareInvoiceHandoffListPdfData({ status: 'INVOICED' });

    expect(result).toEqual([a, b]);
    expect(getMock).toHaveBeenNthCalledWith(2, '/invoice-handoffs', { params: { status: 'INVOICED', cursor: 'ih-1', limit: 100 } });
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeHandoff()], { limit: 100, hasMore: true, nextCursor: 'ih-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareInvoiceHandoffListPdfData({})).rejects.toThrow('network error');
  });
});
