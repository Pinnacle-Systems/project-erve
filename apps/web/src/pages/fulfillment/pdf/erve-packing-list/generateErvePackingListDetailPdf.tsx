import { buildErvePackingListDetailViewModel, type ErvePackingListDetailPdfMeta } from './buildErvePackingListDetailViewModel.js';
import { ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { ErvePackingListDetail } from '../../types.js';

/**
 * The only static importer of `ErvePackingListDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Erve Packing List detail). Callers reach this module via a
 * dynamic `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The detail record is already fully loaded by the page — no extra fetch here.
 */
export async function generateErvePackingListDetailPdfBlob(
  packingList: ErvePackingListDetail,
  meta: ErvePackingListDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildErvePackingListDetailViewModel(packingList, meta);
  return renderPdfBlob(<ErvePackingListDetailDocument viewModel={viewModel} />);
}
