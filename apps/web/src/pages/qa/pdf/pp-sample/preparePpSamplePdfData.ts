import type { QaInspectionDetail } from '@erve/types';
import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';

export interface PreparedPpSamplePdfData {
  detail: QaInspectionDetail;
  evidenceImages: Map<string, PdfImageSource>;
}

const EVIDENCE_IMAGE_MAX_DIMENSION = 400;

/**
 * The only step that touches the network for the PP Sample PDF (`/qa/:id`). PP Sample evidence
 * lives in the legacy `QaEvidence` pipeline, served from `/qa/evidence/:id/content` — a separate
 * authorization path from the PPM/Inline/Final `QualityAttachment` pipeline (it additionally allows
 * factory-scoped `FACTORY_USER` access), reused unmodified here via the same authenticated,
 * bounded-concurrency, placeholder-on-failure resolver as every other PDF phase.
 */
export async function preparePpSamplePdfData(detail: QaInspectionDetail): Promise<PreparedPpSamplePdfData> {
  const evidenceMetadata = [
    ...detail.sessions.flatMap((session) => session.evidence),
    ...detail.reworkTasks.flatMap((task) => task.qaEvidence),
  ];
  const refs: PdfImageRef[] = evidenceMetadata
    .filter((evidence) => IMAGE_CONTENT_TYPES.has(evidence.contentType))
    .map((evidence) => ({ id: evidence.id, path: `/qa/evidence/${evidence.id}/content` }));

  const evidenceImages = await resolveImagesForPdf(refs, { maxDimension: EVIDENCE_IMAGE_MAX_DIMENSION });
  return { detail, evidenceImages };
}
