import { renderErvePackingListDetailPdfBlob } from './renderErvePackingListDetailPdf.js';
import type {
  ErvePackingListDetailWorkerRequest,
  ErvePackingListDetailWorkerResponse,
} from './ervePackingListDetailWorkerTypes.js';

// Each action owns a fresh worker; no HTTP, authentication, or business-data mutation here.
self.addEventListener(
  'message',
  async (event: MessageEvent<ErvePackingListDetailWorkerRequest>) => {
    try {
      const blob = await renderErvePackingListDetailPdfBlob(
        event.data.packingList,
        event.data.meta,
        event.data.images,
      );
      self.postMessage({ type: 'success', blob } satisfies ErvePackingListDetailWorkerResponse);
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Packing list PDF generation failed.',
      } satisfies ErvePackingListDetailWorkerResponse);
    }
  },
  { once: true },
);
