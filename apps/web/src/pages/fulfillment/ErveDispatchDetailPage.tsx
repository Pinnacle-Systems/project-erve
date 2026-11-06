import { canEditErveDispatchTransport, canConfirmErveDispatchDelivery, canManageErveDispatchAssignment, hasExclusiveTransporterRole } from '@erve/shared';
import { AssignedTransportWorkspace } from './dispatch-workspace/AssignedTransportWorkspace.js';
import { TransportFields } from './dispatch-workspace/TransportFields.js';
import { TransporterAssignmentPanel } from './dispatch-workspace/TransporterAssignmentPanel.js';
import { CartonDeliveryPanel } from './dispatch-workspace/CartonDeliveryPanel.js';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { createEnterToNextHandler, PageHeader, StatusBadge } from '@erve/app-components';
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { LoadingState, EmptyState, ErrorState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { canViewSaleOrReturnPositions } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isAxiosError } from 'axios';
import { DispatchOverviewTab } from './dispatch-workspace/DispatchOverviewTab.js';
import { DispatchReceiptTab } from './dispatch-workspace/DispatchReceiptTab.js';
import { DispatchReconciliationTab } from './dispatch-workspace/DispatchReconciliationTab.js';
import { canViewReconciliation } from '@erve/shared';
import { groupReceiptLinesByStyle, type ReceiptTraceableLine } from './style-size-grouping.js';
import type { ErveDispatchView } from './types.js';

export function ErveDispatchDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  if (user?.roles.includes('TRANSPORTER')) return hasExclusiveTransporterRole(user)
    ? <AssignedTransportWorkspace key={id} id={id!} />
    : <ErrorState title="Transport access unavailable" />;
  return <ErveDispatchDetailContent key={id} id={id!} />;
}

