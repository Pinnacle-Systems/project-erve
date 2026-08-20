import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginatedResponse,
  QaQueueFilter,
  QaQueueSummary,
  JobOrderQualityActivity,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

function errorMessage(error: unknown) {
  if (!isAxiosError<ApiErrorResponse>(error)) return 'QA tasks are temporarily unavailable.';
  if (!error.response) return 'You appear to be offline. Pull to refresh or try again.';
  return error.response.data.error.message;
}
export function QaQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFilter = searchParams.get('filter');
  const initialFilter: QaQueueFilter | '' = [
    'AWAITING_FIRST_INSPECTION',
    'IN_PROGRESS',
    'REWORK_REQUIRED',
    'READY_FOR_REINSPECTION',
    'COMPLETED',
  ].includes(requestedFilter ?? '')
    ? (requestedFilter as QaQueueFilter)
    : '';
  const [filter, setFilter] = useState<QaQueueFilter | ''>(initialFilter);
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
  const processFlowQuery = useQuery({
    queryKey: ['process-flow-quality-work'],
    queryFn: async () =>
      (
        await apiClient.get<
          ApiSuccessResponse<
            Array<{
              jobOrderId: string;
              jobOrderNumber: string;
              factory: { id: string; code: string; name: string };
              activity: JobOrderQualityActivity;
            }>
          >
        >('/job-orders/quality-work')
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
        onChange={(e) => {
          const nextFilter = e.target.value as QaQueueFilter | '';
          setFilter(nextFilter);
          setSearchParams(nextFilter ? { filter: nextFilter } : {}, { replace: true });
        }}
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
      <section className="space-y-2">
        <h2 className="font-semibold">Process Flow Quality work</h2>
        {processFlowQuery.isLoading && <p>Loading Process Flow Quality workâ€¦</p>}
        {(processFlowQuery.data ?? []).map((item) => (
          <Link
            key={`${item.jobOrderId}:${item.activity.processFlowVersionStageId}`}
            to={`/job-orders/${item.jobOrderId}`}
            className="block rounded-lg border border-border bg-surface p-3"
          >
            <p className="font-medium">
              {item.jobOrderNumber} Â· {item.activity.name}
            </p>
            <p>
              {item.factory.name} Â· {item.activity.status.replaceAll('_', ' ')}
            </p>
            {item.activity.status === 'FAILED' && <p>Retry available</p>}
            {item.activity.status === 'MISSED' && (
              <p>Not performed during associated Production activity</p>
            )}
            {item.activity.coverage && (
              <p>
                Remaining {item.activity.coverage.remainingQuantity ?? 'Unknown'} Â·{' '}
                {item.activity.coverage.state}
              </p>
            )}
          </Link>
        ))}
      </section>
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
