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
  SourceLinesDisclosure,
  StyleSizeMetricMatrix,
  type StyleSizeMetric,
} from '../../../components/style-size-grid/StyleSizeMetricMatrix.js';
import { groupSourceLinesByStyle, type StyleSizeMatrixRowModel } from '../style-size-grouping.js';
import {
  ReconciliationIndicators,
  ledgerSourceLabel,
  reviewActionLabel,
} from './ReconciliationIndicators.js';

const quantity = (n: number | null) => (n === null ? 'Not recorded' : n.toLocaleString('en-IN'));
const NOT_RECORDED = 'Not recorded';
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
  // One Style row per Style (a Dispatch is the single context here). Source lines — one per Sale
  // Order line — are never merged: each stays listed under its Style with its own figures.
  const matrix = groupSourceLinesByStyle(d.lines);
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
        <StyleSizeMetricMatrix
          label="Style and Size comparison and shortages"
          columns={matrix.columns}
          rows={matrix.rows}
          metrics={comparisonMetrics}
          detail={(row) => (
            <SourceLineDetail
              row={row}
              summary="Source lines"
              showDiscrepancy={d.summary.receiptDiffers}
              figures={(l) =>
                `Dispatched ${quantity(l.dispatchedQuantity)} · Distributor Received ${quantity(l.receivedQuantity)} · Ledger in Use ${quantity(l.ledgerQuantity)} · Difference ${quantity(l.difference)} · Shortage ${quantity(l.shortageQuantity)}`
              }
            />
          )}
        />
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
        <StyleSizeMetricMatrix
          label="Downstream Sales and Returns exposure by Style and Size"
          columns={matrix.columns}
          rows={matrix.rows}
          metrics={exposureMetrics}
          detail={(row) => (
            <SourceLineDetail
              row={row}
              summary="Source orders"
              figures={(l) =>
                `Actual Sales ${l.actualSoldQuantity} · Returned ${l.returnedQuantity} · Approved awaiting receipt ${l.approvedAwaitingReceiptQuantity} · Pending requests ${l.pendingRequestedQuantity}` +
                (l.purchaseMode === 'SALE_RETURN'
                  ? ` · Available for Actual Sale ${l.availableForActualSale} · Available for new Return ${l.availableForNewReturn}`
                  : '')
              }
            />
          )}
        />
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

/**
 * `null` = the evidence is absent ("Not recorded"), which is NOT a recorded zero; a Style / Size
 * with any unrecorded source line therefore shows "Not recorded" for the aggregate too.
 */
const comparisonMetrics: StyleSizeMetric<ReconciliationLine>[] = [
  { key: 'dispatched', label: 'Dispatched', value: (l) => l.dispatchedQuantity, missingLabel: NOT_RECORDED },
  { key: 'received', label: 'Distributor Received', value: (l) => l.receivedQuantity, missingLabel: NOT_RECORDED },
  { key: 'ledger', label: 'Ledger in Use', value: (l) => l.ledgerQuantity, missingLabel: NOT_RECORDED },
  { key: 'difference', label: 'Difference', value: (l) => l.difference, missingLabel: NOT_RECORDED },
  {
    key: 'shortage',
    label: 'Shortage',
    value: (l) => l.shortageQuantity,
    missingLabel: NOT_RECORDED,
    tone: (total) => (total > 0 ? 'danger' : undefined),
  },
];

/** Available-to-sell / return quantities only exist for Sale-or-Return source lines (`null` = not applicable). */
const exposureMetrics: StyleSizeMetric<ReconciliationLine>[] = [
  { key: 'sold', label: 'Actual Sales', value: (l) => l.actualSoldQuantity },
  { key: 'returned', label: 'Returned', value: (l) => l.returnedQuantity },
  { key: 'awaiting', label: 'Approved Awaiting Receipt', value: (l) => l.approvedAwaitingReceiptQuantity },
  { key: 'pending', label: 'Pending Requests', value: (l) => l.pendingRequestedQuantity },
  { key: 'availableSale', label: 'Available for Actual Sale', value: (l) => l.availableForActualSale ?? undefined },
  { key: 'availableReturn', label: 'Available for New Return', value: (l) => l.availableForNewReturn ?? undefined },
];

/**
 * Per-source-line drilldown under a Style block: every Sale Order line keeps its own figures and
 * attribution (order, purchase mode, source id), so an aggregated Style total can never hide a
 * source-line discrepancy. Opened automatically when a Style / Size has several sources or differs.
 */
function SourceLineDetail({
  row,
  summary,
  figures,
  showDiscrepancy = false,
}: {
  row: StyleSizeMatrixRowModel<ReconciliationLine>;
  summary: string;
  figures: (line: ReconciliationLine) => string;
  showDiscrepancy?: boolean;
}) {
  const differs = showDiscrepancy && row.sources.some((l) => l.differs);
  const split = Object.values(row.sourcesBySize).some((sources) => sources.length > 1);
  return (
    <>
      {differs && <p className="text-sm font-medium">Source-line receipt / ledger discrepancy</p>}
      <SourceLinesDisclosure summary={`${summary} (${row.sources.length})`} open={differs || split}>
        <ul className="space-y-1">
          {row.sources.map((l) => (
            <li key={l.saleOrderLineId} className="min-w-0 break-words border-t pt-1">
              <span className="font-medium">{l.sizeLabel}</span> · {l.saleOrderNumber} · {l.purchaseMode} · source{' '}
              {l.saleOrderLineId}
              <div className="text-muted-foreground">{figures(l)}</div>
            </li>
          ))}
        </ul>
      </SourceLinesDisclosure>
    </>
  );
}
