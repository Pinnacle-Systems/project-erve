import { resolveImagesForPdf, type PdfImageRef } from '../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { Style } from '../types.js';

export interface PreparedStyleListPdfData {
  styles: Style[];
  /** Resolved primary-image data (or placeholder), keyed by style id. */
  images: Map<string, PdfImageSource>;
}

const LIST_THUMBNAIL_MAX_DIMENSION = 160;

function primaryImageRef(style: Style): PdfImageRef | null {
  const primary = style.images.find((image) => image.isPrimary) ?? style.images[0] ?? null;
  if (!primary) return null;
  return { id: primary.fileId, path: `/styles/${style.id}/images/${primary.id}/content` };
}

/**
 * The only step that touches the network for the Style List PDF: resolves every row's primary
 * image (bounded concurrency, cache, timeouts, placeholders — see resolveImagesForPdf) and returns
 * plain data. buildStyleListViewModel (pure) and StyleListDocument (pure render) never fetch.
 */
export async function prepareStyleListPdfData(styles: Style[]): Promise<PreparedStyleListPdfData> {
  const refs = styles
    .map(primaryImageRef)
    .filter((ref): ref is PdfImageRef => ref !== null);

  const resolved = await resolveImagesForPdf(refs, { maxDimension: LIST_THUMBNAIL_MAX_DIMENSION });

  const images = new Map<string, PdfImageSource>();
  for (const style of styles) {
    const ref = primaryImageRef(style);
    images.set(style.id, (ref && resolved.get(ref.id)) || { placeholder: true });
  }

  return { styles, images };
}
