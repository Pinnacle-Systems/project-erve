import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canCreateJobOrders, canManagePurchaseOrders } from '../../auth/permissions.js';
import type { OrderSheetPlanningState, PurchaseOrder } from './types.js';
import { getOrderSheetPlanningState } from './types.js';

const PLANNING_STATE_LABELS: Record<OrderSheetPlanningState, string> = {
  AVAILABLE: 'Available for Job Order',
  INCLUDED_IN_JOB_ORDER: 'Included in Job Order',
  CANCELLED: 'Cancelled',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function planningStateTone(state: OrderSheetPlanningState) {
  if (state === 'CANCELLED') return 'cancelled';
  if (state === 'INCLUDED_IN_JOB_ORDER') return 'info';
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

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}/actions/cancel`);
      return res.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-order', id] }),
  });

  const po = poQuery.data;

  const generateOrderSheetDetailPdf = useCallback(async () => {
    if (!po) throw new Error('Order Sheet not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateOrderSheetDetailPdfBlob } = await import('./pdf/generateOrderSheetDetailPdf.js');
    return generateOrderSheetDetailPdfBlob(po, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [po, user?.name]);

  const orderSheetDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Order-Sheet', po?.poNumber]),
    [po?.poNumber],
  );

  const pdfAction = usePdfAction({
    generate: generateOrderSheetDetailPdf,
    filename: orderSheetDetailPdfFilename,
  });

  if (poQuery.isLoading) {
    return <LoadingState label="Loading Order Sheet" />;
  }
  if (!po) {
    return <EmptyState title="Order Sheet not found" description="The selected Order Sheet could not be loaded." tone="error" />;
  }

  const planningState = getOrderSheetPlanningState(po);
  // An Order Sheet is editable/cancellable only while unlocked (no Job Order
  // mapping) and not cancelled — the lock is permanent and has no ADMIN
  // override, regardless of the linked Job Order's own later status.
  const isUnlocked = planningState === 'AVAILABLE';
  const canCreateJobOrder = canCreateJobOrders(user) && isUnlocked;
  // UXAUTH-010: Edit/Cancel must reflect BOTH the actor's mutation capability
  // (reusing the exact same shared role list the API's purchase-orders.routes.ts
  // canManagePOs guard already enforces for PATCH /:id and POST
  // /:id/actions/cancel) and the existing document-state lock — neither check
  // alone is sufficient, and this fix must not weaken the pre-existing
  // isUnlocked lock behavior for roles that already could manage this record.
  const canMutateOrderSheet = canManagePurchaseOrders(user) && isUnlocked;

  return (
    <div className="space-y-6">
      <PageHeader
        title={po.poNumber}
        subtitle={po.distributor.name}
        status={
          <StatusBadge label={PLANNING_STATE_LABELS[planningState]} tone={planningStateTone(planningState)} />
        }
        secondaryActions={
          <>
          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
          {canMutateOrderSheet && (
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
          {canCreateJobOrder && (
            <Button asChild>
              <Link to={`/job-orders/new?purchaseOrderId=${po.id}`}>Create Job Order</Link>
            </Button>
          )}
          {canMutateOrderSheet && (
            <Button
              variant="destructive"
              onClick={() => setCancelDialogOpen(true)}
              loading={cancelMutation.isPending}
            >
              Cancel Order Sheet
            </Button>
          )}
          </div>
        }
      />

      {cancelMutation.isError && (
        <p className="text-sm text-[var(--erp-form-field-error-text-color)]">
          {getApiErrorMessage(cancelMutation.error, 'Unable to cancel this Order Sheet. Please try again.')}
        </p>
      )}

      <Panel title="Order Sheet Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Order Sheet Date" value={formatDate(po.poDate)} />
          <DescriptionList.Item label="Required Delivery" value={po.requiredDeliveryDate ? formatDate(po.requiredDeliveryDate) : null} />
          <DescriptionList.Item label="Purchase Mode" value={po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale or Return'} />
          <DescriptionList.Item label="Total Qty" value={po.totalOrderedQuantity.toLocaleString()} />
          <DescriptionList.Item label="Merchandiser" value={po.merchandiser?.name} />
          <DescriptionList.Item label="Created By" value={po.creator.name} />
          <DescriptionList.Item label="Created" value={formatDate(po.createdAt)} />
          {po.lockedByJobOrder && (
            <DescriptionList.Item
              label="Job Order"
              value={`${po.lockedByJobOrder.jobOrderNumber} (${po.lockedByJobOrder.status})`}
            />
          )}
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
                { key: 'orderedQuantity', header: 'Forecast Qty', accessor: 'orderedQuantity', align: 'right' },
              ]}
              data={line.sizes}
              rowKey="id"
              containerClassName="rounded-none border-0 shadow-none"
            />
          </Panel>
        ))}
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail items={[]} emptyState="Audit log panel will be available in a future update." />
      </Panel>

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel Order Sheet?"
        description="This will cancel the Order Sheet using the existing cancel action."
        confirmLabel="Cancel Order Sheet"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate(undefined, { onSuccess: () => setCancelDialogOpen(false) })}
      />
    </div>
  );
}
