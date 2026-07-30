import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, QaInspectionDetail, QaReworkTaskView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
export function FactoryReworkPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['factory-rework'],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QaReworkTaskView[]>>('/qa/rework')).data.data,
  });
  const action = useMutation({
    mutationFn: async ({ task, name }: { task: QaReworkTaskView; name: 'acknowledge' | 'ready' }) =>
      (
        await apiClient.post<ApiSuccessResponse<QaInspectionDetail>>(
          `/qa/rework/${task.id}/${name}`,
          { expectedVersion: task.version },
          { headers: { 'Idempotency-Key': `mobile:rework:${name}:${task.id}:${task.version}` } },
        )
      ).data.data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['factory-rework'] }),
  });
  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <div>
        <h1 className="text-2xl font-semibold">QA rework</h1>
        <p className="text-sm text-muted-foreground">Only quantities returned by QA are shown.</p>
      </div>
      {query.isLoading && <p>Loading rework…</p>}
      {query.isError && (
        <p role="alert">Unable to load rework. Check your connection and factory permission.</p>
      )}
      {query.data?.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-5">No rework assigned.</p>
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
          <button
            className="mt-3 min-h-12 w-full rounded-lg bg-primary text-primary-foreground"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                task,
                name: task.status === 'PENDING_ACKNOWLEDGEMENT' ? 'acknowledge' : 'ready',
              })
            }
          >
            {task.status === 'PENDING_ACKNOWLEDGEMENT'
              ? 'Acknowledge rework'
              : 'Mark ready for reinspection'}
          </button>
        </article>
      ))}
    </main>
  );
}
