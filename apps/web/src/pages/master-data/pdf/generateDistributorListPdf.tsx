import {
  buildDistributorListViewModel,
  type DistributorListPdfFilters,
  type DistributorListPdfMeta,
} from './buildDistributorListViewModel.js';
import { DistributorListDocument } from './DistributorListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { DistributorSummary } from '../types.js';

/**
 * The only static importer of `DistributorListDocument` (and therefore of `@react-pdf/renderer`
 * for the Distributor list). Callers reach this module via a dynamic `import()` so the PDF engine
 * and document code load only when a user actually clicks Download/Print, not as part of the
 * app's initial bundle.
 */
export async function generateDistributorListPdfBlob(
  distributors: DistributorSummary[],
  filters: DistributorListPdfFilters,
  meta: DistributorListPdfMeta,
): Promise<Blob> {
  const viewModel = buildDistributorListViewModel(distributors, filters, meta);
  return renderPdfBlob(<DistributorListDocument viewModel={viewModel} />);
}
