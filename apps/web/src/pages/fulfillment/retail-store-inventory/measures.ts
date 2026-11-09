import type {
  RetailStoreInventoryLedgerSource,
  RetailStoreInventoryMeasures,
  RetailStoreInventoryPurchaseMode,
  RetailStoreInventorySaleReturnPosition,
} from '@erve/types';

// A6 / ISS-088 — presentation rules for the measure rows. `null` always means
// "no evidence recorded" and is never rendered as 0.

export type MeasureGroup = 'shipment' | 'saleReturn';

export interface MeasureRow {
  key: string;
  label: string;
  group: MeasureGroup;
  /** What a null value means, shown on hover/for assistive tech. */
  nullMeaning: string;
  value: (m: RetailStoreInventoryMeasures) => number | null;
}

export const SHIPMENT_ROWS: readonly MeasureRow[] = [
  {
    key: 'shipped',
    label: 'Shipped',
    group: 'shipment',
    nullMeaning: 'Not recorded',
    value: (m) => m.shippedQuantity,
  },
  {
    key: 'awaiting',
    label: 'Awaiting confirmation',
    group: 'shipment',
    nullMeaning: 'Not recorded',
    value: (m) => m.awaitingConfirmationQuantity,
  },
  {
    key: 'received',
    label: 'Distributor received',
    group: 'shipment',
    nullMeaning: 'Not recorded: no Distributor receipt yet',
    value: (m) => m.attestedReceivedQuantity,
  },
  {
    key: 'shortage',
    label: 'Shortage',
    group: 'shipment',
    nullMeaning: 'Not recorded: needs a Distributor receipt',
    value: (m) => m.shortageQuantity,
  },
  {
    key: 'ledger',
    label: 'Received ledger in use',
    group: 'shipment',
    nullMeaning: 'Not recorded: no received ledger',
    value: (m) => m.ledgerQuantity,
  },
];

export const SALE_RETURN_FIELDS: ReadonlyArray<readonly [string, keyof RetailStoreInventorySaleReturnPosition]> = [
  ['Actual sold', 'actualSoldQuantity'],
  ['Returned to Erve', 'returnedQuantity'],
  ['Approved returns awaiting receipt', 'approvedAwaitingReceiptQuantity'],
  ['Pending return requests', 'pendingRequestedQuantity'],
  ['Remaining with Distributor', 'remainingWithDistributor'],
  ['Available for actual sale', 'availableForActualSale'],
  ['Available for new return', 'availableForNewReturn'],
];

export const SALE_RETURN_ROWS: readonly MeasureRow[] = SALE_RETURN_FIELDS.map(([label, field]) => ({
  key: field,
  label,
  group: 'saleReturn' as const,
  nullMeaning: 'Not available',
  value: (m: RetailStoreInventoryMeasures) => m.saleReturn?.[field] ?? null,
}));

export function rowsFor(mode: RetailStoreInventoryPurchaseMode): readonly MeasureRow[] {
  return mode === 'SALE_RETURN' ? [...SHIPMENT_ROWS, ...SALE_RETURN_ROWS] : SHIPMENT_ROWS;
}

export const PURCHASE_MODE_LABEL: Record<RetailStoreInventoryPurchaseMode, string> = {
  SALE_RETURN: 'Sale-or-Return',
  OUTRIGHT: 'Outright',
};

export const OUTRIGHT_NOTE =
  'Retailer sell-through and live store on-hand are not available for Outright shipments; only shipment and receipt evidence is shown.';

export const ledgerSourceLabel = (source: RetailStoreInventoryLedgerSource | null): string => {
  switch (source) {
    case 'DISTRIBUTOR_CONFIRMED':
      return 'Distributor confirmation';
    case 'USER_CONFIRMED':
      return 'Admin / Merchandiser confirmation';
    case 'LEGACY_ASSUMED_FULL_RECEIPT':
      return 'Legacy assumed full receipt (assumption)';
    default:
      return 'Source not recorded';
  }
};

export const formatQuantity = (value: number): string => value.toLocaleString('en-IN');

export interface InventoryFlag {
  key: string;
  tone: 'warning' | 'danger' | 'info' | 'muted';
  text: string;
}

/** Evidence caveats worth surfacing next to a Style's numbers. Pure function of the measures. */
export function evidenceFlags(m: RetailStoreInventoryMeasures): InventoryFlag[] {
  const flags: InventoryFlag[] = [];
  if (m.awaitingConfirmationQuantity > 0) {
    flags.push({
      key: 'awaiting',
      tone: 'warning',
      text: `${formatQuantity(m.awaitingConfirmationQuantity)} pcs awaiting Distributor confirmation`,
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
  const bySource = m.ledgerBySource;
  if (bySource.legacyAssumedFullReceipt > 0) {
    flags.push({
      key: 'legacy',
      tone: 'info',
      text: `Ledger includes ${formatQuantity(bySource.legacyAssumedFullReceipt)} pcs of legacy assumed receipt (not verified)`,
    });
  }
  if (bySource.userConfirmed > 0) {
    flags.push({
      key: 'user',
      tone: 'info',
      text: `Ledger includes ${formatQuantity(bySource.userConfirmed)} pcs confirmed by Admin / Merchandiser`,
    });
  }
  if (bySource.unspecified > 0) {
    flags.push({
      key: 'unspecified',
      tone: 'muted',
      text: `Ledger includes ${formatQuantity(bySource.unspecified)} pcs with no recorded source`,
    });
  }
  return flags;
}
