import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { InvoiceHandoffStatus, InvoiceHandoffView } from '../../types.js';

export interface InvoiceHandoffListPdfQueryParams {
  status?: InvoiceHandoffStatus;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Invoice Handoff List PDF. GET /invoice-handoffs is
 * cursor-paginated with no total count, and the list screen itself (InvoiceHandoffListPage.tsx)
 * hardcodes `limit: 100` with no "load more" — so a PDF export must loop every page with the
 * identical active Status tab (the only filter the screen exposes) to capture every authorized
 * matching invoice handoff. buildInvoiceHandoffListViewModel (pure) and InvoiceHandoffListDocument
 * (pure render) never fetch. Row-level Distributor scoping and the DISTRIBUTOR-redacted field set
 * are already applied server-side (see invoice-handoff.service.ts's toInvoiceHandoffView) — this
 * export never bypasses that.
 */
export async function prepareInvoiceHandoffListPdfData(
  params: InvoiceHandoffListPdfQueryParams,
): Promise<InvoiceHandoffView[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<InvoiceHandoffView>>>('/invoice-handoffs', {
        params: { status: params.status, cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
