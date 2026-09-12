import { prepareStyleDetailPdfData } from './prepareStyleDetailPdfData.js';
import { buildStyleDetailViewModel, type StyleDetailPdfMeta } from './buildStyleDetailViewModel.js';
import { StyleDetailDocument } from './StyleDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Style } from '../types.js';

/**
 * The only static importer of `StyleDetailDocument` (and therefore of `@react-pdf/renderer` for the
 * Style detail PDF). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print.
 */
export async function generateStyleDetailPdfBlob(
  style: Style,
  meta: StyleDetailPdfMeta,
): Promise<Blob> {
  const prepared = await prepareStyleDetailPdfData(style);
  const viewModel = buildStyleDetailViewModel(prepared, meta);
  return renderPdfBlob(<StyleDetailDocument viewModel={viewModel} />);
}
