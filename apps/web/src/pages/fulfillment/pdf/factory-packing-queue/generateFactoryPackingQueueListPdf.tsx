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
 *
 * UXAUTH-005: `meta.factoryId` (the same Factory context selected on screen —
 * undefined for a FACTORY_USER) is threaded into the "Your Factory
 * Dispatches" re-fetch so a broad reader's export always matches the
 * Factory currently on screen, never every Factory or a previously selected
 * one.
 */
export async function generateFactoryPackingQueueListPdfBlob(
  awaitingPacking: FactoryPackingQueueLine[],
  meta: FactoryPackingQueueListPdfMeta,
): Promise<Blob> {
  const factoryDispatches = await prepareFactoryPackingQueueListPdfData(meta.factoryId);
  const viewModel = buildFactoryPackingQueueListViewModel(awaitingPacking, factoryDispatches, meta);
  return renderPdfBlob(<FactoryPackingQueueListDocument viewModel={viewModel} />);
}
