import { buildFactoryPackingListViewModel, type FactoryPackingListPdfMeta } from './buildFactoryPackingListViewModel.js';
import { FactoryPackingListDetailDocument } from './FactoryPackingListDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { PackingListView } from '../../types.js';

/**
 * The only static importer of `FactoryPackingListDetailDocument` (and therefore of
 * `@react-pdf/renderer` for the Factory Packing List). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print. The packing list page already loads the full record, so no extra fetching is
 * needed here. This replaces the legacy window.print() path on PackingListPage.tsx.
 */
export async function generateFactoryPackingListPdfBlob(
  packingList: PackingListView,
  meta: FactoryPackingListPdfMeta,
): Promise<Blob> {
  const viewModel = buildFactoryPackingListViewModel(packingList, meta);
  return renderPdfBlob(<FactoryPackingListDetailDocument viewModel={viewModel} />);
}
