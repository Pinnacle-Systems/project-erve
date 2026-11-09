import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  ReconciliationDetail,
  ReconciliationLine,
  ReconciliationReviewAction,
} from '@erve/types';
import { canReviewReconciliation, canViewReconciliation } from '@erve/shared';
import { Panel } from '@erve/layout';
import { Button } from '@erve/primitives';
import { LoadingState, ErrorState } from '@erve/data-display';
import { useAuth } from '../../../auth/AuthContext.js';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import {
  ReconciliationIndicators,
  ledgerSourceLabel,
  reviewActionLabel,
} from './ReconciliationIndicators.js';

const quantity = (n: number | null) => (n === null ? 'Not recorded' : n.toLocaleString('en-IN'));
const time = (value: string) =>
  new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

export function DispatchReconciliationTab({ dispatchId }: { dispatchId: string }) {
  const { user } = useAuth();
  const allowed = Boolean(user && canViewReconciliation(user));
  const query = useQuery({
    queryKey: ['dispatch-reconciliation', dispatchId],
    enabled: allowed,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<ReconciliationDetail>>(
          `/erve-dispatches/${dispatchId}/reconciliation`,
        )
      ).data.data,
  });
  if (!allowed) return <ErrorState title="Reconciliation access unavailable" />;
  if (query.isPending) return <LoadingState />;
  if (!query.data)
    return (
      <ErrorState
        title="Unable to load reconciliation"
        description={getApiErrorMessage(query.error, 'Unable to load reconciliation')}
      />
    );
  return (
    <>
      {query.isError && (
        <p role="alert">
          Unable to load reconciliation updates.{' '}
          {getApiErrorMessage(query.error, 'Refresh failed.')} The last loaded comparison and your
          remarks are retained.
        </p>
      )}
      <ReconciliationContent
        key={dispatchId}
        detail={query.data}
        refresh={async () => !(await query.refetch()).isError}
      />
    </>
  );
}

