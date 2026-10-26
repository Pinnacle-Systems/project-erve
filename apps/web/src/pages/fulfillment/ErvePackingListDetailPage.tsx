import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import {
  ConfirmDialog,
  createEnterToNextHandler,
  PageHeader,
  StatusBadge,
} from '@erve/app-components';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, LoadingState, EmptyState, ErrorState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canMutateErveDispatches } from '../../auth/permissions.js';
import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import type { StyleSizeGridRow } from '../../components/style-size-grid/types.js';
import { distinctSizeColumns, groupLinesByStyle, withSizeIdentity } from './style-size-grouping.js';
import { useEligibleErveCartons } from './use-eligible-erve-cartons.js';
import {
  EligibleCartonSearch,
  EligibleCartonContinuation,
} from './EligibleCartonDiscoveryControls.js';
import type {
  EligibleErveCartonView,
  ErvePackingListCartonView,
  ErvePackingListDetail,
  ErvePackingListStyleSizeSummaryRow,
} from './types.js';

// ISS-023 Phase 3 / ISS-053: this carton's own contents as one Style row per Style, with Sizes as
// columns and each Style's own authorized thumbnail — mirrors the already-standardized Factory
// Packing List / Packing Audit carton contents (ISS-023 Phase 1/2, ISS-035's primaryImageByStyle
// pattern in PackingListPage.tsx). `styleId` is already the real Style UUID (ISS-053) — never
// substitute styleNumber, which would break StyleThumbnailCell's authenticated image fetch.
function cartonStyleSizeRows(carton: ErvePackingListCartonView): StyleSizeGridRow[] {
  const primaryImageByStyle = new Map(
    carton.lines.map((line) => [line.styleId, line.primaryImage] as const),
  );
  return groupLinesByStyle(carton.lines.map(withSizeIdentity)).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: primaryImageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

function styleSizeSummaryRows(rows: ErvePackingListStyleSizeSummaryRow[]): StyleSizeGridRow[] {
  const primaryImageByStyle = new Map(rows.map((row) => [row.styleId, row.primaryImage] as const));
  return groupLinesByStyle(rows.map(withSizeIdentity)).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: primaryImageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

// DEMO-020: carton.factory/factoryDispatchNumber are confidential factory/supplier provenance and
// are omitted (not nulled) from the source record for a role outside ERVE_PACKING_LIST_PROVENANCE_
// ROLES — this heading mirrors the PDF's own cartonHeading (ErvePackingListDetailDocument.tsx):
// each segment (and its separator) is only printed when the field is actually present, so a
// redacted carton never shows "Factory Packing List" at all, let alone "undefined"/"null".
function cartonHeading(carton: ErvePackingListCartonView): string {
  const parts = [`Carton ${carton.cartonNumber}`];
  if (carton.factory) parts.push(carton.factory.name);
  parts.push(carton.saleOrder.saleOrderNumber);
  const segments = [parts.join(' — ')];
  if (carton.factoryDispatchNumber)
    segments.push(`Factory Packing List ${carton.factoryDispatchNumber}`);
  return segments.join(' — ');
}

const STATUS_LABEL: Record<ErvePackingListDetail['status'], string> = {
  OPEN: 'Open',
  FINALIZED: 'Finalized',
  DISPATCHED: 'Dispatched',
};

export function ErvePackingListDetailPage() {
  const { id } = useParams();
  return <ErvePackingListDetailContent key={id} id={id!} />;
}

function ErvePackingListDetailContent({ id }: { id: string }) {
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // UXAUTH-007: SENIOR_MANAGEMENT (and any other ERVE_PACKING_LIST_VIEW_ROLES
  // member outside ERVE_DISPATCH_MUTATION_ROLES) may read this detail but not
  // mutate it — reuses the same shared capability the API's
  // erve-dispatch.routes.ts already enforces for every mutation endpoint
  // below (add/remove carton, finalize, record dispatch), so this page can
  // never drift from the backend's real authorization.
  const canMutate = canMutateErveDispatches(user);

  const [dispatchDate, setDispatchDate] = useState(() => getLocalDateString());
  const [transporter, setTransporter] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [addSelected, setAddSelected] = useState<Map<string, EligibleErveCartonView>>(new Map());

  const query = useQuery({
    queryKey: ['erve-packing-list', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ErvePackingListDetail>>(
        `/erve-packing-lists/${id}`,
      );
      return res.data.data;
    },
  });
  const packingList = query.data;
  const isOpen = packingList?.status === 'OPEN';

  const discovery = useEligibleErveCartons(id, isOpen && canMutate);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['erve-packing-list', id] });
    void queryClient.resetQueries({ queryKey: ['erve-packing-lists', 'eligible-cartons'] });
  }

  const addCartonsMutation = useMutation({
    mutationFn: async ({
      packingListId,
      cartonIds,
    }: {
      packingListId: string;
      cartonIds: string[];
    }) => {
      await apiClient.post(`/erve-packing-lists/${packingListId}/cartons`, { cartonIds });
    },
    onSuccess: () => {
      setAddSelected(new Map());
      invalidate();
    },
    onError: (caught) =>
      setFormError(getApiErrorMessage(caught, 'Unable to add the selected cartons.')),
  });

  const removeCartonMutation = useMutation({
    mutationFn: async (cartonId: string) => {
      await apiClient.delete(`/erve-packing-lists/${id}/cartons/${cartonId}`);
    },
    onSuccess: () => invalidate(),
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to remove this carton.')),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/erve-packing-lists/${id}/finalize`);
    },
    onSuccess: () => {
      setFinalizeOpen(false);
      invalidate();
    },
    onError: (caught) =>
      setFormError(getApiErrorMessage(caught, 'Unable to finalize this Erve Packing List.')),
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<{ id: string }>>('/erve-dispatches', {
        ervePackingListId: id,
        dispatchDate,
        transporter: transporter || null,
        vehicleNumber: vehicleNumber || null,
        lrNumber: lrNumber || null,
        remarks: remarks || null,
      });
      return res.data.data;
    },
    onSuccess: (created) => {
      invalidate();
      navigate(`/fulfillment/erve-dispatches/${created.id}`);
    },
    onError: (caught) =>
      setFormError(getApiErrorMessage(caught, 'Unable to record this dispatch.')),
  });

  const eligibleForAdd = discovery.cartons;
  const totalAddQuantity = useMemo(
    () => [...addSelected.values()].reduce((sum, c) => sum + c.totalQuantity, 0),
    [addSelected],
  );

  const generateErvePackingListDetailPdf = useCallback(async () => {
    if (!packingList) throw new Error('Erve Packing List not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateErvePackingListDetailPdfBlob } =
      await import('./pdf/erve-packing-list/generateErvePackingListDetailPdf.js');
    return generateErvePackingListDetailPdfBlob(packingList, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [packingList, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateErvePackingListDetailPdf,
    filename: () => buildPdfFilename(['ERVE-Packing-List', packingList?.ervePackingListNumber]),
  });

  if (query.isLoading) return <LoadingState label="Loading Erve Packing List" />;
  if (query.isError)
    return (
      <ErrorState title="Unable to load Erve Packing List" description={query.error.message} />
    );
  if (!packingList) return <EmptyState title="Erve Packing List not found" tone="error" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={packingList.ervePackingListNumber}
        subtitle={[
          packingList.distributor?.name,
          packingList.destination.label ||
            [packingList.destination.city, packingList.destination.state]
              .filter(Boolean)
              .join(', '),
        ]
          .filter(Boolean)
          .join(' · ')}
        status={
          <StatusBadge
            label={STATUS_LABEL[packingList.status]}
            tone={
              packingList.status === 'DISPATCHED'
                ? 'approved'
                : packingList.status === 'FINALIZED'
                  ? 'pending'
                  : 'draft'
            }
          />
        }
        primaryAction={
          isOpen && canMutate ? (
            <Button
              onClick={() => {
                setFormError('');
                setFinalizeOpen(true);
              }}
              disabled={
                packingList.cartonCount === 0 ||
                addCartonsMutation.isPending ||
                removeCartonMutation.isPending
              }
              loading={finalizeMutation.isPending}
            >
              Finalize Packing List
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button variant="secondary" onClick={() => navigate('/fulfillment/erve-packing-lists')}>
              Back
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={finalizeOpen && isOpen && canMutate}
        onOpenChange={setFinalizeOpen}
        title="Finalize Erve Packing List?"
        description={`Finalize ${packingList.ervePackingListNumber} with ${packingList.cartonCount.toLocaleString()} ${packingList.cartonCount === 1 ? 'carton' : 'cartons'} and ${packingList.totalQuantity.toLocaleString()} pieces. Cartons can no longer be added or removed after finalization.`}
        confirmLabel="Finalize Packing List"
        cancelLabel="Keep Editing"
        loading={finalizeMutation.isPending}
        error={formError || undefined}
        onConfirm={() => {
          if (
            !finalizeMutation.isPending &&
            !addCartonsMutation.isPending &&
            !removeCartonMutation.isPending &&
            packingList.cartonCount > 0
          )
            finalizeMutation.mutate();
        }}
      />
      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <div className="space-y-6">
        <Panel title="Erve India Consolidated Packing List">
          <DescriptionList columns={4}>
            <DescriptionList.Item
              label="Distributor"
              value={packingList.distributor?.name ?? '—'}
            />
            {packingList.destination.storeCode && (
              <DescriptionList.Item label="Store Code" value={packingList.destination.storeCode} />
            )}
            {packingList.destination.gstin && (
              <DescriptionList.Item
                label="Destination GSTIN"
                value={packingList.destination.gstin}
              />
            )}
            <DescriptionList.Item
              label="Destination"
              value={[
                packingList.destination.addressLine1,
                packingList.destination.addressLine2,
                packingList.destination.city,
                packingList.destination.state,
                packingList.destination.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            />
            <DescriptionList.Item label="Created By" value={packingList.createdBy.name} />
            <DescriptionList.Item
              label="Created At"
              value={new Date(packingList.createdAt).toLocaleString()}
            />
            <DescriptionList.Item
              label="Cartons"
              value={packingList.cartonCount.toLocaleString()}
            />
            <DescriptionList.Item
              label="Total Quantity"
              value={packingList.totalQuantity.toLocaleString()}
            />
            {packingList.sourceFactories && (
              <DescriptionList.Item
                label="Source Factories"
                value={packingList.sourceFactories.map((f) => f.name).join(', ') || '—'}
              />
            )}
            <DescriptionList.Item
              label="Source Dispatch Orders"
              value={
                packingList.sourceDispatchOrders.map((s) => s.saleOrderNumber).join(', ') || '—'
              }
            />
          </DescriptionList>
        </Panel>

        <Panel title="Cartons">
          {packingList.cartons.length === 0 ? (
            <EmptyState title="No cartons selected yet" />
          ) : (
            <div className="space-y-3">
              {packingList.cartons.map((carton) => (
                <div key={carton.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{cartonHeading(carton)}</div>
                    {isOpen && canMutate && (
                      <Button
                        variant="ghost"
                        density="compact"
                        onClick={() => removeCartonMutation.mutate(carton.id)}
                        loading={removeCartonMutation.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {carton.packageDetails && (
                    <div className="text-sm text-muted-foreground">{carton.packageDetails}</div>
                  )}
                  <div className="mt-1 text-sm text-muted-foreground">
                    Total Qty: {carton.totalQuantity.toLocaleString()}
                  </div>
                  <div className="mt-2">
                    <StyleSizeGrid
                      columns={distinctSizeColumns(carton.lines.map(withSizeIdentity))}
                      rows={cartonStyleSizeRows(carton)}
                      variant="readOnly"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {packingList.styleSizeSummary.length > 0 && (
          <Panel title="Style / Size Summary">
            <StyleSizeGrid
              columns={distinctSizeColumns(packingList.styleSizeSummary.map(withSizeIdentity))}
              rows={styleSizeSummaryRows(packingList.styleSizeSummary)}
              variant="readOnly"
            />
          </Panel>
        )}
      </div>

      {isOpen && canMutate && (
        <Panel title="Add Cartons">
          <EligibleCartonSearch discovery={discovery} />
          {eligibleForAdd.length > 0 && (
            <>
              <DataTable
                rowKey="id"
                data={eligibleForAdd}
                columns={[
                  {
                    key: 'select',
                    header: '',
                    render: (r: EligibleErveCartonView) => (
                      <input
                        type="checkbox"
                        checked={addSelected.has(r.id)}
                        disabled={addCartonsMutation.isPending || finalizeMutation.isPending}
                        onChange={() =>
                          setAddSelected((current) => {
                            const next = new Map(current);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.set(r.id, r);
                            return next;
                          })
                        }
                        aria-label={`Select carton ${r.cartonNumber}`}
                      />
                    ),
                  },
                  { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
                  { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
                  {
                    key: 'dispatchOrder',
                    header: 'Dispatch Order',
                    render: (r) => r.saleOrder.saleOrderNumber,
                  },
                  {
                    key: 'qty',
                    header: 'Pieces',
                    align: 'right',
                    render: (r) => r.totalQuantity.toLocaleString(),
                  },
                ]}
              />
            </>
          )}
          <EligibleCartonContinuation discovery={discovery} />
          <ul aria-label="Selected cartons" className="mt-3 space-y-1">
            {[...addSelected.values()].map((carton) => (
              <li key={carton.id} className="flex items-center gap-3">
                <span>
                  {carton.cartonNumber} · {carton.totalQuantity.toLocaleString()} pieces
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  density="compact"
                  aria-label={`Remove selected carton ${carton.cartonNumber}`}
                  disabled={addCartonsMutation.isPending}
                  onClick={() =>
                    setAddSelected((current) => {
                      const next = new Map(current);
                      next.delete(carton.id);
                      return next;
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Selected: {addSelected.size} cartons · {totalAddQuantity.toLocaleString()} pieces
            </div>
            <Button
              type="button"
              onClick={() => {
                setFormError('');
                addCartonsMutation.mutate({
                  packingListId: id,
                  cartonIds: [...addSelected.keys()],
                });
              }}
              disabled={
                addSelected.size === 0 ||
                finalizeMutation.isPending ||
                removeCartonMutation.isPending
              }
              loading={addCartonsMutation.isPending}
            >
              Add Selected Cartons
            </Button>
          </div>
        </Panel>
      )}

      {packingList.status === 'FINALIZED' && canMutate && (
        <Panel title="Record Erve Dispatch">
          <div onKeyDown={createEnterToNextHandler()}>
            <div className="flex flex-wrap gap-3">
              <DatePicker
                label="Dispatch Date"
                value={dispatchDate}
                onValueChange={(value) => setDispatchDate(value ?? '')}
                width="sm"
              />
              <TextField
                label="Transporter (optional)"
                value={transporter}
                onChange={(e) => setTransporter(e.target.value)}
              />
              <TextField
                label="Vehicle Number (optional)"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
              />
              <TextField
                label="LR Number (optional)"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
              />
              <TextField
                label="Remarks (optional)"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => dispatchMutation.mutate()}
                disabled={!dispatchDate}
                loading={dispatchMutation.isPending}
              >
                Record Dispatch
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {packingList.status === 'DISPATCHED' && packingList.dispatch && (
        <ValidationMessage tone="success">
          This packing list has been dispatched as{' '}
          <a className="underline" href={`/fulfillment/erve-dispatches/${packingList.dispatch.id}`}>
            {packingList.dispatch.erveDispatchNumber}
          </a>
          .
        </ValidationMessage>
      )}
    </div>
  );
}
