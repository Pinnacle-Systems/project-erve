import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  JobOrderDetail,
  UpdatePreparedQuantityInput,
  QaReworkTaskView,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';

interface MutationVariables {
  body: object;
  key: string;
}

function mutationMessage(error: unknown): string {
  if (!isAxiosError<ApiErrorResponse>(error))
    return 'The request did not complete. You can safely retry it.';
  const code = error.response?.data.error.code;
  if (code === 'STALE_VERSION')
    return 'This task changed on another device. Reload it before continuing.';
  if (code === 'FORBIDDEN')
    return 'Your factory permission was removed or this task belongs to another factory.';
  if (code === 'VALIDATION_ERROR') return error.response!.data.error.message;
  if (code === 'UNAUTHORIZED') return 'Your session expired or was revoked. Sign in again.';
  if (!error.response)
    return 'The result is unknown because the connection was interrupted. Retry is safe.';
  return error.response.data.error.message;
}

function useTaskMutation(id: string, path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, key }: MutationVariables) =>
      (
        await apiClient.post<ApiSuccessResponse<JobOrderDetail>>(path, body, {
          headers: { 'Idempotency-Key': key },
        })
      ).data.data,
    onSuccess: (updated) => {
      queryClient.setQueryData(['factory-task', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['factory-tasks'] });
    },
  });
}

