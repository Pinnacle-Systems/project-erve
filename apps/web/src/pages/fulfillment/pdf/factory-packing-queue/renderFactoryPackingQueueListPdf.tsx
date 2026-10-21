import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import { FactoryPackingQueueListDocument } from './FactoryPackingQueueListDocument.js';
import type { FactoryPackingQueueListPdfViewModel } from './buildFactoryPackingQueueListViewModel.js';

/** Pure render boundary: the original document, columns, pagination and footer are unchanged. */
export function renderFactoryPackingQueueListPdfBlob(
  viewModel: FactoryPackingQueueListPdfViewModel,
): Promise<Blob> {
  return renderPdfBlob(<FactoryPackingQueueListDocument viewModel={viewModel} />);
}
