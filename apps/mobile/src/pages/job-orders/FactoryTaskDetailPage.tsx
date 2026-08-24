import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  JobOrderDetail,
  QualityCoverageView,
  UpdatePreparedQuantityInput,
  QaReworkTaskView,
  QualityExecutionView,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { FinalBatchAllocationForm, getJobOrderOperationalPresentation } from '@erve/app-components';

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

function finalBatchStartError(error: unknown): string {
  if (!isAxiosError<ApiErrorResponse>(error))
    return 'Unable to create the Final batch. Review its size allocation and try again.';
  const response = error.response?.data.error;
  return response?.message ?? 'Unable to create the Final batch. Review its size allocation.';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const [acknowledgedRevision, setAcknowledgedRevision] = useState('');
  const [reworkNotes, setReworkNotes] = useState<Record<string, string>>({});
  const [qualityStartContexts, setQualityStartContexts] = useState<
    Record<string, { sizeId: string; quantity: string }>
  >({});
  const [qualityBatchAllocations, setQualityBatchAllocations] = useState<
    Record<string, Record<string, string>>
  >({});
  const [qualityBatchErrors, setQualityBatchErrors] = useState<Record<string, string>>({});
  const qualityStartBatchPendingRef = useRef(false);
  const task = useQuery({
    queryKey: ['factory-task', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderDetail>>(`/job-orders/${id}`)).data.data,
  });
  const startQuality = useMutation({
    mutationFn: async ({ activityId, body }: { activityId: string; body?: object }) =>
      (
        await apiClient.post<ApiSuccessResponse<QualityExecutionView>>(
          `/job-orders/${id}/quality-activities/${activityId}/executions`,
          body ?? {},
        )
      ).data.data,
    onSuccess: (execution) =>
      navigate(
        execution.ppSample ? `/qa/${execution.jobOrderId}` : `/quality-executions/${execution.id}`,
      ),
    onError: (error, variables) => {
      if (!Object.prototype.hasOwnProperty.call(variables.body ?? {}, 'allocations')) return;
      qualityStartBatchPendingRef.current = false;
      setQualityBatchErrors((current) => ({
        ...current,
        [variables.activityId]: finalBatchStartError(error),
      }));
    },
  });

  const updateFinalBatchAllocation = (activityId: string, sizeId: string, quantity: string) => {
    setQualityBatchAllocations((current) => ({
      ...current,
      [activityId]: { ...current[activityId], [sizeId]: quantity },
    }));
    setQualityBatchErrors((current) => {
      if (!current[activityId]) return current;
      const next = { ...current };
      delete next[activityId];
      return next;
    });
  };

  const startQualityBatch = (activityId: string, coverage: QualityCoverageView | null) => {
    if (qualityStartBatchPendingRef.current || startQuality.isPending) return;
    const values = qualityBatchAllocations[activityId] ?? {};
    const allocations = (coverage?.availableBySize ?? []).flatMap((size) => {
      const quantity = Number(values[size.jobOrderLineSizeId] || 0);
      return quantity > 0 ? [{ jobOrderLineSizeId: size.jobOrderLineSizeId, quantity }] : [];
    });
    const invalid = allocations.some((allocation) => {
      const capacity = coverage?.availableBySize?.find(
        (size) => size.jobOrderLineSizeId === allocation.jobOrderLineSizeId,
      )?.availableQuantity;
      return (
        !Number.isInteger(allocation.quantity) || capacity == null || allocation.quantity > capacity
      );
    });
    if (!allocations.length || invalid) {
      setQualityBatchErrors((current) => ({
        ...current,
        [activityId]: !allocations.length
          ? 'Allocate at least one prepared unit to this Final batch.'
          : 'Each batch allocation must be a whole number within the available size quantity.',
      }));
      return;
    }
    setQualityBatchErrors((current) => {
      if (!current[activityId]) return current;
      const next = { ...current };
      delete next[activityId];
      return next;
    });
    qualityStartBatchPendingRef.current = true;
    startQuality.mutate({
      activityId,
      body: { allocations },
    });
  };

  const confirm = useTaskMutation(id, `/job-orders/${id}/actions/confirm`);
  const completeStage = useTaskMutation(id, `/job-orders/${id}/actions/complete-stage`);
  const startStage = useTaskMutation(id, `/job-orders/${id}/actions/start-stage`);
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
  const productionQualityGateLocked = Boolean(
    job?.qualityActivities.some(
      (activity) => activity.executionMode === 'SEQUENTIAL_GATE' && activity.status !== 'COMPLETED',
    ),
  );
  const sizes = useMemo(
    () =>
      job?.lines.flatMap((line) =>
        line.sizes.map((size) => ({ ...size, style: `${line.styleNumber} ${line.styleName}` })),
      ) ?? [],
    [job],
  );
  const activeMutation = [confirm, startStage, completeStage, savePrepared].find(
    (entry) => entry.isError,
  );
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
  const operationalPresentation = getJobOrderOperationalPresentation(job.operationalState);

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
        <div className="mt-3 border-l-2 border-primary pl-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {operationalPresentation.heading}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-semibold">{operationalPresentation.name}</span>
            {operationalPresentation.stateLabel && (
              <span className="text-sm">{operationalPresentation.stateLabel}</span>
            )}
          </div>
          {operationalPresentation.secondaryLanes.map((lane) => (
            <p key={lane.domain} className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium">{lane.heading}:</span>{' '}
              {lane.name === lane.heading ? '' : `${lane.name} `}
              <span className="font-medium text-foreground">{lane.stateLabel}</span>
            </p>
          ))}
        </div>
        <p className="mt-1 text-sm">
          Prepared {job.preparedQuantityTotal} of {job.orderedQuantityTotal}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Lifecycle: {job.operationalState.lifecycleContext.label} · Version {job.version}
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
        {productionQualityGateLocked && job.factoryConfirmationStatus === 'CONFIRMED' && (
          <p>Production locked pending pre-production QA</p>
        )}
        {nextStage &&
          !productionQualityGateLocked &&
          ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(job.status) && (
            <div className="mt-3 space-y-2">
              {nextStage.status === 'NOT_STARTED' && (
                <button
                  className="min-h-12 w-full rounded-lg border border-border px-5"
                  disabled={startStage.isPending}
                  onClick={() =>
                    startStage.mutate({
                      body: { expectedVersion: job.version, stageStatusId: nextStage.id },
                      key: `${id}:start-stage:${nextStage.id}:${job.version}`,
                    })
                  }
                >
                  Start {nextStage.stageNameSnapshot}
                </button>
              )}
              {nextStage.status === 'IN_PROGRESS' && (
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
                  {completeStage.isPending
                    ? 'Completing…'
                    : `Complete ${nextStage.stageNameSnapshot}`}
                </button>
              )}
            </div>
          )}
      </section>

      {job.qualityActivities.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">Quality activities</h2>
          {job.qualityActivities.map((activity) => (
            <article
              key={activity.processFlowVersionStageId}
              className="rounded border border-border p-3"
            >
              <h3 className="font-medium">{activity.name}</h3>
              <p>
                {activity.qualityForm.name} v{activity.qualityFormVersion.versionNumber} ·{' '}
                {activity.status.replaceAll('_', ' ')}
              </p>
              {activity.coverage && (
                <div className="text-sm">
                  <p>
                    Prepared{' '}
                    {activity.coverage.preparedQuantityAuthoritative
                      ? activity.coverage.preparedQuantity
                      : 'Not yet recorded'}{' '}
                    · Inspected{' '}
                    {activity.coverage.inspectedPhysicalCoverage ??
                      activity.coverage.inspectedQuantity}{' '}
                    · Unresolved{' '}
                    {activity.coverage.remainingQuantity ?? 'Pending prepared quantity'}
                  </p>
                  <p>
                    Coverage {activity.coverage.state} Â· Passed {activity.coverage.passedBatches}{' '}
                    Â· Failed {activity.coverage.failedBatches}
                  </p>
                </div>
              )}
              {activity.status === 'MISSED' && <p>Not performed during Sewing</p>}
              {activity.qualityForm.executionScope === 'SIZE' &&
                activity.executionHistory.map((cycle) => (
                  <p key={cycle.id} className="text-sm">
                    Cycle {cycle.attemptNumber}:{' '}
                    {cycle.sampleSizeCode ?? cycle.sampleSizeLabel ?? 'Size'} Â· Qty{' '}
                    {cycle.sampleQuantity} Â·{' '}
                    {cycle.status === 'DRAFT' ? 'IN PROGRESS' : cycle.outcome}
                  </p>
                ))}
              {activity.execution ? (
                <div>
                  <button
                    className="mt-2 min-h-11 rounded bg-primary px-4 text-primary-foreground"
                    onClick={() =>
                      navigate(
                        activity.qualityForm.executionScope === 'SIZE'
                          ? `/qa/${job.id}`
                          : `/quality-executions/${activity.execution!.id}`,
                      )
                    }
                  >
                    {activity.status === 'COMPLETED' || activity.status === 'FAILED'
                      ? 'View Inspection'
                      : 'Continue Inspection'}
                  </button>
                  {activity.status === 'FAILED' &&
                    activity.eligible &&
                    activity.qualityForm.executionScope === 'SIZE' &&
                    user?.roles.some((role) => role === 'ADMIN' || role === 'QA_USER') && (
                      <div className="mt-2 space-y-2">
                        <p>New PP Sample required</p>
                        <select
                          aria-label="New PP Sample size"
                          value={
                            qualityStartContexts[activity.processFlowVersionStageId]?.sizeId ?? ''
                          }
                          onChange={(event) =>
                            setQualityStartContexts((current) => ({
                              ...current,
                              [activity.processFlowVersionStageId]: {
                                sizeId: event.target.value,
                                quantity:
                                  current[activity.processFlowVersionStageId]?.quantity ?? '',
                              },
                            }))
                          }
                        >
                          <option value="">Select one size</option>
                          {sizes.map((size) => (
                            <option key={size.id} value={size.id}>
                              {size.style} Â· {size.sizeLabel}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="New PP Sample quantity"
                          type="number"
                          min="1"
                          value={
                            qualityStartContexts[activity.processFlowVersionStageId]?.quantity ?? ''
                          }
                          onChange={(event) =>
                            setQualityStartContexts((current) => ({
                              ...current,
                              [activity.processFlowVersionStageId]: {
                                sizeId: current[activity.processFlowVersionStageId]?.sizeId ?? '',
                                quantity: event.target.value,
                              },
                            }))
                          }
                        />
                        <button
                          className="min-h-11 rounded bg-primary px-4 text-primary-foreground"
                          disabled={startQuality.isPending}
                          onClick={() => {
                            const context =
                              qualityStartContexts[activity.processFlowVersionStageId];
                            startQuality.mutate({
                              activityId: activity.processFlowVersionStageId,
                              body: {
                                sampleJobOrderLineSizeId: context?.sizeId,
                                sampleQuantity: Number(context?.quantity),
                              },
                            });
                          }}
                        >
                          Start New PP Sample
                        </button>
                      </div>
                    )}
                  {activity.executionMultiplicity === 'BATCHED' &&
                    activity.execution.status === 'FINALIZED' &&
                    !activity.coverage?.complete && (
                      <div className="mt-2 space-y-3">
                        <FinalBatchAllocationForm
                          coverage={activity.coverage!}
                          values={qualityBatchAllocations[activity.processFlowVersionStageId] ?? {}}
                          onChange={(sizeId, value) =>
                            updateFinalBatchAllocation(
                              activity.processFlowVersionStageId,
                              sizeId,
                              value,
                            )
                          }
                          error={qualityBatchErrors[activity.processFlowVersionStageId]}
                          disabled={startQuality.isPending}
                        />
                        <button
                          className="min-h-11 rounded bg-primary px-4 text-primary-foreground"
                          disabled={startQuality.isPending}
                          onClick={() =>
                            startQualityBatch(activity.processFlowVersionStageId, activity.coverage)
                          }
                        >
                          {startQuality.isPending ? 'Startingâ€¦' : 'Start Next Batch'}
                        </button>
                      </div>
                    )}
                </div>
              ) : activity.status === 'AVAILABLE' &&
                user?.roles.some((role) => role === 'ADMIN' || role === 'QA_USER') ? (
                <div className="mt-2 space-y-2">
                  {activity.qualityForm.executionScope === 'SIZE' && (
                    <>
                      <label className="block">
                        Sample Size
                        <select
                          value={
                            qualityStartContexts[activity.processFlowVersionStageId]?.sizeId ?? ''
                          }
                          onChange={(event) =>
                            setQualityStartContexts((current) => ({
                              ...current,
                              [activity.processFlowVersionStageId]: {
                                sizeId: event.target.value,
                                quantity:
                                  current[activity.processFlowVersionStageId]?.quantity ?? '',
                              },
                            }))
                          }
                        >
                          <option value="">Select one size</option>
                          {sizes.map((size) => (
                            <option key={size.id} value={size.id}>
                              {size.style} · {size.sizeLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {activity.qualityForm.executionScope === 'SIZE' && (
                    <label className="block">
                      Sample Quantity
                      <input
                        type="number"
                        min="1"
                        value={
                          qualityStartContexts[activity.processFlowVersionStageId]?.quantity ?? ''
                        }
                        onChange={(event) =>
                          setQualityStartContexts((current) => ({
                            ...current,
                            [activity.processFlowVersionStageId]: {
                              sizeId: current[activity.processFlowVersionStageId]?.sizeId ?? '',
                              quantity: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                  {activity.executionMultiplicity === 'BATCHED' && (
                    <FinalBatchAllocationForm
                      coverage={activity.coverage!}
                      values={qualityBatchAllocations[activity.processFlowVersionStageId] ?? {}}
                      onChange={(sizeId, value) =>
                        updateFinalBatchAllocation(
                          activity.processFlowVersionStageId,
                          sizeId,
                          value,
                        )
                      }
                      error={qualityBatchErrors[activity.processFlowVersionStageId]}
                      disabled={startQuality.isPending}
                    />
                  )}
                  <button
                    className="min-h-11 rounded bg-primary px-4 text-primary-foreground"
                    disabled={startQuality.isPending}
                    onClick={() => {
                      const context = qualityStartContexts[activity.processFlowVersionStageId];
                      if (activity.executionMultiplicity === 'BATCHED') {
                        startQualityBatch(activity.processFlowVersionStageId, activity.coverage);
                        return;
                      }
                      startQuality.mutate({
                        activityId: activity.processFlowVersionStageId,
                        body:
                          activity.qualityForm.executionScope === 'SIZE'
                            ? {
                                sampleJobOrderLineSizeId: context?.sizeId,
                                sampleQuantity: Number(context?.quantity),
                              }
                            : {},
                      });
                    }}
                  >
                    {startQuality.isPending ? 'Startingâ€¦' : 'Start Inspection'}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">Final quantities ready for QA</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the cumulative quantity currently ready for Final QA. You can increase it as more
          goods become ready at the configured production activity.
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
                max={size.orderedQuantity}
                disabled={
                  !(job.preparedQuantityEntry?.available ?? job.status === 'PRODUCTION_COMPLETE')
                }
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
        {(job.preparedQuantityEntry?.available ?? job.status === 'PRODUCTION_COMPLETE') && (
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
