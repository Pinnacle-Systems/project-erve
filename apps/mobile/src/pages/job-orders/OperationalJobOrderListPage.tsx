import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, JobOrderDetail, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { ACTIVE_JOB_ORDER_QUERY_PARAMS, isActiveOperationalJobOrder } from './active-job-orders.js';

export function OperationalJobOrderListPage() {
  const [search, setSearch] = useState('');
  // GET /job-orders is cursor-paginated; "Load more" follows nextCursor so
  // every active Job Order is reachable. The active-status guard still runs
  // per row, so a page can show fewer than 50 — Load more stays offered
  // while the server has more, and "none" is only claimed once all loaded.
  const query = useInfiniteQuery({
    queryKey: ['operational-job-orders', 'list', search],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrderDetail>>>('/job-orders', {
          params: {
            search: search || undefined,
            limit: 50,
            ...ACTIVE_JOB_ORDER_QUERY_PARAMS,
            cursor: pageParam,
          },
        })
      ).data.data,
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasMore && lastPage.pageInfo.nextCursor
        ? lastPage.pageInfo.nextCursor
        : undefined,
  });
  const jobs = useMemo(
    () => query.data?.pages.flatMap((page) => page.items).filter(isActiveOperationalJobOrder) ?? [],
    [query.data],
  );

  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Active job orders</h1>
        <p className="text-sm text-muted-foreground">
          Monitor current Job Order activity across factories.
        </p>
      </header>
      <input
        className="min-h-12 w-full rounded-md border border-border bg-surface px-4"
        aria-label="Search active job orders"
        placeholder="Search job order number"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <button
        className="min-h-11 rounded-md border border-border px-4"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
      >
        {query.isFetching && !query.isLoading ? 'Refreshing…' : 'Refresh'}
      </button>
      {query.isLoading && <p role="status">Loading active job orders…</p>}
      {query.isError && (
        <section className="rounded-lg border border-danger/40 bg-surface p-4" role="alert">
          <p>Active job orders are temporarily unavailable. Check your connection and retry.</p>
          <button
            className="mt-3 min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </section>
      )}
      {!query.isLoading && !query.isError && jobs.length === 0 && !query.hasNextPage && (
        <p className="rounded-lg border border-border bg-surface p-5">
          No active job orders match this view.
        </p>
      )}
      <div className="space-y-3">
        {jobs.map((job) => (
          <Link
            key={job.id}
            to={`/job-orders/${job.id}`}
            className="block rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">{job.jobOrderNumber}</p>
                <p className="text-sm text-muted-foreground">
                  {job.factory.name} · {job.sourceOrderSheetCount} Order Sheet
                  {job.sourceOrderSheetCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex max-w-[55%] flex-col items-end gap-1 text-right">
                <span className="break-words text-xs">
                  {job.operationalState.primaryDisplayState.label}
                </span>
                {job.isDelayed && (
                  <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
                    Delayed
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm">
              Prepared {job.preparedQuantityTotal} of {job.orderedQuantityTotal}
            </p>
          </Link>
        ))}
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
          Unable to load more job orders. Try again.
        </p>
      )}
    </main>
  );
}
