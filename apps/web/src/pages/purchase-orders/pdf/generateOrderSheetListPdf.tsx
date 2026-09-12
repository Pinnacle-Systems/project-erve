import { prepareOrderSheetListPdfData, type OrderSheetListPdfQueryParams } from './prepareOrderSheetListPdfData.js';
import {
  buildOrderSheetListViewModel,
  type OrderSheetListPdfFilters,
  type OrderSheetListPdfMeta,
} from './buildOrderSheetListViewModel.js';
import { OrderSheetListDocument } from './OrderSheetListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';

/**
 * The only static importer of `OrderSheetListDocument` (and therefore of `@react-pdf/renderer` for
 * the Order Sheet list). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle.
 *
 * Fetches every page of /purchase-orders matching the current filters (the list screen itself only
 * ever shows the first page) before building the document, so the PDF always contains every
 * authorized matching Order Sheet.
 */
export async function generateOrderSheetListPdfBlob(
  queryParams: OrderSheetListPdfQueryParams,
  filters: OrderSheetListPdfFilters,
  meta: OrderSheetListPdfMeta,
): Promise<Blob> {
  const orders = await prepareOrderSheetListPdfData(queryParams);
  const viewModel = buildOrderSheetListViewModel(orders, filters, meta);
  return renderPdfBlob(<OrderSheetListDocument viewModel={viewModel} />);
}
