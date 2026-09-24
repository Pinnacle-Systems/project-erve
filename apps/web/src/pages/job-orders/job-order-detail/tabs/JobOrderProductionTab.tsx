import { useMemo, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import { ConfirmDialog, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import { apiClient } from '../../../../lib/api-client.js';
import { canManageJobOrderProduction } from '../../../../auth/permissions.js';
import type { Style } from '../../../master-data/types.js';
import type { JobOrder } from '../../types.js';
import { ProductionStageStepper } from '../../ProductionStageStepper.js';
import { STAGE_LABELS } from '../../job-order-ui.js';
import { mutationErrorMessage, type FlatSize } from '../job-order-detail-utils.js';

export interface JobOrderProductionTabDisclaimer {
  text: string;
  error: string;
  canEdit: boolean;
  onChange: (value: string) => void;
}

export interface JobOrderProductionTabAcknowledgement {
  canConfirm: boolean;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

export interface JobOrderProductionTabProps {
  jobOrder: JobOrder;
  user: AuthUser | null | undefined;
  flatSizes: FlatSize[];
  canManageJobOrders: boolean;
  disclaimer: JobOrderProductionTabDisclaimer;
  // Kept separate from `disclaimer` (not nested as a field on it): bundling
  // a RefObject alongside plain reactive values in one object makes React
  // Compiler's ref-safety lint (react-hooks/refs) treat every property on
  // that object as a tainted ref read during render, even the plain ones.
  disclaimerRef: RefObject<HTMLTextAreaElement | null>;
  acknowledgement: JobOrderProductionTabAcknowledgement;
}

// Every mutation and derived flag below is used exclusively inside this
// tab's own UI (nothing in the page shell, sticky bar, or another tab reads
// its pending/error state), so both live here rather than being threaded
// down from the page shell — invalidating the shared `job-order`/
// `job-order-audit` query keys works identically regardless of which
// component calls useMutation. The disclaimer *draft* and acknowledgement
// *checked* state are the one exception: those stay page-wide because a
// failed Send (triggered from the sticky bar, on any tab) must be able to
// switch here and focus the invalid field.
export function JobOrderProductionTab({
  jobOrder,
  user,
  flatSizes,
  canManageJobOrders,
  disclaimer,
  disclaimerRef,
  acknowledgement,
}: JobOrderProductionTabProps) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-order', jobOrder.id] });
    void queryClient.invalidateQueries({ queryKey: ['job-order-audit', jobOrder.id] });
  };

  const [markCompleteDialogOpen, setMarkCompleteDialogOpen] = useState(false);
  const [preparedQuantities, setPreparedQuantities] = useState<Record<string, number>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, number>>({});

  const disclaimerMutation = useMutation({
    mutationFn: async () =>
      apiClient.patch<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/disclaimer`,
        { expectedVersion: jobOrder.version, disclaimerText: disclaimer.text },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:disclaimer:${jobOrder.version}` } },
      ),
    onSuccess: invalidate,
  });

  const completeStageMutation = useMutation({
    mutationFn: async (stageStatusId: string) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/actions/complete-stage`,
        { stageStatusId, expectedVersion: jobOrder.version },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:stage:${stageStatusId}:${jobOrder.version}` } },
      ),
    onSuccess: invalidate,
  });

  const startStageMutation = useMutation({
    mutationFn: async (stageStatusId: string) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/actions/start-stage`,
        { stageStatusId, expectedVersion: jobOrder.version },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:start-stage:${stageStatusId}:${jobOrder.version}` } },
      ),
    onSuccess: invalidate,
  });

  const markProductionCompleteMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/actions/mark-production-complete`,
        { expectedVersion: jobOrder.version },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:mark-production-complete:${jobOrder.version}` } },
      ),
    onSuccess: () => {
      setMarkCompleteDialogOpen(false);
      invalidate();
    },
  });

  const preparedMutation = useMutation({
    mutationFn: async (sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/actions/update-prepared-quantity`,
        { sizes, expectedVersion: jobOrder.version },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:prepared:${jobOrder.version}` } },
      ),
    onSuccess: invalidate,
  });

  const updatePlanMutation = useMutation({
    mutationFn: async (sizes: Array<{ sizeId: string; quantity: number }>) =>
      apiClient.patch<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/production-plan`,
        { sizes, expectedVersion: jobOrder.version },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:plan:${jobOrder.version}:${Date.now()}` } },
      ),
    onSuccess: () => {
      setPlanDrafts({});
      invalidate();
    },
  });

  const canMutateProduction = canManageJobOrderProduction(user);
  const nextStage = jobOrder.stages.find((stage) => stage.status !== 'COMPLETED');
  const productionQualityGateLocked = jobOrder.qualityActivities.some(
    (activity) => activity.executionMode === 'SEQUENTIAL_GATE' && activity.status !== 'COMPLETED',
  );
  const canManageProductionStage =
    canMutateProduction &&
    ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status) &&
    Boolean(nextStage) &&
    !productionQualityGateLocked;
  const hasProductionStarted = ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION', 'PRODUCTION_COMPLETE'].includes(
    jobOrder.status,
  );
  const isPreparedQuantitiesUnlocked =
    jobOrder.preparedQuantityEntry?.available ?? jobOrder.status === 'PRODUCTION_COMPLETE';
  const canUpdatePrepared = canMutateProduction && isPreparedQuantitiesUnlocked;
  const canEditProductionPlan = jobOrder.status === 'DRAFT' && canManageJobOrders;
  // Mirrors the server's eligibility rule in markJobOrderProductionComplete
  // — a live in-progress stage must be stopped/completed first.
  const anyProductionStageInProgress = jobOrder.stages.some((stage) => stage.status === 'IN_PROGRESS');
  const canMarkProductionComplete = jobOrder.status === 'IN_PRODUCTION' && canManageJobOrders;

  const styleDetailQuery = useQuery({
    queryKey: ['style', jobOrder.lines[0]?.styleId],
    enabled: Boolean(jobOrder.lines[0]?.styleId) && canEditProductionPlan,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${jobOrder.lines[0]!.styleId}`)).data.data,
  });

  const productionPlanRows = useMemo(() => {
    const bySizeId = new Map<
      string,
      { sizeId: string; sizeCode: string; sizeLabel: string; sortOrder: number; active: boolean }
    >();
    for (const size of styleDetailQuery.data?.sizes ?? []) {
      bySizeId.set(size.id, {
        sizeId: size.id,
        sizeCode: size.code,
        sizeLabel: size.label,
        sortOrder: size.sortOrder,
        active: size.status === 'ACTIVE' && size.mappingStatus === 'ACTIVE',
      });
    }
    for (const size of flatSizes) {
      if (!bySizeId.has(size.sizeId)) {
        bySizeId.set(size.sizeId, {
          sizeId: size.sizeId,
          sizeCode: size.sizeCode,
          sizeLabel: size.sizeLabel,
          sortOrder: Number.POSITIVE_INFINITY,
          active: false,
        });
      }
    }
    for (const row of jobOrder.combinedForecast ?? []) {
      if (!bySizeId.has(row.sizeId)) {
        bySizeId.set(row.sizeId, {
          sizeId: row.sizeId,
          sizeCode: row.sizeCode,
          sizeLabel: row.sizeLabel,
          sortOrder: Number.POSITIVE_INFINITY,
          active: false,
        });
      }
    }
    return [...bySizeId.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [styleDetailQuery.data, flatSizes, jobOrder.combinedForecast]);

  function currentPlanQuantity(sizeId: string): number {
    return flatSizes.find((size) => size.sizeId === sizeId)?.orderedQuantity ?? 0;
  }

  const preparedPayload = flatSizes.map((size) => ({
    jobOrderLineSizeId: size.id,
    preparedQuantity: preparedQuantities[size.id] ?? size.preparedQuantity,
  }));

  return (
    <div className="space-y-4">
      <Panel
        title="Factory commercial terms / disclaimer"
        description={jobOrder.historicalImport
          ? 'Historical source wording; no factory acknowledgement was recorded.'
          : 'Plain-text terms the factory must acknowledge before confirming this Job Order.'}
        footer={
          disclaimer.canEdit ? (
            <div className="flex justify-end">
              <Button onClick={() => disclaimerMutation.mutate()} loading={disclaimerMutation.isPending}>
                Save disclaimer
              </Button>
            </div>
          ) : undefined
        }
      >
        {disclaimer.canEdit ? (
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
              aria-invalid={Boolean(disclaimer.error) || undefined}
              aria-describedby={disclaimer.error ? 'job-order-disclaimer-error' : 'job-order-disclaimer-help'}
              className={`min-h-32 rounded-control border bg-surface-raised px-[var(--erp-control-padding-x)] py-2 font-normal focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] ${
                disclaimer.error
                  ? 'border-[var(--erp-form-field-error-border)] focus:border-[var(--erp-form-field-error-border)]'
                  : 'border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]'
              }`}
              value={disclaimer.text}
              maxLength={10000}
              onChange={(event) => disclaimer.onChange(event.target.value)}
            />
            {disclaimer.error ? (
              <span
                id="job-order-disclaimer-error"
                className="text-xs font-normal text-[var(--erp-form-field-error-text-color)]"
                role="alert"
              >
                {disclaimer.error}
              </span>
            ) : null}
            <span id="job-order-disclaimer-help" className="text-xs font-normal text-muted-foreground">
              Required before sending to the factory. {disclaimer.text.length}/10,000
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

      {disclaimerMutation.isError && (
        <ValidationMessage tone="error">
          {disclaimerMutation.error instanceof Error
            ? disclaimerMutation.error.message
            : 'Unable to update disclaimer'}
        </ValidationMessage>
      )}

      {acknowledgement.canConfirm && (
        <Panel title="Factory acknowledgement review">
          <p className="text-sm text-muted-foreground">
            Review the style, size quantities, unit price, process flow, and disclaimer above before
            confirming.
          </p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={acknowledgement.checked}
              onChange={(event) => acknowledgement.onToggle(event.target.checked)}
            />
            I have read and acknowledge the Job Order commercial terms and disclaimer.
          </label>
        </Panel>
      )}

      {jobOrder.status === 'DRAFT' && (
        <Panel title="Production workflow not started">
          <p className="text-sm text-muted-foreground">
            Send this job order to the factory. Production stages will become available after the factory
            confirms it.
          </p>
        </Panel>
      )}

      {jobOrder.status === 'SENT_TO_FACTORY' && (
        <Panel title="Awaiting factory confirmation">
          <p className="text-sm text-muted-foreground">
            The production workflow will begin after {jobOrder.factory.name} confirms this job order.
          </p>
        </Panel>
      )}

      {productionQualityGateLocked && jobOrder.factoryConfirmationStatus === 'CONFIRMED' && (
        <Panel title="Production" actions={<StatusBadge label="Locked" tone="pending" />}>
          <p className="text-sm text-muted-foreground">
            Locked until pre-production Quality gates are completed.
          </p>
        </Panel>
      )}

      {hasProductionStarted && (
        <ProductionStageStepper
          stages={jobOrder.stages}
          currentStageId={nextStage?.id}
          isPreparedQuantitiesUnlocked={isPreparedQuantitiesUnlocked}
        />
      )}

      {['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status) &&
        !productionQualityGateLocked &&
        nextStage && (
          <Panel title={`Current Stage: ${nextStage.stageNameSnapshot}`}>
            {canManageProductionStage ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Complete {nextStage.stageNameSnapshot} when work for this stage has finished.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  {nextStage.status === 'NOT_STARTED' && (
                    <Button
                      variant="secondary"
                      onClick={() => startStageMutation.mutate(nextStage.id)}
                      loading={startStageMutation.isPending}
                    >
                      Start {nextStage.stageNameSnapshot}
                    </Button>
                  )}
                  {nextStage.status === 'IN_PROGRESS' && (
                    <Button
                      onClick={() => completeStageMutation.mutate(nextStage.id)}
                      loading={completeStageMutation.isPending}
                    >
                      Complete {nextStage.stageNameSnapshot}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Production status: {STAGE_LABELS[nextStage.status]}
              </p>
            )}
          </Panel>
        )}

      {(completeStageMutation.isError || preparedMutation.isError) && (
        <ValidationMessage tone="error">
          {[completeStageMutation.error, preparedMutation.error].find((error) => error instanceof Error)
            ?.message ?? 'Unable to update job order'}
        </ValidationMessage>
      )}

      {jobOrder.status === 'IN_PRODUCTION' && (
        <Panel title="Production Completion">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Production completes automatically once the entire planned quantity has been produced and
              carried through Final QA to a resolved outcome (Released or Permanently Rejected). This is
              independent of Dispatch — no Dispatch Order or delivery activity is required.
            </p>
            {canManageJobOrders && (
              <>
                <p className="text-sm text-muted-foreground">
                  If no further production will be pursued for this Job Order — including a short-produced
                  quantity that will not be completed — Merchandising can mark it Production Complete now.
                </p>
                {anyProductionStageInProgress && (
                  <p className="text-sm text-[var(--erp-form-field-error-text-color)]">
                    Stop or complete the in-progress production stage before marking Production Complete.
                  </p>
                )}
                <div>
                  <Button
                    variant="secondary"
                    disabled={!canMarkProductionComplete || anyProductionStageInProgress}
                    onClick={() => setMarkCompleteDialogOpen(true)}
                  >
                    Mark Production Complete
                  </Button>
                </div>
                {markProductionCompleteMutation.isError && (
                  <ValidationMessage tone="error">
                    {mutationErrorMessage(
                      markProductionCompleteMutation.error,
                      'Unable to mark this Job Order Production Complete.',
                    )}
                  </ValidationMessage>
                )}
              </>
            )}
          </div>
        </Panel>
      )}

      {hasProductionStarted && (
        <Panel
          title="Prepared Quantity"
          description={
            canUpdatePrepared
              ? 'Update the cumulative size-wise quantity prepared for Final inspection so far.'
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
                      max={size.orderedQuantity}
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
          ) : isPreparedQuantitiesUnlocked ? (
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
              ]}
              data={flatSizes}
              rowKey="id"
            />
          ) : (
            <div className="p-4 bg-muted/30 rounded-md border text-sm text-muted-foreground">
              Prepared quantities become available after{' '}
              {jobOrder.preparedQuantityEntry?.associatedProductionActivity?.name ??
                jobOrder.stages[jobOrder.stages.length - 1]?.stageNameSnapshot ??
                'the configured Production activity'}{' '}
              satisfies the Process Flow rule.
            </div>
          )}
        </Panel>
      )}

      <Panel
        title="Production Plan"
        description={
          canEditProductionPlan
            ? "The Job Order's own size-wise production quantities — independent of source Order Sheets. Editable while this Job Order is a draft; source Order Sheet changes never alter it."
            : undefined
        }
        footer={
          canEditProductionPlan ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                {updatePlanMutation.isError && (
                  <ValidationMessage tone="error">
                    {mutationErrorMessage(updatePlanMutation.error, 'Unable to update the production plan.')}
                  </ValidationMessage>
                )}
              </div>
              <Button
                onClick={() =>
                  updatePlanMutation.mutate(
                    productionPlanRows
                      .filter((row) => row.active)
                      .map((row) => ({
                        sizeId: row.sizeId,
                        quantity: planDrafts[row.sizeId] ?? currentPlanQuantity(row.sizeId),
                      })),
                  )
                }
                loading={updatePlanMutation.isPending}
              >
                Save Production Plan
              </Button>
            </div>
          ) : undefined
        }
      >
        {canEditProductionPlan ? (
          <DataTable
            density="compact"
            columns={[
              { key: 'size', header: 'Size', render: (row) => row.sizeLabel },
              {
                key: 'quantity',
                header: 'Production Plan',
                align: 'right',
                render: (row) =>
                  row.active ? (
                    <TextField
                      aria-label={`Production quantity for ${row.sizeLabel}`}
                      type="number"
                      min={0}
                      value={planDrafts[row.sizeId] ?? currentPlanQuantity(row.sizeId)}
                      onChange={(event) =>
                        setPlanDrafts((current) => ({
                          ...current,
                          [row.sizeId]: Math.max(0, Number(event.target.value || 0)),
                        }))
                      }
                      density="compact"
                      width="xs"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {currentPlanQuantity(row.sizeId) > 0
                        ? `${currentPlanQuantity(row.sizeId).toLocaleString()} — size inactive, cannot be changed`
                        : 'Size inactive — cannot be produced'}
                    </span>
                  ),
              },
            ]}
            data={productionPlanRows}
            rowKey="sizeId"
          />
        ) : (
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
        )}
      </Panel>

      <ConfirmDialog
        open={markCompleteDialogOpen}
        onOpenChange={setMarkCompleteDialogOpen}
        title="Mark Production Complete?"
        description="No further production is expected for this Job Order — any remaining planned quantity will not be pursued. This does not create or change Prepared Quantity, QA Releases, or Final QA outcomes, and does not affect Dispatch or pooled inventory."
        confirmLabel="Confirm"
        loading={markProductionCompleteMutation.isPending}
        onConfirm={() => markProductionCompleteMutation.mutate()}
      />
    </div>
  );
}
