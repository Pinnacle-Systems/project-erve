import { useMemo, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import {
  ConfirmDialog,
  NOT_RECORDED_LABEL,
  StatusBadge,
  createEnterToNextHandler,
  formatPreparedQuantity,
  formatPreparedVariance,
} from '@erve/app-components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import { apiClient } from '../../../../lib/api-client.js';
import { canManageJobOrderProduction, canUndoProductionStage } from '../../../../auth/permissions.js';
import type { Style } from '../../../master-data/types.js';
import type { JobOrder, JobOrderStage } from '../../types.js';
import { ProductionStageStepper } from '../../ProductionStageStepper.js';
import { STAGE_LABELS, formatDateTime } from '../../job-order-ui.js';
import { mutationErrorMessage, type FlatSize } from '../job-order-detail-utils.js';
import { JobOrderPlanningGrid } from '../../JobOrderPlanningGrid.js';

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
  const [undoStage, setUndoStage] = useState<JobOrderStage | null>(null);
  const [undoReason, setUndoReason] = useState('');
  // Date.now() may not be called directly during render (react-hooks/purity)
  // — capture it once per mount instead, matching SessionDialogs.tsx's own
  // lazy useState(() => Date.now()) pattern. A page left open past the
  // 24-hour Merchandiser window won't hide the button until the next
  // reload/remount; the backend enforces the window authoritatively
  // regardless, so this is a display-only staleness, not a security gap.
  const [undoEligibilityCheckedAt] = useState(() => Date.now());

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

  const undoStageMutation = useMutation({
    mutationFn: async ({ stageStatusId, reason }: { stageStatusId: string; reason: string }) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/actions/undo-stage`,
        { stageStatusId, expectedVersion: jobOrder.version, reason },
        { headers: { 'Idempotency-Key': `${jobOrder.id}:undo-stage:${stageStatusId}:${jobOrder.version}` } },
      ),
    onSuccess: () => {
      setUndoStage(null);
      setUndoReason('');
      invalidate();
    },
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
  // A historical import is read-only evidence: prepared quantity is never
  // entered for it (the API refuses it too), whatever its status.
  const isPreparedQuantitiesUnlocked =
    !jobOrder.historicalImport &&
    (jobOrder.preparedQuantityEntry?.available ?? jobOrder.status === 'PRODUCTION_COMPLETE');
  const canUpdatePrepared = canMutateProduction && isPreparedQuantitiesUnlocked;
  const canEditProductionPlan = jobOrder.status === 'DRAFT' && canManageJobOrders;
  // Mirrors the server's eligibility rule in markJobOrderProductionComplete
  // — a live in-progress stage must be stopped/completed first.
  const anyProductionStageInProgress = jobOrder.stages.some((stage) => stage.status === 'IN_PROGRESS');
  const canMarkProductionComplete = jobOrder.status === 'IN_PRODUCTION' && canManageJobOrders;

  // DEMO-010: the Undo action is only ever offered for the single
  // most-recently-completed stage (jobOrder.stages is sequence-ordered), and
  // only while the stage after it has not started — mirrors the server's own
  // eligibility rule exactly (job-orders.service.ts's
  // undoCompletedProductionStage) so the button never appears somewhere the
  // backend would reject anyway. The 24-hour Merchandiser-only window is
  // read directly off this stage's completedAt; Admin has no such limit.
  const isAdminUser = Boolean(user?.roles.includes('ADMIN'));
  const completedStages = jobOrder.stages.filter((stage) => stage.status === 'COMPLETED');
  const lastCompletedStage = completedStages.at(-1);
  const stageAfterLastCompleted = lastCompletedStage
    ? jobOrder.stages.find((stage) => stage.stageSequence === lastCompletedStage.stageSequence + 1)
    : undefined;
  const undoNextStageNotStarted = !stageAfterLastCompleted || stageAfterLastCompleted.status === 'NOT_STARTED';
  const undoWithinMerchandiserWindow =
    isAdminUser ||
    !lastCompletedStage?.completedAt ||
    undoEligibilityCheckedAt - new Date(lastCompletedStage.completedAt).getTime() <= 24 * 60 * 60 * 1000;
  const canOfferUndo =
    canUndoProductionStage(user) &&
    Boolean(lastCompletedStage) &&
    undoNextStageNotStarted &&
    undoWithinMerchandiserWindow &&
    ['IN_PRODUCTION', 'PRODUCTION_COMPLETE'].includes(jobOrder.status);

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
          <Textarea
            ref={disclaimerRef}
            id="job-order-disclaimer"
            label="Disclaimer"
            required
            errorMessage={disclaimer.error || undefined}
            helpText={`Required before sending to the factory. ${disclaimer.text.length}/10,000`}
            value={disclaimer.text}
            maxLength={10000}
            onChange={(event) => disclaimer.onChange(event.target.value)}
            className="min-h-32"
          />
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

      {canOfferUndo && lastCompletedStage && (
        <Panel title="Undo completed stage">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {lastCompletedStage.stageNameSnapshot} was completed
              {formatDateTime(lastCompletedStage.completedAt)
                ? ` on ${formatDateTime(lastCompletedStage.completedAt)}`
                : ''}
              {lastCompletedStage.completedBy?.name ? ` by ${lastCompletedStage.completedBy.name}` : ''}.
              {!isAdminUser &&
                ' As Merchandising, this can only be undone within 24 hours of completion.'}
            </p>
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setUndoStage(lastCompletedStage);
                  setUndoReason('');
                }}
              >
                Undo {lastCompletedStage.stageNameSnapshot}
              </Button>
            </div>
            {undoStageMutation.isError && (
              <ValidationMessage tone="error">
                {mutationErrorMessage(
                  undoStageMutation.error,
                  `Unable to undo ${lastCompletedStage.stageNameSnapshot}.`,
                )}
              </ValidationMessage>
            )}
          </div>
        </Panel>
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
                      variant="default"
                      onClick={() => startStageMutation.mutate(nextStage.id)}
                      loading={startStageMutation.isPending}
                    >
                      Start {nextStage.stageNameSnapshot}
                    </Button>
                  )}
                  {nextStage.status === 'IN_PROGRESS' && (
                    <Button
                      variant="default"
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
          {jobOrder.historicalImport ? (
            <div className="p-4 bg-muted/30 rounded-md border text-sm text-muted-foreground">
              {NOT_RECORDED_LABEL} — this is a historical imported Job Order; no prepared quantity was recorded.
            </div>
          ) : canUpdatePrepared ? (
            <div onKeyDown={createEnterToNextHandler()}>
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
            </div>
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
          <JobOrderPlanningGrid
            styleId={jobOrder.lines[0]?.styleId ?? ''}
            styleNumber={jobOrder.lines[0]?.styleNumber ?? ''}
            styleName={jobOrder.lines[0]?.styleName}
            primaryImage={jobOrder.lines[0]?.primaryImage ?? null}
            sizes={productionPlanRows.map((row) => ({
              sizeId: row.sizeId,
              sizeCode: row.sizeCode,
              active: row.active,
              quantity: planDrafts[row.sizeId] ?? currentPlanQuantity(row.sizeId),
            }))}
            onQuantityChange={(sizeId, value) =>
              setPlanDrafts((current) => ({ ...current, [sizeId]: value ?? 0 }))
            }
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
                render: (size) => formatPreparedQuantity(jobOrder, size.preparedQuantity),
              },
              {
                key: 'varianceQuantity',
                header: 'Variance',
                align: 'right',
                render: (size) => formatPreparedVariance(jobOrder, size.preparedQuantity, size.orderedQuantity),
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

      <Dialog
        open={undoStage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUndoStage(null);
            setUndoReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo {undoStage?.stageNameSnapshot}?</DialogTitle>
            <DialogDescription>
              This reopens {undoStage?.stageNameSnapshot} and reverses its completion. A reason is
              required and is recorded in this Job Order&apos;s audit history.
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="Reason"
            width="fill"
            value={undoReason}
            onChange={(event) => setUndoReason(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setUndoStage(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={undoStageMutation.isPending}
              disabled={!undoReason.trim()}
              onClick={() =>
                undoStage &&
                undoStageMutation.mutate({ stageStatusId: undoStage.id, reason: undoReason.trim() })
              }
            >
              Undo stage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
