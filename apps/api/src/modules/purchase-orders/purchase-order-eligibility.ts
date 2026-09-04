import type { PurchaseOrderStatus } from '../../db/prisma.js';

// The single authoritative answer to "is this Purchase Order eligible to
// have new downstream commercial documents raised against it?" — shared by
// every module that references a DistributorPurchaseOrderLineSize (today:
// Sale Order demand validation/catalog in sale-orders; job-orders.service.ts
// enforces the identical DRAFT/CANCELLED/CLOSED exclusion inline for Job
// Order creation, see updatePurchaseOrderJobOrderedStatus/createJobOrder).
//
// DRAFT is not yet a confirmed commercial commitment — submitPurchaseOrder
// requires it move to SUBMITTED before anything downstream may reference it.
// CANCELLED and CLOSED are terminal: the PO is void or done, and cancelling
// already requires zero job-ordered quantity (see cancelPurchaseOrder), so
// neither state should gain new demand. Every other status — SUBMITTED,
// UNDER_REVIEW, PARTIALLY_JOB_ORDERED, FULLY_JOB_ORDERED,
// PARTIALLY_FULFILLED, FULLY_FULFILLED — represents an active or
// historically-fulfilled commitment and stays eligible.
export const PURCHASE_ORDER_STATUSES_INELIGIBLE_FOR_DOWNSTREAM_DEMAND: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'CANCELLED',
  'CLOSED',
];

export function isPurchaseOrderEligibleForDownstreamDemand(status: PurchaseOrderStatus): boolean {
  return !PURCHASE_ORDER_STATUSES_INELIGIBLE_FOR_DOWNSTREAM_DEMAND.includes(status);
}
