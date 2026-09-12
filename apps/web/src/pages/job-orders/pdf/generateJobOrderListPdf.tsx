import { prepareJobOrderListPdfData, type JobOrderListPdfQueryParams } from './prepareJobOrderListPdfData.js';
import {
  buildJobOrderListViewModel,
  type JobOrderListPdfFilters,
  type JobOrderListPdfMeta,
} from './buildJobOrderListViewModel.js';
import { JobOrderListDocument } from './JobOrderListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';

/**
 * The only static importer of `JobOrderListDocument` (and therefore of `@react-pdf/renderer` for
 * the Job Order list). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle.
 *
 * Fetches every page of /job-orders matching the current filters (the list screen itself only ever
 * shows the first page) before building the document, so the PDF always contains every authorized
 * matching Job Order.
 */
export async function generateJobOrderListPdfBlob(
  queryParams: JobOrderListPdfQueryParams,
  filters: JobOrderListPdfFilters,
  meta: JobOrderListPdfMeta,
): Promise<Blob> {
  const jobOrders = await prepareJobOrderListPdfData(queryParams);
  const viewModel = buildJobOrderListViewModel(jobOrders, filters, meta);
  return renderPdfBlob(<JobOrderListDocument viewModel={viewModel} />);
}
