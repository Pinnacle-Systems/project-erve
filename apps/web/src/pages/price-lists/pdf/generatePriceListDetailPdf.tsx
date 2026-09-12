import {
  buildPriceListDetailViewModel,
  type PriceListDetailPdfMeta,
} from './buildPriceListDetailViewModel.js';
import { PriceListDetailDocument } from './PriceListDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { PriceList } from '../types.js';

/**
 * The only static importer of `PriceListDetailDocument` (and therefore of `@react-pdf/renderer`
 * for the Price List detail). Callers reach this module via a dynamic `import()` so the PDF
 * engine and document code load only when a user actually clicks Download/Print, not as part of
 * the app's initial bundle.
 */
export async function generatePriceListDetailPdfBlob(
  priceList: PriceList,
  meta: PriceListDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildPriceListDetailViewModel(priceList, meta);
  return renderPdfBlob(<PriceListDetailDocument viewModel={viewModel} />);
}
