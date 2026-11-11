// ---------------------------------------------------------------------------
// ISS-089 — pure FIFO allocation rules for Store-level "Report Sold" / "Request Return".
//
// No database access here. The service loads the candidate source positions
// (erveDispatchId, saleOrderLineId) of one Retail Store x Style x Size cell and
// their authoritative available quantities, and this module decides which are
// eligible and how a requested quantity is split across them.
//
// FIFO is a *source-allocation convention*: it fixes which original Dispatch
// position a reported quantity is booked against. It is not evidence of which
// physical garment was sold.
// ---------------------------------------------------------------------------

export type FifoPurchaseMode = 'SALE_RETURN' | 'OUTRIGHT';
export type FifoConfirmationSource = 'USER_CONFIRMED' | 'LEGACY_ASSUMED_FULL_RECEIPT' | 'DISTRIBUTOR_CONFIRMED' | null;

export interface FifoCandidate {
  erveDispatchId: string;
  erveDispatchNumber: string;
  saleOrderLineId: string;
  purchaseMode: FifoPurchaseMode;
  dispatchStatus: string;
  /** ErveDispatch.deliveredAt: the receipt timestamp, null on legacy-backfilled Dispatches. */
  deliveredAt: Date | null;
  confirmationSource: FifoConfirmationSource;
}

export type FifoIneligibleReason = 'OUTRIGHT' | 'UNVERIFIED_RECEIPT' | 'RECEIVED_AFTER_DATE';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The calendar date (YYYY-MM-DD) of an instant in India Standard Time (no DST). */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Verified receipt = a real person confirmed delivery and the timestamp was recorded. Legacy assumptions never qualify. */
export function hasVerifiedReceipt(c: FifoCandidate): boolean {
  return (
    c.dispatchStatus === 'DELIVERED' &&
    c.deliveredAt !== null &&
    (c.confirmationSource === 'USER_CONFIRMED' || c.confirmationSource === 'DISTRIBUTOR_CONFIRMED')
  );
}

export function classifyCandidate(c: FifoCandidate, asOfDate: string): FifoIneligibleReason | null {
  if (c.purchaseMode !== 'SALE_RETURN') return 'OUTRIGHT';
  if (!hasVerifiedReceipt(c)) return 'UNVERIFIED_RECEIPT';
  // Stock received after the reporting/return date cannot have been sold/returned on it.
  if (istDateOf(c.deliveredAt!) > asOfDate) return 'RECEIVED_AFTER_DATE';
  return null;
}

export function pairKey(c: { erveDispatchId: string; saleOrderLineId: string }): string {
  return `${c.erveDispatchId}:${c.saleOrderLineId}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest verified receipt first; ties broken by Dispatch number, Dispatch id, Sale Order line id. */
export function compareFifo(a: FifoCandidate, b: FifoCandidate): number {
  return (
    (a.deliveredAt?.getTime() ?? 0) - (b.deliveredAt?.getTime() ?? 0) ||
    compareText(a.erveDispatchNumber, b.erveDispatchNumber) ||
    compareText(a.erveDispatchId, b.erveDispatchId) ||
    compareText(a.saleOrderLineId, b.saleOrderLineId)
  );
}

export interface FifoPartition {
  eligible: FifoCandidate[];
  outright: FifoCandidate[];
  unverified: FifoCandidate[];
  afterDate: FifoCandidate[];
}

export function partitionCandidates(candidates: FifoCandidate[], asOfDate: string): FifoPartition {
  const out: FifoPartition = { eligible: [], outright: [], unverified: [], afterDate: [] };
  for (const c of candidates) {
    const reason = classifyCandidate(c, asOfDate);
    if (reason === null) out.eligible.push(c);
    else if (reason === 'OUTRIGHT') out.outright.push(c);
    else if (reason === 'UNVERIFIED_RECEIPT') out.unverified.push(c);
    else out.afterDate.push(c);
  }
  out.eligible.sort(compareFifo);
  return out;
}

export interface FifoAllocation {
  candidate: FifoCandidate;
  quantity: number;
}

/**
 * Splits `quantity` across the eligible candidates, oldest first. `available` is the authoritative
 * per-position quantity (availableForActualSale for a sale, availableForNewReturn for a return).
 * Never allocates more than a position has, never allocates a non-positive amount.
 */
export function allocateFifo(
  eligibleOldestFirst: Array<{ candidate: FifoCandidate; available: number }>,
  quantity: number,
): { allocations: FifoAllocation[]; shortfall: number; totalAvailable: number } {
  let remaining = quantity;
  let totalAvailable = 0;
  const allocations: FifoAllocation[] = [];
  for (const { candidate, available } of eligibleOldestFirst) {
    const usable = Math.max(0, available);
    totalAvailable += usable;
    if (remaining <= 0 || usable === 0) continue;
    const take = Math.min(usable, remaining);
    allocations.push({ candidate, quantity: take });
    remaining -= take;
  }
  return { allocations, shortfall: Math.max(0, remaining), totalAvailable };
}
