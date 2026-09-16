import {
  buildErveDispatchDetailViewModel,
  type ErveDispatchDetailPdfMeta,
  type ErveDispatchDetailPdfRelated,
} from './buildErveDispatchDetailViewModel.js';
import { ErveDispatchDetailDocument } from './ErveDispatchDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { ErveDispatchView } from '../../types.js';

/**
 * The only static importer of `ErveDispatchDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Erve Dispatch detail). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The detail page already loads the full record, so no extra fetching is needed
 * here — `related` only decides whether the Invoice/Tally section is included, mirroring the
 * page's own `canViewInvoiceHandoffs` gate.
 */
export async function generateErveDispatchDetailPdfBlob(
  dispatch: ErveDispatchView,
  related: ErveDispatchDetailPdfRelated,
  meta: ErveDispatchDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildErveDispatchDetailViewModel(dispatch, related, meta);
  return renderPdfBlob(<ErveDispatchDetailDocument viewModel={viewModel} />);
}
