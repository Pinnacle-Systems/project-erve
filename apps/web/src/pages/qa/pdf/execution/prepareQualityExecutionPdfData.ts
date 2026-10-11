import type { QualityExecutionView } from '@erve/types';
import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';

export interface PreparedQualityExecutionPdfData {
  execution: QualityExecutionView;
  evidenceImages: Map<string, PdfImageSource>;
  /** The server-resolved primaryStyle's image — the explicit `{ inconsistent: true }` marker (never a guess, never a plain placeholder) when execution.primaryStyle.consistent is false. */
  primaryImage: PdfImageSource;
}

const EVIDENCE_IMAGE_MAX_DIMENSION = 400;
const HEADER_IMAGE_MAX_DIMENSION = 480;

/**
 * The only step that touches the network for the PPM/Inline/Final QA execution PDF. Resolves every
 * image-type attachment via the same authenticated, bounded-concurrency, placeholder-on-failure
 * pipeline used by prior PDF phases. Attachments are served from
 * `/quality-executions/attachments/:attachmentId/content` — the same authorization the live screen
 * already uses (no new endpoint, no broadened access). Also resolves the header identity image from
 * `execution.primaryStyle`, which the API already computed through the single-Style invariant
 * (resolvePrimaryStyleAcrossLines) — this step only fetches the image bytes, never re-derives identity.
 */
export async function prepareQualityExecutionPdfData(
  execution: QualityExecutionView,
): Promise<PreparedQualityExecutionPdfData> {
  const refs: PdfImageRef[] = execution.attachments
    .filter((attachment) => IMAGE_CONTENT_TYPES.has(attachment.contentType))
    .map((attachment) => ({
      id: attachment.id,
      path: `/quality-executions/attachments/${attachment.id}/content`,
    }));

  const evidenceImages = await resolveImagesForPdf(refs, { maxDimension: EVIDENCE_IMAGE_MAX_DIMENSION });

  if (!execution.primaryStyle.consistent) {
    return { execution, evidenceImages, primaryImage: { inconsistent: true } };
  }
  const primary = execution.primaryStyle.style.primaryImage;
  if (!primary) {
    return { execution, evidenceImages, primaryImage: { placeholder: true } };
  }
  const headerImages = await resolveImagesForPdf(
    [{ id: primary.fileId, path: `/styles/${execution.primaryStyle.style.id}/images/${primary.id}/content` }],
    { maxDimension: HEADER_IMAGE_MAX_DIMENSION },
  );
  return {
    execution,
    evidenceImages,
    primaryImage: headerImages.get(primary.fileId) ?? { placeholder: true },
  };
}