function ErveDispatchDetailContent({ id }: { id: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const activeTab =
    tab === 'transport-delivery' || tab === 'distributor-receipt' || tab === 'reconciliation' ? tab : 'overview';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canUpdateLr = Boolean(user && canEditErveDispatchTransport(user));
  const canConfirmDelivery = Boolean(user && canConfirmErveDispatchDelivery(user));

  const [transporter, setTransporter] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState<string | null>(null);
  const [lrNumber, setLrNumber] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [transportSaved, setTransportSaved] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);

  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});
  const [deliveryRemarks, setDeliveryRemarks] = useState('');
  const [deliveryFormError, setDeliveryFormError] = useState('');

  const query = useQuery({
    queryKey: ['erve-dispatch', id],
    retry: false,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ErveDispatchView>>(
        `/erve-dispatches/${id}`,
      );
      return res.data.data;
    },
  });
  const dispatch = query.data;
  const deliveryInputLines: ReceiptTraceableLine[] =
    dispatch?.quantityLines ?? dispatch?.invoiceHandoffs ?? [];

  const updateLrMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiSuccessResponse<ErveDispatchView>>(
        `/erve-dispatches/${id}/lr`,
        {
          expectedVersion: dispatch!.version,
          transporter: transporter ?? dispatch!.transporter,
          vehicleNumber: vehicleNumber ?? dispatch!.vehicleNumber,
          lrNumber: lrNumber ?? dispatch!.lrNumber,
        },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setTransporter(null);
      setVehicleNumber(null);
      setLrNumber(null);
      setTransportSaved(true);
      return queryClient.invalidateQueries({ queryKey: ['erve-dispatch', id] });
    },
    onError: (caught) => {
      setFormError(getApiErrorMessage(caught, 'Unable to update transport information.'));
      if (isAxiosError(caught) && caught.response?.status === 409) setNeedsRefresh(true);
    },
  });

  const confirmDeliveryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiSuccessResponse<ErveDispatchView>>(
        `/erve-dispatches/${id}/delivery`,
        {
          expectedVersion: dispatch!.version,
          lines: deliveryInputLines.map((h) => ({
            saleOrderLineId: h.saleOrderLineId,
            receivedQuantity: Number(receivedQuantities[h.saleOrderLineId] ?? h.quantity),
          })),
          remarks: deliveryRemarks || undefined,
        },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setDeliveryFormError('');
      void queryClient.invalidateQueries({ queryKey: ['erve-dispatch', id] });
    },
    onError: (caught) => {
      setDeliveryFormError(getApiErrorMessage(caught, 'Unable to confirm delivery.'));
      if (isAxiosError(caught) && caught.response?.status === 409) setNeedsRefresh(true);
    },
  });

  const generateErveDispatchDetailPdf = useCallback(async () => {
    if (!dispatch) throw new Error('Dispatch not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateErveDispatchDetailPdfBlob } =
      await import('./pdf/erve-dispatch/generateErveDispatchDetailPdf.js');
    return generateErveDispatchDetailPdfBlob(dispatch, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [dispatch, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateErveDispatchDetailPdf,
    filename: () => buildPdfFilename(['ERVE-Dispatch', dispatch?.erveDispatchNumber]),
  });

  if (query.isLoading) return <LoadingState label="Loading dispatch" />;
  if (query.isError && isAxiosError(query.error) && query.error.response?.status === 404)
    return <EmptyState title="Dispatch not found" tone="error" />;
  if (query.isError)
    return <ErrorState title="Unable to load dispatch" description={query.error.message} />;
  if (!dispatch) return <EmptyState title="Dispatch not found" tone="error" />;

  return (
    <div className="space-y-6">
      <PageHeader
        wrapActions
        title={dispatch.erveDispatchNumber}
        subtitle={`${dispatch.distributor.name} | ${new Date(dispatch.dispatchDate).toLocaleDateString()}`}
        status={
          dispatch.status === 'DELIVERED' ? (
            <StatusBadge label="Delivered" tone="posted" />
          ) : (
            <StatusBadge label="Dispatched" tone="approved" />
          )
        }
        secondaryActions={
          <>
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button variant="secondary" onClick={() => navigate('/fulfillment/erve-dispatches')}>
              Back
            </Button>
          </>
        }
      />

      {dispatch.canSubmitDistributorReceipt && activeTab !== 'distributor-receipt' && (
        <Panel title="Confirm Receipt">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Confirm the quantities you actually received for this dispatch.</p>
            <Button
              onClick={() =>
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.set('tab', 'distributor-receipt');
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              Go to Distributor Receipt
            </Button>
          </div>
        </Panel>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setSearchParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set('tab', value);
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList aria-label="Dispatch workspace">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transport-delivery">Transport &amp; Delivery</TabsTrigger>
          <TabsTrigger value="distributor-receipt">Distributor Receipt</TabsTrigger>
          {user && canViewReconciliation(user) && <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <DispatchOverviewTab dispatch={dispatch} />
        </TabsContent>
        <TabsContent value="transport-delivery" className="space-y-4 pt-4">
          {activeTab === 'transport-delivery' && <CartonDeliveryPanel key={id} dispatchId={id} />}
          <Panel title="Transport & Delivery">
            <DescriptionList columns={3}>
              <DescriptionList.Item label="Transporter" value={dispatch.transporter} />
              <DescriptionList.Item label="Vehicle Number" value={dispatch.vehicleNumber} />
              <DescriptionList.Item label="LR Number" value={dispatch.lrNumber} />
              {dispatch.lrUpdatedAt && (
                <DescriptionList.Item
                  label="LR Last Updated"
                  value={`${dispatch.lrUpdatedBy?.name ?? ''} | ${new Date(dispatch.lrUpdatedAt).toLocaleString()}`}
                />
              )}
              <DescriptionList.Item
                label="Delivery"
                value={
                  dispatch.status !== 'DELIVERED'
                    ? dispatch.distributorReceipt
                      ? 'Distributor reports nothing received (final)'
                      : 'Not yet confirmed'
                    : dispatch.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT'
                      ? 'Assumed full receipt (legacy - not actually confirmed)'
                      : `${dispatch.deliveryConfirmationSource === 'DISTRIBUTOR_CONFIRMED' ? 'Confirmed by Distributor | ' : ''}${dispatch.deliveredBy?.name ?? ''} | ${dispatch.deliveredAt ? new Date(dispatch.deliveredAt).toLocaleString() : 'Confirmation metadata not available'}`
                }
              />
              {dispatch.deliveryRemarks && (
                <DescriptionList.Item
                  label="Delivery Remarks"
                  value={dispatch.deliveryRemarks}
                  span={3}
                />
              )}
            </DescriptionList>
          </Panel>
          {transportSaved && <p role="status">Transport information saved.</p>}
          {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
          {needsRefresh && (
            <div className="space-y-2" role="alert">
              <p className="text-sm">
                This dispatch has changed. Refresh and review the latest details before retrying.
                Your entries will be kept.
              </p>
              <Button
                variant="secondary"
                disabled={query.isFetching}
                onClick={async () => {
                  const refreshed = await query.refetch();
                  if (!refreshed.isError) {
                    setNeedsRefresh(false);
                    setFormError('');
                    setDeliveryFormError('');
                  }
                }}
              >
                Refresh Dispatch
              </Button>
            </div>
          )}
          {canConfirmDelivery && dispatch.status !== 'DELIVERED' && !dispatch.distributorReceipt && (
            <Panel title="Confirm Delivery">
              {deliveryFormError && (
                <ValidationMessage tone="error">{deliveryFormError}</ValidationMessage>
              )}
              <p className="mb-3 text-sm text-[var(--erp-muted-fg)]">
                Confirm how much of this Dispatch was actually received by the Distributor — the
                Admin / Merchandiser fallback action when delivery was not otherwise recorded.
                Defaults to the full dispatched quantity; reduce a line to record a shortage
                (remarks become required).
              </p>
              <div className="space-y-4">
                {groupReceiptLinesByStyle(deliveryInputLines).map((group) => {
                  const receivedSubtotal = group.lines.reduce(
                    (sum, line) =>
                      sum + Number(receivedQuantities[line.saleOrderLineId] ?? line.quantity),
                    0,
                  );
                  return (
                    <div
                      key={group.styleNumber}
                      className="rounded border border-[var(--erp-border)] p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {group.styleNumber} — {group.styleName}
                        </span>
                        <span className="text-sm text-[var(--erp-muted-fg)]">
                          Dispatched {group.dispatchedSubtotal.toLocaleString()} · Received{' '}
                          {receivedSubtotal.toLocaleString()}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {group.lines.map((h) => (
                          <div
                            key={h.saleOrderLineId}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <span className="w-20 text-sm">{h.sizeLabel}</span>
                            <span className="w-36 text-sm text-[var(--erp-muted-fg)]">
                              dispatched {h.quantity.toLocaleString()}
                            </span>
                            <input
                              type="number"
                              aria-label={`${h.styleNumber} ${h.sizeLabel} received quantity (${h.saleOrderLineId})`}
                              min={0}
                              max={h.quantity}
                              className="w-24 rounded border border-[var(--erp-border)] px-2 py-1 text-sm"
                              value={receivedQuantities[h.saleOrderLineId] ?? String(h.quantity)}
                              onChange={(e) =>
                                setReceivedQuantities((current) => ({
                                  ...current,
                                  [h.saleOrderLineId]: e.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <TextField
                  label="Delivery Remarks (required if any line is short)"
                  value={deliveryRemarks}
                  onChange={(e) => setDeliveryRemarks(e.target.value)}
                />
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  onClick={() => {
                    if (!confirmDeliveryMutation.isPending && !needsRefresh)
                      confirmDeliveryMutation.mutate();
                  }}
                  disabled={confirmDeliveryMutation.isPending || needsRefresh}
                  loading={confirmDeliveryMutation.isPending}
                >
                  Confirm Delivery
                </Button>
              </div>
            </Panel>
          )}

          {canUpdateLr && (
            <Panel title="Update Transport / LR Information">
              <div onKeyDown={createEnterToNextHandler()}>
                <TransportFields
                  value={{ transporter: transporter ?? dispatch.transporter ?? '', vehicleNumber: vehicleNumber ?? dispatch.vehicleNumber ?? '', lrNumber: lrNumber ?? dispatch.lrNumber ?? '' }}
                  onChange={(field, value) => {
                    setTransportSaved(false);
                    if (field === 'transporter') setTransporter(value);
                    if (field === 'vehicleNumber') setVehicleNumber(value);
                    if (field === 'lrNumber') setLrNumber(value);
                  }}
                  disabled={updateLrMutation.isPending}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={() => {
                      if (!updateLrMutation.isPending && !needsRefresh) updateLrMutation.mutate();
                    }}
                    disabled={updateLrMutation.isPending || needsRefresh}
                    loading={updateLrMutation.isPending}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </Panel>
          )}
          {user && canManageErveDispatchAssignment(user) && <TransporterAssignmentPanel id={id} version={dispatch.version} disabled={needsRefresh || updateLrMutation.isPending || confirmDeliveryMutation.isPending} onConflict={() => setNeedsRefresh(true)} />}
        </TabsContent>
        <TabsContent value="distributor-receipt" className="pt-4">
          <DispatchReceiptTab dispatch={dispatch} />
        </TabsContent>
        {user && canViewReconciliation(user) && <TabsContent value="reconciliation" className="pt-4">
          {activeTab === 'reconciliation' && <DispatchReconciliationTab dispatchId={id} />}
        </TabsContent>}
      </Tabs>
      {canViewSaleOrReturnPositions(user) && (
        <div className="text-sm">
          <Link
            className="underline"
            to={`/fulfillment/sale-or-return?distributorId=${encodeURIComponent(dispatch.distributor.id)}`}
          >
            View Sale-or-Return Stock
          </Link>
        </div>
      )}
    </div>
  );
}
