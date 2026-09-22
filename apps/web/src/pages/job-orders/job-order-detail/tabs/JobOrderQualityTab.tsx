import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  AuthUser,
  QaReworkTaskView,
  QualityCoverageView,
  QualityExecutionView,
} from '@erve/types';
import { FinalBatchAllocationForm, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import { apiClient } from '../../../../lib/api-client.js';
import { useAuthedImage } from '../../../../lib/use-authed-image.js';
import { canMutateQualityExecution, canViewQa } from '../../../../auth/permissions.js';
import type { JobOrder } from '../../types.js';
import {
  QUALITY_RUNTIME_STATUS_LABELS,
  REWORK_STATUS_LABELS,
  formatDateTime,
  qualityRuntimeStatusTone,
} from '../../job-order-ui.js';
import { finalBatchStartError, mutationErrorMessage, type FlatSize } from '../job-order-detail-utils.js';

export interface JobOrderQualityTabProps {
  jobOrderId: string;
  jobOrder: JobOrder;
  user: AuthUser | null | undefined;
  flatSizes: FlatSize[];
}

function QaEvidenceLink({ evidence }: { evidence: QaReworkTaskView['qaEvidence'][number] }) {
  const image = useAuthedImage(`/qa/evidence/${evidence.id}/content`, evidence.createdAt);
  return (
    <button
      type="button"
      className="text-sm font-medium text-primary underline disabled:text-muted-foreground"
      disabled={!image.url}
      onClick={() => image.url && window.open(image.url, '_blank', 'noopener,noreferrer')}
    >
      {image.loading ? `Loading ${evidence.fileName}…` : evidence.fileName}
    </button>
  );
}

// Neither mutation below is observed outside this tab (no other tab or the
// page shell reads their pending/error state, and neither needs to redirect
// the user across a tab boundary the way Send/disclaimer validation does),
// so both are owned here rather than threaded down from the page shell —
// invalidating the shared `job-order`/`job-order-audit` query keys works
// identically regardless of which component calls useMutation.
export function JobOrderQualityTab({ jobOrderId, jobOrder, user, flatSizes }: JobOrderQualityTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-order', jobOrderId] });
    void queryClient.invalidateQueries({ queryKey: ['job-order-audit', jobOrderId] });
  };

  const [reworkNotesDrafts, setReworkNotesDrafts] = useState<Record<string, string>>({});
  const [qualityStartContexts, setQualityStartContexts] = useState<
    Record<string, { sizeId: string; quantity: string }>
  >({});
  const [qualityBatchAllocations, setQualityBatchAllocations] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [qualityBatchErrors, setQualityBatchErrors] = useState<Record<string, string>>({});
  const qualityStartBatchPendingRef = useRef(false);

  const reworkMutation = useMutation({
    mutationFn: async ({
      task,
      action,
      notes,
    }: {
      task: QaReworkTaskView;
      action: 'acknowledge' | 'ready' | 'notes';
      notes: string;
    }) => {
      const url = `/qa/rework/${task.id}/${action}`;
      const body = { expectedVersion: task.version, notes: notes.trim() || null };
      const config = {
        headers: { 'Idempotency-Key': `${jobOrderId}:rework:${task.id}:${action}:${task.version}` },
      };
      return action === 'notes' ? apiClient.patch(url, body, config) : apiClient.post(url, body, config);
    },
    onSuccess: invalidate,
  });

  const qualityStartMutation = useMutation({
    mutationFn: async ({ activityId, body }: { activityId: string; body?: object }) =>
      (
        await apiClient.post<ApiSuccessResponse<QualityExecutionView>>(
          `/job-orders/${jobOrderId}/quality-activities/${activityId}/executions`,
          body ?? {},
        )
      ).data.data,
    onSuccess: (execution) => {
      invalidate();
      navigate(execution.ppSample ? `/qa/${execution.jobOrderId}` : `/quality-executions/${execution.id}`);
    },
    onError: (error, variables) => {
      if (!Object.prototype.hasOwnProperty.call(variables.body ?? {}, 'allocations')) return;
      qualityStartBatchPendingRef.current = false;
      setQualityBatchErrors((current) => ({
        ...current,
        [variables.activityId]: finalBatchStartError(error),
      }));
    },
  });

  const canPerformQaRework = canMutateQualityExecution(user);
  const openRework = jobOrder.reworkTasks.filter((task) => task.status !== 'REINSPECTED');
  const historicalRework = jobOrder.reworkTasks.filter((task) => task.status === 'REINSPECTED');

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
    if (qualityStartBatchPendingRef.current || qualityStartMutation.isPending) return;
    const values = qualityBatchAllocations[activityId] ?? {};
    const allocations = (coverage?.availableBySize ?? []).flatMap((size) => {
      const quantity = Number(values[size.jobOrderLineSizeId] || 0);
      return quantity > 0 ? [{ jobOrderLineSizeId: size.jobOrderLineSizeId, quantity }] : [];
    });
    const invalid = allocations.some((allocation) => {
      const capacity = coverage?.availableBySize?.find(
        (size) => size.jobOrderLineSizeId === allocation.jobOrderLineSizeId,
      )?.availableQuantity;
      return !Number.isInteger(allocation.quantity) || capacity == null || allocation.quantity > capacity;
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
    qualityStartMutation.mutate({ activityId, body: { allocations } });
  };

  return (
    <div className="space-y-4">
      {jobOrder.reworkTasks.length > 0 && (
        <Panel
          title="Reinspection Handoff"
          description="Physical correction happens offline at the factory. QA tracks each correction here — by size and inspection cycle — through to reinspection."
        >
          <div className="space-y-5">
            {openRework.length > 0 && (
              <section className="space-y-3" aria-label="Open corrections">
                <h3 className="text-sm font-semibold">Open corrections</h3>
                {openRework.map((task) => {
                  const notes = reworkNotesDrafts[task.id] ?? task.factoryNotes ?? '';
                  return (
                    <article key={task.id} className="space-y-4 rounded-md border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {jobOrder.jobOrderNumber} · {task.styleNumber} {task.styleName} · Size{' '}
                            {task.sizeLabel}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Correction cycle {task.attemptNumber} · Requested {formatDateTime(task.requestedAt)}{' '}
                            by {task.requestedBy.name}
                          </p>
                        </div>
                        <StatusBadge
                          label={REWORK_STATUS_LABELS[task.status]}
                          tone={task.status === 'READY_FOR_REINSPECTION' ? 'info' : 'warning'}
                        />
                      </div>
                      <DescriptionList columns={3}>
                        <DescriptionList.Item
                          label="Requested quantity"
                          value={task.assignedQuantity.toLocaleString()}
                        />
                        <DescriptionList.Item
                          label="Defect category"
                          value={task.defectCategory?.replaceAll('_', ' ') ?? 'Not recorded'}
                        />
                        <DescriptionList.Item
                          label="Defect details"
                          value={task.otherDefectDetails ?? task.defectNotes ?? 'Not recorded'}
                        />
                        <DescriptionList.Item label="QA remarks" value={task.qaRemarks ?? 'Not recorded'} />
                        <DescriptionList.Item
                          label="Acknowledged"
                          value={
                            task.acknowledgedAt
                              ? `${formatDateTime(task.acknowledgedAt)} by ${task.acknowledgedBy?.name ?? 'QA'}`
                              : 'Not yet'
                          }
                        />
                        <DescriptionList.Item
                          label="Ready for reinspection"
                          value={
                            task.readyAt
                              ? `${formatDateTime(task.readyAt)} by ${task.readyBy?.name ?? 'QA'}`
                              : 'Not yet'
                          }
                        />
                      </DescriptionList>
                      <div>
                        <p className="mb-2 text-sm font-medium">QA evidence</p>
                        {task.qaEvidence.length ? (
                          <div className="flex flex-wrap gap-3">
                            {task.qaEvidence.map((evidence) => (
                              <QaEvidenceLink key={evidence.id} evidence={evidence} />
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No QA evidence attached.</p>
                        )}
                      </div>
                      <label className="block text-sm font-medium">
                        Correction notes
                        <textarea
                          className="mt-1 min-h-24 w-full rounded-control border border-border bg-surface-raised px-3 py-2 font-normal"
                          maxLength={1000}
                          readOnly={!canPerformQaRework}
                          value={notes}
                          onChange={(event) =>
                            setReworkNotesDrafts((current) => ({ ...current, [task.id]: event.target.value }))
                          }
                        />
                      </label>
                      {canPerformQaRework && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            loading={reworkMutation.isPending}
                            onClick={() => reworkMutation.mutate({ task, action: 'notes', notes })}
                          >
                            Save notes
                          </Button>
                          {task.status === 'REWORK_REQUIRED' && (
                            <Button
                              loading={reworkMutation.isPending}
                              onClick={() => reworkMutation.mutate({ task, action: 'acknowledge', notes })}
                            >
                              Acknowledge Correction
                            </Button>
                          )}
                          {task.status === 'ACKNOWLEDGED' && (
                            <Button
                              loading={reworkMutation.isPending}
                              onClick={() => reworkMutation.mutate({ task, action: 'ready', notes })}
                            >
                              Mark Ready for Reinspection
                            </Button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )}
            {historicalRework.length > 0 && (
              <section className="space-y-2" aria-label="Reinspection history">
                <h3 className="text-sm font-semibold">Reinspection history</h3>
                {historicalRework.map((task) => (
                  <div key={task.id} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium">
                      {task.styleNumber} · Size {task.sizeLabel} · correction cycle {task.attemptNumber}
                    </p>
                    <p className="text-muted-foreground">
                      {task.assignedQuantity} units · Reinspected {formatDateTime(task.reinspectedAt)}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {reworkMutation.isError && (
              <ValidationMessage tone="error">
                {mutationErrorMessage(
                  reworkMutation.error,
                  'Unable to update the reinspection handoff. Refresh and try again.',
                )}
              </ValidationMessage>
            )}
          </div>
        </Panel>
      )}

      {jobOrder.qualityActivities.length > 0 && (
        <Panel
          title="Quality activities"
          description="Eligibility is calculated from the assigned Process Flow version and current Production runtime."
        >
          <div className="space-y-3">
            {jobOrder.qualityActivities.map((activity) => (
              <Panel
                key={activity.processFlowVersionStageId}
                variant="bordered"
                padding="sm"
                title={activity.name}
                description={`${activity.qualityForm.name} v${activity.qualityFormVersion.versionNumber}`}
                actions={
                  <StatusBadge
                    label={QUALITY_RUNTIME_STATUS_LABELS[activity.status]}
                    tone={qualityRuntimeStatusTone(activity.status)}
                  />
                }
              >
                <DescriptionList columns={4} density="compact">
                  <DescriptionList.Item
                    label="Mode"
                    value={activity.executionMode === 'IN_PROCESS' ? 'In-process' : 'Sequential gate'}
                  />
                  <DescriptionList.Item
                    label="Associated production activity"
                    value={activity.associatedProductionActivity?.name ?? 'Not applicable'}
                  />
                  <DescriptionList.Item
                    label="Availability"
                    value={
                      activity.progressThresholdPercent
                        ? `${Number(activity.progressThresholdPercent)}% progress`
                        : activity.availabilityPolicy.toLowerCase().replaceAll('_', ' ')
                    }
                  />
                  <DescriptionList.Item
                    label="Execution"
                    value={activity.executionMultiplicity === 'BATCHED' ? 'Batched' : 'Single'}
                  />
                </DescriptionList>
                {activity.coverage && (
                  <DescriptionList columns={4} density="compact" className="mt-4">
                    <DescriptionList.Item
                      label="Prepared"
                      value={
                        activity.coverage.preparedQuantityAuthoritative
                          ? activity.coverage.preparedQuantity
                          : 'Not yet recorded'
                      }
                    />
                    <DescriptionList.Item
                      label="Inspected"
                      value={activity.coverage.inspectedPhysicalCoverage ?? activity.coverage.inspectedQuantity}
                    />
                    <DescriptionList.Item
                      label="Unresolved"
                      value={activity.coverage.remainingQuantity ?? 'Pending prepared quantity'}
                    />
                    <DescriptionList.Item label="Coverage" value={activity.coverage.state} />
                    <DescriptionList.Item label="Passed batches" value={activity.coverage.passedBatches} />
                    <DescriptionList.Item label="Failed batches" value={activity.coverage.failedBatches} />
                  </DescriptionList>
                )}
                {activity.status === 'MISSED' && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Not performed during the associated Production activity.
                  </p>
                )}
                {activity.qualityForm.executionScope === 'SIZE' && activity.executionHistory.length > 0 && (
                  <DataTable
                    density="compact"
                    containerClassName="mt-4"
                    rowKey="id"
                    data={activity.executionHistory}
                    columns={[
                      { key: 'attempt', header: 'Cycle', accessor: 'attemptNumber' },
                      {
                        key: 'size',
                        header: 'Sample size',
                        render: (cycle) => cycle.sampleSizeCode ?? cycle.sampleSizeLabel ?? 'Size',
                      },
                      { key: 'quantity', header: 'Quantity', accessor: 'sampleQuantity', align: 'right' },
                      {
                        key: 'status',
                        header: 'Result',
                        render: (cycle) =>
                          cycle.status === 'DRAFT' ? (
                            <StatusBadge label="In Progress" tone="info" />
                          ) : (
                            <StatusBadge
                              label={cycle.outcome ?? 'Finalized'}
                              tone={cycle.outcome === 'PASS' ? 'success' : 'danger'}
                            />
                          ),
                      },
                    ]}
                  />
                )}
                {activity.execution ? (
                  <div className="mt-4 space-y-3">
                    {/* UXAUTH-011: both cross-link targets here (`/qa/:id` and
                        `/quality-executions/:id`) share the exact same
                        allowed-role set (QA_VIEW_ROLES) — FACTORY_USER can
                        view this Job Order and its QA status/history above,
                        but is in neither route's guard, so the navigation
                        button itself must not render for it. */}
                    {canViewQa(user) && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          navigate(
                            activity.qualityForm.executionScope === 'SIZE'
                              ? `/qa/${jobOrder.id}`
                              : `/quality-executions/${activity.execution!.id}`,
                          )
                        }
                      >
                        {activity.status === 'COMPLETED' || activity.status === 'FAILED'
                          ? 'View Inspection'
                          : 'Continue Inspection'}
                      </Button>
                    )}
                    {activity.status === 'FAILED' &&
                      activity.eligible &&
                      activity.qualityForm.executionScope === 'SIZE' &&
                      user?.roles.some((role) => role === 'ADMIN' || role === 'QA_USER') && (
                        <Panel variant="subtle" padding="sm" title="New PP Sample required">
                          <div className="flex flex-wrap items-end gap-3">
                            <SelectField
                              label="Sample Size"
                              value={qualityStartContexts[activity.processFlowVersionStageId]?.sizeId || 'NONE'}
                              onValueChange={(value) =>
                                setQualityStartContexts((current) => ({
                                  ...current,
                                  [activity.processFlowVersionStageId]: {
                                    sizeId: value === 'NONE' ? '' : value,
                                    quantity: current[activity.processFlowVersionStageId]?.quantity ?? '',
                                  },
                                }))
                              }
                            >
                              <SelectItem value="NONE">Select one size</SelectItem>
                              {flatSizes.map((size) => (
                                <SelectItem key={size.id} value={size.id}>
                                  {size.style} — {size.sizeLabel}
                                </SelectItem>
                              ))}
                            </SelectField>
                            <TextField
                              label="Sample Quantity"
                              type="number"
                              min="1"
                              width="xs"
                              value={qualityStartContexts[activity.processFlowVersionStageId]?.quantity ?? ''}
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
                            <Button
                              loading={qualityStartMutation.isPending}
                              onClick={() => {
                                const context = qualityStartContexts[activity.processFlowVersionStageId];
                                qualityStartMutation.mutate({
                                  activityId: activity.processFlowVersionStageId,
                                  body: {
                                    sampleJobOrderLineSizeId: context?.sizeId,
                                    sampleQuantity: Number(context?.quantity),
                                  },
                                });
                              }}
                            >
                              Start New PP Sample
                            </Button>
                          </div>
                        </Panel>
                      )}
                    {activity.executionMultiplicity === 'BATCHED' &&
                      activity.execution.status === 'FINALIZED' &&
                      !activity.coverage?.complete &&
                      !activity.coverage?.reconciliationConflict && (
                        <div className="w-full space-y-3">
                          <FinalBatchAllocationForm
                            coverage={activity.coverage!}
                            values={qualityBatchAllocations[activity.processFlowVersionStageId] ?? {}}
                            onChange={(sizeId, value) =>
                              updateFinalBatchAllocation(activity.processFlowVersionStageId, sizeId, value)
                            }
                            error={qualityBatchErrors[activity.processFlowVersionStageId]}
                            disabled={qualityStartMutation.isPending}
                          />
                          <Button
                            loading={qualityStartMutation.isPending}
                            onClick={() => startQualityBatch(activity.processFlowVersionStageId, activity.coverage)}
                          >
                            Start Next Batch
                          </Button>
                        </div>
                      )}
                  </div>
                ) : activity.status === 'AVAILABLE' &&
                  user?.roles.some((role) => role === 'ADMIN' || role === 'QA_USER') ? (
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    {activity.qualityForm.executionScope === 'SIZE' && (
                      <>
                        <SelectField
                          label="Sample Size"
                          value={qualityStartContexts[activity.processFlowVersionStageId]?.sizeId || 'NONE'}
                          onValueChange={(value) =>
                            setQualityStartContexts((current) => ({
                              ...current,
                              [activity.processFlowVersionStageId]: {
                                sizeId: value === 'NONE' ? '' : value,
                                quantity: current[activity.processFlowVersionStageId]?.quantity ?? '',
                              },
                            }))
                          }
                        >
                          <SelectItem value="NONE">Select one size</SelectItem>
                          {flatSizes.map((size) => (
                            <SelectItem key={size.id} value={size.id}>
                              {size.style} — {size.sizeLabel}
                            </SelectItem>
                          ))}
                        </SelectField>
                        <TextField
                          label="Sample Quantity"
                          type="number"
                          min="1"
                          width="xs"
                          value={qualityStartContexts[activity.processFlowVersionStageId]?.quantity ?? ''}
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
                      </>
                    )}
                    {activity.executionMultiplicity === 'BATCHED' && (
                      <FinalBatchAllocationForm
                        coverage={activity.coverage!}
                        values={qualityBatchAllocations[activity.processFlowVersionStageId] ?? {}}
                        onChange={(sizeId, value) =>
                          updateFinalBatchAllocation(activity.processFlowVersionStageId, sizeId, value)
                        }
                        error={qualityBatchErrors[activity.processFlowVersionStageId]}
                        disabled={qualityStartMutation.isPending}
                      />
                    )}
                    <Button
                      loading={qualityStartMutation.isPending}
                      onClick={() => {
                        const context = qualityStartContexts[activity.processFlowVersionStageId];
                        if (activity.executionMultiplicity === 'BATCHED') {
                          startQualityBatch(activity.processFlowVersionStageId, activity.coverage);
                          return;
                        }
                        qualityStartMutation.mutate({
                          activityId: activity.processFlowVersionStageId,
                          body:
                            activity.qualityForm.executionScope === 'SIZE'
                              ? { sampleJobOrderLineSizeId: context?.sizeId, sampleQuantity: Number(context?.quantity) }
                              : {},
                        });
                      }}
                    >
                      Start Inspection
                    </Button>
                  </div>
                ) : null}
              </Panel>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
