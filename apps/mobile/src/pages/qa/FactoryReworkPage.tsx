import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, QaReworkTaskView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
export function FactoryReworkPage() {
  const query = useQuery({
    queryKey: ['factory-rework'],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QaReworkTaskView[]>>('/qa/rework')).data.data,
  });
  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <div>
        <h1 className="text-2xl font-semibold">Reinspection Handoff</h1>
        <p className="text-sm text-muted-foreground">
          Corrections returned by QA, awaiting acknowledgement or reinspection.
        </p>
      </div>
      {query.isLoading && <p>Loading corrections…</p>}
      {query.isError && (
        <p role="alert">
          Unable to load the reinspection handoff. Check your connection and permission.
        </p>
      )}
      {query.data?.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-5">No open corrections.</p>
      )}
      {query.data?.map((task) => (
        <article key={task.id} className="rounded-xl border border-border bg-surface p-4">
          <p className="font-semibold">
            {task.jobOrderNumber} · {task.styleNumber} · {task.sizeCode}
          </p>
          <p className="mt-1">
            Quantity {task.assignedQuantity} · attempt {task.attemptNumber}
          </p>
          <p className="text-sm text-muted-foreground">
            {task.defectCategory?.replaceAll('_', ' ')}{' '}
            {task.defectNotes ? `· ${task.defectNotes}` : ''}
          </p>
          <Link
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground"
            to={`/job-orders/${task.jobOrderId}`}
          >
            Open original Job Order
          </Link>
        </article>
      ))}
    </main>
  );
}