function ReconciliationContent({
  detail: d,
  refresh,
}: {
  detail: ReconciliationDetail;
  refresh: () => Promise<boolean>;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const actions = (['ACKNOWLEDGE', 'FOLLOW_UP', 'FINANCE_REVIEW'] as const).filter(
    (a) => user && canReviewReconciliation(user, a),
  );
  const [action, setAction] = useState<ReconciliationReviewAction>(actions[0] ?? 'FINANCE_REVIEW');
  const [remarks, setRemarks] = useState('');
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.post(`/erve-dispatches/${d.summary.id}/reconciliation/reviews`, {
        action,
        remarks: remarks.trim(),
        snapshotToken: d.summary.snapshotToken,
        previousReviewId: d.summary.latestReviewId,
      }),
    onSuccess: async () => {
      setRemarks('');
      setSaved(true);
      await refresh();
      await client.invalidateQueries({ queryKey: ['post-dispatch-reconciliation'] });
    },
    onError: () => setStale(true),
  });
  const groups = new Map<string, ReconciliationLine[]>();
  for (const line of d.lines) {
    const key = `${line.styleId}:${line.sizeId}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return (
    <div className="min-w-0 space-y-4">
      <Panel title="Physical Dispatch summary">
        <p>
          {d.summary.dispatchedQuantity.toLocaleString()} dispatched · {d.summary.cartonCount}{' '}
          physical cartons
        </p>
        <ReconciliationIndicators summary={d.summary} />
        <p className="mt-2 text-sm">
          Reconciliation is an operational review. Acknowledging or reviewing a discrepancy does not
          correct quantities or financial records.
        </p>
      </Panel>
      <Panel title="QR carton delivery evidence">
        <p>
          {d.summary.qrConfirmed} / {d.summary.cartonCount} confirmed · {d.summary.qrPending}{' '}
          pending
        </p>
        <p className="text-sm">
          A QR confirmation records physical delivery, not accepted Style × Size quantities. Missing
          QR confirmation does not establish a shortage; full QR confirmation does not establish
          distributor receipt.
        </p>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {d.cartons.map((c) => (
            <li key={c.id} className="break-words rounded border p-2">
              Carton {c.cartonNumber}: {c.confirmedAt ? time(c.confirmedAt) : 'QR pending'}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Distributor actual receipt">
        {d.receipt ? (
          <>
            <p>
              Final received quantity: {quantity(d.summary.receivedQuantity)} · shortage:{' '}
              {quantity(d.summary.shortageQuantity)}
            </p>
            <p className="text-sm">
              {d.receipt.receivedBy} · {time(d.receipt.receivedAt)}
            </p>
            <p className="whitespace-pre-wrap break-words">{d.receipt.remarks}</p>
          </>
        ) : (
          <p>Awaiting distributor receipt. No A4 attestation exists.</p>
        )}
        <p className="mt-2 text-sm">
          {d.summary.ledgerDisposition === 'APPLIED'
            ? 'A4 quantities became the existing downstream ledger.'
            : d.summary.ledgerDisposition === 'EVIDENCE_ONLY_EXISTING'
              ? 'The earlier received ledger remains authoritative for downstream calculations.'
              : d.summary.ledgerDisposition === 'NOT_APPLIED_ZERO'
                ? 'Final all-zero evidence. No received ledger was applied; Dispatch remains Dispatched.'
                : 'Dispatched quantities are not proof of receipt.'}
        </p>
      </Panel>
      <Panel title="Existing received-quantity ledger">
        <p>
          {ledgerSourceLabel(d.summary.ledgerSource)} · {quantity(d.summary.ledgerQuantity)}
        </p>
        <p className="text-sm">
          {d.ledger.recordedBy ?? 'Actor not recorded'}
          {d.ledger.recordedAt && ` · ${time(d.ledger.recordedAt)}`}
        </p>
        <p className="whitespace-pre-wrap break-words">{d.ledger.remarks}</p>
        {d.receipt?.priorSource && (
          <p className="text-sm">
            Prior receipt basis: {ledgerSourceLabel(d.receipt.priorSource)}.{' '}
            {d.receipt.priorRemarks}
          </p>
        )}
      </Panel>
      <Panel title="Style × Size comparison and shortages" padding="sm">
        <p className="mb-3 text-sm">
          Difference = Distributor Received − Ledger in Use. “Not recorded” is missing evidence, not
          zero. Source-line differences remain visible even when group totals agree.
        </p>
        <div className="space-y-4">
          {[...groups.entries()].map(([key, lines]) => (
            <ComparisonGroup key={key} lines={lines} showDiscrepancy={d.summary.receiptDiffers} />
          ))}
        </div>
      </Panel>
      <Panel title="Downstream Sales / Returns exposure">
        <p className="mb-2 text-sm">
          Existing ledger quantities continue to drive Actual Sales and Returns. Available
          quantities below use the shared Sale-or-Return calculation. Invoice, tax, commercial or
          stock adjustments require a separately approved correction workflow.
        </p>
        {d.summary.followUpRequired && (
          <p className="font-medium">
            Follow-up required — supporting quantities are preserved; no correction has been made.
          </p>
        )}
        {d.lines.map((l) => (
          <div key={l.saleOrderLineId} className="mt-2 rounded border p-2 text-sm">
            <p className="break-words">
              {l.styleNumber} / {l.sizeLabel} · {l.saleOrderNumber} · {l.purchaseMode}
            </p>
            <p>
              Actual Sales {l.actualSoldQuantity} · Returned {l.returnedQuantity} · Approved
              awaiting receipt {l.approvedAwaitingReceiptQuantity} · Pending requests{' '}
              {l.pendingRequestedQuantity}
            </p>
            {l.purchaseMode === 'SALE_RETURN' && (
              <p>
                Available for Actual Sale {l.availableForActualSale} · Available for new Return{' '}
                {l.availableForNewReturn}
              </p>
            )}
          </div>
        ))}
      </Panel>
      <Panel title="Internal reconciliation review history">
        <p className="text-sm">
          {d.summary.pendingReview
            ? 'Pending review of current evidence'
            : 'Current evidence reviewed'}{' '}
          · {reviewActionLabel(d.summary.latestReviewAction)}. Review notes never change quantities.
        </p>
        {d.reviews.length === 0 && <p>No reviews recorded.</p>}
        <ol className="space-y-3">
          {d.reviews.map((r) => (
            <li key={r.id} className="mt-2 rounded border p-3">
              <p>
                {reviewActionLabel(r.action)} · {r.actor.name} · {time(r.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words">{r.remarks}</p>
              <details className="mt-2 text-sm">
                <summary>Observed reconciliation snapshot</summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(r.snapshot, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
        {actions.length > 0 && (
          <form
            className="mt-4 space-y-3"
            aria-label="Record reconciliation review"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!stale && !mutation.isPending && remarks.trim()) {
                setSaved(false);
                mutation.mutate();
              }
            }}
          >
            <label className="block">
              Review action
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                value={action}
                onChange={(e) => setAction(e.target.value as ReconciliationReviewAction)}
              >
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {reviewActionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Review remarks (required)
              <textarea
                required
                maxLength={2000}
                className="mt-1 block w-full rounded border bg-background p-2"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </label>
            {mutation.isError && (
              <p role="alert">{getApiErrorMessage(mutation.error, 'Unable to record review')}</p>
            )}
            {stale && (
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if (await refresh()) setStale(false);
                }}
              >
                Refresh comparison before retrying
              </Button>
            )}
            <Button type="submit" disabled={stale || mutation.isPending || !remarks.trim()}>
              Record review
            </Button>
            {saved && (
              <p role="status">Review recorded. No quantities or financial records changed.</p>
            )}
          </form>
        )}
      </Panel>
    </div>
  );
}

function ComparisonGroup({
  lines,
  showDiscrepancy,
}: {
  lines: ReconciliationLine[];
  showDiscrepancy: boolean;
}) {
  const sum = (
    key:
      | 'dispatchedQuantity'
      | 'receivedQuantity'
      | 'ledgerQuantity'
      | 'difference'
      | 'shortageQuantity',
  ) => (lines.every((l) => l[key] !== null) ? lines.reduce((n, l) => n + l[key]!, 0) : null);
  const first = lines[0]!;
  return (
    <section className="min-w-0 rounded border p-2">
      <h3 className="break-words font-medium">
        {first.styleNumber} — {first.styleName} / {first.sizeLabel}
      </h3>
      {showDiscrepancy && lines.some((l) => l.differs) && (
        <p className="text-sm font-medium">Source-line receipt / ledger discrepancy</p>
      )}
      <QuantityRow
        dispatched={sum('dispatchedQuantity')}
        received={sum('receivedQuantity')}
        ledger={sum('ledgerQuantity')}
        difference={sum('difference')}
        shortage={sum('shortageQuantity')}
      />
      {lines.map((l) => (
        <details
          key={l.saleOrderLineId}
          className="mt-2 border-t pt-2 text-sm"
          open={lines.length > 1}
        >
          <summary className="break-words">
            {l.saleOrderNumber} · {l.purchaseMode} · source {l.saleOrderLineId}
          </summary>
          <QuantityRow
            dispatched={l.dispatchedQuantity}
            received={l.receivedQuantity}
            ledger={l.ledgerQuantity}
            difference={l.difference}
            shortage={l.shortageQuantity}
          />
        </details>
      ))}
    </section>
  );
}

function QuantityRow({
  dispatched,
  received,
  ledger,
  difference,
  shortage,
}: {
  dispatched: number | null;
  received: number | null;
  ledger: number | null;
  difference: number | null;
  shortage: number | null;
}) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
      {[
        ['Dispatched', dispatched],
        ['Distributor Received', received],
        ['Ledger in Use', ledger],
        ['Difference', difference],
        ['Shortage', shortage],
      ].map(([label, value]) => (
        <div key={String(label)} className="min-w-0 rounded bg-muted p-2">
          <dt className="break-words">{label}</dt>
          <dd className="font-medium tabular-nums">{quantity(value as number | null)}</dd>
        </div>
      ))}
    </dl>
  );
}
