import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, ConfirmDialog, PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canCreateJobOrders } from '../../auth/permissions.js';
import type {
  PurchaseOrder,
  PurchaseOrderBalance,
  PurchaseOrderFulfilmentSummary,
  PurchaseOrderStatus,
} from './types.js';

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
  const { user } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`);
      return res.data.data;
    },
  });

  // Reuses the same canonical Job Order balance read model that Job Order
  // creation reads from, rather than re-deriving ordered/job-ordered/balance
  // from the PO's own line data.
  const balanceQuery = useQuery({
    queryKey: ['purchase-order-job-order-balance', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrderBalance>>(
        `/purchase-orders/${id}/job-order-balance`,
      );
      return res.data.data;
    },
  });

  const balanceTotals = useMemo(() => {
    const lines = balanceQuery.data?.lines ?? [];
    return lines.reduce(
      (totals, line) => {
        for (const size of line.sizes) {
          totals.ordered += size.orderedQuantity;
          totals.jobOrdered += size.jobOrderedQuantity;
          totals.remaining += size.balanceQuantity;
        }
        return totals;
      },
      { ordered: 0, jobOrdered: 0, remaining: 0 },
    );
  }, [balanceQuery.data]);

  // Reuses the same canonical Ordered -> Job Ordered -> Prepared -> QA
  // Released -> Sale Order Allocated reconciliation the backend already
  // computes from Job Order, Final QA, and Stock Allocation records, rather
  // than re-deriving any of those figures on the client.
  const fulfilmentQuery = useQuery({
    queryKey: ['purchase-order-fulfilment-summary', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrderFulfilmentSummary>>(
        `/purchase-orders/${id}/fulfilment-summary`,
      );
      return res.data.data;
    },
  });

  const fulfilmentTotals = useMemo(() => {
    const lines = fulfilmentQuery.data?.lines ?? [];
    return lines.reduce(
      (totals, line) => {
        totals.ordered += line.totals.orderedQuantity;
        totals.jobOrdered += line.totals.jobOrderedQuantity;
        totals.prepared += line.totals.preparedQuantity;
        totals.qaReleased += line.totals.qaReleasedQuantity;
        totals.saleOrderAllocated += line.totals.saleOrderAllocatedQuantity;
        totals.notPrepared += line.totals.notPreparedQuantity;
        totals.preparedNotReleased += line.totals.preparedNotReleasedQuantity;
        totals.releasedUnallocated += line.totals.releasedUnallocatedQuantity;
        return totals;
      },
      {
        ordered: 0,
        jobOrdered: 0,
        prepared: 0,
        qaReleased: 0,
        saleOrderAllocated: 0,
        notPrepared: 0,
        preparedNotReleased: 0,
        releasedUnallocated: 0,
      },
    );
  }, [fulfilmentQuery.data]);

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
  // Remaining balance from the canonical Job Order balance read model is the
  // authoritative signal for whether another Job Order can claim quantity;
  // the status exclusion below is only a consistency check that mirrors the
  // backend's own status gate (see job-orders.service.ts), not a substitute.
  const hasRemainingJobOrderBalance = balanceQuery.data !== undefined && balanceTotals.remaining > 0;
  const canCreateJobOrder =
    canCreateJobOrders(user) &&
    !['DRAFT', 'CANCELLED', 'CLOSED'].includes(po.status) &&
    hasRemainingJobOrderBalance;

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
          {canCreateJobOrder && (
            <Button asChild>
              <Link to={`/job-orders/new?purchaseOrderId=${po.id}`}>Create Job Order</Link>
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
          {submitMutation.isError &&
            getApiErrorMessage(submitMutation.error, 'Unable to submit this purchase order. Please try again.')}
          {cancelMutation.isError &&
            getApiErrorMessage(cancelMutation.error, 'Unable to cancel this purchase order. Please try again.')}
        </p>
      )}

      <Panel title="PO Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="PO Date" value={formatDate(po.poDate)} />
          <DescriptionList.Item label="Required Delivery" value={po.requiredDeliveryDate ? formatDate(po.requiredDeliveryDate) : null} />
          <DescriptionList.Item label="Purchase Mode" value={po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale or Return'} />
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
                <span className="ml-2 text-xs text-muted-foreground">{line.seasonSnapshots.map((season) => season.displayName).join(', ')}</span>
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
              ]}
              data={line.sizes}
              rowKey="id"
              containerClassName="rounded-none border-0 shadow-none"
            />
          </Panel>
        ))}
      </Panel>

      <Panel title="Job Order Balance">
        {balanceQuery.isLoading && <LoadingState label="Loading job order balance" density="compact" />}
        {balanceQuery.isError && (
          <ErrorState
            title="Unable to load job order balance"
            description={
              balanceQuery.error instanceof Error ? balanceQuery.error.message : undefined
            }
          />
        )}
        {balanceQuery.data && (
          <TotalsPanel
            items={[
              { label: 'Total ordered', value: balanceTotals.ordered.toLocaleString() },
              { label: 'Job ordered', value: balanceTotals.jobOrdered.toLocaleString() },
              {
                label: 'Remaining balance',
                value: balanceTotals.remaining.toLocaleString(),
                emphasis: 'strong',
                tone: balanceTotals.remaining === 0 ? 'success' : 'default',
                description:
                  balanceTotals.jobOrdered === 0
                    ? 'No Job Orders created yet'
                    : balanceTotals.remaining === 0
                      ? 'Fully allocated across Job Orders'
                      : 'Partially allocated across Job Orders',
                dividerBefore: true,
              },
            ]}
          />
        )}
      </Panel>

      <Panel title="Fulfilment Summary">
        {fulfilmentQuery.isLoading && <LoadingState label="Loading fulfilment summary" density="compact" />}
        {fulfilmentQuery.isError && (
          <ErrorState
            title="Unable to load fulfilment summary"
            description={
              fulfilmentQuery.error instanceof Error ? fulfilmentQuery.error.message : undefined
            }
          />
        )}
        {fulfilmentQuery.data && fulfilmentTotals.ordered === 0 && (
          <EmptyState
            title="No quantities ordered yet"
            description="This purchase order has no size lines to summarise."
          />
        )}
        {fulfilmentQuery.data && fulfilmentTotals.ordered > 0 && (
          <TotalsPanel
            items={[
              { label: 'PO Ordered', value: fulfilmentTotals.ordered.toLocaleString() },
              { label: 'Job Ordered', value: fulfilmentTotals.jobOrdered.toLocaleString() },
              {
                label: 'Prepared',
                value: fulfilmentTotals.prepared.toLocaleString(),
                description: 'Production completed, awaiting Final QA',
              },
              {
                label: 'QA Released',
                value: fulfilmentTotals.qaReleased.toLocaleString(),
                description: 'Passed Final QA, available for allocation',
              },
              {
                label: 'Allocated to Sale Orders',
                value: fulfilmentTotals.saleOrderAllocated.toLocaleString(),
                emphasis: 'strong',
                tone: fulfilmentTotals.saleOrderAllocated > 0 ? 'success' : 'default',
              },
              { label: 'Not yet prepared', value: fulfilmentTotals.notPrepared.toLocaleString(), dividerBefore: true },
              {
                label: 'Prepared, awaiting Final QA',
                value: fulfilmentTotals.preparedNotReleased.toLocaleString(),
              },
              {
                label: 'QA released, not yet allocated',
                value: fulfilmentTotals.releasedUnallocated.toLocaleString(),
              },
            ]}
          />
        )}
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
