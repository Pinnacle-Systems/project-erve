import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { ErvePackingListSummary } from '../../types.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Erve Packing List (EIPL) List PDF. GET
 * /erve-packing-lists is cursor-paginated with no total count, and the list screen itself
 * (ErvePackingListListPage.tsx) hardcodes `limit: 50` with no "load more" and exposes no
 * filter/search/sort controls — so a PDF export must loop every page (identical, empty filter
 * set) to capture every authorized Erve Packing List, not merely the first 50 the screen shows.
 * buildErvePackingListListViewModel (pure) and ErvePackingListListDocument (pure render) never fetch.
 */
export async function prepareErvePackingListListPdfData(): Promise<ErvePackingListSummary[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<ErvePackingListSummary>>>(
        '/erve-packing-lists',
        { params: { cursor, limit } },
      );
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
