import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { FactoryDispatchSummary } from '../../types.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Factory Packing Queue PDF's "Your Factory Dispatches"
 * section. GET /factory-dispatches is cursor-paginated (default limit 25, max 100), but the screen
 * itself hardcodes `limit: 25` with no "load more" — so beyond 25 open Factory Dispatches the page
 * silently shows only the first page. A PDF export must not inherit that cap: this loops every page
 * (same implicit server-side Factory scoping, no extra filters — the screen exposes none) so the
 * export always contains every authorized matching Factory Dispatch.
 *
 * The "Awaiting Packing" section needs no equivalent treatment — GET /factory-dispatches/packing-queue
 * has no pagination at all and already returns every remaining line, so the PDF reads that half
 * directly from the page's already-loaded query data.
 */
export async function prepareFactoryPackingQueueListPdfData(): Promise<FactoryDispatchSummary[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
