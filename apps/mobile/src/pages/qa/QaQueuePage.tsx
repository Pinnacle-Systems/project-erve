import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiErrorResponse, ApiSuccessResponse, JobOrderQualityActivity } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

type QualityWorkItem = {
  jobOrderId: string;
  jobOrderNumber: string;
  purchaseOrderNumber: string;
  factory: { id: string; code: string; name: string };
  activity: JobOrderQualityActivity;
};

type QualityWorkFilter =
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'FAILED'
  | 'MISSED'
  | 'COMPLETED'
  | 'RECONCILIATION_CONFLICT';

const QUALITY_FILTERS: QualityWorkFilter[] = [
  'AVAILABLE',
  'IN_PROGRESS',
  'FAILED',
  'MISSED',
  'COMPLETED',
  'RECONCILIATION_CONFLICT',
];

function errorMessage(error: unknown) {
  if (!isAxiosError<ApiErrorResponse>(error)) return 'QA work is temporarily unavailable.';
  if (!error.response) return 'You appear to be offline. Pull to refresh or try again.';
  return error.response.data.error.message;
}

export function QaQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFilter = searchParams.get('filter');
  const initialFilter = QUALITY_FILTERS.includes(requestedFilter as QualityWorkFilter)
    ? (requestedFilter as QualityWorkFilter)
    : '';
  const [filter, setFilter] = useState<QualityWorkFilter | ''>(initialFilter);
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['process-flow-quality-work'],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<Array<QualityWorkItem>>>(
          '/job-orders/quality-work',
        )
      ).data.data,
  });
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const qualityWork = (query.data ?? []).filter((item) => {
    const matchesSearch =
      !normalizedSearch ||
      [
        item.jobOrderNumber,
        item.purchaseOrderNumber,
        item.factory.name,
        item.factory.code,
        item.activity.name,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    const matchesFilter =
      !filter ||
      (filter === 'RECONCILIATION_CONFLICT'
        ? item.activity.coverage?.reconciliationConflict === true
        : item.activity.status === filter);
    return matchesSearch && matchesFilter;
  });

  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <div>
        <h1 className="text-2xl font-semibold">QA Work</h1>
        <p className="text-sm text-muted-foreground">
          Quality inspections and reports required by active Job Orders.
        </p>
      </div>
      <input
        className="min-h-12 w-full rounded-md border border-border bg-surface px-4"
        placeholder="Job order, PO, activity or factory"
        aria-label="Search QA work"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        className="min-h-12 w-full rounded-md border border-border bg-surface px-3"
        aria-label="QA status"
        value={filter}
        onChange={(event) => {
          const nextFilter = event.target.value as QualityWorkFilter | '';
          setFilter(nextFilter);
          setSearchParams(nextFilter ? { filter: nextFilter } : {}, { replace: true });
        }}
      >
        <option value="">All statuses</option>
        <option value="AVAILABLE">Available</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="FAILED">Failed / retry required</option>
        <option value="MISSED">Missed</option>
        <option value="COMPLETED">Completed</option>
        <option value="RECONCILIATION_CONFLICT">Reconciliation conflict</option>
      </select>
      <button
        className="min-h-11 rounded-md border border-border px-4"
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? 'Refreshing…' : 'Refresh'}
      </button>
      {query.isLoading && <p role="status">Loading QA work…</p>}
      {query.isError && (
        <section role="alert" className="rounded-lg border border-danger/40 bg-surface p-4">
          <p>{errorMessage(query.error)}</p>
          <button
            className="mt-3 min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </section>
      )}
      {!query.isLoading && !query.isError && qualityWork.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-5">
          No Quality activities match this view.
        </p>
      )}
      <div className="space-y-3">
        {qualityWork.map((item) => {
          const coverage = item.activity.coverage;
          const conflict = coverage?.reconciliationConflict === true;
          return (
            <Link
              key={`${item.jobOrderId}:${item.activity.processFlowVersionStageId}`}
              to={`/job-orders/${item.jobOrderId}`}
              className="block rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.jobOrderNumber}</p>
                  <p className="text-sm text-muted-foreground">{item.activity.name}</p>
                </div>
                <span className="text-xs">
                  {conflict
                    ? 'Reconciliation conflict'
                    : item.activity.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-2 text-sm">
                {item.factory.name} · PO {item.purchaseOrderNumber}
              </p>
              {item.activity.status === 'FAILED' && <p className="mt-2 text-sm">Retry required</p>}
              {item.activity.status === 'MISSED' && (
                <p className="mt-2 text-sm">Not performed during its Production activity</p>
              )}
              {coverage && (
                <p className="mt-2 text-sm">
                  Coverage {coverage.inspectedQuantity} /{' '}
                  {coverage.preparedQuantityAuthoritative ? coverage.preparedQuantity : '—'}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
