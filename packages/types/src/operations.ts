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
  // The Financial Year of this PO's own poDate — never inherited from a
  // downstream document or a parent relationship.
  financialYear: { id: string; code: string };
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
  seasonSnapshots: Array<{
    seasonId: string | null;
    code: string;
    name: string;
    financialYear: string;
    displayName: string;
  }>;
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
    colour: string | null;
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
export type QualityRuntimeStatus =
  'NOT_AVAILABLE' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'MISSED';

export type OperationalStateTone = 'muted' | 'pending' | 'info' | 'success' | 'warning' | 'danger';

export interface OperationalStateValue {
  code: string;
  label: string;
  tone: OperationalStateTone;
  activityId: string | null;
  activityName: string | null;
}

export interface JobOrderOperationalState {
  lifecycleContext: OperationalStateValue;
  productionState: OperationalStateValue | null;
  qualityState: OperationalStateValue | null;
  primaryDisplayState: OperationalStateValue;
}
export interface JobOrderQualityActivity {
  processFlowVersionStageId: string;
  sequence: number;
  name: string;
  status: QualityRuntimeStatus;
  eligible: boolean;
  qualityForm: { id: string; code: string; name: string; executionScope: 'JOB_ORDER' | 'SIZE' };
  qualityFormVersion: { id: string; versionNumber: number };
  executionMode: 'SEQUENTIAL_GATE' | 'IN_PROCESS';
  associatedProductionActivity: { id: string; name: string } | null;
  availabilityPolicy:
    | 'SEQUENTIAL_PREDECESSOR_COMPLETED'
    | 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
    | 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'
    | 'PROGRESS_PERCENTAGE';
  progressThresholdPercent: string | null;
  gateSatisfactionRequirement: 'FINALIZED' | 'OUTCOME_PASS' | null;
  executionMultiplicity: 'SINGLE' | 'BATCHED';
  coverageTarget: 'PREPARED_QUANTITY' | null;
  coverage: QualityCoverageView | null;
  execution: {
    id: string;
    attemptNumber: number;
    batchNumber: number;
    inspectedQuantity: number | null;
    status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
    version: number;
    outcome: 'PASS' | 'FAIL' | null;
    startedAt: string;
    finalizedAt: string | null;
  } | null;
  executionHistory: Array<{
    id: string;
    attemptNumber: number;
    batchNumber: number;
    inspectedQuantity: number | null;
    sampleJobOrderLineSizeId: string | null;
    sampleQuantity: number | null;
    sampleSizeCode: string | null;
    sampleSizeLabel: string | null;
    ppSampleSessionId: string | null;
    ppSampleFormId: string | null;
    status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
    outcome: 'PASS' | 'FAIL' | null;
    startedBy: { id: string; name: string; email: string };
    finalizedBy: { id: string; name: string; email: string } | null;
    startedAt: string;
    finalizedAt: string | null;
  }>;
}

export interface QualityExecutionPayload {
  expectedVersion: number;
  checklistResponses: Array<{
    componentId: string;
    itemKey: string;
    response: string;
    remarks?: string | null;
  }>;
  aqlResults: Array<{
    componentId: string;
    severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
    maxAllowed?: number | null;
    found?: number | null;
  }>;
  defects: Array<{
    componentId: string;
    description: string;
    severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
    quantity?: number | null;
  }>;
  correctiveActions: Array<{
    componentId: string;
    values: Record<string, string | number | boolean | null>;
  }>;
  testResults: Array<{
    componentId: string;
    testKey: string;
    response: string;
    remarks?: string | null;
  }>;
  quantities: Array<{ componentId: string; fieldKey: string; value: number }>;
  comments: Array<{ componentId: string; value: string }>;
  fieldResponses: Array<{ componentId: string; fieldKey: string; value: string }>;
  attendees: Array<{ componentId: string; roleKey: string; attendeeName: string }>;
  actions: Array<{
    componentId: string;
    values: Record<string, string | number | boolean | null>;
  }>;
  signoffs: Array<{ componentId: string; roleKey: string; signatoryName: string }>;
  outcome?: { componentId: string; value: 'PASS' | 'FAIL'; remarks?: string | null } | null;
}

