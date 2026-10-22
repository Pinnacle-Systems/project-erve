import {
  prepareFactoryPackingQueueAwaitingData,
  prepareFactoryPackingQueueListPdfData,
} from './prepareFactoryPackingQueueListPdfData.js';
import {
  buildFactoryPackingQueueListViewModel,
  type FactoryPackingQueueListPdfMeta,
} from './buildFactoryPackingQueueListViewModel.js';
import type { FactoryPackingQueueWorkerResponse } from './factoryPackingQueueWorkerTypes.js';
import type { FactoryPackingQueueLine } from '../../types.js';

/**
 * Fetches the authorized export data on the UI thread, then renders the unchanged PDF
 * in one dedicated worker. API/authentication clients never cross into the worker.
 * Callers reach this module via the existing Download/Print dynamic import.
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
  const worker = new Worker(new URL('./factoryPackingQueueList.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FactoryPackingQueueWorkerResponse | null>) => {
        const response = event.data;
        if (
          response?.type === 'success' &&
          response.blob instanceof Blob &&
          response.blob.type === 'application/pdf' &&
          response.blob.size > 0
        ) {
          resolve(response.blob);
        } else if (response?.type === 'error' && typeof response.message === 'string') {
          reject(new Error(response.message));
        } else {
          reject(new Error('Packing Queue PDF worker response is invalid.'));
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error('Packing Queue PDF worker failed to load or render.'));
      };
      worker.onmessageerror = () =>
        reject(new Error('Packing Queue PDF worker response could not be read.'));
      worker.postMessage({ viewModel });
    });
  } finally {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}
