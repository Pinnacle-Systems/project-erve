import { prepareQualityExecutionPdfData } from './prepareQualityExecutionPdfData.js';
import {
  buildQualityExecutionViewModel,
  type QualityExecutionPdfMeta,
} from './buildQualityExecutionViewModel.js';
import { QualityExecutionDocument } from './QualityExecutionDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { QualityExecutionView } from '@erve/types';

/**
 * The only static importer of `QualityExecutionDocument` (and therefore of `@react-pdf/renderer`
 * for the PPM/Inline/Final QA execution PDF). Callers reach this module via a dynamic `import()`
 * so the PDF engine and document code load only when a user actually clicks Download/Print.
 */
export async function generateQualityExecutionPdfBlob(
  execution: QualityExecutionView,
  meta: QualityExecutionPdfMeta,
): Promise<Blob> {
  const prepared = await prepareQualityExecutionPdfData(execution);
  const viewModel = buildQualityExecutionViewModel(prepared, meta);
  return renderPdfBlob(<QualityExecutionDocument viewModel={viewModel} />);
}
