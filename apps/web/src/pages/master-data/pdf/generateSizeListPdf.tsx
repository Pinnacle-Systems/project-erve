import { buildSizeListViewModel, type SizeListPdfMeta } from './buildSizeListViewModel.js';
import { SizeListDocument } from './SizeListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Size } from '../types.js';

/**
 * The only static importer of `SizeListDocument` (and therefore of `@react-pdf/renderer` for the
 * Size list). Callers reach this module via a dynamic `import()` so the PDF engine and document
 * code load only when a user actually clicks Download/Print, not as part of the app's initial
 * bundle.
 */
export async function generateSizeListPdfBlob(sizes: Size[], meta: SizeListPdfMeta): Promise<Blob> {
  const viewModel = buildSizeListViewModel(sizes, meta);
  return renderPdfBlob(<SizeListDocument viewModel={viewModel} />);
}
