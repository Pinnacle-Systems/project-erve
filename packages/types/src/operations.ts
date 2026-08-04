import type { Role } from './roles.js';

export const STABLE_API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STALE_VERSION',
  'STALE_DISCLAIMER_REVISION',
  'DISCLAIMER_REQUIRED',
  'ACKNOWLEDGEMENT_REQUIRED',
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
  | 'REWORK_REQUIRED'
  | 'READY_FOR_REINSPECTION'
  | 'QA_APPROVED'
  | 'QA_PASSED'
  | 'PARTIALLY_QA_PASSED'
  | 'CLOSED'
  | 'CANCELLED';
export type FactoryConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type ProductionStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface JobOrderAcknowledgement {
  id: string;
  jobOrderVersion: number;
  disclaimerRevision: number;
  disclaimerTextSnapshot: string;
  disclaimerSha256: string;
  factoryIdSnapshot: string;
  acknowledgedBy: { id: string; name: string; email: string };
  acknowledgedByRole: Role;
  acknowledgedAt: string;
  invalidatedAt: string | null;
  invalidatedByUserId: string | null;
  invalidationReason: string | null;
  invalidationMetadata: unknown;
}

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
  styleFactoryPrices?: Record<string, number | null>;
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
  unitPrice: number;
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
  disclaimerText: string | null;
  disclaimerRevision: number;
  acknowledgement: JobOrderAcknowledgement | null;
  acknowledgements: JobOrderAcknowledgement[];
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
  unitPrice: string;
  disclaimerText?: string;
  lines: Array<{
    purchaseOrderLineId: string;
    sizes: Array<{ purchaseOrderLineSizeId: string; quantity: number }>;
  }>;
}
export interface VersionedMutationInput {
  expectedVersion: number;
}
export interface UpdateJobOrderDisclaimerInput extends VersionedMutationInput {
  disclaimerText?: string;
}
export interface ConfirmJobOrderInput extends VersionedMutationInput {
  expectedDisclaimerRevision: number;
  acknowledgeDisclaimer: true;
}
export interface CompleteJobOrderStageInput extends VersionedMutationInput {
  stageStatusId: string;
  remarks?: string | null;
}
export interface UpdatePreparedQuantityInput extends VersionedMutationInput {
  sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>;
}

export type QaQueueFilter =
  | 'AWAITING_FIRST_INSPECTION'
  | 'IN_PROGRESS'
  | 'REWORK_REQUIRED'
  | 'READY_FOR_REINSPECTION'
  | 'COMPLETED';

/** QA workflow states shared by the API and clients. */
export const QA_QUEUE_STATUSES: JobOrderStatus[] = [
  'READY_FOR_QA',
  'QA_IN_PROGRESS',
  'REWORK_REQUIRED',
  'READY_FOR_REINSPECTION',
  'QA_APPROVED',
];
export const QA_INSPECTION_START_STATUSES: JobOrderStatus[] = [
  'READY_FOR_QA',
  'QA_IN_PROGRESS',
  'READY_FOR_REINSPECTION',
];
export function canStartQaInspection(status: JobOrderStatus): boolean {
  return QA_INSPECTION_START_STATUSES.includes(status);
}
export function qaInspectionAction(status: JobOrderStatus): 'INITIAL' | 'REINSPECTION' | null {
  if (status === 'READY_FOR_REINSPECTION') return 'REINSPECTION';
  if (status === 'READY_FOR_QA' || status === 'QA_IN_PROGRESS') return 'INITIAL';
  return null;
}
export type QaInspectionStatus = 'DRAFT' | 'FINALIZED' | 'REOPENED' | 'VOIDED';
export type QaDefectCategory =
  'STITCHING' | 'FABRIC' | 'PRINT_EMBROIDERY' | 'MEASUREMENT' | 'FINISHING' | 'PACKAGING' | 'OTHER';
export type QaReworkStatus =
  'PENDING_ACKNOWLEDGEMENT' | 'ACKNOWLEDGED' | 'READY_FOR_REINSPECTION' | 'CLOSED';

export interface QaQuantityTotals {
  prepared: number;
  availableToInspect: number;
  accepted: number;
  rework: number;
  awaitingReinspection: number;
  permanentlyRejected: number;
  finalApproved: number;
}
export interface QaQueueSummary extends VersionedResource {
  id: string;
  jobOrderNumber: string;
  purchaseOrderNumber: string;
  factory: { id: string; code: string; name: string };
  status: JobOrderStatus;
  totals: QaQuantityTotals;
}
export interface QaInspectionLineView {
  id: string;
  jobOrderLineSizeId: string;
  sourceReworkTaskId: string | null;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  preparedQuantity: number;
  inspectedQuantity: number;
  acceptedQuantity: number;
  reworkQuantity: number;
  permanentlyRejectedQuantity: number;
  defectCategory: QaDefectCategory | null;
  defectNotes: string | null;
}
export interface QaEvidenceMetadata {
  id: string;
  inspectionLineId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface QaInspectionSessionView extends VersionedResource {
  id: string;
  cycleNumber: number;
  status: QaInspectionStatus;
  inspector: { id: string; name: string; email: string };
  notes: string | null;
  finalizedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  lines: QaInspectionLineView[];
  evidence: QaEvidenceMetadata[];
  createdAt: string;
}
export interface QaReworkTaskView extends VersionedResource {
  id: string;
  jobOrderId: string;
  jobOrderNumber: string;
  jobOrderLineSizeId: string;
  styleNumber: string;
  sizeCode: string;
  assignedQuantity: number;
  attemptNumber: number;
  status: QaReworkStatus;
  defectCategory: QaDefectCategory | null;
  defectNotes: string | null;
}
export interface QaInspectionDetail extends QaQueueSummary {
  lines: Array<{
    jobOrderLineSizeId: string;
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
    preparedQuantity: number;
    availableToInspect: number;
    acceptedQuantity: number;
    reworkQuantity: number;
    awaitingReinspectionQuantity: number;
    permanentlyRejectedQuantity: number;
  }>;
  sessions: QaInspectionSessionView[];
  reworkTasks: QaReworkTaskView[];
}
export interface SaveQaInspectionInput extends VersionedMutationInput {
  notes?: string | null;
  lines: Array<{
    jobOrderLineSizeId: string;
    sourceReworkTaskId?: string | null;
    inspectedQuantity: number;
    acceptedQuantity: number;
    reworkQuantity: number;
    permanentlyRejectedQuantity: number;
    defectCategory?: QaDefectCategory | null;
    defectNotes?: string | null;
  }>;
}
