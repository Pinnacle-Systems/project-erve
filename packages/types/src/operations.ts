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

export interface PurchaseOrderFulfilmentSummary {
  poId: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  lines: Array<{
    lineId: string;
    styleId: string;
    styleNumber: string;
    styleName: string;
    sizes: PurchaseOrderFulfilmentSizeSummary[];
    totals: PurchaseOrderFulfilmentTotals;
  }>;
}

export interface PurchaseOrderFulfilmentSizeSummary extends PurchaseOrderFulfilmentTotals {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
}

export interface PurchaseOrderFulfilmentTotals {
  orderedQuantity: number;
  jobOrderedQuantity: number;
  preparedQuantity: number;
  qaReleasedQuantity: number;
  saleOrderAllocatedQuantity: number;
  remainingToJobOrderQuantity: number;
  notPreparedQuantity: number;
  preparedNotReleasedQuantity: number;
  releasedUnallocatedQuantity: number;
}

// ---------------------------------------------------------------------------
// Sale Orders
// ---------------------------------------------------------------------------

export type SaleOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FULFILLED';

export type StockAllocationStatus = 'ACTIVE' | 'RELEASED';
export type StockAllocationSource =
  | 'DISTRIBUTOR_REQUEST'
  | 'MERCHANDISER_ADJUSTMENT'
  | 'MERCHANDISER_REASSIGNMENT';

export interface StockAllocationSourceDetail {
  qaReleaseLineId: string;
  distributor: { id: string; code: string; name: string };
  purchaseOrder: { id: string; poNumber: string };
  jobOrder: { id: string; jobOrderNumber: string };
  factory: { id: string; code: string; name: string };
  releasedAt: string;
}

export interface SaleOrderAllocationView {
  id: string;
  quantity: number;
  status: StockAllocationStatus;
  allocationSource: StockAllocationSource;
  reason: string | null;
  createdAt: string;
  // Null when redacted for a viewer who is not permitted to see cross-
  // distributor provenance (a DISTRIBUTOR viewer on a MERCHANDISER_REASSIGNMENT
  // allocation) — see requirement 4/10 in the Sale Order spec.
  source: StockAllocationSourceDetail | null;
}

export interface SaleOrderLineView {
  id: string;
  purchaseOrderLineSizeId: string;
  purchaseOrderId: string;
  poNumber: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
  qaPassedQuantity: number;
  requestedQuantity: number;
  approvedQuantity: number | null;
  remarks: string | null;
  allocations: SaleOrderAllocationView[];
}

export interface SaleOrderSummary extends VersionedResource {
  id: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  financialYear: { id: string; code: string };
  soDate: string;
  status: SaleOrderStatus;
  totalRequestedQuantity: number;
  totalApprovedQuantity: number;
  createdAt: string;
}

export interface SaleOrderDetail extends SaleOrderSummary {
  creator: { id: string; name: string; email: string };
  reviewedBy: { id: string; name: string; email: string } | null;
  fulfilledBy: { id: string; name: string; email: string } | null;
  remarks: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  fulfilledAt: string | null;
  fulfillmentReference: string | null;
  decisionReason: string | null;
  lines: SaleOrderLineView[];
  fulfillment: SaleOrderFulfillmentSummary;
}

// ---------------------------------------------------------------------------
// Fulfillment: Factory Packing -> Erve India Consolidation -> Distributor
// Dispatch (see the schema module doc for the full design), followed by the
// Dispatch -> Invoice/Tally reference handoff below. Tally remains the
// accounting system of record and sole generator of the actual invoice/
// e-invoice/e-way bill — these views only carry the reference Tally produces.
// ---------------------------------------------------------------------------

export type FactoryDispatchStatus = 'DRAFT' | 'READY_FOR_ERVE';
export type ErvePackingListStatus = 'OPEN' | 'DISPATCHED';
export type ErveDispatchStatus = 'DISPATCHED' | 'DELIVERED';
export type DeliveryConfirmationSource = 'USER_CONFIRMED' | 'LEGACY_ASSUMED_FULL_RECEIPT';

/** One approved-allocation row a FACTORY_USER may pack, scoped to their own mapped Factory only. */
export interface FactoryPackingQueueLine {
  saleOrderId: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  saleOrderLineId: string;
  stockAllocationId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  allocatedQuantity: number;
  packedQuantity: number;
  remainingQuantity: number;
}

export interface FactoryDispatchLineView {
  id: string;
  saleOrderLineId: string;
  stockAllocationId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  packedQuantity: number;
  cartonedQuantity: number;
}

