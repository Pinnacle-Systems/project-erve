import type { ErvePackingListDetail } from '../../types.js';
import type { ErvePackingListDetailPdfMeta } from './buildErvePackingListDetailViewModel.js';

export interface ErvePackingListDetailWorkerRequest {
  packingList: ErvePackingListDetail;
  meta: ErvePackingListDetailPdfMeta;
}

export type ErvePackingListDetailWorkerResponse =
  { type: 'success'; blob: Blob } | { type: 'error'; message: string };
