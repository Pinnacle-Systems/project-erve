import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { FactoryInvoiceStatus, FactoryInvoiceView } from '../../types.js';

export interface FactoryInvoiceListPdfQueryParams {
  status?: FactoryInvoiceStatus;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Factory Invoice List PDF. GET /factory-invoices is
 * cursor-paginated with no total count, and the list screen itself (FactoryInvoiceListPage.tsx)
 * hardcodes `limit: 100` with no "load more" — so a PDF export must loop every page with the
 * identical active Status tab (the only filter the screen exposes) to capture every authorized
 * matching Factory Invoice. buildFactoryInvoiceListViewModel (pure) and FactoryInvoiceListDocument
 * (pure render) never fetch.
 */
export async function prepareFactoryInvoiceListPdfData(
  params: FactoryInvoiceListPdfQueryParams,
): Promise<FactoryInvoiceView[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<FactoryInvoiceView>>>('/factory-invoices', {
        params: { status: params.status, cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
