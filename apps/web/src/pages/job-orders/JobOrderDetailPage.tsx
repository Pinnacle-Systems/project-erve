import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  JobOrderAuditEntry,
  QaReworkTaskView,
} from '@erve/types';
import { AuditTrail, ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuthedImage } from '../../lib/use-authed-image.js';
import { useOptionalAuth } from '../../auth/AuthContext.js';
import type { JobOrder, JobOrderLineSize } from './types.js';
import { ProductionStageStepper } from './ProductionStageStepper.js';
import { formatJobOrderAuditTitle } from './job-order-audit.js';
import {
  CONFIRMATION_LABELS,
  JOB_ORDER_STATUS_LABELS,
  confirmationTone,
  formatDateTime,
  statusTone,
} from './job-order-ui.js';

type FlatSize = JobOrderLineSize & {
  style: string;
  linePreparedQuantityTotal: number;
};

const disclaimerRequiredMessage =
  'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.';

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorResponse>(error)) return error.response?.data.error.message ?? fallback;
  if (error instanceof Error && !error.message.startsWith('Request failed with status code'))
    return error.message;
  return fallback;
}

const REWORK_STATUS_LABELS: Record<QaReworkTaskView['status'], string> = {
  REWORK_REQUIRED: 'Rework required',
  ACKNOWLEDGED: 'Acknowledged',
  READY_FOR_REINSPECTION: 'Ready for reinspection',
  REINSPECTED: 'Reinspected',
};

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

