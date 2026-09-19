export type {
  FactoryConfirmationStatus,
  JobOrderDetail as JobOrder,
  JobOrderLine,
  JobOrderLineSize,
  JobOrderStage,
  JobOrderStatus,
  ProductionStageStatus,
} from '@erve/types';

// UXAUTH-014: the minimal shape returned by GET /job-orders/factory-options
// — deliberately not the full master-data Factory type, since this filter
// only ever renders `.name` (and `.status` for the "(inactive)" label).
export interface JobOrderFactoryOption {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}
