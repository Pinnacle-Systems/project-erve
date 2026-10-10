import { resolveImagesForPdf } from '../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { PurchaseOrder } from '../types.js';

export interface PreparedOrderSheetDetailPdfData {
  po: PurchaseOrder;
  primaryImage: PdfImageSource;
}

const DETAIL_IMAGE_MAX_DIMENSION = 480;

/**
 * The only step that touches the network for the Order Sheet Detail PDF.
 * An Order Sheet is exactly one Style (server-enforced, see
 * purchase-orders.validation.ts) so its one line's primaryImage — already
 * on the loaded record, no extra fetch for which image — is this
 * document's own identity image, same convention as prepareStyleDetailPdfData.
 */
export async function prepareOrderSheetDetailPdfData(po: PurchaseOrder): Promise<PreparedOrderSheetDetailPdfData> {
  const primary = po.lines[0]?.primaryImage;
  if (!primary) {
    return { po, primaryImage: { placeholder: true } };
  }
  const styleId = po.lines[0]!.styleId;
  const resolved = await resolveImagesForPdf([{ id: primary.fileId, path: `/styles/${styleId}/images/${primary.id}/content` }], {
    maxDimension: DETAIL_IMAGE_MAX_DIMENSION,
  });
  return { po, primaryImage: resolved.get(primary.fileId) ?? { placeholder: true } };
}
