import {
  buildDistributorDetailViewModel,
  type DistributorDetailPdfMeta,
} from './buildDistributorDetailViewModel.js';
import { DistributorDetailDocument } from './DistributorDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { Distributor } from '../types.js';

/**
 * The only static importer of `DistributorDetailDocument` (and therefore of `@react-pdf/renderer`
 * for the Distributor detail PDF). Callers reach this module via a dynamic `import()` so the PDF
 * engine and document code load only when a user actually clicks Download/Print.
 */
export async function generateDistributorDetailPdfBlob(
  distributor: Distributor,
  meta: DistributorDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildDistributorDetailViewModel(distributor, meta);
  return renderPdfBlob(<DistributorDetailDocument viewModel={viewModel} />);
}
