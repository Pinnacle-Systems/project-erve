import type { SaleOrderStatus } from '../../db/prisma.js';

// Sale Order statuses that represent active/open downstream demand against
// a Purchase Order, shared by cancelPurchaseOrder (purchase-orders.service.ts,
// which must refuse to cancel a PO while one of these references it) and any
// future caller needing the same classification.
//
// DRAFT is excluded: a draft line never carries a StockAllocation (those are
// only created at submit — see submitSaleOrder — or approval), so it is
// purely local, uncommitted user input with no downstream effect yet.
// REJECTED and CANCELLED are excluded: both are terminal, and both release
// every active allocation back to availability (see
// releaseAllActiveAllocations in sale-orders.service.ts) as part of the
// transition into them. SUBMITTED and UNDER_REVIEW carry an opportunistic
// DISTRIBUTOR_REQUEST reservation and represent demand still awaiting a
// Merchandiser decision; APPROVED is a committed reservation. All three
// must block the Purchase Order they reference from being cancelled out
// from under them.
export const SALE_ORDER_STATUSES_BLOCKING_PO_CANCELLATION: readonly SaleOrderStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
];

export function isSaleOrderStatusBlockingPurchaseOrderCancellation(status: SaleOrderStatus): boolean {
  return SALE_ORDER_STATUSES_BLOCKING_PO_CANCELLATION.includes(status);
}
