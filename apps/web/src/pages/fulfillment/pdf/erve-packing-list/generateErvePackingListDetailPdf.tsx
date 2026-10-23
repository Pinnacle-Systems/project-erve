import type { ErvePackingListDetail } from '../../types.js';
import type { ErvePackingListDetailPdfMeta } from './buildErvePackingListDetailViewModel.js';
import type { ErvePackingListDetailWorkerResponse } from './ervePackingListDetailWorkerTypes.js';
import { prepareErvePackingListDetailPdfImages } from './prepareErvePackingListDetailPdfImages.js';

/**
 * One isolated worker per action. Only the final immutable Blob crosses back to the UI. ISS-053:
 * the worker is started immediately (unchanged construction-failure/cleanup behavior), but
 * `postMessage` waits on the one authenticated step this module performs itself — resolving every
 * distinct Style's primary image to a data URI — since the worker has no fetch/auth context of
 * its own (mirrors prepareJobOrderDetailPdfData.ts's main-thread-only network access).
 */
export async function generateErvePackingListDetailPdfBlob(
  packingList: ErvePackingListDetail,
  meta: ErvePackingListDetailPdfMeta,
): Promise<Blob> {
  const worker = new Worker(new URL('./ervePackingListDetail.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const images = await prepareErvePackingListDetailPdfImages(packingList);
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ErvePackingListDetailWorkerResponse | null>) => {
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
          reject(new Error('Packing list PDF worker response is invalid.'));
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error('Packing list PDF worker failed to load or render.'));
      };
      worker.onmessageerror = () =>
        reject(new Error('Packing list PDF worker response could not be read.'));
      worker.postMessage({ packingList, meta, images });
    });
  } finally {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}
