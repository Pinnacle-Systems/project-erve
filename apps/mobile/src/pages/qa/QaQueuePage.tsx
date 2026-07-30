import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginatedResponse,
  QaQueueFilter,
  QaQueueSummary,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

function errorMessage(error: unknown) {
  if (!isAxiosError<ApiErrorResponse>(error)) return 'QA tasks are temporarily unavailable.';
  if (error.response?.data.error.code === 'FACTORY_MAPPING_REQUIRED')
    return 'Your QA account is not mapped to a factory.';
  if (error.response?.data.error.code === 'FACTORY_MAPPING_AMBIGUOUS')
    return 'Your QA account has conflicting factory mappings. Contact an administrator.';
  if (!error.response) return 'You appear to be offline. Pull to refresh or try again.';
  return error.response.data.error.message;
}
export function QaQueuePage() {
  const [filter, setFilter] = useState<QaQueueFilter | ''>('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['qa-queue', filter, search],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<QaQueueSummary>>>('/qa/queue', {
          params: { filter: filter || undefined, search: search || undefined, limit: 50 },
        })
      ).data.data,
  });
  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <div>
        <h1 className="text-2xl font-semibold">QA inspection</h1>
        <p className="text-sm text-muted-foreground">
          Inspect prepared garments and close QA outcomes.
        </p>
      </div>
      <input
        className="min-h-12 w-full rounded-md border border-border bg-surface px-4"
        placeholder="Job order or PO"
        aria-label="Search QA tasks"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        className="min-h-12 w-full rounded-md border border-border bg-surface px-3"
        aria-label="QA status"
        value={filter}
        onChange={(e) => setFilter(e.target.value as QaQueueFilter | '')}
      >
        <option value="">All active and completed</option>
        <option value="AWAITING_FIRST_INSPECTION">Awaiting first inspection</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="REWORK_REQUIRED">Rework required</option>
        <option value="READY_FOR_REINSPECTION">Ready for reinspection</option>
        <option value="COMPLETED">Completed</option>
      </select>
      <button
        className="min-h-11 rounded-md border border-border px-4"
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? 'Refreshing…' : 'Refresh'}
      </button>
      {query.isLoading && <p role="status">Loading QA queue…</p>}
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
      {!query.isLoading && !query.isError && query.data?.items.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-5">
          No QA tasks match this view.
        </p>
      )}
      <div className="space-y-3">
        {query.data?.items.map((task) => (
          <Link
            key={task.id}
            to={`/qa/${task.id}`}
            className="block rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-semibold">{task.jobOrderNumber}</p>
                <p className="text-sm text-muted-foreground">
                  PO {task.purchaseOrderNumber} · {task.factory.name}
                </p>
              </div>
              <span className="text-xs">{task.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <span>Prepared {task.totals.prepared}</span>
              <span>Available {task.totals.availableToInspect}</span>
              <span>Accepted {task.totals.accepted}</span>
              <span>Rework {task.totals.awaitingReinspection}</span>
              <span>Rejected {task.totals.permanentlyRejected}</span>
              <span>Approved {task.totals.finalApproved}</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