export function JobOrderDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [preparedQuantities, setPreparedQuantities] = useState<Record<string, number>>({});
  const [disclaimerDrafts, setDisclaimerDrafts] = useState<Record<string, string>>({});
  const [disclaimerError, setDisclaimerError] = useState('');
  const [sendError, setSendError] = useState('');
  const [acknowledgedRevision, setAcknowledgedRevision] = useState('');
  const [reworkNotesDrafts, setReworkNotesDrafts] = useState<Record<string, string>>({});
  const disclaimerRef = useRef<HTMLTextAreaElement>(null);
  const user = useOptionalAuth()?.user;

  const jobOrderQuery = useQuery({
    queryKey: ['job-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}`);
      return res.data.data;
    },
  });
  const auditQuery = useQuery({
    queryKey: ['job-order-audit', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderAuditEntry[]>>(`/job-orders/${id}/audit`))
        .data.data,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-order', id] });
    void queryClient.invalidateQueries({ queryKey: ['job-order-audit', id] });
  };

  const sendMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/send-to-factory`,
        { expectedVersion: jobOrderQuery.data!.version },
        { headers: { 'Idempotency-Key': `${id}:send:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: () => {
      setSendDialogOpen(false);
      setSendError('');
      invalidate();
    },
    onError: (error) => {
      const apiCode = isAxiosError<ApiErrorResponse>(error)
        ? error.response?.data.error.code
        : undefined;
      const message =
        apiCode === 'DISCLAIMER_REQUIRED'
          ? disclaimerRequiredMessage
          : mutationErrorMessage(error, 'Unable to send this Job Order to the factory.');
      setSendDialogOpen(false);
      setSendError(message);
      if (apiCode === 'DISCLAIMER_REQUIRED') {
        setDisclaimerError(message);
        disclaimerRef.current?.focus();
        disclaimerRef.current?.scrollIntoView?.({ block: 'center' });
      }
    },
  });
  const confirmMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/confirm`,
        {
          expectedVersion: jobOrderQuery.data!.version,
          expectedDisclaimerRevision: jobOrderQuery.data!.disclaimerRevision,
          acknowledgeDisclaimer: true,
        },
        { headers: { 'Idempotency-Key': `${id}:confirm:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: () => {
      setDisclaimerError('');
      setSendError('');
      invalidate();
    },
  });
  const disclaimerMutation = useMutation({
    mutationFn: async () =>
      apiClient.patch<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/disclaimer`,
        {
          expectedVersion: jobOrderQuery.data!.version,
          disclaimerText:
            disclaimerDrafts[jobOrderQuery.data!.id] ?? jobOrderQuery.data!.disclaimerText ?? '',
        },
        { headers: { 'Idempotency-Key': `${id}:disclaimer:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: invalidate,
  });
  const completeStageMutation = useMutation({
    mutationFn: async (stageStatusId: string) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/complete-stage`,
        { stageStatusId, expectedVersion: jobOrderQuery.data!.version },
        {
          headers: {
            'Idempotency-Key': `${id}:stage:${stageStatusId}:${jobOrderQuery.data!.version}`,
          },
        },
      ),
    onSuccess: invalidate,
  });
  const preparedMutation = useMutation({
    mutationFn: async (sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/update-prepared-quantity`,
        { sizes, expectedVersion: jobOrderQuery.data!.version },
        { headers: { 'Idempotency-Key': `${id}:prepared:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: invalidate,
  });
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
        headers: { 'Idempotency-Key': `${id}:rework:${task.id}:${action}:${task.version}` },
      };
      return action === 'notes'
        ? apiClient.patch(url, body, config)
        : apiClient.post(url, body, config);
    },
    onSuccess: invalidate,
  });

  const jobOrder = jobOrderQuery.data;
  const flatSizes: FlatSize[] = useMemo(
    () =>
      (jobOrder?.lines ?? []).flatMap((line) =>
        line.sizes.map((size) => ({
          ...size,
          style: `${line.styleNumber} ${line.styleName}`,
          linePreparedQuantityTotal: line.preparedQuantityTotal,
        })),
      ),
    [jobOrder],
  );
  const nextStage = jobOrder?.stages.find((stage) => stage.status !== 'COMPLETED');

  if (jobOrderQuery.isLoading) return <LoadingState label="Loading job order" />;
  if (!jobOrder)
    return (
      <EmptyState
        title="Job order not found"
        description="The selected job order could not be loaded."
        tone="error"
      />
    );

  const canManageJobOrders = Boolean(
    user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER'),
  );
  const canSend = jobOrder.status === 'DRAFT' && canManageJobOrders;
  const acknowledgementKey = `${jobOrder.id}:${jobOrder.version}:${jobOrder.disclaimerRevision}`;
  const acknowledgeDisclaimer = acknowledgedRevision === acknowledgementKey;
  const disclaimerText = disclaimerDrafts[jobOrder.id] ?? jobOrder.disclaimerText ?? '';
  const canEditDisclaimer = jobOrder.status === 'DRAFT' && canManageJobOrders;
  const canConfirm =
    jobOrder.status === 'SENT_TO_FACTORY' && Boolean(user?.roles.includes('FACTORY_USER'));
  const canCompleteStage =
    ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status) && Boolean(nextStage);
  const canUpdatePrepared = jobOrder.status === 'PRODUCTION_COMPLETE';
  const canPerformFactoryRework = Boolean(user?.roles.includes('FACTORY_USER'));
  const openRework = jobOrder.reworkTasks.filter((task) => task.status !== 'REINSPECTED');
  const historicalRework = jobOrder.reworkTasks.filter((task) => task.status === 'REINSPECTED');
  const hasProductionStarted = [
    'CONFIRMED_BY_FACTORY',
    'IN_PRODUCTION',
    'PRODUCTION_COMPLETE',
  ].includes(jobOrder.status);
  const preparedPayload = flatSizes.map((size) => ({
    jobOrderLineSizeId: size.id,
    preparedQuantity: preparedQuantities[size.id] ?? size.preparedQuantity,
  }));
  const focusDisclaimer = (message: string) => {
    setDisclaimerError(message);
    setSendError(message);
    setSendDialogOpen(false);
    disclaimerRef.current?.focus();
    disclaimerRef.current?.scrollIntoView?.({ block: 'center' });
  };
  const validateDisclaimerForSend = () => {
    if (!disclaimerText.trim()) {
      focusDisclaimer(disclaimerRequiredMessage);
      return false;
    }
    if (disclaimerText.trim() !== (jobOrder.disclaimerText ?? '').trim()) {
      focusDisclaimer('Save the disclaimer before sending this Job Order to the factory.');
      return false;
    }
    setDisclaimerError('');
    setSendError('');
    return true;
  };
  const openSendDialog = () => {
    if (validateDisclaimerForSend()) setSendDialogOpen(true);
  };
  const sendToFactory = () => {
    if (validateDisclaimerForSend()) sendMutation.mutate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={jobOrder.jobOrderNumber}
        subtitle={`From ${jobOrder.purchaseOrder.poNumber}`}
        status={
          <StatusBadge
            label={JOB_ORDER_STATUS_LABELS[jobOrder.status]}
            tone={statusTone(jobOrder.status)}
          />
        }
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        }
        primaryAction={
          <div className="flex flex-wrap gap-2">
            {canSend && (
              <div className="flex flex-col items-end gap-1">
                <Button onClick={openSendDialog}>Send to Factory</Button>
                {sendError ? (
                  <p
                    className="max-w-md text-right text-xs text-[var(--erp-form-field-error-text-color)]"
                    role="alert"
                  >
                    {sendError}
                  </p>
                ) : null}
              </div>
            )}
            {canConfirm && (
              <Button
                disabled={!acknowledgeDisclaimer}
                onClick={() => confirmMutation.mutate()}
                loading={confirmMutation.isPending}
              >
                Confirm
              </Button>
            )}
          </div>
        }
      />

      {(confirmMutation.isError || completeStageMutation.isError || preparedMutation.isError) && (
        <ValidationMessage tone="error">
          {[confirmMutation.error, completeStageMutation.error, preparedMutation.error].find(
            (error) => error instanceof Error,
          )?.message ?? 'Unable to update job order'}
        </ValidationMessage>
      )}

      {disclaimerMutation.isError && (
        <ValidationMessage tone="error">
          {disclaimerMutation.error instanceof Error
            ? disclaimerMutation.error.message
            : 'Unable to update disclaimer'}
        </ValidationMessage>
      )}

      <Panel title="Job Order Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Source PO" value={jobOrder.purchaseOrder.poNumber} />
          <DescriptionList.Item label="Factory" value={jobOrder.factory.name} />
          <DescriptionList.Item
            label="Factory unit price"
            value={`₹${jobOrder.unitPrice.toFixed(2)}`}
          />
          <DescriptionList.Item
            label="Process Flow"
            value={`${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`}
          />
          <DescriptionList.Item
            label="Confirmation"
            value={
              <StatusBadge
                label={CONFIRMATION_LABELS[jobOrder.factoryConfirmationStatus]}
                tone={confirmationTone(jobOrder.factoryConfirmationStatus)}
              />
            }
          />
          <DescriptionList.Item
            label="Ordered Qty"
            value={jobOrder.orderedQuantityTotal.toLocaleString()}
          />
          <DescriptionList.Item
            label="Prepared Qty"
            value={jobOrder.preparedQuantityTotal.toLocaleString()}
          />
          <DescriptionList.Item
            label="Variance"
            value={(
              jobOrder.preparedQuantityTotal - jobOrder.orderedQuantityTotal
            ).toLocaleString()}
          />
          <DescriptionList.Item label="Created" value={formatDateTime(jobOrder.createdAt)} />
          <DescriptionList.Item label="Confirmed By" value={jobOrder.confirmedBy?.name} />
          <DescriptionList.Item label="Confirmed At" value={formatDateTime(jobOrder.confirmedAt)} />
          <DescriptionList.Item
            label="Production Started"
            value={formatDateTime(jobOrder.productionStartedAt)}
          />
          <DescriptionList.Item
            label="Production Completed"
            value={formatDateTime(jobOrder.productionCompletedAt)}
          />
        </DescriptionList>
      </Panel>

      {jobOrder.reworkTasks.length > 0 && (
        <Panel
          title="Rework"
          description="QA rework remains part of this original Job Order and is tracked separately by size and inspection cycle."
        >
          <div className="space-y-5">
            {openRework.length > 0 && (
              <section className="space-y-3" aria-label="Open rework cycles">
                <h3 className="text-sm font-semibold">Current open rework</h3>
                {openRework.map((task) => {
                  const notes = reworkNotesDrafts[task.id] ?? task.factoryNotes ?? '';
                  return (
                    <article
                      key={task.id}
                      className="space-y-4 rounded-md border border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {jobOrder.jobOrderNumber} · {task.styleNumber} {task.styleName} · Size{' '}
                            {task.sizeLabel}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Rework cycle {task.attemptNumber} · Requested{' '}
                            {formatDateTime(task.requestedAt)} by {task.requestedBy.name}
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
                        <DescriptionList.Item
                          label="QA remarks"
                          value={task.qaRemarks ?? 'Not recorded'}
                        />
                        <DescriptionList.Item
                          label="Acknowledged"
                          value={
                            task.acknowledgedAt
                              ? `${formatDateTime(task.acknowledgedAt)} by ${task.acknowledgedBy?.name ?? 'Factory'}`
                              : 'Not yet'
                          }
                        />
                        <DescriptionList.Item
                          label="Ready"
                          value={
                            task.readyAt
                              ? `${formatDateTime(task.readyAt)} by ${task.readyBy?.name ?? 'Factory'}`
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
                        Factory rework notes
                        <textarea
                          className="mt-1 min-h-24 w-full rounded-control border border-border bg-surface-raised px-3 py-2 font-normal"
                          maxLength={1000}
                          readOnly={!canPerformFactoryRework}
                          value={notes}
                          onChange={(event) =>
                            setReworkNotesDrafts((current) => ({
                              ...current,
                              [task.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {canPerformFactoryRework && (
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
                              onClick={() =>
                                reworkMutation.mutate({ task, action: 'acknowledge', notes })
                              }
                            >
                              Acknowledge rework
                            </Button>
                          )}
                          {task.status === 'ACKNOWLEDGED' && (
                            <Button
                              loading={reworkMutation.isPending}
                              onClick={() =>
                                reworkMutation.mutate({ task, action: 'ready', notes })
                              }
                            >
                              Mark complete quantity ready for reinspection
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
              <section className="space-y-2" aria-label="Previous rework cycles">
                <h3 className="text-sm font-semibold">Previous rework cycles</h3>
                {historicalRework.map((task) => (
                  <div key={task.id} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium">
                      {task.styleNumber} · Size {task.sizeLabel} · cycle {task.attemptNumber}
                    </p>
                    <p className="text-muted-foreground">
                      {task.assignedQuantity} units · Reinspected{' '}
                      {formatDateTime(task.reinspectedAt)}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {reworkMutation.isError && (
              <ValidationMessage tone="error">
                {mutationErrorMessage(
                  reworkMutation.error,
                  'Unable to update rework. Refresh and try again.',
                )}
              </ValidationMessage>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title="Factory commercial terms / disclaimer"
        description="Plain-text terms the factory must acknowledge before confirming this Job Order."
        footer={
          canEditDisclaimer ? (
            <div className="flex justify-end">
              <Button
                onClick={() => disclaimerMutation.mutate()}
                loading={disclaimerMutation.isPending}
              >
                Save disclaimer
              </Button>
            </div>
          ) : undefined
        }
      >
        {canEditDisclaimer ? (
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="job-order-disclaimer">
            <span>
              Disclaimer{' '}
              <span className="text-[var(--erp-form-field-error-text-color)]" aria-hidden="true">
                *
              </span>
            </span>
            <textarea
              ref={disclaimerRef}
              id="job-order-disclaimer"
              required
              aria-invalid={Boolean(disclaimerError) || undefined}
              aria-describedby={
                disclaimerError ? 'job-order-disclaimer-error' : 'job-order-disclaimer-help'
              }
              className={`min-h-32 rounded-control border bg-surface-raised px-[var(--erp-control-padding-x)] py-2 font-normal focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] ${
                disclaimerError
                  ? 'border-[var(--erp-form-field-error-border)] focus:border-[var(--erp-form-field-error-border)]'
                  : 'border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]'
              }`}
              value={disclaimerText}
              maxLength={10000}
              onChange={(event) => {
                const value = event.target.value;
                setDisclaimerDrafts((current) => ({ ...current, [jobOrder.id]: value }));
                if (value.trim()) {
                  setDisclaimerError('');
                  setSendError('');
                }
              }}
            />
            {disclaimerError ? (
              <span
                id="job-order-disclaimer-error"
                className="text-xs font-normal text-[var(--erp-form-field-error-text-color)]"
                role="alert"
              >
                {disclaimerError}
              </span>
            ) : null}
            <span
              id="job-order-disclaimer-help"
              className="text-xs font-normal text-muted-foreground"
            >
              Required before sending to the factory. {disclaimerText.length}/10,000
            </span>
          </label>
        ) : jobOrder.disclaimerText ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm font-sans">
            {jobOrder.disclaimerText}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">No disclaimer has been recorded.</p>
        )}
      </Panel>

      {canConfirm && (
        <Panel title="Factory acknowledgement review">
          <p className="text-sm text-muted-foreground">
            Review the style, size quantities, unit price, process flow, and disclaimer above before
            confirming.
          </p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={acknowledgeDisclaimer}
              onChange={(event) =>
                setAcknowledgedRevision(event.target.checked ? acknowledgementKey : '')
              }
            />
            I have read and acknowledge the Job Order commercial terms and disclaimer.
          </label>
        </Panel>
      )}

      {jobOrder.status === 'DRAFT' && (
        <Panel title="Production workflow not started">
          <p className="text-sm text-muted-foreground">
            Send this job order to the factory. Production stages will become available after the
            factory confirms it.
          </p>
        </Panel>
      )}

      {jobOrder.status === 'SENT_TO_FACTORY' && (
        <Panel title="Awaiting factory confirmation">
          <p className="text-sm text-muted-foreground">
            The production workflow will begin after {jobOrder.factory.name} confirms this job
            order.
          </p>
        </Panel>
      )}

      {hasProductionStarted && (
        <ProductionStageStepper
          stages={jobOrder.stages}
          currentStageId={nextStage?.id}
          isPreparedQuantitiesUnlocked={canUpdatePrepared}
        />
      )}

      {canCompleteStage && nextStage && (
        <Panel title={`Current Stage: ${nextStage.stageNameSnapshot}`}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Complete {nextStage.stageNameSnapshot} when work for this stage has finished.
            </p>
            <div className="flex">
              <Button
                onClick={() => completeStageMutation.mutate(nextStage.id)}
                loading={completeStageMutation.isPending}
              >
                Complete {nextStage.stageNameSnapshot}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {hasProductionStarted && (
        <Panel
          title="Prepared Quantity"
          description={
            canUpdatePrepared
              ? 'Update size-wise prepared quantities after production is complete.'
              : undefined
          }
          footer={
            canUpdatePrepared && (
              <div className="flex justify-end">
                <Button
                  onClick={() => preparedMutation.mutate(preparedPayload)}
                  disabled={!canUpdatePrepared}
                  loading={preparedMutation.isPending}
                >
                  Save Prepared Quantity
                </Button>
              </div>
            )
          }
        >
          {canUpdatePrepared ? (
            <DataTable
              columns={[
                { key: 'style', header: 'Style', accessor: 'style' },
                { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
                {
                  key: 'orderedQuantity',
                  header: 'Ordered',
                  align: 'right',
                  render: (size) => size.orderedQuantity.toLocaleString(),
                },
                {
                  key: 'preparedInput',
                  header: 'Prepared',
                  align: 'right',
                  render: (size) => (
                    <TextField
                      aria-label={`Prepared quantity for ${size.style} ${size.sizeCode}`}
                      type="number"
                      min={0}
                      value={preparedQuantities[size.id] ?? size.preparedQuantity}
                      onChange={(event) =>
                        setPreparedQuantities((current) => ({
                          ...current,
                          [size.id]: Number(event.target.value || 0),
                        }))
                      }
                      disabled={!canUpdatePrepared}
                      density="compact"
                      width="xs"
                    />
                  ),
                },
              ]}
              data={flatSizes}
              rowKey="id"
            />
          ) : (
            <div className="p-4 bg-muted/30 rounded-md border text-sm text-muted-foreground">
              Prepared quantities become available after{' '}
              {jobOrder.stages[jobOrder.stages.length - 1]?.stageNameSnapshot ?? 'the final stage'}{' '}
              is completed.
            </div>
          )}
        </Panel>
      )}

      <Panel title="Style and Size Quantities">
        <DataTable
          columns={[
            { key: 'style', header: 'Style', accessor: 'style' },
            { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
            {
              key: 'orderedQuantity',
              header: 'Ordered',
              align: 'right',
              render: (size) => size.orderedQuantity.toLocaleString(),
            },
            {
              key: 'preparedQuantity',
              header: 'Prepared',
              align: 'right',
              render: (size) => size.preparedQuantity.toLocaleString(),
            },
            {
              key: 'varianceQuantity',
              header: 'Variance',
              align: 'right',
              render: (size) => (size.preparedQuantity - size.orderedQuantity).toLocaleString(),
            },
          ]}
          data={flatSizes}
          rowKey="id"
        />
      </Panel>

      <Panel title="Seasons">
        <div className="text-sm text-muted-foreground">
          {(jobOrder.seasonSnapshots ?? []).map((season) => season.displayName).join(', ') ||
            'No Season snapshot'}
        </div>
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail
          items={(auditQuery.data ?? []).map((entry) => ({
            id: entry.id,
            title: formatJobOrderAuditTitle(entry.action, entry.metadata),
            actor: entry.actor?.name ?? 'System',
            timestamp: formatDateTime(entry.createdAt),
          }))}
          emptyState={auditQuery.isLoading ? 'Loading history…' : 'No history available.'}
        />
      </Panel>

      <Panel title="Factory acknowledgement evidence">
        {jobOrder.acknowledgement ? (
          <div className="space-y-3 text-sm">
            <p>
              Acknowledged by <strong>{jobOrder.acknowledgement.acknowledgedBy.name}</strong> at{' '}
              {formatDateTime(jobOrder.acknowledgement.acknowledgedAt)} (revision{' '}
              {jobOrder.acknowledgement.disclaimerRevision}).
            </p>
            <p className="break-all text-muted-foreground">
              SHA-256: {jobOrder.acknowledgement.disclaimerSha256}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-sans">
              {jobOrder.acknowledgement.disclaimerTextSnapshot}
            </pre>
          </div>
        ) : jobOrder.status !== 'DRAFT' ? (
          <p className="text-sm text-muted-foreground">
            No recorded disclaimer acknowledgement. This Job Order predates the acknowledgement
            workflow.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No acknowledgement is required while this Job Order is a draft.
          </p>
        )}
      </Panel>

      <ConfirmDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        title="Send job order to factory?"
        description="The selected process flow version will be locked for factory confirmation."
        confirmLabel="Send"
        loading={sendMutation.isPending}
        onConfirm={sendToFactory}
      />
    </div>
  );
}
