import {
  buildOrderSheetDetailViewModel,
  type OrderSheetDetailPdfMeta,
} from './buildOrderSheetDetailViewModel.js';
import { OrderSheetDetailDocument } from './OrderSheetDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { PurchaseOrder } from '../types.js';

/**
 * The only static importer of `OrderSheetDetailDocument` (and therefore of `@react-pdf/renderer`
 * for the Order Sheet detail). Callers reach this module via a dynamic `import()` so the PDF engine
 * and document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle. The detail page already loads the full record, so no extra fetching is needed here.
 */
export async function generateOrderSheetDetailPdfBlob(
  po: PurchaseOrder,
  meta: OrderSheetDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildOrderSheetDetailViewModel(po, meta);
  return renderPdfBlob(<OrderSheetDetailDocument viewModel={viewModel} />);
}