export function FactoryTaskDetailPage() {
  const { user } = useAuth();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const [acknowledgedRevision, setAcknowledgedRevision] = useState('');
  const [reworkNotes, setReworkNotes] = useState<Record<string, string>>({});
  const task = useQuery({
    queryKey: ['factory-task', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderDetail>>(`/job-orders/${id}`)).data.data,
  });

  const confirm = useTaskMutation(id, `/job-orders/${id}/actions/confirm`);
  const completeStage = useTaskMutation(id, `/job-orders/${id}/actions/complete-stage`);
  const savePrepared = useTaskMutation(id, `/job-orders/${id}/actions/update-prepared-quantity`);
  const rework = useMutation({
    mutationFn: async ({
      task: item,
      action,
      notes,
    }: {
      task: QaReworkTaskView;
      action: 'acknowledge' | 'ready' | 'notes';
      notes: string;
    }) => {
      const config = {
        headers: { 'Idempotency-Key': `mobile:rework:${action}:${item.id}:${item.version}` },
      };
      const body = { expectedVersion: item.version, notes: notes.trim() || null };
      return action === 'notes'
        ? apiClient.patch(`/qa/rework/${item.id}/notes`, body, config)
        : apiClient.post(`/qa/rework/${item.id}/${action}`, body, config);
    },
    onSuccess: () => {
      void task.refetch();
      void queryClient.invalidateQueries({ queryKey: ['factory-rework'] });
    },
  });
  const job = task.data;
  const nextStage = job?.stages.find((stage) => stage.status !== 'COMPLETED');
  const sizes = useMemo(
    () =>
      job?.lines.flatMap((line) =>
        line.sizes.map((size) => ({ ...size, style: `${line.styleNumber} ${line.styleName}` })),
      ) ?? [],
    [job],
  );
  const activeMutation = [confirm, completeStage, savePrepared].find((entry) => entry.isError);
  const canFactoryAcknowledge = Boolean(user?.roles.includes('FACTORY_USER'));

  if (task.isLoading)
    return (
      <main
        className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-background p-5"
        role="status"
      >
        Loading task…
      </main>
    );
  if (task.isError || !job)
    return (
      <main
        className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-hidden bg-background p-5 text-center"
        role="alert"
      >
        <p>{mutationMessage(task.error)}</p>
        <button
          className="min-h-11 rounded-md bg-primary px-5 text-primary-foreground"
          onClick={() => void task.refetch()}
        >
          Try again
        </button>
      </main>
    );

  const preparedBody: UpdatePreparedQuantityInput = {
    expectedVersion: job.version,
    sizes: sizes.map((size) => ({
      jobOrderLineSizeId: size.id,
      preparedQuantity: Number(prepared[size.id] ?? size.preparedQuantity),
    })),
  };
  const acknowledgementKey = `${job.id}:${job.version}:${job.disclaimerRevision}`;
  const acknowledgeDisclaimer = acknowledgedRevision === acknowledgementKey;

  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <Link
        to={user?.roles.includes('FACTORY_USER') ? '/factory-tasks' : '/job-orders'}
        className="inline-flex min-h-11 items-center text-[var(--erp-text-link)]"
      >
        ← {user?.roles.includes('FACTORY_USER') ? 'My tasks' : 'Active job orders'}
      </Link>
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          {job.purchaseOrder.poNumber} · {job.factory.name}
        </p>
        <h1 className="text-2xl font-semibold">{job.jobOrderNumber}</h1>
        <p className="mt-2 text-sm">
          {job.status.replaceAll('_', ' ')} · Version {job.version}
        </p>
        <p className="mt-1 text-sm">
          Prepared {job.preparedQuantityTotal} of {job.orderedQuantityTotal}
        </p>
      </section>

      {job.reworkTasks.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">Rework on this Job Order</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each entry is tied to its original QA size form and inspection cycle.
          </p>
          <div className="mt-3 space-y-4">
            {job.reworkTasks.map((item) => {
              const notes = reworkNotes[item.id] ?? item.factoryNotes ?? '';
              const open = item.status !== 'REINSPECTED';
              return (
                <article key={item.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">
                    {item.styleNumber} {item.styleName} · Size {item.sizeLabel}
                  </p>
                  <p className="mt-1 text-sm">
                    Quantity {item.assignedQuantity} · cycle {item.attemptNumber} ·{' '}
                    {item.status.replaceAll('_', ' ')}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.defectCategory?.replaceAll('_', ' ') ?? 'Defect'} ·{' '}
                    {item.otherDefectDetails ?? item.defectNotes ?? 'No defect details'}
                  </p>
                  <p className="mt-1 text-sm">QA remarks: {item.qaRemarks ?? 'Not recorded'}</p>
                  <p className="mt-1 text-sm">
                    QA evidence:{' '}
                    {item.qaEvidence.map((evidence) => evidence.fileName).join(', ') ||
                      'None attached'}
                  </p>
                  {open && canFactoryAcknowledge && (
                    <>
                      <label className="mt-3 block text-sm font-medium">
                        Factory rework notes
                        <textarea
                          className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-3 font-normal"
                          maxLength={1000}
                          value={notes}
                          onChange={(event) =>
                            setReworkNotes((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        className="mt-2 min-h-12 w-full rounded-lg border border-border px-4"
                        disabled={rework.isPending}
                        onClick={() => rework.mutate({ task: item, action: 'notes', notes })}
                      >
                        Save notes
                      </button>
                      {item.status === 'REWORK_REQUIRED' && (
                        <button
                          className="mt-2 min-h-12 w-full rounded-lg bg-primary px-4 text-primary-foreground"
                          disabled={rework.isPending}
                          onClick={() =>
                            rework.mutate({ task: item, action: 'acknowledge', notes })
                          }
                        >
                          Acknowledge rework
                        </button>
                      )}
                      {item.status === 'ACKNOWLEDGED' && (
                        <button
                          className="mt-2 min-h-12 w-full rounded-lg bg-primary px-4 text-primary-foreground"
                          disabled={rework.isPending}
                          onClick={() => rework.mutate({ task: item, action: 'ready', notes })}
                        >
                          Mark complete quantity ready for reinspection
                        </button>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeMutation?.isError && (
        <section className="rounded-lg border border-danger/40 bg-surface p-4" role="alert">
          <p>{mutationMessage(activeMutation.error)}</p>
          <div className="mt-3 flex gap-2">
            {activeMutation.variables && (
              <button
                className="min-h-11 rounded-md bg-primary px-5 text-primary-foreground"
                onClick={() => activeMutation.mutate(activeMutation.variables!)}
              >
                Retry safely
              </button>
            )}
            <button
              className="min-h-11 rounded-md border border-border px-5"
              onClick={() => void task.refetch()}
            >
              Reload
            </button>
          </div>
        </section>
      )}

      {job.status === 'SENT_TO_FACTORY' && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">Factory commercial terms / disclaimer</h2>
          {job.disclaimerText ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm font-sans">
              {job.disclaimerText}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-danger">
              No disclaimer is available. Contact the merchandiser.
            </p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Review the style, size quantities, total quantity, unit price, and process flow before
            confirming.
          </p>
          {canFactoryAcknowledge && (
            <label className="mt-4 flex min-h-12 items-center gap-3 text-sm font-medium">
              <input
                className="size-5"
                type="checkbox"
                checked={acknowledgeDisclaimer}
                onChange={(event) =>
                  setAcknowledgedRevision(event.target.checked ? acknowledgementKey : '')
                }
              />
              I have read and acknowledge the Job Order commercial terms and disclaimer.
            </label>
          )}
          {canFactoryAcknowledge && (
            <button
              className="min-h-12 w-full rounded-lg bg-primary px-5 font-medium text-primary-foreground"
              disabled={
                confirm.isPending ||
                !canFactoryAcknowledge ||
                !acknowledgeDisclaimer ||
                !job.disclaimerText
              }
              onClick={() =>
                confirm.mutate({
                  body: {
                    expectedVersion: job.version,
                    expectedDisclaimerRevision: job.disclaimerRevision,
                    acknowledgeDisclaimer: true,
                  },
                  key: `${id}:confirm:${job.version}`,
                })
              }
            >
              {confirm.isPending ? 'Confirming…' : 'Confirm job order'}
            </button>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">Production stages</h2>
        <ol className="mt-3 space-y-3">
          {job.stages.map((stage) => (
            <li
              key={stage.id}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-border pb-3 last:border-0"
            >
              <span>
                {stage.stageSequence}. {stage.stageNameSnapshot}
              </span>
              <span className="text-xs">{stage.status.replaceAll('_', ' ')}</span>
            </li>
          ))}
        </ol>
        {nextStage && ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(job.status) && (
          <button
            className="mt-3 min-h-12 w-full rounded-lg bg-primary px-5 text-primary-foreground"
            disabled={completeStage.isPending}
            onClick={() =>
              completeStage.mutate({
                body: { expectedVersion: job.version, stageStatusId: nextStage.id },
                key: `${id}:stage:${nextStage.id}:${job.version}`,
              })
            }
          >
            {completeStage.isPending ? 'Completing…' : `Complete ${nextStage.stageNameSnapshot}`}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">Final quantities ready for QA</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the finished quantity for each garment size after every production stage is
          complete. These are not per-stage throughput quantities.
        </p>
        <div className="mt-3 space-y-3">
          {sizes.map((size) => (
            <label
              key={size.id}
              className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <span>
                <span className="block font-medium">{size.style}</span>
                <span className="text-sm text-muted-foreground">
                  Garment size {size.sizeLabel} · job quantity {size.orderedQuantity}
                </span>
              </span>
              <input
                className="min-h-12 w-24 rounded-md border border-border bg-background px-3 text-right text-lg"
                aria-label={`Final quantity ready for QA, ${size.style}, garment size ${size.sizeLabel}`}
                type="number"
                min={0}
                disabled={job.status !== 'PRODUCTION_COMPLETE'}
                value={prepared[size.id] ?? String(size.preparedQuantity)}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) =>
                  setPrepared((current) => ({
                    ...current,
                    [size.id]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        {job.status === 'PRODUCTION_COMPLETE' && (
          <button
            className="mt-4 min-h-12 w-full rounded-lg bg-primary px-5 text-primary-foreground"
            disabled={savePrepared.isPending}
            onClick={() =>
              savePrepared.mutate({ body: preparedBody, key: `${id}:prepared:${job.version}` })
            }
          >
            {savePrepared.isPending ? 'Saving…' : 'Submit final quantities to QA'}
          </button>
        )}
        {job.status === 'READY_FOR_QA' && (
          <p className="mt-3 rounded-md bg-primary/10 p-3 text-sm">
            Production is complete and ready for QA.
          </p>
        )}
      </section>
    </main>
  );
}
