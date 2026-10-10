import {
  buildJobOrderDetailViewModel,
  type JobOrderDetailPdfMeta,
} from './buildJobOrderDetailViewModel.js';
import { prepareJobOrderDetailPdfData } from './prepareJobOrderDetailPdfData.js';
import { JobOrderDetailDocument } from './JobOrderDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { JobOrder } from '../types.js';

/**
 * The only static importer of `JobOrderDetailDocument` (and therefore of `@react-pdf/renderer` for
 * the Job Order detail). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle. The detail page already loads the full record — the only network step left is
 * resolving the invariant-checked primary Style's image (prepareJobOrderDetailPdfData).
 */
export async function generateJobOrderDetailPdfBlob(
  jobOrder: JobOrder,
  meta: JobOrderDetailPdfMeta,
): Promise<Blob> {
  const prepared = await prepareJobOrderDetailPdfData(jobOrder);
  const viewModel = buildJobOrderDetailViewModel(prepared.jobOrder, meta, prepared.primaryImage);
  return renderPdfBlob(<JobOrderDetailDocument viewModel={viewModel} />);
}
