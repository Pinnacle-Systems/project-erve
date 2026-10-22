import type { FactoryPackingQueueListPdfViewModel } from './buildFactoryPackingQueueListViewModel.js';

export interface FactoryPackingQueueWorkerRequest {
  viewModel: FactoryPackingQueueListPdfViewModel;
}

export type FactoryPackingQueueWorkerResponse =
  { type: 'success'; blob: Blob } | { type: 'error'; message: string };
