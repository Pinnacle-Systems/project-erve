import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobOrder } from '../types.js';
import { prepareJobOrderListPdfData } from './prepareJobOrderListPdfData.js';

const getMock = vi.fn();
vi.mock('../../../lib/api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => {
  getMock.mockReset();
});

function makeJobOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    financialYear: { id: 'fy1', code: '2026-27' },
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    unitPrice: 100,
    status: 'DRAFT',
    operationalState: {
      lifecycleContext: { code: 'DRAFT', label: 'Draft', tone: 'muted', activityId: null, activityName: null },
      productionState: null,
      qualityState: null,
      primaryDisplayState: { code: 'DRAFT', label: 'Draft', tone: 'muted', activityId: null, activityName: null },
    },
    factoryConfirmationStatus: 'PENDING',
    requiredDeliveryDate: null,
    deliveryDateLocked: false,
    isDelayed: false,
    orderedQuantityTotal: 0,
    preparedQuantityTotal: 0,
    sourceOrderSheetCount: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    seasonSnapshots: [],
    processFlowVersion: { id: 'pfv1', versionNumber: 1, status: 'ACTIVE', processFlow: { id: 'pf1', code: 'PF1', name: 'Standard Flow' } },
    confirmedBy: null,
    confirmedAt: null,
    disclaimerText: null,
    disclaimerRevision: 0,
    acknowledgement: null,
    acknowledgements: [],
    productionStartedAt: null,
    productionCompletedAt: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    lines: [],
    stages: [],
    qualityActivities: [],
    reworkTasks: [],
    ...overrides,
  };
}

function apiResponse(items: JobOrder[], pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }) {
  return { data: { data: { items, pageInfo } } };
}

describe('prepareJobOrderListPdfData', () => {
  it('returns all items from a single-page response with the requested filters and export page size', async () => {
    getMock.mockResolvedValue(apiResponse([makeJobOrder()], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareJobOrderListPdfData({ search: 'EIJO', factoryId: 'f1' });

    expect(result).toEqual([makeJobOrder()]);
    expect(getMock).toHaveBeenCalledWith('/job-orders', {
      params: { search: 'EIJO', factoryId: 'f1', cursor: undefined, limit: 100 },
    });
  });

  it('fetches every remaining page using identical filters and preserves order', async () => {
    const jobOrderA = makeJobOrder({ id: 'jo-1', jobOrderNumber: 'EIJO/26-27/0001' });
    const jobOrderB = makeJobOrder({ id: 'jo-2', jobOrderNumber: 'EIJO/26-27/0002' });
    getMock
      .mockResolvedValueOnce(apiResponse([jobOrderA], { limit: 100, hasMore: true, nextCursor: 'jo-1' }))
      .mockResolvedValueOnce(apiResponse([jobOrderB], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareJobOrderListPdfData({ status: 'IN_PRODUCTION' });

    expect(result).toEqual([jobOrderA, jobOrderB]);
    expect(getMock).toHaveBeenNthCalledWith(1, '/job-orders', {
      params: { status: 'IN_PRODUCTION', cursor: undefined, limit: 100 },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/job-orders', {
      params: { status: 'IN_PRODUCTION', cursor: 'jo-1', limit: 100 },
    });
  });

  it('returns an empty array for a zero-result response', async () => {
    getMock.mockResolvedValue(apiResponse([], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await prepareJobOrderListPdfData({});

    expect(result).toEqual([]);
  });

  it('fails the whole export when a later page request rejects', async () => {
    getMock
      .mockResolvedValueOnce(apiResponse([makeJobOrder()], { limit: 100, hasMore: true, nextCursor: 'jo-1' }))
      .mockRejectedValueOnce(new Error('network error'));

    await expect(prepareJobOrderListPdfData({})).rejects.toThrow('network error');
  });
});
