import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { ErvePackingListDetail } from '../../types.js';
import type { ErvePackingListDetailPdfMeta } from './buildErvePackingListDetailViewModel.js';

export interface ErvePackingListDetailWorkerRequest {
  packingList: ErvePackingListDetail;
  meta: ErvePackingListDetailPdfMeta;
  /** ISS-053: Style primary images, already resolved to data URIs on the main thread (see prepareErvePackingListDetailPdfImages) — this worker has no authenticated fetch context. */
  images: Map<string, PdfImageSource>;
}

export type ErvePackingListDetailWorkerResponse =
  { type: 'success'; blob: Blob } | { type: 'error'; message: string };
