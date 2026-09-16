import { prepareErvePackingListListPdfData } from './prepareErvePackingListListPdfData.js';
import { buildErvePackingListListViewModel, type ErvePackingListListPdfMeta } from './buildErvePackingListListViewModel.js';
import { ErvePackingListListDocument } from './ErvePackingListListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `ErvePackingListListDocument` (and therefore of
 * `@react-pdf/renderer` for the Erve Packing List list). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print.
 *
 * Fetches every page of /erve-packing-lists (the list screen itself only ever shows the first 50)
 * before building the document, so the PDF always contains every authorized Erve Packing List.
 */
export async function generateErvePackingListListPdfBlob(meta: ErvePackingListListPdfMeta): Promise<Blob> {
  const packingLists = await prepareErvePackingListListPdfData();
  const viewModel = buildErvePackingListListViewModel(packingLists, meta);
  return renderPdfBlob(<ErvePackingListListDocument viewModel={viewModel} />);
}
