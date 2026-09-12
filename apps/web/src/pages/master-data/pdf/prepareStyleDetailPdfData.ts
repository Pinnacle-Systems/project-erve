import { resolveImagesForPdf } from '../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { Style } from '../types.js';

export interface PreparedStyleDetailPdfData {
  style: Style;
  primaryImage: PdfImageSource;
}

const DETAIL_IMAGE_MAX_DIMENSION = 480;

/** The only step that touches the network for the Style Detail PDF. */
export async function prepareStyleDetailPdfData(style: Style): Promise<PreparedStyleDetailPdfData> {
  const primary = style.images.find((image) => image.isPrimary) ?? style.images[0] ?? null;
  if (!primary) {
    return { style, primaryImage: { placeholder: true } };
  }
  const resolved = await resolveImagesForPdf(
    [{ id: primary.fileId, path: `/styles/${style.id}/images/${primary.id}/content` }],
    { maxDimension: DETAIL_IMAGE_MAX_DIMENSION },
  );
  return { style, primaryImage: resolved.get(primary.fileId) ?? { placeholder: true } };
}
