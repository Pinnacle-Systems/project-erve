import { prepareInvoiceHandoffListPdfData, type InvoiceHandoffListPdfQueryParams } from './prepareInvoiceHandoffListPdfData.js';
import { buildInvoiceHandoffListViewModel, type InvoiceHandoffListPdfMeta } from './buildInvoiceHandoffListViewModel.js';
import { InvoiceHandoffListDocument } from './InvoiceHandoffListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `InvoiceHandoffListDocument` (and therefore of
 * `@react-pdf/renderer` for the Invoice Handoff list). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print.
 *
 * Fetches every page of /invoice-handoffs matching the current Status tab (the list screen itself
 * only ever shows the first page) before building the document, so the PDF always contains every
 * authorized matching invoice handoff for that filter.
 */
export async function generateInvoiceHandoffListPdfBlob(
  queryParams: InvoiceHandoffListPdfQueryParams,
  meta: InvoiceHandoffListPdfMeta,
): Promise<Blob> {
  const handoffs = await prepareInvoiceHandoffListPdfData(queryParams);
  const viewModel = buildInvoiceHandoffListViewModel(handoffs, queryParams, meta);
  return renderPdfBlob(<InvoiceHandoffListDocument viewModel={viewModel} />);
}
