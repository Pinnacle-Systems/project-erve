import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, JobOrderDetail, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

const inactiveStatuses = ['DRAFT', 'CLOSED', 'CANCELLED'];

export function OperationalJobOrderListPage() {
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['operational-job-orders', search],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrderDetail>>>('/job-orders', {
          params: { search: search || undefined, limit: 50 },
        })
      ).data.data,
  });
  const jobs = query.data?.items.filter((job) => !inactiveStatuses.includes(job.status)) ?? [];

  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Active job orders</h1>
        <p className="text-sm text-muted-foreground">
          Monitor current production status across factories.
        </p>
      </header>
      <input
        className="min-h-12 w-full rounded-md border border-border bg-surface px-4"
        aria-label="Search active job orders"
        placeholder="Search job order or PO"
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
      {!query.isLoading && !query.isError && jobs.length === 0 && (
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
                  PO {job.purchaseOrder.poNumber} · {job.factory.name}
                </p>
              </div>
              <span className="text-right text-xs">{job.status.replaceAll('_', ' ')}</span>
            </div>
            <p className="mt-3 text-sm">
              Prepared {job.preparedQuantityTotal} of {job.orderedQuantityTotal}
            </p>
          </Link>
        ))}
      </div>
      {query.data?.pageInfo.hasMore && (
        <p className="text-sm text-muted-foreground">
          Showing the 50 most recent records. Use search to find another job order.
        </p>
      )}
    </main>
  );
}
