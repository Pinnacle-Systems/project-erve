import { buildCartonLabelViewModel, type CartonLabelPdfMeta, type CartonLabelSource } from './buildCartonLabelViewModel.js';
import { CartonLabelDocument } from './CartonLabelDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';

/**
 * The only static importer of `CartonLabelDocument` (and therefore of `@react-pdf/renderer` for
 * carton labels). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Print/Download, not as part of the app's
 * initial bundle.
 *
 * Enforces the business rule that a carton label can only ever be generated from confirmed/audited
 * carton data — this is the single choke point every caller goes through, so the UI's own disabled
 * state on the Print/Download buttons is reinforced here rather than being the only guard.
 */
export async function generateCartonLabelPdfBlob(source: CartonLabelSource, meta: CartonLabelPdfMeta): Promise<Blob> {
  if (source.carton.auditState !== 'INSPECTED') {
    throw new Error('Carton label can only be generated for a currently Inspected carton.');
  }
  const viewModel = buildCartonLabelViewModel(source, meta);
  return renderPdfBlob(<CartonLabelDocument viewModel={viewModel} />);
}
