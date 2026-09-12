import {
  buildSeasonListViewModel,
  type SeasonListPdfFilters,
  type SeasonListPdfMeta,
} from './buildSeasonListViewModel.js';
import { SeasonListDocument } from './SeasonListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Season } from '../types.js';

/**
 * The only static importer of `SeasonListDocument` (and therefore of `@react-pdf/renderer` for
 * the Season list). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle.
 */
export async function generateSeasonListPdfBlob(
  seasons: Season[],
  filters: SeasonListPdfFilters,
  meta: SeasonListPdfMeta,
): Promise<Blob> {
  const viewModel = buildSeasonListViewModel(seasons, filters, meta);
  return renderPdfBlob(<SeasonListDocument viewModel={viewModel} />);
}
