import {
  buildPackingAuditCartonDetailViewModel,
  type PackingAuditCartonDetailPdfMeta,
  type PackingAuditCartonDetailSource,
} from './buildPackingAuditCartonDetailViewModel.js';
import { PackingAuditCartonDetailDocument } from './PackingAuditCartonDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `PackingAuditCartonDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Packing Audit carton detail). Callers reach this module via a
 * dynamic `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The carton detail page already loads the full server-persisted record, so no
 * extra fetching is needed here.
 */
export async function generatePackingAuditCartonDetailPdfBlob(
  carton: PackingAuditCartonDetailSource,
  meta: PackingAuditCartonDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildPackingAuditCartonDetailViewModel(carton, meta);
  return renderPdfBlob(<PackingAuditCartonDetailDocument viewModel={viewModel} />);
}
