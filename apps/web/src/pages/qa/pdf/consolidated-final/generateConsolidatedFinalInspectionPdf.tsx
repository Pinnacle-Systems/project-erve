import type { QualityExecutionView } from '@erve/types';
import { collectConsolidatedFinalInspectionData } from './collectConsolidatedFinalInspectionData.js';
import { prepareConsolidatedFinalInspectionPdfData } from './prepareConsolidatedFinalInspectionPdfData.js';
import {
  buildConsolidatedFinalInspectionViewModel,
  type ConsolidatedFinalInspectionPdfMeta,
} from './buildConsolidatedFinalInspectionViewModel.js';
import { ConsolidatedFinalInspectionDocument } from './ConsolidatedFinalInspectionDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `ConsolidatedFinalInspectionDocument` (and therefore of
 * `@react-pdf/renderer` for this report) — callers reach this module via a dynamic `import()`, the
 * same pattern as `generateQualityExecutionPdf.tsx`, so collection, evidence resolution, and the
 * PDF engine all happen only once the user actually clicks Download/Print, never on page load.
 *
 * `cachedExecution` is the caller's already-rendered page state — used only as an identity check,
 * never as the source of batch/coverage data. `collectConsolidatedFinalInspectionData` immediately
 * re-fetches this execution fresh (another user may have changed Final Inspection batches since
 * the page loaded) before discovering batches or computing reconciliation totals.
 */
export async function generateConsolidatedFinalInspectionPdfBlob(
  cachedExecution: QualityExecutionView,
  meta: ConsolidatedFinalInspectionPdfMeta,
): Promise<Blob> {
  const snapshot = await collectConsolidatedFinalInspectionData(cachedExecution);
  const prepared = await prepareConsolidatedFinalInspectionPdfData(snapshot);
  const viewModel = buildConsolidatedFinalInspectionViewModel(prepared, meta);
  return renderPdfBlob(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />);
}
