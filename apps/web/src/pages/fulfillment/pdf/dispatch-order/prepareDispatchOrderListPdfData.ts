import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { SaleOrder } from '../../../sale-orders/types.js';

export interface DispatchOrderListPdfQueryParams {
  search?: string;
  distributorId?: string;
  factoryId?: string;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Dispatch Order List PDF. GET /sale-orders is
 * cursor-paginated with no total count, and the list screen itself never requests past the first
 * page — so a PDF export must loop every page with identical filters (Search/Distributor/Factory,
 * the only three controls the screen exposes) to capture every authorized matching Dispatch Order.
 * buildDispatchOrderListViewModel (pure) and DispatchOrderListDocument (pure render) never fetch.
 */
export async function prepareDispatchOrderListPdfData(
  params: DispatchOrderListPdfQueryParams,
): Promise<SaleOrder[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<SaleOrder>>>('/sale-orders', {
        params: { ...params, cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
