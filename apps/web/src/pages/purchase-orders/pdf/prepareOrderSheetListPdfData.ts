import type { ApiSuccessResponse, PaginatedResponse, PurchaseOrderDetail } from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../lib/pdf/fetchAllPaginatedRecords.js';

export interface OrderSheetListPdfQueryParams {
  search?: string;
  planningState?: string;
  distributorId?: string;
  purchaseMode?: string;
  financialYearId?: string;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Order Sheet List PDF. GET /purchase-orders is cursor-
 * paginated with no total count, and the list screen itself never requests past the first page —
 * so a PDF export must loop every page with identical filters to capture every authorized matching
 * Order Sheet, not just the current UI page. buildOrderSheetListViewModel (pure) and
 * OrderSheetListDocument (pure render) never fetch.
 */
export async function prepareOrderSheetListPdfData(
  params: OrderSheetListPdfQueryParams,
): Promise<PurchaseOrderDetail[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<PurchaseOrderDetail>>>(
        '/purchase-orders',
        { params: { ...params, cursor, limit } },
      );
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
