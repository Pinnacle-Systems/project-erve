import { buildSizeDetailViewModel, type SizeDetailPdfMeta } from './buildSizeDetailViewModel.js';
import { SizeDetailDocument } from './SizeDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Size } from '../types.js';

/**
 * The only static importer of `SizeDetailDocument` (and therefore of `@react-pdf/renderer` for
 * the Size detail PDF). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print.
 */
export async function generateSizeDetailPdfBlob(size: Size, meta: SizeDetailPdfMeta): Promise<Blob> {
  const viewModel = buildSizeDetailViewModel(size, meta);
  return renderPdfBlob(<SizeDetailDocument viewModel={viewModel} />);
}
