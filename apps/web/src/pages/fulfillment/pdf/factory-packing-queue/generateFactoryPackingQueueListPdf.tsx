import { prepareFactoryPackingQueueListPdfData } from './prepareFactoryPackingQueueListPdfData.js';
import {
  buildFactoryPackingQueueListViewModel,
  type FactoryPackingQueueListPdfMeta,
} from './buildFactoryPackingQueueListViewModel.js';
import { FactoryPackingQueueListDocument } from './FactoryPackingQueueListDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { FactoryPackingQueueLine } from '../../types.js';

/**
 * The only static importer of `FactoryPackingQueueListDocument` (and therefore of
 * `@react-pdf/renderer` for the Factory Packing Queue). Callers reach this module via a dynamic
 * `import()` so the PDF engine and document code load only when a user actually clicks
 * Download/Print.
 *
 * The "Awaiting Packing" half is passed in already-loaded (its own endpoint is unbounded); the
 * "Your Factory Dispatches" half is fetched here across every page so the PDF never inherits the
 * screen's own hardcoded `limit: 25`.
 */
export async function generateFactoryPackingQueueListPdfBlob(
  awaitingPacking: FactoryPackingQueueLine[],
  meta: FactoryPackingQueueListPdfMeta,
): Promise<Blob> {
  const factoryDispatches = await prepareFactoryPackingQueueListPdfData();
  const viewModel = buildFactoryPackingQueueListViewModel(awaitingPacking, factoryDispatches, meta);
  return renderPdfBlob(<FactoryPackingQueueListDocument viewModel={viewModel} />);
}
