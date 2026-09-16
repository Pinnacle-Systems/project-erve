import { prepareErveDispatchListPdfData } from './prepareErveDispatchListPdfData.js';
import { buildErveDispatchListViewModel, type ErveDispatchListPdfMeta } from './buildErveDispatchListViewModel.js';
import { ErveDispatchListDocument } from './ErveDispatchListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `ErveDispatchListDocument` (and therefore of `@react-pdf/renderer`
 * for the Erve Dispatch list). Callers reach this module via a dynamic `import()` so the PDF
 * engine and document code load only when a user actually clicks Download/Print.
 *
 * Fetches every page of /erve-dispatches (the list screen itself only ever shows the first 50)
 * before building the document, so the PDF always contains every authorized Erve Dispatch.
 */
export async function generateErveDispatchListPdfBlob(meta: ErveDispatchListPdfMeta): Promise<Blob> {
  const dispatches = await prepareErveDispatchListPdfData();
  const viewModel = buildErveDispatchListViewModel(dispatches, meta);
  return renderPdfBlob(<ErveDispatchListDocument viewModel={viewModel} />);
}
