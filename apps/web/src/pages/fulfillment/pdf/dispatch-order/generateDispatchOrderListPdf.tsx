import {
  prepareDispatchOrderListPdfData,
  type DispatchOrderListPdfQueryParams,
} from './prepareDispatchOrderListPdfData.js';
import {
  buildDispatchOrderListViewModel,
  type DispatchOrderListPdfFilters,
  type DispatchOrderListPdfMeta,
} from './buildDispatchOrderListViewModel.js';
import { DispatchOrderListDocument } from './DispatchOrderListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `DispatchOrderListDocument` (and therefore of `@react-pdf/renderer`
 * for the Dispatch Order list). Callers reach this module via a dynamic `import()` so the PDF
 * engine and document code load only when a user actually clicks Download/Print.
 *
 * Fetches every page of /sale-orders matching the current filters (the list screen itself only
 * ever shows the first page) before building the document, so the PDF always contains every
 * authorized matching Dispatch Order.
 */
export async function generateDispatchOrderListPdfBlob(
  queryParams: DispatchOrderListPdfQueryParams,
  filters: DispatchOrderListPdfFilters,
  meta: DispatchOrderListPdfMeta,
): Promise<Blob> {
  const saleOrders = await prepareDispatchOrderListPdfData(queryParams);
  const viewModel = buildDispatchOrderListViewModel(saleOrders, filters, meta);
  return renderPdfBlob(<DispatchOrderListDocument viewModel={viewModel} />);
}
