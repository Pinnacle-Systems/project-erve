import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { ErveDispatchView } from '../../types.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Erve Dispatch List PDF. GET /erve-dispatches is
 * cursor-paginated with no total count, and the list screen itself (ErveDispatchListPage.tsx)
 * hardcodes `limit: 50` with no "load more" and exposes no filter/search/sort controls — so a PDF
 * export must loop every page (identical, empty filter set) to capture every authorized Erve
 * Dispatch. buildErveDispatchListViewModel (pure) and ErveDispatchListDocument (pure render) never fetch.
 */
export async function prepareErveDispatchListPdfData(): Promise<ErveDispatchView[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<ErveDispatchView>>>('/erve-dispatches', {
        params: { cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
