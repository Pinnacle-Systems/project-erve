export type JobOrderStatus =
  | 'DRAFT'
  | 'SENT_TO_FACTORY'
  | 'CONFIRMED_BY_FACTORY'
  | 'IN_PRODUCTION'
  | 'PRODUCTION_COMPLETE'
  | 'READY_FOR_QA'
  | 'QA_IN_PROGRESS'
  | 'QA_PASSED'
  | 'PARTIALLY_QA_PASSED'
  | 'CLOSED'
  | 'CANCELLED';

export type FactoryConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type ProductionStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface JobOrderLineSize {
  id: string;
  purchaseOrderLineSizeId: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
  preparedQuantity: number;
  varianceQuantity: number;
}

export interface JobOrderLine {
  id: string;
  purchaseOrderLineId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  status: JobOrderStatus;
  sizes: JobOrderLineSize[];
}

export interface JobOrderStage {
  id: string;
  processFlowVersionStageId: string;
  stageSequence: number;
  stageNameSnapshot: string;
  status: ProductionStageStatus;
  completedBy: { id: string; name: string; email: string } | null;
  completedAt: string | null;
  remarks: string | null;
}

export interface JobOrder {
  id: string;
  jobOrderNumber: string;
  purchaseOrder: { id: string; poNumber: string; status: string };
  factory: { id: string; code: string; name: string };
  processFlowVersion: {
    id: string;
    versionNumber: number;
    status: string;
    processFlow: { id: string; code: string; name: string };
  };
  status: JobOrderStatus;
  factoryConfirmationStatus: FactoryConfirmationStatus;
  confirmedBy: { id: string; name: string; email: string } | null;
  confirmedAt: string | null;
  productionStartedAt: string | null;
  productionCompletedAt: string | null;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  creator: { id: string; name: string; email: string };
  lines: JobOrderLine[];
  stages: JobOrderStage[];
  createdAt: string;
  updatedAt: string;
}

export interface JobOrderBalance {
  poId: string;
  poNumber: string;
  lines: Array<{
    lineId: string;
    styleId: string;
    styleNumber: string;
    styleName: string;
    sizes: Array<{
      purchaseOrderLineSizeId: string;
      sizeId: string;
      sizeCode: string;
      sizeLabel: string;
      orderedQuantity: number;
      jobOrderedQuantity: number;
      balanceQuantity: number;
    }>;
  }>;
}
