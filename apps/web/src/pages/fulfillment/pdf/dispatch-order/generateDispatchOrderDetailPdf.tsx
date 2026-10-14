import {
  buildDispatchOrderDetailViewModel,
  type DispatchOrderDetailPdfMeta,
  type DispatchOrderDetailPdfRelated,
} from './buildDispatchOrderDetailViewModel.js';
import { DispatchOrderDetailDocument } from './DispatchOrderDetailDocument.js';
import { prepareDispatchOrderDetailPdfData } from './prepareDispatchOrderDetailPdfData.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { SaleOrder } from '../../../sale-orders/types.js';

/**
 * The only static importer of `DispatchOrderDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Dispatch Order detail). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The detail page already loads the full record (plus its own permission-gated
 * linked-record queries); only primary image bytes are fetched during preparation.
 */
export async function generateDispatchOrderDetailPdfBlob(
  saleOrder: SaleOrder,
  related: DispatchOrderDetailPdfRelated,
  meta: DispatchOrderDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildDispatchOrderDetailViewModel(saleOrder, related, meta);
  const images = await prepareDispatchOrderDetailPdfData(viewModel);
  return renderPdfBlob(<DispatchOrderDetailDocument viewModel={viewModel} images={images} />);
}
