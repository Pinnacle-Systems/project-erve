import { buildInvoiceHandoffDetailViewModel, type InvoiceHandoffDetailPdfMeta } from './buildInvoiceHandoffDetailViewModel.js';
import { InvoiceHandoffDetailDocument } from './InvoiceHandoffDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { InvoiceHandoffView } from '../../types.js';

/**
 * The only static importer of `InvoiceHandoffDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Invoice Handoff detail). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The detail record is already fully loaded by the page (with server-side
 * DISTRIBUTOR field redaction already applied) — no extra fetch here.
 */
export async function generateInvoiceHandoffDetailPdfBlob(
  handoff: InvoiceHandoffView,
  meta: InvoiceHandoffDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildInvoiceHandoffDetailViewModel(handoff, meta);
  return renderPdfBlob(<InvoiceHandoffDetailDocument viewModel={viewModel} />);
}
