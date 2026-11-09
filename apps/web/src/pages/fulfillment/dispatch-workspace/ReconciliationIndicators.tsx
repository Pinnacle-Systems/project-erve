import type { ReconciliationSummary } from '@erve/types';

export function ReconciliationIndicators({ summary: s }: { summary: ReconciliationSummary }) {
  const indicators = [
    s.awaitingReceipt && 'Awaiting distributor receipt',
    s.receiptMatchesLedger && 'Receipt matches ledger',
    s.receiptDiffers && 'Receipt differs from ledger',
    s.hasShortage && 'Distributor shortage',
    s.nothingReceived && 'Nothing received — final receipt',
    s.qrPending > 0 && 'QR delivery incomplete',
    s.downstreamActivity && 'Downstream activity exists',
    s.followUpRequired && 'Follow-up required',
  ].filter(Boolean);
  return (
    <ul className="flex flex-wrap gap-2 text-xs" aria-label="Reconciliation indicators">
      {indicators.map((text) => (
        <li key={String(text)} className="rounded border px-2 py-1">
          {text}
        </li>
      ))}
    </ul>
  );
}

export const ledgerSourceLabel = (source: string | null) =>
  source === 'LEGACY_ASSUMED_FULL_RECEIPT'
    ? 'Legacy assumed full receipt (assumption)'
    : source === 'USER_CONFIRMED'
      ? 'Admin / Merchandiser confirmation'
      : source === 'DISTRIBUTOR_CONFIRMED'
        ? 'Distributor confirmation'
        : 'No received ledger';
export const reviewActionLabel = (action: string | null) =>
  action === 'ACKNOWLEDGE'
    ? 'Acknowledged'
    : action === 'FOLLOW_UP'
      ? 'Operational follow-up'
      : action === 'FINANCE_REVIEW'
        ? 'Finance review'
        : 'Not reviewed';
