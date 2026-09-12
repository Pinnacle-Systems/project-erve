import { buildFactoryDetailViewModel, type FactoryDetailPdfMeta } from './buildFactoryDetailViewModel.js';
import { FactoryDetailDocument } from './FactoryDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Factory } from '../types.js';

/**
 * The only static importer of `FactoryDetailDocument` (and therefore of `@react-pdf/renderer` for
 * the Factory detail PDF). Callers reach this module via a dynamic `import()` so the PDF engine
 * and document code load only when a user actually clicks Download/Print.
 */
export async function generateFactoryDetailPdfBlob(
  factory: Factory,
  meta: FactoryDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildFactoryDetailViewModel(factory, meta);
  return renderPdfBlob(<FactoryDetailDocument viewModel={viewModel} />);
}
