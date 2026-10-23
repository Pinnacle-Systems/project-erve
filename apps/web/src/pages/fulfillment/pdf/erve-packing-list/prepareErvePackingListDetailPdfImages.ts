import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { ErvePackingListDetail } from '../../types.js';

const THUMBNAIL_MAX_DIMENSION = 160;

interface StyleImageBearingLine {
  styleId: string;
  primaryImage: { id: string; fileId: string } | null;
}

/** Each distinct Style contributes at most one fetch, however many cartons/lines repeat it. */
function collectPrimaryImageRefs(packingList: ErvePackingListDetail): Map<string, PdfImageRef> {
  const refsByStyleId = new Map<string, PdfImageRef>();
  const consider = (line: StyleImageBearingLine) => {
    if (refsByStyleId.has(line.styleId) || !line.primaryImage) return;
    refsByStyleId.set(line.styleId, {
      id: line.primaryImage.fileId,
      path: `/styles/${line.styleId}/images/${line.primaryImage.id}/content`,
    });
  };
  for (const carton of packingList.cartons) {
    for (const line of carton.lines) consider(line);
  }
  for (const row of packingList.styleSizeSummary) consider(row);
  return refsByStyleId;
}

/**
 * The only step that touches the network for the EIPL Detail PDF's Style imagery (ISS-053):
 * resolves each distinct Style's primary image exactly once via the shared resolveImagesForPdf
 * (bounded concurrency, timeouts, placeholders — one broken image never fails the export). Must
 * run on the main thread, before postMessage — ervePackingListDetail.worker.ts has no
 * authenticated fetch context, mirroring prepareJobOrderDetailPdfData.ts. The returned Map is
 * keyed by Style UUID (never styleNumber), matching the real identity now carried on
 * ErvePackingListCartonView.lines[]/ErvePackingListStyleSizeSummaryRow.
 */
export async function prepareErvePackingListDetailPdfImages(
  packingList: ErvePackingListDetail,
): Promise<Map<string, PdfImageSource>> {
  const refsByStyleId = collectPrimaryImageRefs(packingList);
  if (refsByStyleId.size === 0) return new Map();
  const resolved = await resolveImagesForPdf([...refsByStyleId.values()], { maxDimension: THUMBNAIL_MAX_DIMENSION });
  const images = new Map<string, PdfImageSource>();
  for (const [styleId, ref] of refsByStyleId) {
    images.set(styleId, resolved.get(ref.id) ?? { placeholder: true });
  }
  return images;
}
