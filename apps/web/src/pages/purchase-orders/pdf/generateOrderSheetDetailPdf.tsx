import {
  buildOrderSheetDetailViewModel,
  type OrderSheetDetailPdfMeta,
} from './buildOrderSheetDetailViewModel.js';
import { prepareOrderSheetDetailPdfData } from './prepareOrderSheetDetailPdfData.js';
import { OrderSheetDetailDocument } from './OrderSheetDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { PurchaseOrder } from '../types.js';

/**
 * The only static importer of `OrderSheetDetailDocument` (and therefore of `@react-pdf/renderer`
 * for the Order Sheet detail). Callers reach this module via a dynamic `import()` so the PDF engine
 * and document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle. The detail page already loads the full record (including the one line's
 * primaryImage) — the only network step left is resolving that image to a print-quality data URI
 * (prepareOrderSheetDetailPdfData), same convention as the Style Detail PDF.
 */
export async function generateOrderSheetDetailPdfBlob(
  po: PurchaseOrder,
  meta: OrderSheetDetailPdfMeta,
): Promise<Blob> {
  const prepared = await prepareOrderSheetDetailPdfData(po);
  const viewModel = buildOrderSheetDetailViewModel(prepared.po, meta, prepared.primaryImage);
  return renderPdfBlob(<OrderSheetDetailDocument viewModel={viewModel} />);
}
