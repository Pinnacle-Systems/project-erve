import {
  buildPriceListListViewModel,
  type PriceListListPdfFilters,
  type PriceListListPdfMeta,
} from './buildPriceListListViewModel.js';
import { PriceListListDocument } from './PriceListListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { PriceListSummary } from '../types.js';

/**
 * The only static importer of `PriceListListDocument` (and therefore of `@react-pdf/renderer` for
 * the Price List list). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle.
 */
export async function generatePriceListListPdfBlob(
  priceLists: PriceListSummary[],
  filters: PriceListListPdfFilters,
  meta: PriceListListPdfMeta,
): Promise<Blob> {
  const viewModel = buildPriceListListViewModel(priceLists, filters, meta);
  return renderPdfBlob(<PriceListListDocument viewModel={viewModel} />);
}
