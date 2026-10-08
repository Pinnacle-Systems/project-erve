import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { FactoryDispatchSummary, FactoryPackingQueueLine } from '../../types.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * Traverses every page of GET /factory-dispatches/packing-queue (bounded by default, limit 100)
 * so the PDF export contains every authorized line awaiting packing, rather than only the
 * first page shown on screen.
 *
 * UXAUTH-005: factoryId matches the on-screen selected Factory context (undefined for FACTORY_USER).
 */
export async function prepareFactoryPackingQueueAwaitingData(factoryId?: string): Promise<FactoryPackingQueueLine[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<FactoryPackingQueueLine>>>('/factory-dispatches/packing-queue', {
        params: { cursor, limit, factoryId },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}

/**
 * Traverses every page of GET /factory-dispatches (default limit 25, max 100)
 * so the PDF export always contains every authorized matching Factory Dispatch.
 *
 * UXAUTH-005: factoryId matches the on-screen selected Factory context (undefined for FACTORY_USER).
 */
export async function prepareFactoryPackingQueueListPdfData(factoryId?: string): Promise<FactoryDispatchSummary[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { cursor, limit, factoryId },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
