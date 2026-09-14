import type { QaInspectionDetail } from '@erve/types';
import { preparePpSamplePdfData } from './preparePpSamplePdfData.js';
import { buildPpSampleViewModel, type PpSamplePdfMeta } from './buildPpSampleViewModel.js';
import { PpSampleDocument } from './PpSampleDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `PpSampleDocument` (and therefore of `@react-pdf/renderer` for the
 * PP Sample PDF). Callers reach this module via a dynamic `import()` so the PDF engine and document
 * code load only when a user actually clicks Download/Print.
 */
export async function generatePpSamplePdfBlob(
  detail: QaInspectionDetail,
  meta: PpSamplePdfMeta,
): Promise<Blob> {
  const prepared = await preparePpSamplePdfData(detail);
  const viewModel = buildPpSampleViewModel(prepared, meta);
  return renderPdfBlob(<PpSampleDocument viewModel={viewModel} />);
}
