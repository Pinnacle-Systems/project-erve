import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  AssignedFactoryTaskSummary,
  PaginatedResponse,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

function message(error: unknown): string {
  if (!isAxiosError<ApiErrorResponse>(error)) return 'Tasks are temporarily unavailable.';
  switch (error.response?.data.error.code) {
    case 'FACTORY_MAPPING_REQUIRED':
      return 'Your account is not mapped to a factory. Contact an administrator.';
    case 'FACTORY_MAPPING_AMBIGUOUS':
      return 'Your legacy account has multiple factory mappings. Contact an administrator.';
    case 'FORBIDDEN':
      return 'You do not have permission to view factory tasks.';
    default:
      return error.response
        ? error.response.data.error.message
        : 'You appear to be offline. Your session has not been ended.';
  }
}

export function FactoryTaskListPage() {
  const [search, setSearch] = useState('');
  const tasks = useQuery({
    queryKey: ['factory-tasks', search],
    queryFn: async () => {
      const response = await apiClient.get<
        ApiSuccessResponse<PaginatedResponse<AssignedFactoryTaskSummary>>
      >('/job-orders/assigned-tasks', { params: { search: search || undefined, limit: 50 } });
      return response.data.data;
    },
  });

  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <div>
        <h1 className="text-2xl font-semibold">My factory tasks</h1>
        <p className="text-sm text-muted-foreground">
          Confirm jobs and record production progress.
        </p>
      </div>
      <input
        className="min-h-12 w-full rounded-md border border-border bg-surface px-4"
        aria-label="Search tasks"
        placeholder="Search job order or PO"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <button
        className="min-h-11 rounded-md border border-border px-4"
        onClick={() => void tasks.refetch()}
        disabled={tasks.isFetching}
      >
        {tasks.isFetching && !tasks.isLoading ? 'Refreshing…' : 'Refresh'}
      </button>
      {tasks.isLoading && <p role="status">Loading assigned tasks…</p>}
      {tasks.isError && (
        <section className="rounded-lg border border-danger/40 bg-surface p-4" role="alert">
          <p>{message(tasks.error)}</p>
          <button
            className="mt-3 min-h-11 rounded-md bg-primary px-5 text-primary-foreground"
            onClick={() => void tasks.refetch()}
          >
            Try again
          </button>
        </section>
      )}
      {!tasks.isLoading && !tasks.isError && tasks.data?.items.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-5">No assigned tasks.</p>
      )}
      <div className="space-y-3">
        {tasks.data?.items.map((task) => (
          <Link
            key={task.id}
            to={`/factory-tasks/${task.id}`}
            className="block rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{task.jobOrderNumber}</p>
                <p className="text-sm text-muted-foreground">
                  PO {task.purchaseOrderNumber} · {task.distributor.name}
                </p>
              </div>
              {task.actionRequired && (
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                  Action needed
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <span>Current: {task.operationalState.primaryDisplayState.label}</span>
              <span className="text-right">
                {task.preparedQuantityTotal}/{task.orderedQuantityTotal}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
