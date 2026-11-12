import type { RetailStoreInventoryMeasures } from '@erve/types';
import { formatQuantity, type InventoryFlag } from '../retail-store-inventory/measures.js';

// Sale-or-Return Stock (Style-first) - presentation rules for the measure rows.
// Quantities come from the API already finalized by the shared computeAvailability();
// nothing here re-derives a business number. `null` means "no evidence recorded" and
// is never rendered as 0.

export interface StockMeasureRow {
  key: string;
  label: string;
  /** Short explanation shown as a tooltip / for assistive tech. */
  help: string;
  /** What a null value means. */
  nullMeaning: string;
  group: 'dispatch' | 'evidence' | 'position';
  value: (m: RetailStoreInventoryMeasures) => number | null;
}

export const STOCK_MEASURE_ROWS: readonly StockMeasureRow[] = [
  {
    key: 'dispatched',
    label: 'Dispatched',
    help: 'Physical Erve Dispatch carton quantity.',
    nullMeaning: 'Not recorded',
    group: 'dispatch',
    value: (m) => m.shippedQuantity,
  },
  {
    key: 'ledger',
    label: 'Received ledger',
    help: 'The received quantity in use. Sales and Returns are limited by it.',
    nullMeaning: 'Not recorded: no received ledger yet',
    group: 'dispatch',
    value: (m) => m.ledgerQuantity,
  },
  {
    key: 'attested',
    label: 'Distributor-attested receipt',
    help: 'What the Distributor itself recorded as received. Separate evidence, not the ledger.',
    nullMeaning: 'Not recorded: no Distributor receipt yet',
    group: 'evidence',
    value: (m) => m.attestedReceivedQuantity,
  },
  {
    key: 'awaitingEvidence',
    label: 'Awaiting Distributor receipt',
    help: 'Dispatched quantity with no Distributor receipt recorded yet. Not "in transit".',
    nullMeaning: 'Not recorded',
    group: 'evidence',
    value: (m) => m.awaitingConfirmationQuantity,
  },
  {
    key: 'sold',
    label: 'Actual sold',
    help: 'Sold quantity reported by the Distributor.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.actualSoldQuantity ?? null,
  },
  {
    key: 'returned',
    label: 'Returned to Erve',
    help: 'Returns physically received by Erve.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.returnedQuantity ?? null,
  },
  {
    key: 'pending',
    label: 'Pending return requests',
    help: 'Return requests submitted and not yet approved or rejected.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.pendingRequestedQuantity ?? null,
  },
  {
    key: 'approved',
    label: 'Approved returns awaiting receipt',
    help: 'Approved Distributor Returns that Erve has not yet physically received. This is not incoming dispatch delivery.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.approvedAwaitingReceiptQuantity ?? null,
  },
  {
    key: 'remaining',
    label: 'Remaining with Distributor',
    help: 'Received ledger - actual sold - returned to Erve.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.remainingWithDistributor ?? null,
  },
  {
    key: 'availableSale',
    label: 'Available for actual sale',
    help: 'Remaining, less approved returns awaiting receipt.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.availableForActualSale ?? null,
  },
  {
    key: 'availableReturn',
    label: 'Available for new return',
    help: 'Available for actual sale, less pending return requests.',
    nullMeaning: 'Not available',
    group: 'position',
    value: (m) => m.saleReturn?.availableForNewReturn ?? null,
  },
];

export const GROUP_LABEL: Record<StockMeasureRow['group'], string> = {
  dispatch: 'Dispatch and received ledger',
  evidence: 'Distributor receipt evidence',
  position: 'Sale-or-Return position',
};

/** `n/r` is the on-screen form of "not recorded"; it is never a zero. */
export const NOT_RECORDED = 'n/r';
export const displayQuantity = (value: number | null): string => (value === null ? NOT_RECORDED : formatQuantity(value));

/** The compact figures shown on a Style / Distributor / Store row, in reading order. */
export const SUMMARY_STATS: ReadonlyArray<{ key: string; label: string; value: (m: RetailStoreInventoryMeasures) => number | null }> = [
  { key: 'dispatched', label: 'Dispatched', value: (m) => m.shippedQuantity },
  { key: 'ledger', label: 'Received ledger', value: (m) => m.ledgerQuantity },
  { key: 'sold', label: 'Sold', value: (m) => m.saleReturn?.actualSoldQuantity ?? null },
  { key: 'returned', label: 'Returned', value: (m) => m.saleReturn?.returnedQuantity ?? null },
  { key: 'remaining', label: 'Remaining', value: (m) => m.saleReturn?.remainingWithDistributor ?? null },
  { key: 'availableSale', label: 'Available to sell', value: (m) => m.saleReturn?.availableForActualSale ?? null },
];

/** Returns and receipt-evidence caveats that must stay visible next to a total. */
export function stockFlags(m: RetailStoreInventoryMeasures): InventoryFlag[] {
  const flags: InventoryFlag[] = [];
  const sr = m.saleReturn;
  if (sr && sr.pendingRequestedQuantity > 0) {
    flags.push({ key: 'pending', tone: 'info', text: `${formatQuantity(sr.pendingRequestedQuantity)} pcs in pending return requests` });
  }
  if (sr && sr.approvedAwaitingReceiptQuantity > 0) {
    flags.push({
      key: 'approved',
      tone: 'info',
      text: `${formatQuantity(sr.approvedAwaitingReceiptQuantity)} pcs in approved returns awaiting receipt`,
    });
  }
  if (m.awaitingConfirmationQuantity > 0) {
    flags.push({
      key: 'awaiting',
      tone: 'warning',
      text: `${formatQuantity(m.awaitingConfirmationQuantity)} pcs awaiting Distributor receipt evidence`,
    });
  }
  if ((m.shortageQuantity ?? 0) > 0) {
    flags.push({ key: 'shortage', tone: 'danger', text: `Shortage ${formatQuantity(m.shortageQuantity!)} pcs` });
  }
  if (m.discrepancySourceCount > 0) {
    flags.push({
      key: 'discrepancy',
      tone: 'danger',
      text: `Distributor receipt differs from the ledger in ${m.discrepancySourceCount} ${m.discrepancySourceCount === 1 ? 'source' : 'sources'}`,
    });
  }
  if (m.ledgerBySource.legacyAssumedFullReceipt > 0) {
    flags.push({
      key: 'legacy',
      tone: 'info',
      text: `Ledger includes ${formatQuantity(m.ledgerBySource.legacyAssumedFullReceipt)} pcs of legacy assumed receipt (not verified)`,
    });
  }
  return flags;
}
