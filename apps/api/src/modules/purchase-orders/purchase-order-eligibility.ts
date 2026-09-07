import type { PurchaseOrderStatus } from '../../db/prisma.js';

// The single authoritative answer to "is this Purchase Order eligible to
// have new downstream commercial documents raised against it?" — used by
// Sale Order demand validation/catalog (sale-orders.service.ts,
// inventory.service.ts) ONLY. Job Order planning eligibility is a separate,
// dedicated predicate — isOrderSheetEligibleForJobOrder below — do not reuse
// this one for that purpose; an Order Sheet has no DRAFT/SUBMITTED
// distinction or remaining-balance concept, unlike this Sale-Order-facing
// eligibility rule.
//
// Every Order Sheet is created directly into SUBMITTED (there is no Draft ->
// Submit workflow — see purchase-orders.service.ts createPurchaseOrder).
// CANCELLED and CLOSED are terminal: the PO is void or done, so neither state
// should gain new demand. Every other status — SUBMITTED, UNDER_REVIEW,
// PARTIALLY_JOB_ORDERED, FULLY_JOB_ORDERED, PARTIALLY_FULFILLED,
// FULLY_FULFILLED — represents an active or historically-fulfilled
// commitment and stays eligible. (UNDER_REVIEW/PARTIALLY_JOB_ORDERED/
// FULLY_JOB_ORDERED/PARTIALLY_FULFILLED/FULLY_FULFILLED/CLOSED/DRAFT are
// legacy enum values no longer written by any service, kept only to avoid a
// destructive migration — see the Order Sheet rename plan.)
export const PURCHASE_ORDER_STATUSES_INELIGIBLE_FOR_DOWNSTREAM_DEMAND: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'CANCELLED',
  'CLOSED',
];

export function isPurchaseOrderEligibleForDownstreamDemand(status: PurchaseOrderStatus): boolean {
  return !PURCHASE_ORDER_STATUSES_INELIGIBLE_FOR_DOWNSTREAM_DEMAND.includes(status);
}

// Job Order planning eligibility for an Order Sheet — deliberately NOT the
// same predicate as isPurchaseOrderEligibleForDownstreamDemand above (that
// one stays Sale-Order/inventory-only; do not repurpose it for Job Order
// planning). An Order Sheet is no longer a downstream fulfilment anchor and
// has no DRAFT/SUBMITTED distinction or remaining-balance concept: it is
// eligible for Job Order planning whenever it is not cancelled and not
// already locked to a Job Order (`jobOrderId == null`), which the caller
// checks separately since it isn't part of PurchaseOrderStatus.
export function isOrderSheetEligibleForJobOrder(status: PurchaseOrderStatus): boolean {
  return status !== 'CANCELLED';
}
