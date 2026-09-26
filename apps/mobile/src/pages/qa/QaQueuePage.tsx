import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiErrorResponse, ApiSuccessResponse, PaginatedResponse, QualityWorkItem } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

type QualityWorkFilter =
  'AVAILABLE' | 'IN_PROGRESS' | 'FAILED' | 'MISSED' | 'COMPLETED' | 'RECONCILIATION_CONFLICT';

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

  // GET /job-orders/quality-work is cursor-paginated and server-filtered
  // (QW1) — status/conflict/factory/search are all applied by the server,
  // never by fetching one unpaginated array and filtering it here, which is
  // exactly what let the old take-100 window silently hide eligible work.
  const query = useInfiniteQuery({
    queryKey: ['process-flow-quality-work', filter, search],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<QualityWorkItem>>>(
          '/job-orders/quality-work',
          {
            params: {
              status: filter && filter !== 'RECONCILIATION_CONFLICT' ? filter : undefined,
              conflict: filter === 'RECONCILIATION_CONFLICT' ? 'true' : undefined,
              search: search.trim() || undefined,
              limit: 25,
              cursor: pageParam,
            },
          },
        )
      ).data.data,
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasMore && lastPage.pageInfo.nextCursor
        ? lastPage.pageInfo.nextCursor
        : undefined,
  });
  const qualityWork = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

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
        placeholder="Job order, activity or factory"
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
        disabled={query.isFetching}
      >
        {query.isFetching && !query.isFetchingNextPage ? 'Refreshing…' : 'Refresh'}
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
      {!query.isLoading && !query.isError && qualityWork.length === 0 && !query.hasNextPage && (
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
                  {conflict ? 'Reconciliation conflict' : item.activity.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-2 text-sm">{item.factory.name}</p>
              {item.activity.status === 'FAILED' && <p className="mt-2 text-sm">Retry required</p>}
              {item.activity.status === 'MISSED' && (
                <p className="mt-2 text-sm">Not performed during its Production activity</p>
              )}
              {coverage && (
                <p className="mt-2 text-sm">
                  Coverage {coverage.inspectedPhysicalCoverage ?? coverage.inspectedQuantity} /{' '}
                  {coverage.preparedQuantityAuthoritative ? coverage.preparedQuantity : '—'}
                </p>
              )}
            </Link>
          );
        })}
      </div>
      {query.hasNextPage && (
        <button
          className="min-h-11 w-full rounded-md border border-border px-4"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
      {query.isFetchNextPageError && (
        <p className="text-sm text-danger" role="alert">
          Unable to load more QA work. Try again.
        </p>
      )}
    </main>
  );
}
