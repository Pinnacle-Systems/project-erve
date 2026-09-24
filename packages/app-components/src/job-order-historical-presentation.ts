// Presentation rules for recordOrigin=HISTORICAL_IMPORT Job Orders (the API
// marks those rows with a non-null `historicalImport`; it is null/absent for
// every LIVE_WORKFLOW Job Order).
//
// A historical import is read-only source evidence. It never passed through
// the live factory-confirmation workflow, and no prepared quantity was
// recorded for it, so its raw factoryConfirmationStatus (PENDING) and
// preparedQuantityTotal (0) are placeholders, not facts. Showing them would
// read as "confirmation still outstanding" and "nothing was prepared".
// "Not recorded" (unknown) is deliberately distinct from a recorded 0.
// Live Job Orders keep their existing presentation unchanged.

export const NOT_RECORDED_LABEL = 'Not recorded';
export const NOT_APPLICABLE_LABEL = 'Not applicable';

export interface HistoricalAwareJobOrder {
  historicalImport?: unknown;
}

export function isHistoricalImportJobOrder(jobOrder: HistoricalAwareJobOrder): boolean {
  return jobOrder.historicalImport !== null && jobOrder.historicalImport !== undefined;
}

/**
 * The prepared quantity as a recorded fact, or null when none was recorded.
 * Historical imports carry no prepared quantity today. If the model later
 * records a source-backed historical prepared quantity, return it here and
 * every caller will show it instead of "Not recorded".
 */
export function getRecordedPreparedQuantity(
  jobOrder: HistoricalAwareJobOrder,
  preparedQuantity: number,
): number | null {
  return isHistoricalImportJobOrder(jobOrder) ? null : preparedQuantity;
}

/** "Not recorded" for a historical import; otherwise the live value, formatted exactly as before. */
export function formatPreparedQuantity(jobOrder: HistoricalAwareJobOrder, preparedQuantity: number): string {
  const recorded = getRecordedPreparedQuantity(jobOrder, preparedQuantity);
  return recorded === null ? NOT_RECORDED_LABEL : recorded.toLocaleString();
}

/** Variance only exists against a recorded prepared quantity. */
export function formatPreparedVariance(
  jobOrder: HistoricalAwareJobOrder,
  preparedQuantity: number,
  orderedQuantity: number,
): string {
  const recorded = getRecordedPreparedQuantity(jobOrder, preparedQuantity);
  return recorded === null ? NOT_APPLICABLE_LABEL : (recorded - orderedQuantity).toLocaleString();
}
