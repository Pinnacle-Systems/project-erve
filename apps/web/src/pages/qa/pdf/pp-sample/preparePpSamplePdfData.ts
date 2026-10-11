import type { QaInspectionDetail } from '@erve/types';
import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';
import { resolveJobOrderPrimaryStyle } from '../../../job-orders/resolveJobOrderPrimaryStyle.js';

export interface PreparedPpSamplePdfData {
  detail: QaInspectionDetail;
  evidenceImages: Map<string, PdfImageSource>;
  /** The explicit `{ inconsistent: true }` marker (never a guess, never a plain placeholder) when the Job Order's lines disagree on Style. */
  primaryImage: PdfImageSource;
}

const EVIDENCE_IMAGE_MAX_DIMENSION = 400;
const HEADER_IMAGE_MAX_DIMENSION = 480;

/**
 * The only step that touches the network for the PP Sample PDF (`/qa/:id`). PP Sample evidence
 * lives in the legacy `QaEvidence` pipeline, served from `/qa/evidence/:id/content` — a separate
 * authorization path from the PPM/Inline/Final `QualityAttachment` pipeline (it additionally allows
 * factory-scoped `FACTORY_USER` access), reused unmodified here via the same authenticated,
 * bounded-concurrency, placeholder-on-failure resolver as every other PDF phase.
 *
 * The header identity image reuses the exact same invariant check as the Job Order detail
 * header/PDF (resolveJobOrderPrimaryStyle) — `detail.lines[]` carries the same
 * styleId/styleNumber/styleName/primaryImage shape as JobOrderLine, duck-typed compatible with no
 * extra mapping. A Job Order (and therefore its QA record) is exactly one Style by business rule;
 * disagreeing lines are a data problem, never a legitimate multi-Style case.
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

  const resolved = resolveJobOrderPrimaryStyle(detail.lines);
  if (!resolved.consistent) {
    return { detail, evidenceImages, primaryImage: { inconsistent: true } };
  }
  const primary = resolved.style.primaryImage;
  if (!primary) {
    return { detail, evidenceImages, primaryImage: { placeholder: true } };
  }
  const headerImages = await resolveImagesForPdf(
    [{ id: primary.fileId, path: `/styles/${resolved.style.styleId}/images/${primary.id}/content` }],
    { maxDimension: HEADER_IMAGE_MAX_DIMENSION },
  );
  return { detail, evidenceImages, primaryImage: headerImages.get(primary.fileId) ?? { placeholder: true } };
}
