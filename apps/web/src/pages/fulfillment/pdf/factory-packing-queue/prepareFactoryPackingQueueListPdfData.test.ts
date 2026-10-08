import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryDispatchSummary, FactoryPackingQueueLine } from '../../types.js';
import {
  prepareFactoryPackingQueueAwaitingData,
  prepareFactoryPackingQueueListPdfData,
} from './prepareFactoryPackingQueueListPdfData.js';

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

function makeQueueLine(overrides: Partial<FactoryPackingQueueLine> = {}): FactoryPackingQueueLine {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Distributor One' },
    saleOrderLineId: 'line-1',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    allocatedQuantity: 10,
    packedQuantity: 0,
    remainingQuantity: 10,
    ...overrides,
  };
}

function apiResponse<T>(items: T[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
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

describe('prepareFactoryPackingQueueAwaitingData — PAG-P1-05 cursor traversal', () => {
  it('returns all items from a single-page response at the export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeQueueLine()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryPackingQueueAwaitingData();

    expect(result).toEqual([makeQueueLine()]);
    expect(getMock).toHaveBeenCalledWith('/factory-dispatches/packing-queue', { params: { cursor: undefined, limit: 100 } });
  });

  it('traverses every page across cursor boundaries and preserves item ordering', async () => {
    const lineA = makeQueueLine({ saleOrderLineId: 'line-1' });
    const lineB = makeQueueLine({ saleOrderLineId: 'line-2' });
    const lineC = makeQueueLine({ saleOrderLineId: 'line-3' });

    getMock
      .mockResolvedValueOnce(apiResponse([lineA, lineB], { limit: 100, hasMore: true, nextCursor: 'cursor-token-1' }))
      .mockResolvedValueOnce(apiResponse([lineC], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareFactoryPackingQueueAwaitingData('factory-1');

    expect(result).toEqual([lineA, lineB, lineC]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/factory-dispatches/packing-queue', {
      params: { cursor: undefined, limit: 100, factoryId: 'factory-1' },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/factory-dispatches/packing-queue', {
      params: { cursor: 'cursor-token-1', limit: 100, factoryId: 'factory-1' },
    });
  });

  it('returns empty array when queue is empty', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    const result = await prepareFactoryPackingQueueAwaitingData();
    expect(result).toEqual([]);
  });

  it('propagates error when any page request fails', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeQueueLine()], { limit: 100, hasMore: true, nextCursor: 'cursor-1' }))
      .mockRejectedValueOnce(new Error('connection timeout'));

    await expect(prepareFactoryPackingQueueAwaitingData()).rejects.toThrow('connection timeout');
  });

  it('omits factoryId when undefined for FACTORY_USER', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    await prepareFactoryPackingQueueAwaitingData();
    const [, config] = getMock.mock.calls[0]!;
    expect((config as { params: Record<string, unknown> }).params.factoryId).toBeUndefined();
  });
});
