import type { QualityExecutionView } from '@erve/types';
import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';

export interface PreparedQualityExecutionPdfData {
  execution: QualityExecutionView;
  evidenceImages: Map<string, PdfImageSource>;
}

const EVIDENCE_IMAGE_MAX_DIMENSION = 400;

/**
 * The only step that touches the network for the PPM/Inline/Final QA execution PDF. Resolves every
 * image-type attachment via the same authenticated, bounded-concurrency, placeholder-on-failure
 * pipeline used by prior PDF phases. Attachments are served from
 * `/quality-executions/attachments/:attachmentId/content` — the same authorization the live screen
 * already uses (no new endpoint, no broadened access).
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
  return { execution, evidenceImages };
}
