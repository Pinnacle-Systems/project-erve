import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryInvoiceView } from '../../types.js';
import { prepareFactoryInvoiceListPdfData } from './prepareFactoryInvoiceListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return {
    id: 'fi-1',
    status: 'GENERATED',
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    factoryDispatch: { id: 'fd1', factoryDispatchNumber: 'FD/26-27/0001' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    generatedAt: '2026-06-30T00:00:00.000Z',
    factoryConfirmedBy: null,
    factoryConfirmedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    subtotal: 1000,
    gstAmount: 50,
    total: 1050,
    remarks: null,
    lines: [],
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

function apiResponse(items: FactoryInvoiceView[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareFactoryInvoiceListPdfData', () => {
  it('returns all items from a single-page response with the requested status filter', async () => {
    getMock.mockResolvedValue(apiResponse([makeInvoice()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryInvoiceListPdfData({ status: 'GENERATED' });

    expect(result).toEqual([makeInvoice()]);
    expect(getMock).toHaveBeenCalledWith('/factory-invoices', { params: { status: 'GENERATED', cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page using identical filters and preserves order', async () => {
    const a = makeInvoice({ id: 'fi-1' });
    const b = makeInvoice({ id: 'fi-2' });
    getMock
      .mockResolvedValueOnce(apiResponse([a], { limit: 100, hasMore: true, nextCursor: 'fi-1' }))
      .mockResolvedValueOnce(apiResponse([b], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryInvoiceListPdfData({ status: 'FINALIZED' });

    expect(result).toEqual([a, b]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/factory-invoices', { params: { status: 'FINALIZED', cursor: undefined, limit: 100 } });
    expect(getMock).toHaveBeenNthCalledWith(2, '/factory-invoices', { params: { status: 'FINALIZED', cursor: 'fi-1', limit: 100 } });
  });

  it('omits the status filter when none is active (the "All" tab)', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    await prepareFactoryInvoiceListPdfData({});
    expect(getMock).toHaveBeenCalledWith('/factory-invoices', { params: { status: undefined, cursor: undefined, limit: 100 } });
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeInvoice()], { limit: 100, hasMore: true, nextCursor: 'fi-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareFactoryInvoiceListPdfData({ status: 'GENERATED' })).rejects.toThrow('network error');
  });
});