export interface FactoryPackingCartonLineView {
  factoryDispatchLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

export interface FactoryPackingCartonView {
  id: string;
  cartonNumber: string;
  packageDetails: string | null;
  weight: string | null;
  lines: FactoryPackingCartonLineView[];
  createdAt: string;
}

export interface FactoryDispatchSummary extends VersionedResource {
  id: string;
  factoryDispatchNumber: string;
  factory: { id: string; code: string; name: string };
  saleOrder: { id: string; saleOrderNumber: string; distributor: { id: string; code: string; name: string } };
  status: FactoryDispatchStatus;
  preparedBy: { id: string; name: string; email: string };
  preparedAt: string;
  finalizedBy: { id: string; name: string; email: string } | null;
  finalizedAt: string | null;
  totalPackedQuantity: number;
  consolidated: boolean;
  createdAt: string;
}

export interface FactoryDispatchDetail extends FactoryDispatchSummary {
  lines: FactoryDispatchLineView[];
  cartons: FactoryPackingCartonView[];
}

export interface ErvePackingListSourceView {
  factoryDispatchId: string;
  factoryDispatchNumber: string;
  factory: { id: string; code: string; name: string };
  lines: FactoryDispatchLineView[];
  cartons: FactoryPackingCartonView[];
}

export interface ErvePackingListSummary {
  id: string;
  ervePackingListNumber: string;
  saleOrder: { id: string; saleOrderNumber: string; distributor: { id: string; code: string; name: string } };
  status: ErvePackingListStatus;
  createdBy: { id: string; name: string; email: string };
  createdAt: string;
  totalQuantity: number;
}

export interface ErvePackingListDetail extends ErvePackingListSummary {
  sources: ErvePackingListSourceView[];
}

/**
 * Per-SaleOrderLine invoice-handoff ("Dispatch Sale") status embedded on
 * ErveDispatchView so a Dispatch shows its invoice state without a second
 * fetch. EVERY physically dispatched line appears here, both Purchase
 * Modes — see ErveDispatchSaleOrReturnLine below for the SALE_RETURN-only
 * commercial sell-through position layered on top for those lines.
 */
export interface ErveDispatchInvoiceHandoffSummary {
  invoiceHandoffId: string;
  saleOrderLineId: string;
  purchaseMode: PurchaseMode;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
  status: InvoiceHandoffStatus;
  tallyInvoiceNumber: string | null;
  tallyInvoiceDate: string | null;
}

/** A SALE_RETURN line's consignment/Actual-Sale/Return position within this one Dispatch — see SaleOrReturnPositionRow for the full cross-Dispatch derivation. Independent of the line's InvoiceHandoff above — the Dispatch Sale invoice already exists for the full dispatchedQuantity regardless of actualSoldQuantity. */
export interface ErveDispatchSaleOrReturnLine {
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
  returnableQuantity: number;
}

export interface ErveDispatchView extends VersionedResource {
  id: string;
  erveDispatchNumber: string;
  ervePackingList: { id: string; ervePackingListNumber: string };
  saleOrder: { id: string; saleOrderNumber: string };
  distributor: { id: string; code: string; name: string };
  status: ErveDispatchStatus;
  dispatchDate: string;
  transporter: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  remarks: string | null;
  dispatchedBy: { id: string; name: string; email: string };
  dispatchedAt: string;
  lrUpdatedBy: { id: string; name: string; email: string } | null;
  lrUpdatedAt: string | null;
  deliveredBy: { id: string; name: string; email: string } | null;
  deliveredAt: string | null;
  deliveryRemarks: string | null;
  deliveryConfirmationSource: DeliveryConfirmationSource | null;
  totalQuantity: number;
  invoiceHandoffs: ErveDispatchInvoiceHandoffSummary[];
  saleOrReturnLines: ErveDispatchSaleOrReturnLine[];
}

// ---------------------------------------------------------------------------
// Physical Dispatch -> Invoice/Tally reference handoff ("Dispatch Sale").
// Financial granularity is the SaleOrderLine, never the whole Dispatch or
// Sale Order — see the schema module doc (invoice_handoffs) for why: a Sale
// Order (and therefore one ErveDispatch consolidating it) can span multiple
// Purchase Orders with different PurchaseMode, so a single physical Dispatch
// can legitimately mix OUTRIGHT and SALE_RETURN quantity.
//
// EVERY physically dispatched line — both Purchase Modes — gets exactly one
// InvoiceHandoff the moment ErveDispatch is recorded. This is deliberately
// NOT the same fact as a SALE_RETURN Distributor's later-reported Actual
// Sale (see DistributorSalesReportLineView) — recording an Actual Sale never
// creates a second handoff; the invoice for the physical movement already
// exists here. purchaseMode is exposed for business context/reporting only
// and never affects eligibility.
//
// tallyVoucherReference/remarks/recordedBy are omitted (null) for a
// DISTRIBUTOR caller — only the number/date are "safe" fields for that role.
// tallyInvoiceNumber is intentionally NOT unique across handoffs: whether one
// Tally invoice may cover several handoff rows (consolidation) is an open
// business question this system does not yet constrain.
// ---------------------------------------------------------------------------

export type InvoiceHandoffStatus = 'PENDING_TALLY' | 'INVOICED';

export interface InvoiceHandoffView extends VersionedResource {
  id: string;
  erveDispatch: { id: string; erveDispatchNumber: string; dispatchDate: string };
  saleOrder: { id: string; saleOrderNumber: string };
  distributor: { id: string; code: string; name: string };
  purchaseMode: PurchaseMode;
  saleOrderLineId: string;
  style: { styleNumber: string; styleName: string };
  size: { sizeCode: string; sizeLabel: string };
  quantity: number;
  status: InvoiceHandoffStatus;
  tallyInvoiceNumber: string | null;
  tallyInvoiceDate: string | null;
  tallyVoucherReference: string | null;
  remarks: string | null;
  recordedBy: { id: string; name: string; email: string } | null;
  recordedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Sale-or-Return consignment position — derived (dispatched, minus Actual
// Sale reported; returns are future scope, see the schema module doc), never
// an independently mutable record, and entirely independent of the line's
// InvoiceHandoff status (the Dispatch Sale invoice already exists for the
// full dispatchedQuantity — see InvoiceHandoffView above). This is the
// Distributor-facing "what can I report sales against" queue and the
// Accountant/Merchandiser/Senior Management read of the same facts.
// ---------------------------------------------------------------------------

export interface SaleOrReturnPositionRow {
  erveDispatchId: string;
  erveDispatchNumber: string;
  dispatchDate: string;
  saleOrderId: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
  returnableQuantity: number;
}

// ---------------------------------------------------------------------------
// Distributor Return — unsold SALE_RETURN stock physically coming back from
// a Distributor to Erve. See apps/api's distributor-return.service.ts module
// doc for the full lifecycle/quantity model this feeds
// (SaleOrReturnPositionRow.returnableQuantity above is the eligibility
// ceiling for a new submission).
// ---------------------------------------------------------------------------

export type DistributorReturnStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'CANCELLED';

export interface DistributorReturnLineView {
  id: string;
  erveDispatch: { id: string; erveDispatchNumber: string };
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  receivedQuantity: number | null;
  returnedStockLotId: string | null;
}

export interface DistributorReturnView extends VersionedResource {
  id: string;
  returnNumber: string;
  distributor: { id: string; code: string; name: string };
  returnDate: string;
  status: DistributorReturnStatus;
  returnReason: string;
  remarks: string | null;
  submittedBy: { id: string; name: string; email: string };
  submittedAt: string;
  approvedBy: { id: string; name: string; email: string } | null;
  approvedAt: string | null;
  approvalRemarks: string | null;
  rejectionReason: string | null;
  receivedBy: { id: string; name: string; email: string } | null;
  receivedAt: string | null;
  creditNoteReference: string | null;
  creditNoteDate: string | null;
  creditNoteRecordedBy: { id: string; name: string; email: string } | null;
  cancelledBy: { id: string; name: string; email: string } | null;
  cancelledAt: string | null;
  lines: DistributorReturnLineView[];
}

export interface DistributorSalesReportLineView {
  id: string;
  erveDispatch: { id: string; erveDispatchNumber: string };
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantitySold: number;
}

export interface DistributorSalesReportView {
  id: string;
  distributor: { id: string; code: string; name: string };
  reportDate: string;
  remarks: string | null;
  submittedBy: { id: string; name: string; email: string };
  submittedAt: string;
  lines: DistributorSalesReportLineView[];
}

export interface SaleOrderFulfillmentLineProgress {
  saleOrderLineId: string;
  approvedQuantity: number;
  factoryPackedQuantity: number;
  dispatchedQuantity: number;
  remainingToPackQuantity: number;
  remainingToDispatchQuantity: number;
}

/** View-model-only progress derived at read time — never persisted on SaleOrder.status (see spec). */
export type SaleOrderFulfillmentStage =
  | 'NOT_APPLICABLE'
  | 'AWAITING_FACTORY_PACKING'
  | 'PARTIALLY_FACTORY_PACKED'
  | 'READY_FOR_ERVE_PACKING'
  | 'PARTIALLY_DISPATCHED'
  | 'DISPATCHED_IN_FULL';

export interface SaleOrderFulfillmentSummary {
  stage: SaleOrderFulfillmentStage;
  totalApprovedQuantity: number;
  totalFactoryPackedQuantity: number;
  totalDispatchedQuantity: number;
  lines: SaleOrderFulfillmentLineProgress[];
  /** true when status is FULFILLED via the old manual action with no Erve Dispatch history behind it. */
  isLegacyFulfilled: boolean;
}

export interface SaleOrderAuditEntry {
  id: string;
  action: string;
  title: string;
  // Pre-formatted, viewer-sanitized business detail — cross-distributor
  // provenance (source distributor/PO/Job Order/factory) is only ever
  // included here for a viewer permitted to see it; a DISTRIBUTOR viewer
  // gets a generic phrase instead. The API is authoritative for this, not
  // the frontend — see requirement 6/14 in the Sale Order audit spec.
  detail: string | null;
  actor: { id: string; name: string; email: string } | null;
  createdAt: string;
}

// The demand-side catalog a DISTRIBUTOR selects from when creating a Sale
// Order line: identity fields only, from their own Purchase Order line/sizes
// — deliberately carries no stock/availability quantity of any kind (own or
// central), so it stays safe to show regardless of what QA-released stock
// currently exists anywhere.
export interface RequestableCatalogLine {
  purchaseOrderLineSizeId: string;
  purchaseOrderId: string;
  poNumber: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
}

export interface EligibleStockLine {
  purchaseOrderLineSizeId: string;
  purchaseOrderId: string;
  poNumber: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  releasedQuantity: number;
  committedQuantity: number;
  availableQuantity: number;
}

export interface GlobalInventoryLine {
  qaReleaseLineId: string;
  distributor: { id: string; code: string; name: string };
  purchaseOrder: { id: string; poNumber: string };
  jobOrder: { id: string; jobOrderNumber: string };
  factory: { id: string; code: string; name: string };
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  releasedQuantity: number;
  committedQuantity: number;
  availableQuantity: number;
  releasedAt: string;
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
    reworks?: FinalQualityBatchReworkCycleView[];
  }>;
}

export type FinalQualityBatchReworkStatus = 'REQUIRED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED';

/** One Factory corrective-action cycle spawned by a single Final FAIL. */
export interface FinalQualityBatchReworkCycleView {
  id: string;
  cycleNumber: number;
  status: FinalQualityBatchReworkStatus;
  failedQualityExecutionId: string;
  failedAttemptNumber: number;
  notes: string | null;
  acknowledgedBy: { id: string; name: string; email: string } | null;
  acknowledgedAt: string | null;
  startedBy: { id: string; name: string; email: string } | null;
  startedAt: string | null;
  completedBy: { id: string; name: string; email: string } | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A Factory-facing actionable item for the current rework cycle of one
 * unresolved (AWAITING_REINSPECTION) Final Quality batch. `previousCycles`
 * carries the full corrective-action history for prior failed attempts on
 * the same physical batch.
 */
export interface FinalQualityBatchReworkTaskView {
  /** Id of the current (latest) rework cycle. */
  id: string;
  finalQualityBatchId: string;
  jobOrderId: string;
  jobOrderNumber: string;
  processFlowActivityId: string;
  activityName: string;
  batchNumber: number;
  physicalQuantity: number;
  allocations: Array<{
    jobOrderLineSizeId: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
  }>;
  cycleNumber: number;
  status: FinalQualityBatchReworkStatus;
  failedAttemptNumber: number;
  failedAt: string | null;
  qaRemarks: string | null;
  notes: string | null;
  acknowledgedBy: { id: string; name: string; email: string } | null;
  acknowledgedAt: string | null;
  startedBy: { id: string; name: string; email: string } | null;
  startedAt: string | null;
  completedBy: { id: string; name: string; email: string } | null;
  completedAt: string | null;
  previousCycles: FinalQualityBatchReworkCycleView[];
  version: number;
  updatedAt: string;
}

export interface FinalQualityBatchReworkActionInput extends VersionedMutationInput {
  notes?: string | null;
}
export interface FinalQualityBatchReworkCompleteInput extends VersionedMutationInput {
  notes: string;
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
  reworks?: FinalQualityBatchReworkCycleView[];
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
  finalBatchReworks: FinalQualityBatchReworkTaskView[];
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
  finalBatchReworkRequired: boolean;
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
