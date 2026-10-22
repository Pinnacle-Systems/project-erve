import { renderFactoryPackingQueueListPdfBlob } from './renderFactoryPackingQueueListPdf.js';
import type {
  FactoryPackingQueueWorkerRequest,
  FactoryPackingQueueWorkerResponse,
} from './factoryPackingQueueWorkerTypes.js';

// One render per action; all fetching and authorization stay in the existing UI-side pipeline.
self.addEventListener(
  'message',
  async (event: MessageEvent<FactoryPackingQueueWorkerRequest>) => {
    try {
      const blob = await renderFactoryPackingQueueListPdfBlob(event.data.viewModel);
      self.postMessage({ type: 'success', blob } satisfies FactoryPackingQueueWorkerResponse);
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Packing Queue PDF generation failed.',
      } satisfies FactoryPackingQueueWorkerResponse);
    }
  },
  { once: true },
);
