import { prepareStyleListPdfData } from './prepareStyleListPdfData.js';
import { buildStyleListViewModel, type StyleListPdfFilters, type StyleListPdfMeta } from './buildStyleListViewModel.js';
import { StyleListDocument } from './StyleListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Style } from '../types.js';

/**
 * The only static importer of `StyleListDocument` (and therefore of `@react-pdf/renderer` for the
 * Style list). Callers reach this module via a dynamic `import()` so the PDF engine and document
 * code load only when a user actually clicks Download/Print, not as part of the app's initial
 * bundle — react-pdf is a relatively heavy, infrequently-used capability.
 */
export async function generateStyleListPdfBlob(
  styles: Style[],
  filters: StyleListPdfFilters,
  meta: StyleListPdfMeta,
): Promise<Blob> {
  const prepared = await prepareStyleListPdfData(styles);
  const viewModel = buildStyleListViewModel(prepared, filters, meta);
  return renderPdfBlob(<StyleListDocument viewModel={viewModel} />);
}
