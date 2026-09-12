import { buildFactoryListViewModel, type FactoryListPdfMeta } from './buildFactoryListViewModel.js';
import { FactoryListDocument } from './FactoryListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Factory } from '../types.js';

/**
 * The only static importer of `FactoryListDocument` (and therefore of `@react-pdf/renderer` for
 * the Factory list). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print, not as part of the app's
 * initial bundle.
 */
export async function generateFactoryListPdfBlob(
  factories: Factory[],
  meta: FactoryListPdfMeta,
): Promise<Blob> {
  const viewModel = buildFactoryListViewModel(factories, meta);
  return renderPdfBlob(<FactoryListDocument viewModel={viewModel} />);
}
