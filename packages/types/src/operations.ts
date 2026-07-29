export const STABLE_API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STALE_VERSION',
  'IDEMPOTENCY_KEY_REUSED',
  'FACTORY_MAPPING_REQUIRED',
  'FACTORY_MAPPING_AMBIGUOUS',
  'TEMPORARILY_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
] as const;
export type StableApiErrorCode = (typeof STABLE_API_ERROR_CODES)[number];

export interface PaginationMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pageInfo: PaginationMeta;
}

export interface VersionedResource {
  version: number;
  updatedAt: string;
}

export type PurchaseMode = 'OUTRIGHT' | 'SALE_RETURN';
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PARTIALLY_JOB_ORDERED'
  | 'FULLY_JOB_ORDERED'
  | 'PARTIALLY_FULFILLED'
  | 'FULLY_FULFILLED'
  | 'CLOSED'
  | 'CANCELLED';
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

export interface PurchaseOrderSummary extends VersionedResource {
  id: string;
  poNumber: string;
  distributor: { id: string; code: string; name: string };
  poDate: string;
  requiredDeliveryDate: string | null;
  purchaseMode: PurchaseMode;
  status: PurchaseOrderStatus;
  totalOrderedQuantity: number;
  createdAt: string;
}

export interface PurchaseOrderLineSize {
  id: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
  jobOrderedQuantity: number;
  qaPassedQuantity: number;
  saleOrderedQuantity: number;
  dispatchedQuantity: number;
  deliveredQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  reassignedQuantity: number;
}
export interface PurchaseOrderLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  lineStatus: 'ACTIVE' | 'CANCELLED';
  remarks: string | null;
  sizes: PurchaseOrderLineSize[];
  totalOrderedQuantity: number;
}
export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  merchandiser: { id: string; name: string; email: string } | null;
  creator: { id: string; name: string; email: string };
  remarks: string | null;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderBalance {
  poId: string;
  poNumber: string;
  version: number;
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
  createdAt: string;
  updatedAt: string;
}
export interface JobOrderSummary extends VersionedResource {
  id: string;
  jobOrderNumber: string;
  purchaseOrder: { id: string; poNumber: string; status: PurchaseOrderStatus };
  factory: { id: string; code: string; name: string };
  status: JobOrderStatus;
  factoryConfirmationStatus: FactoryConfirmationStatus;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  createdAt: string;
}
export interface JobOrderDetail extends JobOrderSummary {
  processFlowVersion: {
    id: string;
    versionNumber: number;
    status: string;
    processFlow: { id: string; code: string; name: string };
  };
  confirmedBy: { id: string; name: string; email: string } | null;
  confirmedAt: string | null;
  productionStartedAt: string | null;
  productionCompletedAt: string | null;
  creator: { id: string; name: string; email: string };
  lines: JobOrderLine[];
  stages: JobOrderStage[];
}

export interface JobOrderAuditEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  metadata: unknown;
}

export interface AssignedFactoryTaskSummary extends VersionedResource {
  id: string;
  jobOrderNumber: string;
  purchaseOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  factory: { id: string; code: string; name: string };
  status: JobOrderStatus;
  currentStage: { id: string; sequence: number; name: string } | null;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  requiredDeliveryDate: string | null;
  actionRequired: boolean;
}

export interface CreateJobOrderInput {
  purchaseOrderId: string;
  factoryId: string;
  processFlowVersionId: string;
  lines: Array<{
    purchaseOrderLineId: string;
    sizes: Array<{ purchaseOrderLineSizeId: string; quantity: number }>;
  }>;
}
export interface VersionedMutationInput {
  expectedVersion: number;
}
export interface CompleteJobOrderStageInput extends VersionedMutationInput {
  stageStatusId: string;
  remarks?: string | null;
}
export interface UpdatePreparedQuantityInput extends VersionedMutationInput {
  sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>;
}
