import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { PackingAuditCartonDetailSource } from './buildPackingAuditCartonDetailViewModel.js';

/** Resolve authenticated Style images before rendering; a missing/broken image stays a placeholder. */
export async function preparePackingAuditCartonDetailPdfImages(
  carton: PackingAuditCartonDetailSource,
): Promise<Map<string, PdfImageSource>> {
  const refs = new Map<string, PdfImageRef>();
  for (const line of carton.lines) {
    if (!line.primaryImage || refs.has(line.styleId)) continue;
    refs.set(line.styleId, {
      id: line.primaryImage.fileId,
      path: `/styles/${line.styleId}/images/${line.primaryImage.id}/content`,
    });
  }
  if (!refs.size) return new Map();
  const resolved = await resolveImagesForPdf([...refs.values()], { maxDimension: 160 });
  return new Map(
    [...refs].map(([styleId, ref]) => [styleId, resolved.get(ref.id) ?? { placeholder: true }]),
  );
}
