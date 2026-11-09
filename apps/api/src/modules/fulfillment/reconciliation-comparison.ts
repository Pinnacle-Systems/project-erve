/** Difference is distributor evidence minus the ledger; missing is never zero. */
export function compareReconciliationLine(
  dispatched: number,
  received: number | null,
  ledger: number | null,
) {
  return {
    difference: received === null || ledger === null ? null : received - ledger,
    differs: received !== null && received !== ledger,
    shortageQuantity: received === null ? null : Math.max(0, dispatched - received),
  };
}
