import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { StylePrimaryImageView } from '@erve/types';
import type { PackingListView } from '../../types.js';

function recordLines(
  map: Map<string, StylePrimaryImageView | null>,
  lines: readonly { styleId: string; primaryImage: StylePrimaryImageView | null }[],
): void {
  for (const line of lines) {
    if (!map.has(line.styleId) || (!map.get(line.styleId) && line.primaryImage)) {
      map.set(line.styleId, line.primaryImage);
    }
  }
}

/**
 * The only network-touching step for the Factory Packing List PDF (ISS-039) — resolves one
 * thumbnail per distinct Style referenced anywhere in the packing list (destination lines,
 * each destination's carton lines, and retired-carton lines), reusing whichever line already
 * carries that Style's primaryImage — same source/fallback order as PackingListPage.tsx's web
 * thumbnails. A Style with no uploaded image still gets an explicit `{ placeholder: true }`
 * entry, never an absent/guessed one, so FactoryPackingListDetailDocument's per-row thumbnail
 * always has a predictable value to render. buildFactoryPackingListViewModel (pure) and
 * FactoryPackingListDetailDocument (pure render) never fetch.
 */
export async function prepareFactoryPackingListPdfImages(
  packingList: PackingListView,
): Promise<Map<string, PdfImageSource>> {
  const primaryImageByStyle = new Map<string, StylePrimaryImageView | null>();
  for (const destination of packingList.destinations) {
    recordLines(primaryImageByStyle, destination.lines);
    for (const carton of destination.cartons) recordLines(primaryImageByStyle, carton.lines);
  }
  for (const carton of packingList.retiredCartons) recordLines(primaryImageByStyle, carton.lines);

  const refs: PdfImageRef[] = [];
  for (const [styleId, image] of primaryImageByStyle) {
    if (image) refs.push({ id: image.fileId, path: `/styles/${styleId}/images/${image.id}/content` });
  }
  const images = refs.length > 0 ? await resolveImagesForPdf(refs) : new Map<string, PdfImageSource>();

  const result = new Map<string, PdfImageSource>();
  for (const [styleId, image] of primaryImageByStyle) {
    result.set(styleId, image ? images.get(image.fileId) ?? { placeholder: true } : { placeholder: true });
  }
  return result;
}
