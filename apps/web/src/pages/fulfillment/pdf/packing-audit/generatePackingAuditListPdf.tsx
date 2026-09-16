import { preparePackingAuditListPdfData } from './preparePackingAuditListPdfData.js';
import { buildPackingAuditListViewModel, type PackingAuditListPdfMeta } from './buildPackingAuditListViewModel.js';
import { PackingAuditListDocument } from './PackingAuditListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `PackingAuditListDocument` (and therefore of `@react-pdf/renderer`
 * for the Packing Audit queue). Callers reach this module via a dynamic `import()` so the PDF
 * engine and document code load only when a user actually clicks Download/Print.
 *
 * Fetches every page of /packing-audit/queue (the screen itself only ever requests a flat
 * limit:100 with no cursor) before building the document, so the PDF always contains every open
 * carton matching the queue's own semantics.
 */
export async function generatePackingAuditListPdfBlob(meta: PackingAuditListPdfMeta): Promise<Blob> {
  const items = await preparePackingAuditListPdfData();
  const viewModel = buildPackingAuditListViewModel(items, meta);
  return renderPdfBlob(<PackingAuditListDocument viewModel={viewModel} />);
}
