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
  // Order Sheet planning lock: null while open (editable/cancellable/
  // eligible for Job Ordering); set once a Job Order claims this Order
  // Sheet, at which point it is locked permanently regardless of the Job
  // Order's own later status (see lockedByJobOrder.status).
  jobOrderId: string | null;
  lockedByJobOrder: { id: string; jobOrderNumber: string; status: JobOrderStatus } | null;
  totalOrderedQuantity: number;
  createdAt: string;
}

export interface PurchaseOrderLineSize {
  id: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
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
// Slim Style row for the Order Sheet Style lookup (GET
// /purchase-orders/style-options). Deliberately excludes sizes, images and
// factory mappings — those belong to the selected Style only.
export interface OrderSheetStyleOption {
  id: string;
  styleNumber: string;
  styleName: string;
  lmixNumber: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  season: { code: string; displayName: string };
}

// The one selected Style (GET /purchase-orders/style-options/:styleId): the
// option fields plus only the sizes an Order Sheet line may order today
// (active StyleSize mapping on an active Size — the same rule
// validateLines enforces on save). Returned whatever the Style's own status,
// so a saved Order Sheet can still display a since-retired Style.
export interface OrderSheetStyleDetail extends OrderSheetStyleOption {
  sizes: Array<{ id: string; code: string; label: string; sortOrder: number }>;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  merchandiser: { id: string; name: string; email: string } | null;
  creator: { id: string; name: string; email: string };
  remarks: string | null;
  lines: PurchaseOrderLine[];
}

// PurchaseOrderBalance / PurchaseOrderFulfilmentSummary (retired): the Order
// Sheet is no longer a remaining-balance/partial-fulfilment ledger — Job
// Order creation claims an Order Sheet wholly and atomically, so
// "remaining quantity"/"fulfilment progress" no longer applies at the Order
// Sheet level. Their backing endpoints were removed from purchase-orders
// service/routes in the same pass.

// ---------------------------------------------------------------------------
// Dispatch Orders (user-facing name; technical model/type names keep the
// SaleOrder prefix to avoid unnecessary churn — see the Dispatch Order Phase
// 3 plan). Merchandising allocates pooled Factory+Style+Size QA-passed stock
// to one or more Distributors' destinations (Correction 8: a Dispatch Order
// belongs to exactly one Factory but may contain multiple Distributors, each
// grouping one or more destination snapshots with their own Style/Size/
// Quantity lines — a DO may legitimately mix Purchase Modes across its
// Distributors); creation is the sole allocation point, there is no draft/
// submit/review/approve workflow, no cancellation, no partial fulfilment.
// Internal StockAllocation/QaReleaseLine/Job Order traceability is never
// exposed on these views — see DispatchOrderAuditDetail (ADMIN/MERCHANDISER
// only) for that.
// ---------------------------------------------------------------------------

// Not a workflow field — kept for filterability/forward-compatibility only;
// see the schema comment on SaleOrderStatus.
export type SaleOrderStatus = 'ACTIVE';

export type StockAllocationStatus = 'ACTIVE' | 'RELEASED';
// Every reservation is a Merchandiser action against a pooled,
// distributor-independent Factory+Style+Size pool — there is no
// distributor-initiated request or cross-distributor reassignment concept.
export type StockAllocationSource = 'MERCHANDISER_ALLOCATION';

export interface SaleOrderDestinationView {
  id: string;
  label: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  /** Captured where supplied; nullable/optional, format-validated only — never used to infer Bill-To/Ship-To tax treatment (Correction 8 §7). */
  gstin: string | null;
  /** Server-derived (Correction 8): true only while the whole Dispatch Order is still editable AND this destination has zero packed cartons — the exact, shared eligibility the "Move to Distributor" action must reflect. Never infer this client-side from other fields. */
  canMoveDistributor: boolean;
}

export interface SaleOrderLineView {
  id: string;
  destinationId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
  remarks: string | null;
}

/** One Distributor's participation in a Dispatch Order (Correction 8) — groups its destinations and the lines under them. purchaseMode is a snapshot taken when this Distributor was attached (Distributor.purchaseMode is immutable after creation, so it can never diverge from the master); name/code are always the CURRENT Distributor master values (live-joined, not snapshotted — see the Correction 8 "Distributor identity snapshot scope" decision). */
export interface SaleOrderDistributorGroupView {
  id: string;
  distributor: { id: string; code: string; name: string };
  purchaseMode: PurchaseMode;
  destinations: SaleOrderDestinationView[];
  lines: SaleOrderLineView[];
}

export interface SaleOrderSummary extends VersionedResource {
  id: string;
  saleOrderNumber: string;
  /** Every Distributor represented in this Dispatch Order (Correction 8 — replaces the old singular `distributor`, which assumed exactly one Distributor per Dispatch Order). */
  distributors: Array<{ id: string; code: string; name: string; purchaseMode: PurchaseMode }>;
  factory: { id: string; code: string; name: string };
  financialYear: { id: string; code: string };
  soDate: string;
  status: SaleOrderStatus;
  destinationCount: number;
  totalQuantity: number;
  createdAt: string;
  /** Server-computed: true once the authoritative Factory Dispatch fact (a FactoryDispatch reaching READY_FOR_ERVE, or any ErveDispatch) exists — see isDispatchOrderLocked. No role, including ADMIN, may mutate a locked Dispatch Order. */
  isLocked: boolean;
}

export interface SaleOrderDetail extends SaleOrderSummary {
  creator: { id: string; name: string; email: string };
  remarks: string | null;
  /** Distributor -> destination -> line hierarchy (Correction 8 — replaces the old flat `destinations`/`lines`). */
  distributorGroups: SaleOrderDistributorGroupView[];
  lines: SaleOrderLineView[];
  fulfillment: DispatchOrderFulfillmentSummary;
}

// ---------------------------------------------------------------------------
// Fulfillment: Factory Packing -> Erve India Consolidation -> Distributor
// Dispatch (see the schema module doc for the full design), followed by the
// Dispatch -> Invoice/Tally reference handoff below. Tally remains the
// accounting system of record and sole generator of the actual invoice/
// e-invoice/e-way bill — these views only carry the reference Tally produces.
// ---------------------------------------------------------------------------

export type FactoryDispatchStatus = 'DRAFT' | 'READY_FOR_ERVE';
export type ErvePackingListStatus = 'OPEN' | 'FINALIZED' | 'DISPATCHED';
export type ErveDispatchStatus = 'DISPATCHED' | 'DELIVERED';
export type DeliveryConfirmationSource = 'USER_CONFIRMED' | 'LEGACY_ASSUMED_FULL_RECEIPT';

/** One Dispatch Order line a FACTORY_USER may pack, scoped to their own mapped Factory only — business-level (no StockAllocation/QaReleaseLine/Job Order exposed). */
export interface FactoryPackingQueueLine {
  saleOrderId: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  saleOrderLineId: string;
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
}

/** Phase 4: carton contents reference the stable Dispatch Order line directly — never a StockAllocation/FactoryDispatchLine id. */
export interface FactoryPackingCartonLineView {
  saleOrderLineId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
  /** The line's CURRENT destinationId — compare against the carton's own destinationId to detect a destination-move mismatch. */
  currentDestinationId: string;
}

export type PackingAuditState = 'NOT_INSPECTED' | 'INSPECTED' | 'NEEDS_REINSPECTION';

export interface PackingCartonAuditHistoryEntry {
  cartonVersion: number;
  inspectedById: string;
  inspectedByName: string;
  inspectedAt: string;
  remarks: string | null;
}

export interface FactoryPackingCartonView {
  id: string;
  cartonNumber: string;
  destinationId: string;
  packageDetails: string | null;
  weight: string | null;
  version: number;
  totalQuantity: number;
  destinationMismatch: boolean;
  auditState: PackingAuditState;
  retired: boolean;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: FactoryPackingCartonLineView[];
  auditHistory: PackingCartonAuditHistoryEntry[];
}

export interface PackingListLineView {
  saleOrderLineId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  requiredQuantity: number;
  packedQuantity: number;
}

export interface PackingListDestinationView extends SaleOrderDestinationView {
  /** Correction 8: which Distributor this destination belongs to — makes the owning Distributor obvious when selecting a destination for a carton (the carton itself never carries a distributor field, only destinationId). */
  distributor: { id: string; code: string; name: string };
  lines: PackingListLineView[];
  cartons: FactoryPackingCartonView[];
}

/** The Factory Packing List — Dispatch-Order-centric, readable before any FactoryDispatch exists (Phase 4). */
export interface PackingListView {
  saleOrderId: string;
  saleOrderNumber: string;
  /** Every Distributor represented in this Dispatch Order (Correction 8 — replaces the old singular `distributor`). Header-level summary only; per-destination ownership is on PackingListDestinationView. One FPL still mirrors the WHOLE Dispatch Order quantitatively, never split per Distributor. */
  distributors: Array<{ id: string; code: string; name: string }>;
  factory: { id: string; code: string; name: string };
  factoryDispatch:
    | { id: string; factoryDispatchNumber: string; status: FactoryDispatchStatus; version: number; factoryInvoiceId: string | null }
    | null;
  destinations: PackingListDestinationView[];
  retiredCartons: FactoryPackingCartonView[];
}

export interface FactoryDispatchSummary {
  id: string;
  factoryDispatchNumber: string;
  factory: { id: string; code: string; name: string };
  saleOrder: { id: string; saleOrderNumber: string; distributors: Array<{ id: string; code: string; name: string }> };
  status: FactoryDispatchStatus;
  version: number;
  preparedAt: string;
  finalizedAt: string | null;
  consolidated: boolean;
}

export interface FinalizeIssueLine {
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  required: number;
  packed: number;
}

export interface FinalizeIssueCarton {
  cartonId: string;
  cartonNumber: string;
  destinationId: string;
}

export interface FinalizeBlockers {
  cartonsNotAudited: FinalizeIssueCarton[];
  cartonsNeedingReinspection: FinalizeIssueCarton[];
  emptyCartons: FinalizeIssueCarton[];
  destinationMismatchCartons: FinalizeIssueCarton[];
  underPackedLines: FinalizeIssueLine[];
  overPackedLines: FinalizeIssueLine[];
  internalPackingMismatch: FinalizeIssueLine[];
}

// ---------------------------------------------------------------------------
// Factory Invoice — ERVE-generated payable document, one per finalized
// (READY_FOR_ERVE) Factory Packing List. No create endpoint: generated
// automatically the moment Factory Packing List finalization succeeds (see
// the API's factory-invoice.service.ts). Style/Size/Quantity are the
// finalized packing snapshot and are never independently editable through
// this API — see the confirm/financials/finalize actions below for exactly
// what each role may change.
// ---------------------------------------------------------------------------

export type FactoryInvoiceStatus = 'GENERATED' | 'FACTORY_CONFIRMED' | 'FINALIZED';

export interface FactoryInvoiceLineView {
  id: string;
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  /** Finalized physical packed quantity — read-only, never editable through this API. */
  quantity: number;
  /** Immutable snapshot of the Style<->Factory production rate used when the invoice was generated. */
  defaultRate: number;
  /** Current invoice rate — equal to defaultRate until an ACCOUNTANT overrides it post-Factory-confirmation. */
  unitRate: number;
  lineAmount: number;
}

export interface FactoryInvoiceView extends VersionedResource {
  id: string;
  status: FactoryInvoiceStatus;
  factory: { id: string; code: string; name: string };
  factoryDispatch: { id: string; factoryDispatchNumber: string };
  saleOrder: { id: string; saleOrderNumber: string };
  generatedAt: string;
  factoryConfirmedBy: { id: string; name: string; email: string } | null;
  factoryConfirmedAt: string | null;
  finalizedBy: { id: string; name: string; email: string } | null;
  finalizedAt: string | null;
  subtotal: number;
  gstAmount: number;
  total: number;
  remarks: string | null;
  lines: FactoryInvoiceLineView[];
  createdAt: string;
}

export interface PackingAuditQueueItem extends FactoryPackingCartonView {
  factoryDispatchNumber: string;
  factory: { id: string; code: string; name: string };
  saleOrder: { id: string; saleOrderNumber: string };
  /** Phase 5: Distributor/Destination context for the Packing Audit PDF — always present, both on the queue and (via `PackingAuditQueueItem & { factoryDispatchId }`) the carton detail endpoint. */
  destination: { id: string; label: string | null; city: string; state: string; distributor: { id: string; code: string; name: string } };
}

/** Phase 6: cartons individually selected for Erve consolidation, filterable/groupable client-side by factory/Dispatch Order/destination — never a StockAllocation/Job Order id (Phase 6 plan §7). */
export interface EligibleErveCartonView {
  id: string;
  cartonNumber: string;
  factory: { id: string; code: string; name: string };
  factoryDispatchId: string;
  factoryDispatchNumber: string;
  saleOrder: { id: string; saleOrderNumber: string };
  distributor: { id: string; code: string; name: string };
  destination: { id: string; label: string | null; city: string; state: string };
  packageDetails: string | null;
  weight: string | null;
  totalQuantity: number;
  lines: Array<{ saleOrderLineId: string; styleNumber: string; styleName: string; sizeCode: string; sizeLabel: string; quantity: number }>;
}

/** A carton consolidated into one Erve Packing List — the physical authority for the Consolidated Packing List (Phase 6 plan §7/§8). */
export interface ErvePackingListCartonView {
  id: string;
  cartonNumber: string;
  factory: { id: string; code: string; name: string };
  factoryDispatchId: string;
  factoryDispatchNumber: string;
  saleOrder: { id: string; saleOrderNumber: string };
  packageDetails: string | null;
  weight: string | null;
  totalQuantity: number;
  lines: Array<{ saleOrderLineId: string; styleNumber: string; styleName: string; sizeCode: string; sizeLabel: string; quantity: number }>;
}

export interface ErvePackingListDestinationSnapshot {
  label: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
}

export interface ErvePackingListStyleSizeSummaryRow {
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

/**
 * Erve India's destination-specific Consolidated Packing List (Phase 6).
 * saleOrder is legacy-only and may be null — a Consolidated Packing List may
 * now draw cartons from several Dispatch Orders, so sourceDispatchOrders
 * (derived from the selected cartons) is the general-purpose replacement.
 */
export interface ErvePackingListSummary {
  id: string;
  ervePackingListNumber: string;
  distributor: { id: string; code: string; name: string } | null;
  saleOrder: { id: string; saleOrderNumber: string } | null;
  destination: ErvePackingListDestinationSnapshot;
  status: ErvePackingListStatus;
  createdBy: { id: string; name: string; email: string };
  createdAt: string;
  cartonCount: number;
  totalQuantity: number;
  sourceFactories: Array<{ id: string; code: string; name: string }>;
  sourceDispatchOrders: Array<{ id: string; saleOrderNumber: string }>;
  dispatch: { id: string; erveDispatchNumber: string; status: ErveDispatchStatus } | null;
}

export interface ErvePackingListDetail extends ErvePackingListSummary {
  finalizedBy: { id: string; name: string; email: string } | null;
  finalizedAt: string | null;
  cartons: ErvePackingListCartonView[];
  styleSizeSummary: ErvePackingListStyleSizeSummaryRow[];
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
  saleOrder: { id: string; saleOrderNumber: string } | null;
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

// Dispatch Order Phase 3: a small set of discrete operational facts derived
// from FactoryDispatch/ErveDispatch state — never a percentage/remaining-
// balance computation (there is no partial-fulfilment lifecycle).
export type DispatchOrderFulfillmentStage =
  | 'AWAITING_PACKING'
  | 'PACKING_IN_PROGRESS'
  | 'FACTORY_DISPATCHED'
  | 'ERVE_DISPATCHED'
  | 'DELIVERED';

export interface DispatchOrderFulfillmentSummary {
  stage: DispatchOrderFulfillmentStage;
  totalQuantity: number;
  totalFactoryPackedQuantity: number;
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

// RequestableCatalogLine / EligibleStockLine / GlobalInventoryLine (retired,
// Dispatch Order Phase 3): all three were built on the legacy per-Order-
// Sheet Sale Order allocation bridge (QaReleaseLine.purchaseOrderLineSizeId)
// and are fully removed. PooledFactoryInventoryLine below is the sole
// inventory-availability read path for Dispatch Order creation/editing.

// Phase 2.1 target fact: QA-passed stock pooled by Factory + Style + Size
// only — never by Distributor/Order Sheet/Purchase Mode, and never
// requiring the caller to pick a specific Job Order. Aggregated across every
// Job Order (single- or multi-source) that released stock for that
// Factory+Style+Size combination.
export interface PooledFactoryInventoryLine {
  factoryId: string;
  factoryCode: string;
  factoryName: string;
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

// Phase 2.1: no purchaseOrderLineSizeId — the Job Order's production plan
// is independent of any source Order Sheet (see JobOrderSourceOrderSheet
// below for planning provenance, kept entirely separate).
export interface JobOrderLineSize {
  id: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
  preparedQuantity: number;
  varianceQuantity: number;
}
export interface JobOrderLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  status: JobOrderStatus;
  sizes: JobOrderLineSize[];
}

// One consolidated source Order Sheet feeding a Job Order's planning
// (Merchandising-only — see toJobOrderView). forecastBySize/forecastTotal
// are that Order Sheet's own demand/forecast, informational only: the Job
// Order's own production plan (JobOrderLine.sizes) is independently set.
export interface JobOrderSourceOrderSheet {
  id: string;
  poNumber: string;
  distributor: { id: string; code: string; name: string };
  purchaseMode: PurchaseMode;
  requiredDeliveryDate: string | null;
  styleId: string;
  forecastBySize: Array<{ sizeId: string; sizeCode: string; sizeLabel: string; orderedQuantity: number }>;
  forecastTotal: number;
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
  outcome?: {
    componentId: string;
    value: 'PASS' | 'FAIL';
    remarks?: string | null;
    rejectionReason?: string | null;
  } | null;
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
    rejectionReason: string | null;
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
  // never inherited from any source Order Sheet.
  financialYear: { id: string; code: string };
  factory: { id: string; code: string; name: string };
  unitPrice: number;
  status: JobOrderStatus;
  operationalState: JobOrderOperationalState;
  factoryConfirmationStatus: FactoryConfirmationStatus;
  // This Job Order's own production/delivery target date — independent of
  // any source Order Sheet's requiredDeliveryDate (Order Sheet Phase 2).
  requiredDeliveryDate: string | null;
  // Locked once factoryConfirmationStatus reaches CONFIRMED. Separate from
  // source Order Sheet mapping freeze, which happens earlier at
  // SENT_TO_FACTORY.
  deliveryDateLocked: boolean;
  // Derived, non-persisted: requiredDeliveryDate has passed (India business
  // date) while production is still open (before PRODUCTION_COMPLETE).
  // Informational only — never blocks workflow, never a lifecycle status.
  isDelayed: boolean;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  // How many source Order Sheets are consolidated into this Job Order.
  // Visible to every viewer (a bare count, no provenance); the itemized
  // list (sourceOrderSheets on JobOrderDetail) is Merchandising-only.
  sourceOrderSheetCount: number;
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
  // Merchandising planning provenance only — undefined for Factory/QA
  // viewers. Present (possibly empty only transiently) for ADMIN/
  // MERCHANDISER/SENIOR_MANAGEMENT viewers.
  sourceOrderSheets?: JobOrderSourceOrderSheet[];
  // Combined per-size forecast summed across sourceOrderSheets, for the
  // "Combined Forecast vs Job Order" planning display — Merchandising-only,
  // informational (never enforced against the Job Order's own quantities).
  combinedForecast?: Array<{
    sizeId: string;
    sizeCode: string;
    sizeLabel: string;
    forecastQuantity: number;
  }>;
  // Present only for recordOrigin=HISTORICAL_IMPORT rows (null for every
  // live Job Order): the real historical identity and business date, so the
  // UI can present the row as read-only historical evidence rather than as
  // live work awaiting factory confirmation.
  //
  // When this is non-null, the live-workflow fields factoryConfirmationStatus
  // (PENDING) and preparedQuantityTotal / per-size preparedQuantity (0) are
  // NON-AUTHORITATIVE schema defaults, not recorded facts: no factory
  // confirmation or prepared quantity exists for a historical import. Always
  // interpret them together with this marker — present them via the
  // @erve/app-components historical helpers ("Not recorded"), and never treat
  // such a row as active operational work (work queues filter
  // recordOrigin=LIVE_WORKFLOW).
  historicalImport?: {
    legacyReferenceNumber: string | null;
    historicalBusinessDate: string | null;
    importedAt: string | null;
  } | null;
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
  factory: { id: string; code: string; name: string };
  status: JobOrderStatus;
  operationalState: JobOrderOperationalState;
  currentStage: { id: string; sequence: number; name: string } | null;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  requiredDeliveryDate: string | null;
  isDelayed: boolean;
  actionRequired: boolean;
}

// The Job Order's own production plan (Phase 2.1) — one entry per Style
// size, entirely independent of any source Order Sheet's forecast.
export interface JobOrderPlanSizeInput {
  sizeId: string;
  quantity: number;
}
export interface CreateJobOrderInput {
  orderSheetIds: string[];
  factoryId: string;
  processFlowVersionId: string;
  unitPrice: string;
  disclaimerText?: string;
  // Required only when the selected Order Sheets have differing
  // requiredDeliveryDate values; otherwise defaults to their shared date.
  requiredDeliveryDate?: string | null;
  sizes: JobOrderPlanSizeInput[];
}
export interface VersionedMutationInput {
  expectedVersion: number;
}
export interface UpdateJobOrderDisclaimerInput extends VersionedMutationInput {
  disclaimerText?: string;
}
// DRAFT-only source Order Sheet mapping edit (Order Sheet Phase 2/2.1) — add
// and/or remove source Order Sheets in one atomic call. At least one of
// add/remove must be non-empty, and the Job Order must retain at least one
// source Order Sheet afterward. Pure planning provenance (Phase 2.1) — never
// carries production quantities; see UpdateJobOrderPlanInput for those.
export interface UpdateJobOrderSourcesInput extends VersionedMutationInput {
  add: string[];
  remove: string[];
}
// DRAFT-only Job Order production-plan edit (Phase 2.1).
export interface UpdateJobOrderPlanInput extends VersionedMutationInput {
  sizes: JobOrderPlanSizeInput[];
}
export interface UpdateJobOrderDeliveryDateInput extends VersionedMutationInput {
  requiredDeliveryDate: string | null;
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
