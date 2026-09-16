import { buildFactoryInvoiceDetailViewModel, type FactoryInvoiceDetailPdfMeta } from './buildFactoryInvoiceDetailViewModel.js';
import { FactoryInvoiceDetailDocument } from './FactoryInvoiceDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { FactoryInvoiceView } from '../../types.js';

/**
 * The only static importer of `FactoryInvoiceDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Factory Invoice detail). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The detail record is already fully loaded by the page — no extra fetch here.
 */
export async function generateFactoryInvoiceDetailPdfBlob(
  invoice: FactoryInvoiceView,
  meta: FactoryInvoiceDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildFactoryInvoiceDetailViewModel(invoice, meta);
  return renderPdfBlob(<FactoryInvoiceDetailDocument viewModel={viewModel} />);
}
