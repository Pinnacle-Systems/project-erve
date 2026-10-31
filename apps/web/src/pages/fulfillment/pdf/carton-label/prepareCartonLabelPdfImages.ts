import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { StylePrimaryImageView } from '@erve/types';
import type { FactoryPackingCartonView } from '../../types.js';

/**
 * Resolve the carton label's Style thumbnails from the already-authorized
 * carton lines. Fetch one image per unique Style/file, never use a public URL
 * or perform a master-data lookup, and degrade to a placeholder on failure.
 * The pure view-model builder and PDF renderer do not touch the network.
 */
export async function prepareCartonLabelPdfImages(
  carton: FactoryPackingCartonView,
): Promise<Map<string, PdfImageSource>> {
  const byStyle = new Map<string, StylePrimaryImageView | null>();
  for (const line of carton.lines) {
    if (!byStyle.has(line.styleId) || (!byStyle.get(line.styleId) && line.primaryImage)) {
      byStyle.set(line.styleId, line.primaryImage);
    }
  }

  const refs: PdfImageRef[] = [];
  for (const [styleId, image] of byStyle) {
    if (image) {
      refs.push({ id: image.fileId, path: `/styles/${styleId}/images/${image.id}/content` });
    }
  }
  const resolved = refs.length > 0
    ? await resolveImagesForPdf(refs, { maxDimension: 120 })
    : new Map<string, PdfImageSource>();

  const result = new Map<string, PdfImageSource>();
  for (const [styleId, image] of byStyle) {
    result.set(styleId, image ? resolved.get(image.fileId) ?? { placeholder: true } : { placeholder: true });
  }
  return result;
}
