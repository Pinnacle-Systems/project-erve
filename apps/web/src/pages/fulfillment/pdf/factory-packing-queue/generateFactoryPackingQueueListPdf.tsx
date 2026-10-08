import {
  prepareFactoryPackingQueueAwaitingData,
  prepareFactoryPackingQueueListPdfData,
} from './prepareFactoryPackingQueueListPdfData.js';
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
 * Both the "Awaiting Packing" queue and "Your Factory Dispatches" sections are fetched across
 * every page (traversing all pages with fetchAllPaginatedRecords) so the PDF export is never
 * truncated to only the initial page loaded on screen.
 *
 * UXAUTH-005: `meta.factoryId` (the same Factory context selected on screen —
 * undefined for a FACTORY_USER) is threaded into both data fetches so a broad reader's
 * export always matches the Factory currently on screen.
 */
export async function generateFactoryPackingQueueListPdfBlob(
  metaOrAwaiting: FactoryPackingQueueLine[] | FactoryPackingQueueListPdfMeta,
  maybeMeta?: FactoryPackingQueueListPdfMeta,
): Promise<Blob> {
  const isLinesArray = Array.isArray(metaOrAwaiting);
  const meta = isLinesArray ? maybeMeta! : metaOrAwaiting;
  const [awaitingPacking, factoryDispatches] = await Promise.all([
    isLinesArray
      ? Promise.resolve(metaOrAwaiting)
      : prepareFactoryPackingQueueAwaitingData(meta.factoryId),
    prepareFactoryPackingQueueListPdfData(meta.factoryId),
  ]);
  const viewModel = buildFactoryPackingQueueListViewModel(awaitingPacking, factoryDispatches, meta);
  return renderPdfBlob(<FactoryPackingQueueListDocument viewModel={viewModel} />);
}
