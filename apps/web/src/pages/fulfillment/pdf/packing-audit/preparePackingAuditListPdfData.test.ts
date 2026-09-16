import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackingAuditQueueItem } from '../../types.js';
import { preparePackingAuditListPdfData } from './preparePackingAuditListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeItem(overrides: Partial<PackingAuditQueueItem> = {}): PackingAuditQueueItem {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    weight: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'NOT_INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [],
    auditHistory: [],
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: { id: 'dest-1', label: 'Store 1', city: 'Chennai', state: 'TN', distributor: { id: 'd1', code: 'D1', name: 'Distributor One' } },
    ...overrides,
  };
}

function apiResponse(items: PackingAuditQueueItem[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('preparePackingAuditListPdfData', () => {
  it('returns all items from a single-page response at the export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeItem()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await preparePackingAuditListPdfData();

    expect(result).toEqual([makeItem()]);
    expect(getMock).toHaveBeenCalledWith('/packing-audit/queue', { params: { cursor: undefined, limit: 100 } });
  });

  it('fetches every remaining page beyond the screen\'s own flat limit:100 and preserves order', async () => {
    const a = makeItem({ id: 'c1' });
    const b = makeItem({ id: 'c2' });
    getMock
      .mockResolvedValueOnce(apiResponse([a], { limit: 100, hasMore: true, nextCursor: 'c1' }))
      .mockResolvedValueOnce(apiResponse([b], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await preparePackingAuditListPdfData();

    expect(result).toEqual([a, b]);
    expect(getMock).toHaveBeenNthCalledWith(2, '/packing-audit/queue', { params: { cursor: 'c1', limit: 100 } });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));
    const result = await preparePackingAuditListPdfData();
    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeItem()], { limit: 100, hasMore: true, nextCursor: 'c1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(preparePackingAuditListPdfData()).rejects.toThrow('network error');
  });
});
