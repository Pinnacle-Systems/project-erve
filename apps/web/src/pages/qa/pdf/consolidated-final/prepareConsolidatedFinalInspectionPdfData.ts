import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';
import type { ConsolidatedFinalInspectionSnapshot } from './collectConsolidatedFinalInspectionData.js';

export interface PreparedConsolidatedFinalInspectionPdfData {
  snapshot: ConsolidatedFinalInspectionSnapshot;
  /** Keyed by attachment id — globally unique, so one shared Map safely serves every attempt's own
   * evidence without any risk of cross-attempt mixing (each attempt's view model only ever looks up
   * the ids in its own `attachments` list). */
  evidenceImages: Map<string, PdfImageSource>;
  /** The server-resolved primaryStyle's image — the explicit `{ inconsistent: true }` marker (never
   * a guess) when the seed execution's `primaryStyle.consistent` is false. */
  primaryImage: PdfImageSource;
}

const EVIDENCE_IMAGE_MAX_DIMENSION = 400;
const HEADER_IMAGE_MAX_DIMENSION = 480;
const EVIDENCE_FETCH_CONCURRENCY = 4;

/**
 * The only step that touches the network for evidence images in the consolidated Final Inspection
 * PDF — called only after `collectConsolidatedFinalInspectionData` has already resolved every
 * batch/attempt, so nothing here fetches eagerly on page load, only when the user actually
 * requests the export. Flattens every attempt's image-type attachments across every batch into one
 * bounded-concurrency, placeholder-on-failure resolution pass, reusing the exact same authenticated
 * pipeline (`/quality-executions/attachments/:attachmentId/content`) the single-execution PDF uses
 * — no new endpoint, no broadened access.
 */
export async function prepareConsolidatedFinalInspectionPdfData(
  snapshot: ConsolidatedFinalInspectionSnapshot,
): Promise<PreparedConsolidatedFinalInspectionPdfData> {
  const refs: PdfImageRef[] = snapshot.batches
    .flatMap((batchSnapshot) => batchSnapshot.attempts)
    .flatMap((execution) => execution.attachments)
    .filter((attachment) => IMAGE_CONTENT_TYPES.has(attachment.contentType))
    .map((attachment) => ({
      id: attachment.id,
      path: `/quality-executions/attachments/${attachment.id}/content`,
    }));

  const evidenceImages = await resolveImagesForPdf(refs, {
    maxDimension: EVIDENCE_IMAGE_MAX_DIMENSION,
    concurrency: EVIDENCE_FETCH_CONCURRENCY,
  });

  if (!snapshot.seedExecution.primaryStyle.consistent) {
    return { snapshot, evidenceImages, primaryImage: { inconsistent: true } };
  }
  const primary = snapshot.seedExecution.primaryStyle.style.primaryImage;
  if (!primary) {
    return { snapshot, evidenceImages, primaryImage: { placeholder: true } };
  }
  const headerImages = await resolveImagesForPdf(
    [
      {
        id: primary.fileId,
        path: `/styles/${snapshot.seedExecution.primaryStyle.style.id}/images/${primary.id}/content`,
      },
    ],
    { maxDimension: HEADER_IMAGE_MAX_DIMENSION },
  );
  return {
    snapshot,
    evidenceImages,
    primaryImage: headerImages.get(primary.fileId) ?? { placeholder: true },
  };
}
