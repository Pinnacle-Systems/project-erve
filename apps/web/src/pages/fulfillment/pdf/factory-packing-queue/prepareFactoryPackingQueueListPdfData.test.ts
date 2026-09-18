import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryDispatchSummary } from '../../types.js';
import { prepareFactoryPackingQueueListPdfData } from './prepareFactoryPackingQueueListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeDispatch(overrides: Partial<FactoryDispatchSummary> = {}): FactoryDispatchSummary {
  return {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [{ id: 'd1', code: 'D1', name: 'Distributor One' }] },
    status: 'DRAFT',
    version: 1,
    preparedAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: null,
    consolidated: false,
    ...overrides,
  };
}

function apiResponse(items: FactoryDispatchSummary[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareFactoryPackingQueueListPdfData', () => {
  it('returns all items from a single-page response at the export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeDispatch()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryPackingQueueListPdfData();

    expect(result).toEqual([makeDispatch()]);
    expect(getMock).toHaveBeenCalledWith('/factory-dispatches', { params: { cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page beyond the screen\'s own hardcoded limit:25 and preserves order', async () => {
    const fdA = makeDispatch({ id: 'fd-1' });
    const fdB = makeDispatch({ id: 'fd-2' });
    getMock
      .mockResolvedValueOnce(apiResponse([fdA], { limit: 100, hasMore: true, nextCursor: 'fd-1' }))
      .mockResolvedValueOnce(apiResponse([fdB], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryPackingQueueListPdfData();

    expect(result).toEqual([fdA, fdB]);
    expect(getMock).toHaveBeenNthCalledWith(2, '/factory-dispatches', { params: { cursor: 'fd-1', limit: 100 } });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    const result = await prepareFactoryPackingQueueListPdfData();
    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeDispatch()], { limit: 100, hasMore: true, nextCursor: 'fd-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareFactoryPackingQueueListPdfData()).rejects.toThrow('network error');
  });

  // UXAUTH-005: this export's "Your Factory Dispatches" half previously
  // ignored the on-screen Factory selection entirely (always fetched every
  // Factory). It must now carry the exact same Factory context the screen
  // is showing.
  it('passes a given factoryId through to every page request', async () => {
    const fdA = makeDispatch({ id: 'fd-1' });
    const fdB = makeDispatch({ id: 'fd-2' });
    getMock
      .mockResolvedValueOnce(apiResponse([fdA], { limit: 100, hasMore: true, nextCursor: 'fd-1' }))
      .mockResolvedValueOnce(apiResponse([fdB], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryPackingQueueListPdfData('factory-B');

    expect(result).toEqual([fdA, fdB]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/factory-dispatches', { params: { cursor: undefined, limit: 100, factoryId: 'factory-B' } });
    expect(getMock).toHaveBeenNthCalledWith(2, '/factory-dispatches', { params: { cursor: 'fd-1', limit: 100, factoryId: 'factory-B' } });
  });

  it('switching the requested Factory changes every subsequent request — never mixes a previous Factory\'s scope into a new export', async () => {
    getMock.mockResolvedValue(apiResponse([makeDispatch({ id: 'fd-a' })], { limit: 100, hasMore: false, nextCursor: null }));
    await prepareFactoryPackingQueueListPdfData('factory-A');
    expect(getMock).toHaveBeenLastCalledWith('/factory-dispatches', { params: { cursor: undefined, limit: 100, factoryId: 'factory-A' } });

    getMock.mockReset();
    getMock.mockResolvedValue(apiResponse([makeDispatch({ id: 'fd-b' })], { limit: 100, hasMore: false, nextCursor: null }));
    await prepareFactoryPackingQueueListPdfData('factory-B');
    expect(getMock).toHaveBeenLastCalledWith('/factory-dispatches', { params: { cursor: undefined, limit: 100, factoryId: 'factory-B' } });
  });

  it('omits factoryId (server-scoped FACTORY_USER) when none is given', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    await prepareFactoryPackingQueueListPdfData();
    const [, config] = getMock.mock.calls[0]!;
    expect((config as { params: Record<string, unknown> }).params.factoryId).toBeUndefined();
  });
});