export interface QualityExecutionValidationError {
  sectionId: string;
  sectionTitle: string;
  componentId: string;
  componentTitle: string;
  fieldKey: string;
  fieldLabel: string;
  rowIndex?: number;
  code: 'REQUIRED' | 'INVALID';
  message: string;
}

export interface QualityProductionContext {
  associatedActivity: { id: string; code: string | null; name: string } | null;
  stages: Array<{
    id: string;
    code: string | null;
    name: string;
    status: ProductionStageStatus;
    relationship: 'PREVIOUS' | 'ASSOCIATED' | 'FOLLOWING';
  }>;
}

export interface QualityExecutionView {
  id: string;
  jobOrderId: string;
  jobOrderNumber: string;
  processFlowActivityId: string;
  activityName: string;
  qualityForm: { id: string; code: string; name: string; versionId: string; versionNumber: number };
  attemptNumber: number;
  batchNumber: number;
  inspectedQuantity: number | null;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  version: number;
  startedAt: string;
  finalizedAt: string | null;
  ppSample: {
    selectedSizeId: string;
    sizeCode: string | null;
    sizeLabel: string | null;
    sampleQuantity: number;
    sessionId: string | null;
    formId: string | null;
    decision: 'PASS' | 'FAIL' | null;
  } | null;
  finalBatch?: FinalQualityBatchView | null;
  productionContext: QualityProductionContext | null;
  coverage: QualityCoverageView | null;
  sections: Array<{
    id: string;
    sequence: number;
    title: string;
    description?: string | null;
    components: Array<{
      id: string;
      sequence: number;
      type: string;
      title: string;
      description?: string | null;
      config: Record<string, unknown>;
      systemValue?: Array<{ key: string; value: unknown; available: boolean }>;
    }>;
  }>;
  responses: QualityExecutionPayload;
  attachments: Array<{
    id: string;
    componentId: string;
    requirementKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
}
export interface QualityCoverageView {
  preparedQuantityAuthoritative: boolean;
  preparedQuantity: number | null;
  inspectedQuantity: number;
  inspectionActivityQuantity?: number;
  reservedForFinalQuantity?: number;
  inspectedPhysicalCoverage?: number;
  resolvedPhysicalCoverage?: number;
  /** Compatibility alias for inspectedPhysicalCoverage. */
  physicalFinalCoverage?: number;
  releasedQuantity?: number;
  permanentlyRejectedQuantity?: number;
  awaitingReinspectionQuantity?: number;
  remainingQuantity: number | null;
  availableForNewFinalBatch?: number | null;
  complete: boolean;
  coverageCompleteSoFar?: boolean;
  finalQaComplete?: boolean;
  reconciliationConflict: boolean;
  state: 'UNKNOWN' | 'IN_PROGRESS' | 'COMPLETE' | 'CONFLICT';
  passedBatches: number;
  failedBatches: number;
  hasFailedBatches: boolean;
  availableBySize?: Array<{
    jobOrderLineSizeId: string;
    sizeCode: string;
    sizeLabel: string;
    preparedQuantity: number;
    allocatedQuantity: number;
    availableQuantity: number;
  }>;
  batches: Array<{
    id: string;
    batchNumber: number;
    physicalQuantity?: number;
    inspectedQuantity: number | null;
    status: 'DRAFT' | 'FINALIZED';
    outcome: 'PASS' | 'FAIL' | null;
    disposition?:
      'DRAFT' | 'AWAITING_REINSPECTION' | 'RELEASED' | 'PERMANENTLY_REJECTED' | 'CANCELLED';
    finalizedAt: string | null;
    allocations?: Array<{ jobOrderLineSizeId: string; quantity: number }>;
    attemptCount?: number;
  }>;
}

export interface FinalQualityBatchView {
  id: string;
  jobOrderId?: string;
  processFlowActivityId?: string;
  batchNumber: number;
  physicalQuantity: number;
  disposition:
    'DRAFT' | 'AWAITING_REINSPECTION' | 'RELEASED' | 'PERMANENTLY_REJECTED' | 'CANCELLED';
  createdBy?: { id: string; name: string; email: string };
  createdAt?: string;
  terminalBy?: { id: string; name: string; email: string } | null;
  terminalAt?: string | null;
  terminalReason?: string | null;
  allocations: Array<{
    jobOrderLineSizeId: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
  }>;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
    outcome: 'PASS' | 'FAIL' | null;
    startedBy?: { id: string; name: string; email: string };
    startedAt: string;
    finalizedBy?: { id: string; name: string; email: string } | null;
    finalizedAt: string | null;
  }>;
  release: { id: string; releasedAt: string; quantity: number } | null;
}
export interface JobOrderSummary extends VersionedResource {
  id: string;
  jobOrderNumber: string;
  // The Financial Year of this JO's own effective date (its createdAt) —
  // never inherited from the parent Purchase Order.
  financialYear: { id: string; code: string };
  purchaseOrder: { id: string; poNumber: string; status: PurchaseOrderStatus };
  factory: { id: string; code: string; name: string };
  unitPrice: number;
  status: JobOrderStatus;
  operationalState: JobOrderOperationalState;
  factoryConfirmationStatus: FactoryConfirmationStatus;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  createdAt: string;
}
export interface JobOrderDetail extends JobOrderSummary {
  preparedQuantityEntry?: {
    available: boolean;
    processFlowActivityId: string | null;
    associatedProductionActivity: { id: string; name: string } | null;
  };
  seasonSnapshots: Array<{
    seasonId: string | null;
    code: string;
    name: string;
    financialYear: string;
    displayName: string;
  }>;
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
  qualityActivities: JobOrderQualityActivity[];
  reworkTasks: QaReworkTaskView[];
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
  operationalState: JobOrderOperationalState;
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
export interface StartJobOrderStageInput extends VersionedMutationInput {
  stageStatusId: string;
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
  'REWORK_REQUIRED' | 'ACKNOWLEDGED' | 'READY_FOR_REINSPECTION' | 'REINSPECTED';
export type QaChecklistStatus = 'YES' | 'NO' | 'AVAILABLE';
export const QA_CHECKLIST_CHOICES: ReadonlyArray<{
  value: QaChecklistStatus;
  label: string;
  ppSample: boolean;
}> = [
  { value: 'YES', label: 'Yes', ppSample: true },
  { value: 'NO', label: 'No', ppSample: true },
  { value: 'AVAILABLE', label: 'Available', ppSample: false },
];
export const qaChecklistChoices = (ppSample: boolean) =>
  QA_CHECKLIST_CHOICES.filter((choice) => !ppSample || choice.ppSample);
export type QaChecklistItemCode =
  | 'FABRIC_COLOUR_QUALITY'
  | 'TRIMS_CARD'
  | 'FABRIC_GSM'
  | 'MEASUREMENTS_REPORT'
  | 'GARMENT_CONSTRUCTION'
  | 'GENERAL_QUALITY_PRESENTATION'
  | 'LABELLING_POSITION'
  | 'FIT_SAMPLE_BUYER_COMMENTS'
  | 'SPI'
  | 'SAMPLE_TAG'
  | 'DATA_SHEET_PULL_TEST_PINCH_SETTING'
  | 'METAL_DETECTION'
  | 'P_AND_P'
  | 'PP_SAMPLE_FIT_COMMENTS'
  | 'SOURCE_DECLARATION_FORM';
export const QA_CHECKLIST_ITEMS: ReadonlyArray<{ code: QaChecklistItemCode; label: string }> = [
  {
    code: 'FABRIC_COLOUR_QUALITY',
    label:
      'Confirm fabric has been checked and is correct colour and quality (approved shade band / bulk hanger)',
  },
  { code: 'TRIMS_CARD', label: 'Confirm trims is available and checked as per trims card' },
  { code: 'FABRIC_GSM', label: 'Confirm fabric GSM is correct' },
  {
    code: 'MEASUREMENTS_REPORT',
    label: 'Confirm all measurements are within tolerance and measurement report is attached',
  },
  {
    code: 'GARMENT_CONSTRUCTION',
    label: 'Confirm garment construction is correct and as per all previous samples comment',
  },
  {
    code: 'GENERAL_QUALITY_PRESENTATION',
    label: 'Confirm samples general quality and presentation are acceptable',
  },
  { code: 'LABELLING_POSITION', label: 'Confirm labelling position has been checked and correct' },
  { code: 'FIT_SAMPLE_BUYER_COMMENTS', label: 'Fit sample made based on buyer comments' },
  {
    code: 'SPI',
    label: 'Confirm SPI is correct (outside 11–12 per inch and inside 12–13 per inch)',
  },
  { code: 'SAMPLE_TAG', label: 'Confirm sample tag with details' },
  {
    code: 'DATA_SHEET_PULL_TEST_PINCH_SETTING',
    label: 'Confirm all Data Sheet / Pull Test / Pinch Setting have been checked and are correct',
  },
  { code: 'METAL_DETECTION', label: 'Confirm Metal Detection have been checked and are correct' },
  { code: 'P_AND_P', label: 'Confirm P&P have been checked and are correct' },
  { code: 'PP_SAMPLE_FIT_COMMENTS', label: 'Confirm PP sample made based on fit comments' },
  { code: 'SOURCE_DECLARATION_FORM', label: 'Source declaration form available' },
];
export interface QaChecklistItemView {
  itemCode: QaChecklistItemCode;
  status: QaChecklistStatus | null;
  remarks: string | null;
}

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
export interface QaSizeInspectionFormView {
  id: string;
  status: QaInspectionStatus;
  version: number;
  finalizedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  jobOrderLineSizeId: string;
  sourceReworkTaskId: string | null;
  styleNumber: string;
  styleName: string;
  colour: string | null;
  sizeCode: string;
  sizeLabel: string;
  preparedQuantity: number;
  sampleQuantity: number | null;
  checklist: QaChecklistItemView[];
  inspectionRemarks: string | null;
  inspectedQuantity: number;
  acceptedQuantity: number;
  reworkQuantity: number;
  permanentlyRejectedQuantity: number;
  defectCategory: QaDefectCategory | null;
  otherDefectDetails: string | null;
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
  finalizedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  forms: QaSizeInspectionFormView[];
  evidence: QaEvidenceMetadata[];
  createdAt: string;
  processFlowPpSample?: {
    executionId: string;
    processFlowActivityId: string;
    qualityFormVersionId: string;
    sampleQuantity: number;
    decision: 'PASS' | 'FAIL' | null;
  } | null;
}
export interface QaReworkTaskView extends VersionedResource {
  id: string;
  jobOrderId: string;
  jobOrderNumber: string;
  jobOrderLineSizeId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  assignedQuantity: number;
  attemptNumber: number;
  status: QaReworkStatus;
  defectCategory: QaDefectCategory | null;
  otherDefectDetails: string | null;
  defectNotes: string | null;
  qaRemarks: string | null;
  qaEvidence: QaEvidenceMetadata[];
  requestedBy: { id: string; name: string; email: string };
  requestedAt: string;
  factoryNotes: string | null;
  acknowledgedBy: { id: string; name: string; email: string } | null;
  acknowledgedAt: string | null;
  readyBy: { id: string; name: string; email: string } | null;
  readyAt: string | null;
  reinspectedAt: string | null;
}
export interface QaInspectionDetail extends QaQueueSummary {
  distributor: { id: string; code: string; name: string } | null;
  seasons: Array<{ code: string; displayName: string }>;
  lines: Array<{
    jobOrderLineSizeId: string;
    styleNumber: string;
    styleName: string;
    colour: string | null;
    sizeCode: string;
    sizeLabel: string;
    orderedQuantity: number;
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
