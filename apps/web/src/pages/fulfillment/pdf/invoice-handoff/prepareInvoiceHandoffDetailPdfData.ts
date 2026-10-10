import { resolveImagesForPdf } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { InvoiceHandoffView } from '../../types.js';

export interface PreparedInvoiceHandoffDetailPdfData {
  handoff: InvoiceHandoffView;
  primaryImage: PdfImageSource;
}

const DETAIL_IMAGE_MAX_DIMENSION = 480;

/**
 * The only step that touches the network for the Invoice Handoff Detail
 * PDF. An invoice handoff is always exactly one SaleOrderLine (one Style,
 * one Size) — handoff.style.primaryImage, already on the loaded record,
 * no extra fetch for which image — same convention as the Style Detail
 * PDF's prepare step.
 */
export async function prepareInvoiceHandoffDetailPdfData(
  handoff: InvoiceHandoffView,
): Promise<PreparedInvoiceHandoffDetailPdfData> {
  const primary = handoff.style.primaryImage;
  if (!primary) {
    return { handoff, primaryImage: { placeholder: true } };
  }
  const resolved = await resolveImagesForPdf(
    [{ id: primary.fileId, path: `/styles/${handoff.style.id}/images/${primary.id}/content` }],
    { maxDimension: DETAIL_IMAGE_MAX_DIMENSION },
  );
  return { handoff, primaryImage: resolved.get(primary.fileId) ?? { placeholder: true } };
}
