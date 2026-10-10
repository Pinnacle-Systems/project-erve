import { resolveImagesForPdf } from '../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import { resolveJobOrderPrimaryStyle } from '../resolveJobOrderPrimaryStyle.js';
import type { JobOrder } from '../types.js';

export interface PreparedJobOrderDetailPdfData {
  jobOrder: JobOrder;
  primaryImage: PdfImageSource;
}

const DETAIL_IMAGE_MAX_DIMENSION = 480;

/**
 * The only step that touches the network for the Job Order Detail PDF.
 * Resolves the Job Order's primary Style through the same invariant check
 * the detail page header uses (resolveJobOrderPrimaryStyle) — legacy lines
 * that disagree on Style, or a Job Order with no lines at all, degrade to
 * the honest placeholder rather than guessing a line's image.
 */
export async function prepareJobOrderDetailPdfData(jobOrder: JobOrder): Promise<PreparedJobOrderDetailPdfData> {
  const resolved = resolveJobOrderPrimaryStyle(jobOrder.lines);
  if (!resolved.consistent || !resolved.style.primaryImage) {
    return { jobOrder, primaryImage: { placeholder: true } };
  }
  const { styleId, primaryImage: primary } = resolved.style;
  const images = await resolveImagesForPdf([{ id: primary.fileId, path: `/styles/${styleId}/images/${primary.id}/content` }], {
    maxDimension: DETAIL_IMAGE_MAX_DIMENSION,
  });
  return { jobOrder, primaryImage: images.get(primary.fileId) ?? { placeholder: true } };
}
