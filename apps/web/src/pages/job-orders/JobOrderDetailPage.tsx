import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { JobOrder, JobOrderLineSize } from './types.js';
import {
  CONFIRMATION_LABELS,
  JOB_ORDER_STATUS_LABELS,
  STAGE_LABELS,
  confirmationTone,
  formatDateTime,
  stageTone,
  statusTone,
} from './job-order-ui.js';

type FlatSize = JobOrderLineSize & {
  style: string;
  linePreparedQuantityTotal: number;
};

export function JobOrderDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [preparedQuantities, setPreparedQuantities] = useState<Record<string, number>>({});

  const jobOrderQuery = useQuery({
    queryKey: ['job-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}`);
      return res.data.data;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job-order', id] });

  const sendMutation = useMutation({
    mutationFn: async () => apiClient.post<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}/actions/send-to-factory`),
    onSuccess: () => {
      setSendDialogOpen(false);
      invalidate();
    },
  });
  const confirmMutation = useMutation({
    mutationFn: async () => apiClient.post<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}/actions/confirm`),
    onSuccess: invalidate,
  });
  const completeStageMutation = useMutation({
    mutationFn: async (stageStatusId: string) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}/actions/complete-stage`, { stageStatusId }),
    onSuccess: invalidate,
  });
  const preparedMutation = useMutation({
    mutationFn: async (sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>) =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}/actions/update-prepared-quantity`, { sizes }),
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
  if (!jobOrder) return <EmptyState title="Job order not found" description="The selected job order could not be loaded." tone="error" />;

  const canSend = jobOrder.status === 'DRAFT';
  const canConfirm = jobOrder.status === 'SENT_TO_FACTORY';
  const canCompleteStage = ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status) && Boolean(nextStage);
  const canUpdatePrepared = jobOrder.status === 'PRODUCTION_COMPLETE';
  const preparedPayload = flatSizes.map((size) => ({
    jobOrderLineSizeId: size.id,
    preparedQuantity: preparedQuantities[size.id] ?? size.preparedQuantity,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={jobOrder.jobOrderNumber}
        subtitle={`From ${jobOrder.purchaseOrder.poNumber}`}
        status={<StatusBadge label={JOB_ORDER_STATUS_LABELS[jobOrder.status]} tone={statusTone(jobOrder.status)} />}
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        }
        primaryAction={
          <div className="flex flex-wrap gap-2">
            {canSend && <Button onClick={() => setSendDialogOpen(true)}>Send to Factory</Button>}
            {canConfirm && <Button onClick={() => confirmMutation.mutate()} loading={confirmMutation.isPending}>Confirm</Button>}
            {canCompleteStage && nextStage && (
              <Button onClick={() => completeStageMutation.mutate(nextStage.id)} loading={completeStageMutation.isPending}>
                Complete Next Stage
              </Button>
            )}
          </div>
        }
      />

      {(sendMutation.isError || confirmMutation.isError || completeStageMutation.isError || preparedMutation.isError) && (
        <ValidationMessage tone="error">
          {[sendMutation.error, confirmMutation.error, completeStageMutation.error, preparedMutation.error]
            .find((error) => error instanceof Error)?.message ?? 'Unable to update job order'}
        </ValidationMessage>
      )}

      <Panel title="Job Order Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Source PO" value={jobOrder.purchaseOrder.poNumber} />
          <DescriptionList.Item label="Factory" value={jobOrder.factory.name} />
          <DescriptionList.Item label="Process Flow" value={`${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`} />
          <DescriptionList.Item
            label="Confirmation"
            value={<StatusBadge label={CONFIRMATION_LABELS[jobOrder.factoryConfirmationStatus]} tone={confirmationTone(jobOrder.factoryConfirmationStatus)} />}
          />
          <DescriptionList.Item label="Ordered Qty" value={jobOrder.orderedQuantityTotal.toLocaleString()} />
          <DescriptionList.Item label="Prepared Qty" value={jobOrder.preparedQuantityTotal.toLocaleString()} />
          <DescriptionList.Item label="Variance" value={(jobOrder.preparedQuantityTotal - jobOrder.orderedQuantityTotal).toLocaleString()} />
          <DescriptionList.Item label="Created" value={formatDateTime(jobOrder.createdAt)} />
          <DescriptionList.Item label="Confirmed By" value={jobOrder.confirmedBy?.name} />
          <DescriptionList.Item label="Confirmed At" value={formatDateTime(jobOrder.confirmedAt)} />
          <DescriptionList.Item label="Production Started" value={formatDateTime(jobOrder.productionStartedAt)} />
          <DescriptionList.Item label="Production Completed" value={formatDateTime(jobOrder.productionCompletedAt)} />
        </DescriptionList>
      </Panel>

      <Panel title="Style and Size Quantities">
        <DataTable
          columns={[
            { key: 'style', header: 'Style', accessor: 'style' },
            { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
            { key: 'orderedQuantity', header: 'Ordered', align: 'right', render: (size) => size.orderedQuantity.toLocaleString() },
            { key: 'preparedQuantity', header: 'Prepared', align: 'right', render: (size) => size.preparedQuantity.toLocaleString() },
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

      <Panel title="Production Stage Timeline">
        <DataTable
          columns={[
            { key: 'stageSequence', header: 'Seq', accessor: 'stageSequence', width: '72px' },
            { key: 'stageNameSnapshot', header: 'Stage', accessor: 'stageNameSnapshot' },
            {
              key: 'status',
              header: 'Status',
              render: (stage) => <StatusBadge label={STAGE_LABELS[stage.status]} tone={stageTone(stage.status)} />,
            },
            { key: 'completedAt', header: 'Completed', render: (stage) => formatDateTime(stage.completedAt) ?? '—' },
            { key: 'completedBy', header: 'Completed By', render: (stage) => stage.completedBy?.name ?? '—' },
            { key: 'remarks', header: 'Remarks', render: (stage) => stage.remarks ?? '—' },
          ]}
          data={jobOrder.stages}
          rowKey="id"
          emptyState={<EmptyState title="No stages yet" description="Stages are created when the factory confirms the job order." />}
          selectedRowKey={nextStage?.id}
        />
      </Panel>

      <Panel
        title="Prepared Quantity"
        description="Update size-wise prepared quantities after production is complete."
        footer={
          <div className="flex justify-end">
            <Button
              onClick={() => preparedMutation.mutate(preparedPayload)}
              disabled={!canUpdatePrepared}
              loading={preparedMutation.isPending}
            >
              Save Prepared Quantity
            </Button>
          </div>
        }
      >
        <DataTable
          columns={[
            { key: 'style', header: 'Style', accessor: 'style' },
            { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
            { key: 'orderedQuantity', header: 'Ordered', align: 'right', render: (size) => size.orderedQuantity.toLocaleString() },
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
                  onChange={(event) => setPreparedQuantities((current) => ({ ...current, [size.id]: Number(event.target.value || 0) }))}
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
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail items={[]} emptyState="Audit log panel will be connected when the audit API is exposed." />
      </Panel>

      <ConfirmDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        title="Send job order to factory?"
        description="The selected process flow version will be locked for factory confirmation."
        confirmLabel="Send"
        loading={sendMutation.isPending}
        onConfirm={() => sendMutation.mutate()}
      />
    </div>
  );
}
