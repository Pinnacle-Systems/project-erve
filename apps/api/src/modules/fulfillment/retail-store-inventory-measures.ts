import type {
  RetailStoreInventoryMeasures,
  RetailStoreInventoryPurchaseMode,
} from '@erve/types';
import { computeAvailability } from './sale-or-return-quantities.js';

// ---------------------------------------------------------------------------
// A6 / ISS-088 — pure translation of PostgreSQL-aggregated components into the
// public measures. The SQL layer only ever produces *additive* components, so
// the same RawComponents can be summed again here (Style card, Store total)
// and finalized by one function. Missing evidence is derived from the *counts*
// (attestedCount / ledgerCount), never from a zero sum.
//
// SALE_RETURN availability is NOT re-derived: it calls the shared
// computeAvailability(), the same function Sales Reports, Returns and the
// Sale-or-Return position use. That formula is linear, so applying it to the
// summed components equals summing the per-source availabilities. The "received"
// input is the received ledger in use (ErveDispatchDeliveryLine), exactly as
// those flows use it, with a missing ledger row counting as 0.
// ---------------------------------------------------------------------------

export interface RawInventoryComponents {
  sourceCount: number;
  shipped: number;
  awaiting: number;
  attestedShipped: number;
  attestedReceived: number;
  attestedCount: number;
  shortage: number;
  ledger: number;
  ledgerCount: number;
  ledgerDistributor: number;
  ledgerUser: number;
  ledgerLegacy: number;
  ledgerUnspecified: number;
  discrepancy: number;
  sold: number;
  returned: number;
  approved: number;
  pending: number;
}

export const EMPTY_COMPONENTS: RawInventoryComponents = {
  sourceCount: 0,
  shipped: 0,
  awaiting: 0,
  attestedShipped: 0,
  attestedReceived: 0,
  attestedCount: 0,
  shortage: 0,
  ledger: 0,
  ledgerCount: 0,
  ledgerDistributor: 0,
  ledgerUser: 0,
  ledgerLegacy: 0,
  ledgerUnspecified: 0,
  discrepancy: 0,
  sold: 0,
  returned: 0,
  approved: 0,
  pending: 0,
};

type Numeric = number | bigint | string | null | undefined;
const n = (value: Numeric): number => (value === null || value === undefined ? 0 : Number(value));

/** Raw `$queryRaw` aggregate row (snake_case aliases from SUMS_SQL) -> RawInventoryComponents. */
export function rawComponentsFromRow(row: Record<string, Numeric>): RawInventoryComponents {
  return {
    sourceCount: n(row.source_count),
    shipped: n(row.shipped),
    awaiting: n(row.awaiting),
    attestedShipped: n(row.attested_shipped),
    attestedReceived: n(row.attested_received),
    attestedCount: n(row.attested_count),
    shortage: n(row.shortage),
    ledger: n(row.ledger),
    ledgerCount: n(row.ledger_count),
    ledgerDistributor: n(row.ledger_distributor),
    ledgerUser: n(row.ledger_user),
    ledgerLegacy: n(row.ledger_legacy),
    ledgerUnspecified: n(row.ledger_unspecified),
    discrepancy: n(row.discrepancy),
    sold: n(row.sold),
    returned: n(row.returned),
    approved: n(row.approved),
    pending: n(row.pending),
  };
}

export function addComponents(
  a: RawInventoryComponents,
  b: RawInventoryComponents,
): RawInventoryComponents {
  const out = { ...a };
  for (const key of Object.keys(b) as Array<keyof RawInventoryComponents>) out[key] += b[key];
  return out;
}

export function toMeasures(
  raw: RawInventoryComponents,
  purchaseMode: RetailStoreInventoryPurchaseMode,
): RetailStoreInventoryMeasures {
  const hasAttestation = raw.attestedCount > 0;
  let saleReturn: RetailStoreInventoryMeasures['saleReturn'] = null;
  if (purchaseMode === 'SALE_RETURN') {
    const availability = computeAvailability({
      receivedQuantity: raw.ledger,
      actualSoldQuantity: raw.sold,
      returnedQuantity: raw.returned,
      approvedAwaitingReceiptQuantity: raw.approved,
      pendingRequestedQuantity: raw.pending,
    });
    saleReturn = {
      actualSoldQuantity: raw.sold,
      returnedQuantity: raw.returned,
      approvedAwaitingReceiptQuantity: raw.approved,
      pendingRequestedQuantity: raw.pending,
      ...availability,
    };
  }
  return {
    sourceCount: raw.sourceCount,
    shippedQuantity: raw.shipped,
    awaitingConfirmationQuantity: raw.awaiting,
    attestedShippedQuantity: raw.attestedShipped,
    attestedReceivedQuantity: hasAttestation ? raw.attestedReceived : null,
    shortageQuantity: hasAttestation ? raw.shortage : null,
    ledgerQuantity: raw.ledgerCount > 0 ? raw.ledger : null,
    ledgerBySource: {
      distributorConfirmed: raw.ledgerDistributor,
      userConfirmed: raw.ledgerUser,
      legacyAssumedFullReceipt: raw.ledgerLegacy,
      unspecified: raw.ledgerUnspecified,
    },
    discrepancySourceCount: raw.discrepancy,
    saleReturn,
  };
}
