import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, ConfirmDialog, PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { PurchaseOrder, PurchaseOrderStatus } from './types.js';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  PARTIALLY_JOB_ORDERED: 'Partially Job Ordered',
  FULLY_JOB_ORDERED: 'Fully Job Ordered',
  PARTIALLY_FULFILLED: 'Partially Fulfilled',
  FULLY_FULFILLED: 'Fully Fulfilled',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusTone(status: PurchaseOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'CLOSED') return 'posted';
  if (status.includes('FULFILLED')) return 'success';
  if (status.includes('JOB_ORDERED')) return 'info';
  return 'pending';
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`);
      return res.data.data;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}/actions/submit`);
      return res.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-order', id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}/actions/cancel`);
      return res.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-order', id] }),
  });

  const po = poQuery.data;

  if (poQuery.isLoading) {
    return <LoadingState label="Loading purchase order" />;
  }
  if (!po) {
    return <EmptyState title="Purchase order not found" description="The selected PO could not be loaded." tone="error" />;
  }

  const isDraft = po.status === 'DRAFT';
  const canCancel = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(po.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={po.poNumber}
        subtitle={po.distributor.name}
        status={<StatusBadge label={STATUS_LABELS[po.status]} tone={statusTone(po.status)} />}
        secondaryActions={
          <>
          {isDraft && (
            <Button asChild variant="secondary">
              <Link to={`/purchase-orders/${id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>
            Back
          </Button>
          </>
        }
        primaryAction={
          <div className="flex gap-2">
          {isDraft && (
            <Button
              onClick={() => submitMutation.mutate()}
              loading={submitMutation.isPending}
            >
              Submit
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              onClick={() => setCancelDialogOpen(true)}
              loading={cancelMutation.isPending}
            >
              Cancel PO
            </Button>
          )}
          </div>
        }
      />

      {(submitMutation.isError || cancelMutation.isError) && (
        <p className="text-sm text-[var(--erp-form-field-error-text-color)]">
          {submitMutation.error instanceof Error ? submitMutation.error.message : ''}
          {cancelMutation.error instanceof Error ? cancelMutation.error.message : ''}
        </p>
      )}

      <Panel title="PO Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="PO Date" value={formatDate(po.poDate)} />
          <DescriptionList.Item label="Required Delivery" value={po.requiredDeliveryDate ? formatDate(po.requiredDeliveryDate) : null} />
          <DescriptionList.Item label="Purchase Mode" value={po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale Return'} />
          <DescriptionList.Item label="Total Qty" value={po.totalOrderedQuantity.toLocaleString()} />
          <DescriptionList.Item label="Merchandiser" value={po.merchandiser?.name} />
          <DescriptionList.Item label="Created By" value={po.creator.name} />
          <DescriptionList.Item label="Created" value={formatDate(po.createdAt)} />
          <DescriptionList.Item label="Remarks" value={po.remarks} span={2} />
        </DescriptionList>
      </Panel>

      <Panel title="Style and Size-wise Quantities">
        {po.lines.map((line) => (
          <Panel key={line.id} variant="bordered" padding="none" className="mb-4 last:mb-0">
            <div className="border-b border-border-subtle bg-surface-muted px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <span className="font-medium text-foreground">{line.styleNumber}</span>
                <span className="ml-2 text-sm text-muted-foreground">{line.styleName}</span>
              </div>
              <span className="text-sm font-medium text-foreground">
                Total: {line.totalOrderedQuantity.toLocaleString()}
              </span>
            </div>
            <DataTable
              columns={[
                { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
                { key: 'orderedQuantity', header: 'Ordered', accessor: 'orderedQuantity', align: 'right' },
                { key: 'jobOrderedQuantity', header: 'Job Ordered', accessor: 'jobOrderedQuantity', align: 'right' },
                { key: 'dispatchedQuantity', header: 'Dispatched', accessor: 'dispatchedQuantity', align: 'right' },
                { key: 'deliveredQuantity', header: 'Delivered', accessor: 'deliveredQuantity', align: 'right' },
              ]}
              data={line.sizes}
              rowKey="id"
              containerClassName="rounded-none border-0 shadow-none"
            />
          </Panel>
        ))}
      </Panel>

      <Panel title="Job Order Balance">
        <TotalsPanel
          items={[
            { label: 'Ordered', value: po.totalOrderedQuantity.toLocaleString() },
            { label: 'Job ordered', value: 'Pending job order module', emphasis: 'muted' },
          ]}
        />
      </Panel>

      <Panel title="Fulfilment Summary">
        <TotalsPanel
          items={[
            { label: 'Dispatched', value: 'Pending dispatch records', emphasis: 'muted' },
            { label: 'Delivered', value: 'Pending delivery records', emphasis: 'muted' },
          ]}
        />
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail items={[]} emptyState="Audit log panel will be available in a future update." />
      </Panel>

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel purchase order?"
        description="This will cancel the PO using the existing cancel action."
        confirmLabel="Cancel PO"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate(undefined, { onSuccess: () => setCancelDialogOpen(false) })}
      />
    </div>
  );
}
