import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { canViewReconciliation } from '@erve/shared';
import type { ApiSuccessResponse, ReconciliationQueue } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { Button } from '@erve/primitives';
import { LoadingState, ErrorState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import {
  ReconciliationIndicators,
  ledgerSourceLabel,
  reviewActionLabel,
} from './dispatch-workspace/ReconciliationIndicators.js';
import {
  DistributorLookupField,
  type DistributorLookupValue,
} from '../master-data/DistributorLookupField.js';

const showQuantity = (n: number | null) =>
  n === null ? 'Not recorded' : n.toLocaleString('en-IN');

export function PostDispatchReconciliationPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    distributorId: '',
    dispatchReference: '',
    discrepancy: '',
    shortage: '',
    allZero: '',
    awaitingReceipt: '',
    pendingReview: '',
  });
  const [applied, setApplied] = useState(filters);
  const [distributor, setDistributor] = useState<DistributorLookupValue | null>(null);
  const [page, setPage] = useState(1);
  const allowed = Boolean(user && canViewReconciliation(user));
  const query = useQuery({
    queryKey: ['post-dispatch-reconciliation', applied, page],
    enabled: allowed,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<ReconciliationQueue>>(
          '/post-dispatch-reconciliation',
          {
            params: {
              ...Object.fromEntries(Object.entries(applied).filter(([, value]) => value !== '')),
              page,
              pageSize: 25,
            },
          },
        )
      ).data.data,
  });
  if (!allowed) return <ErrorState title="Reconciliation access unavailable" />;
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Post-Dispatch Reconciliation"
        subtitle="Compare physical dispatch, QR evidence, distributor receipt and the ledger in use. Reviews record follow-up; they do not correct quantities."
      />
      <Panel title="Reconciliation queue">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setApplied({ ...filters });
          }}
        >
          <DistributorLookupField
            label="Distributor"
            value={distributor}
            onChange={(value) => {
              setDistributor(value);
              setFilters({ ...filters, distributorId: value?.id ?? '' });
            }}
          />
          <label className="text-sm">
            Dispatch reference
            <input
              className="mt-1 block w-full rounded border p-2"
              value={filters.dispatchReference}
              onChange={(e) => setFilters({ ...filters, dispatchReference: e.target.value })}
            />
          </label>
          {(
            [
              ['discrepancy', 'Receipt / ledger discrepancy'],
              ['shortage', 'Distributor shortage'],
              ['allZero', 'All-zero receipt'],
              ['awaitingReceipt', 'Awaiting distributor receipt'],
              ['pendingReview', 'Pending review'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                value={filters[key]}
                onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
              >
                <option value="">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          ))}
          <div className="flex items-end">
            <Button type="submit">Apply filters</Button>
          </div>
        </form>
      </Panel>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          title="Unable to load reconciliation queue"
          description={getApiErrorMessage(query.error, 'Unable to load reconciliation queue')}
        />
      ) : (
        <>
          <p className="text-sm" role="status">
            {query.data.total} dispatches · Page {page} of{' '}
            {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}
          </p>
          {query.data.items.length === 0 && <p>No dispatches match these filters.</p>}
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {query.data.items.map((s) => (
              <Panel key={s.id} title={s.dispatchNumber}>
                <p className="break-words">
                  {s.distributorName} ·{' '}
                  {new Date(s.dispatchDate).toLocaleDateString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                  })}
                </p>
                <dl className="my-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {[
                    ['Dispatched', s.dispatchedQuantity],
                    ['Distributor received', s.receivedQuantity],
                    ['Shortage', s.shortageQuantity],
                    ['Ledger in use', s.ledgerQuantity],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd className="font-medium">{showQuantity(value as number | null)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>QR cartons</dt>
                    <dd>
                      {s.qrConfirmed} / {s.cartonCount} · {s.qrPending} pending
                    </dd>
                  </div>
                </dl>
                <p className="mb-2 text-sm">{ledgerSourceLabel(s.ledgerSource)}</p>
                <ReconciliationIndicators summary={s} />
                <p className="my-2 text-sm">
                  {s.pendingReview
                    ? 'Pending review of current evidence'
                    : 'Current evidence reviewed'}{' '}
                  · {reviewActionLabel(s.latestReviewAction)}
                </p>
                <Link
                  className="text-sm underline"
                  to={`/fulfillment/erve-dispatches/${encodeURIComponent(s.id)}?tab=reconciliation`}
                >
                  Open reconciliation
                </Link>
              </Panel>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={page === 1 || query.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={page * query.data.pageSize >= query.data.total || query.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
