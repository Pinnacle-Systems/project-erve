import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, LoadingState, EmptyState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canMutateErveDispatches, canViewInvoiceHandoffs } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { ErveDispatchView } from './types.js';

export function ErveDispatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canUpdateLr = canMutateErveDispatches(user);
  const canSeeInvoices = canViewInvoiceHandoffs(user);

  const [transporter, setTransporter] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState<string | null>(null);
  const [lrNumber, setLrNumber] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});
  const [deliveryRemarks, setDeliveryRemarks] = useState('');
  const [deliveryFormError, setDeliveryFormError] = useState('');

  const query = useQuery({
    queryKey: ['erve-dispatch', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ErveDispatchView>>(`/erve-dispatches/${id}`);
      return res.data.data;
    },
  });
  const dispatch = query.data;

  const updateLrMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiSuccessResponse<ErveDispatchView>>(`/erve-dispatches/${id}/lr`, {
        expectedVersion: dispatch!.version,
        transporter: transporter ?? dispatch!.transporter,
        vehicleNumber: vehicleNumber ?? dispatch!.vehicleNumber,
        lrNumber: lrNumber ?? dispatch!.lrNumber,
      });
      return res.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['erve-dispatch', id] }),
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to update transport information.')),
  });

  const confirmDeliveryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiSuccessResponse<ErveDispatchView>>(`/erve-dispatches/${id}/delivery`, {
        expectedVersion: dispatch!.version,
        lines: dispatch!.invoiceHandoffs.map((h) => ({
          saleOrderLineId: h.saleOrderLineId,
          receivedQuantity: Number(receivedQuantities[h.saleOrderLineId] ?? h.quantity),
        })),
        remarks: deliveryRemarks || undefined,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setDeliveryFormError('');
      void queryClient.invalidateQueries({ queryKey: ['erve-dispatch', id] });
    },
    onError: (caught) => setDeliveryFormError(getApiErrorMessage(caught, 'Unable to confirm delivery.')),
  });

  if (query.isLoading) return <LoadingState label="Loading dispatch" />;
  if (!dispatch) return <EmptyState title="Dispatch not found" tone="error" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={dispatch.erveDispatchNumber}
        subtitle={`${dispatch.saleOrder.saleOrderNumber} · ${dispatch.distributor.name}`}
        status={
          dispatch.status === 'DELIVERED' ? (
            <StatusBadge label="Delivered" tone="posted" />
          ) : (
            <StatusBadge label="Dispatched" tone="approved" />
          )
        }
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate('/fulfillment/erve-dispatches')}>
            Back
          </Button>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <Panel title="Dispatch Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Erve Packing List" value={dispatch.ervePackingList.ervePackingListNumber} />
          <DescriptionList.Item label="Dispatch Date" value={new Date(dispatch.dispatchDate).toLocaleDateString()} />
          <DescriptionList.Item label="Total Quantity" value={dispatch.totalQuantity.toLocaleString()} />
          <DescriptionList.Item label="Dispatched By" value={dispatch.dispatchedBy.name} />
          <DescriptionList.Item label="Transporter" value={dispatch.transporter} />
          <DescriptionList.Item label="Vehicle Number" value={dispatch.vehicleNumber} />
          <DescriptionList.Item label="LR Number" value={dispatch.lrNumber} />
          <DescriptionList.Item label="Remarks" value={dispatch.remarks} span={2} />
          {dispatch.lrUpdatedAt && (
            <DescriptionList.Item
              label="LR Last Updated"
              value={`${dispatch.lrUpdatedBy?.name ?? ''} · ${new Date(dispatch.lrUpdatedAt).toLocaleString()}`}
            />
          )}
          <DescriptionList.Item
            label="Delivery"
            value={
              dispatch.status !== 'DELIVERED'
                ? 'Not yet confirmed'
                : dispatch.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT'
                  ? 'Assumed full receipt (legacy — not actually confirmed)'
                  : `${dispatch.deliveredBy?.name ?? ''} · ${dispatch.deliveredAt ? new Date(dispatch.deliveredAt).toLocaleString() : ''}`
            }
          />
          {dispatch.deliveryRemarks && <DescriptionList.Item label="Delivery Remarks" value={dispatch.deliveryRemarks} span={2} />}
        </DescriptionList>
      </Panel>

      {canSeeInvoices && (
        <Panel title="Invoice / Tally Status" padding="none">
          <DataTable
            rowKey="invoiceHandoffId"
            data={dispatch.invoiceHandoffs}
            onRowClick={(row) => navigate(`/fulfillment/invoices/${row.invoiceHandoffId}`)}
            emptyState={<EmptyState title="No invoice handoffs" />}
            columns={[
              { key: 'mode', header: 'Mode', render: (r) => (r.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return') },
              { key: 'style', header: 'Style / Size', render: (r) => `${r.styleNumber} / ${r.sizeLabel}` },
              { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.quantity.toLocaleString() },
              {
                key: 'status',
                header: 'Invoice Status',
                render: (r) =>
                  r.status === 'PENDING_TALLY' ? (
                    <StatusBadge label="Pending Tally" tone="pending" />
                  ) : (
                    <StatusBadge label="Invoiced" tone="posted" />
                  ),
              },
              { key: 'tallyInvoiceNumber', header: 'Tally Invoice #', render: (r) => r.tallyInvoiceNumber ?? '—' },
            ]}
          />
        </Panel>
      )}

      {dispatch.saleOrReturnLines.length > 0 && (
        <Panel title="Sale-or-Return Position" padding="none">
          <DataTable
            rowKey="saleOrderLineId"
            data={dispatch.saleOrReturnLines}
            emptyState={<EmptyState title="No Sale-or-Return lines" />}
            columns={[
              { key: 'style', header: 'Style / Size', render: (r) => `${r.styleNumber} / ${r.sizeLabel}` },
              { key: 'dispatched', header: 'Dispatched', align: 'right', render: (r) => r.dispatchedQuantity.toLocaleString() },
              { key: 'received', header: 'Received', align: 'right', render: (r) => r.receivedQuantity.toLocaleString() },
              { key: 'sold', header: 'Actual Sold', align: 'right', render: (r) => r.actualSoldQuantity.toLocaleString() },
              { key: 'returned', header: 'Returned', align: 'right', render: (r) => r.returnedQuantity.toLocaleString() },
              { key: 'approvedAwaiting', header: 'Approved (Awaiting Receipt)', align: 'right', render: (r) => r.approvedAwaitingReceiptQuantity.toLocaleString() },
              { key: 'pendingRequested', header: 'Pending Return Request', align: 'right', render: (r) => r.pendingRequestedQuantity.toLocaleString() },
              { key: 'remaining', header: 'Remaining with Distributor', align: 'right', render: (r) => r.remainingWithDistributor.toLocaleString() },
            ]}
          />
        </Panel>
      )}

      {canUpdateLr && dispatch.status !== 'DELIVERED' && (
        <Panel title="Confirm Delivery">
          {deliveryFormError && <ValidationMessage tone="error">{deliveryFormError}</ValidationMessage>}
          <p className="mb-3 text-sm text-[var(--erp-muted-fg)]">
            Confirm how much of this Dispatch was actually received by the Distributor — the fallback action for when the
            transporter did not use the delivery link. Defaults to the full dispatched quantity; reduce a line to record a
            shortage (remarks become required).
          </p>
          <div className="space-y-3">
            {dispatch.invoiceHandoffs.map((h) => (
              <div key={h.saleOrderLineId} className="flex items-center gap-3">
                <span className="w-56 text-sm">
                  {h.styleNumber} / {h.sizeLabel} (dispatched {h.quantity.toLocaleString()})
                </span>
                <input
                  type="number"
                  min={0}
                  max={h.quantity}
                  className="w-24 rounded border border-[var(--erp-border)] px-2 py-1 text-sm"
                  value={receivedQuantities[h.saleOrderLineId] ?? String(h.quantity)}
                  onChange={(e) =>
                    setReceivedQuantities((current) => ({ ...current, [h.saleOrderLineId]: e.target.value }))
                  }
                />
              </div>
            ))}
            <TextField label="Delivery Remarks (required if any line is short)" value={deliveryRemarks} onChange={(e) => setDeliveryRemarks(e.target.value)} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => confirmDeliveryMutation.mutate()} loading={confirmDeliveryMutation.isPending}>
              Confirm Delivery
            </Button>
          </div>
        </Panel>
      )}

      {canUpdateLr && (
        <Panel title="Update Transport / LR Information">
          <div className="flex flex-wrap gap-3">
            <TextField
              label="Transporter"
              value={transporter ?? dispatch.transporter ?? ''}
              onChange={(e) => setTransporter(e.target.value)}
            />
            <TextField
              label="Vehicle Number"
              value={vehicleNumber ?? dispatch.vehicleNumber ?? ''}
              onChange={(e) => setVehicleNumber(e.target.value)}
            />
            <TextField label="LR Number" value={lrNumber ?? dispatch.lrNumber ?? ''} onChange={(e) => setLrNumber(e.target.value)} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => updateLrMutation.mutate()} loading={updateLrMutation.isPending}>
              Save
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
