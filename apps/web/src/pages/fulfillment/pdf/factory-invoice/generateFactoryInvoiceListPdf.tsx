import { prepareFactoryInvoiceListPdfData, type FactoryInvoiceListPdfQueryParams } from './prepareFactoryInvoiceListPdfData.js';
import { buildFactoryInvoiceListViewModel, type FactoryInvoiceListPdfMeta } from './buildFactoryInvoiceListViewModel.js';
import { FactoryInvoiceListDocument } from './FactoryInvoiceListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `FactoryInvoiceListDocument` (and therefore of
 * `@react-pdf/renderer` for the Factory Invoice list). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print.
 *
 * Fetches every page of /factory-invoices matching the current Status tab (the list screen itself
 * only ever shows the first page) before building the document, so the PDF always contains every
 * authorized matching Factory Invoice for that filter — never silently just page 1.
 */
export async function generateFactoryInvoiceListPdfBlob(
  queryParams: FactoryInvoiceListPdfQueryParams,
  meta: FactoryInvoiceListPdfMeta,
): Promise<Blob> {
  const invoices = await prepareFactoryInvoiceListPdfData(queryParams);
  const viewModel = buildFactoryInvoiceListViewModel(invoices, queryParams, meta);
  return renderPdfBlob(<FactoryInvoiceListDocument viewModel={viewModel} />);
}
