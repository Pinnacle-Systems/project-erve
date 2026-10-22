import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler, PageHeader, StatusBadge } from '@erve/app-components';
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
import { distinctSizeColumns, groupLinesByStyle, withBusinessKeyIdentity } from './style-size-grouping.js';
import type {
  EligibleErveCartonView,
  ErvePackingListCartonView,
  ErvePackingListDetail,
  ErvePackingListStyleSizeSummaryRow,
} from './types.js';

// ISS-023 Phase 3: this carton's own contents as one Style row per Style, with Sizes as columns,
// instead of one flat "Style/Size: qty" string — mirrors the already-standardized Factory Packing
// List / Packing Audit carton contents (ISS-023 Phase 1/2).
function cartonStyleSizeRows(carton: ErvePackingListCartonView): StyleSizeGridRow[] {
  return groupLinesByStyle(carton.lines.map(withBusinessKeyIdentity)).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

function styleSizeSummaryRows(rows: ErvePackingListStyleSizeSummaryRow[]): StyleSizeGridRow[] {
  return groupLinesByStyle(rows.map(withBusinessKeyIdentity)).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
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
  if (carton.factoryDispatchNumber) segments.push(`Factory Packing List ${carton.factoryDispatchNumber}`);
  return segments.join(' — ');
}

const STATUS_LABEL: Record<ErvePackingListDetail['status'], string> = {
  OPEN: 'Open',
  FINALIZED: 'Finalized',
  DISPATCHED: 'Dispatched',
};

export function ErvePackingListDetailPage() {
  const { id } = useParams();
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
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['erve-packing-list', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ErvePackingListDetail>>(`/erve-packing-lists/${id}`);
      return res.data.data;
    },
  });
  const packingList = query.data;
  const isOpen = packingList?.status === 'OPEN';

  const eligibleQuery = useQuery({
    enabled: isOpen && canMutate,
    queryKey: ['erve-packing-lists', 'eligible-cartons', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<EligibleErveCartonView[]>>('/erve-packing-lists/eligible-cartons', {
        params: { ervePackingListId: id },
      });
      return res.data.data;
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['erve-packing-list', id] });
    void queryClient.invalidateQueries({ queryKey: ['erve-packing-lists', 'eligible-cartons', id] });
  }

  const addCartonsMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/erve-packing-lists/${id}/cartons`, { cartonIds: [...addSelected] });
    },
    onSuccess: () => {
      setAddSelected(new Set());
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to add the selected cartons.')),
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
      setFormError('');
      setFinalizeDialogOpen(false);
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to finalize this Erve Packing List.')),
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
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to record this dispatch.')),
  });

  const eligibleForAdd = useMemo(() => eligibleQuery.data ?? [], [eligibleQuery.data]);
  const totalAddQuantity = useMemo(
    () => eligibleForAdd.filter((c) => addSelected.has(c.id)).reduce((sum, c) => sum + c.totalQuantity, 0),
    [eligibleForAdd, addSelected],
  );

  const generateErvePackingListDetailPdf = useCallback(async () => {
    if (!packingList) throw new Error('Erve Packing List not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateErvePackingListDetailPdfBlob } = await import('./pdf/erve-packing-list/generateErvePackingListDetailPdf.js');
    return generateErvePackingListDetailPdfBlob(packingList, { generatedAt: new Date().toISOString(), generatedBy: user?.name });
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
        subtitle={`${packingList.distributor?.name ?? '—'} · ${packingList.destination.city ?? '—'}, ${packingList.destination.state ?? ''}`}
        status={
          <StatusBadge
            label={STATUS_LABEL[packingList.status]}
            tone={packingList.status === 'DISPATCHED' ? 'approved' : packingList.status === 'FINALIZED' ? 'pending' : 'draft'}
          />
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
        primaryAction={
          isOpen && canMutate ? (
            <Button
              onClick={() => { setFormError(''); setFinalizeDialogOpen(true); }}
              disabled={packingList.cartonCount === 0 || addCartonsMutation.isPending || removeCartonMutation.isPending}
              loading={finalizeMutation.isPending}
            >
              Finalize Packing List
            </Button>
          ) : undefined
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>

      <div className="space-y-6">
        <Panel title="Erve India Consolidated Packing List">
          <DescriptionList columns={4}>
            <DescriptionList.Item label="Distributor" value={packingList.distributor?.name ?? '—'} />
            {packingList.destination.storeCode && <DescriptionList.Item label="Store Code" value={packingList.destination.storeCode} />}
            {packingList.destination.gstin && <DescriptionList.Item label="Destination GSTIN" value={packingList.destination.gstin} />}
            <DescriptionList.Item
              label="Destination"
              value={[packingList.destination.addressLine1, packingList.destination.addressLine2, packingList.destination.city, packingList.destination.state, packingList.destination.postalCode]
                .filter(Boolean)
                .join(', ')}
            />
            <DescriptionList.Item label="Created By" value={packingList.createdBy.name} />
            <DescriptionList.Item label="Created At" value={new Date(packingList.createdAt).toLocaleString()} />
            <DescriptionList.Item label="Cartons" value={packingList.cartonCount.toLocaleString()} />
            <DescriptionList.Item label="Total Quantity" value={packingList.totalQuantity.toLocaleString()} />
            {packingList.sourceFactories && (
              <DescriptionList.Item label="Source Factories" value={packingList.sourceFactories.map((f) => f.name).join(', ') || '—'} />
            )}
            <DescriptionList.Item label="Source Dispatch Orders" value={packingList.sourceDispatchOrders.map((s) => s.saleOrderNumber).join(', ') || '—'} />
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
                  {carton.packageDetails && <div className="text-sm text-muted-foreground">{carton.packageDetails}</div>}
                  <div className="mt-1 text-sm text-muted-foreground">Total Qty: {carton.totalQuantity.toLocaleString()}</div>
                  <div className="mt-2">
                    <StyleSizeGrid
                      columns={distinctSizeColumns(carton.lines.map(withBusinessKeyIdentity))}
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
              columns={distinctSizeColumns(packingList.styleSizeSummary.map(withBusinessKeyIdentity))}
              rows={styleSizeSummaryRows(packingList.styleSizeSummary)}
              variant="readOnly"
            />
          </Panel>
        )}
      </div>

      {isOpen && canMutate && (
        <Panel title="Add Cartons">
          {eligibleQuery.isLoading ? (
            <LoadingState label="Loading eligible cartons" />
          ) : eligibleForAdd.length === 0 ? (
            <EmptyState title="Nothing eligible" description="No further cartons for this destination and Distributor are available." />
          ) : (
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
                        onChange={() =>
                          setAddSelected((current) => {
                            const next = new Set(current);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })
                        }
                        aria-label={`Select carton ${r.cartonNumber}`}
                      />
                    ),
                  },
                  { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
                  { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
                  { key: 'dispatchOrder', header: 'Dispatch Order', render: (r) => r.saleOrder.saleOrderNumber },
                  { key: 'qty', header: 'Pieces', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
                ]}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Selected: {addSelected.size} cartons · {totalAddQuantity.toLocaleString()} pieces</div>
                <Button onClick={() => addCartonsMutation.mutate()} disabled={addSelected.size === 0} loading={addCartonsMutation.isPending}>
                  Add Selected Cartons
                </Button>
              </div>
            </>
          )}
        </Panel>
      )}

      {packingList.status === 'FINALIZED' && canMutate && (
        <Panel title="Record Erve Dispatch">
          <div onKeyDown={createEnterToNextHandler()}>
            <div className="flex flex-wrap gap-3">
              <DatePicker label="Dispatch Date" value={dispatchDate} onValueChange={(value) => setDispatchDate(value ?? '')} width="sm" />
              <TextField label="Transporter (optional)" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
              <TextField label="Vehicle Number (optional)" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
              <TextField label="LR Number (optional)" value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} />
              <TextField label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => dispatchMutation.mutate()} disabled={!dispatchDate} loading={dispatchMutation.isPending}>
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

      <ConfirmDialog
        open={finalizeDialogOpen}
        onOpenChange={(open) => { if (!finalizeMutation.isPending) setFinalizeDialogOpen(open); }}
        title="Finalize Erve Packing List?"
        description={`Finalize ${packingList.ervePackingListNumber} with ${packingList.cartonCount.toLocaleString()} ${packingList.cartonCount === 1 ? 'carton' : 'cartons'} and ${packingList.totalQuantity.toLocaleString()} pieces? Once finalized, its carton membership can no longer be edited.`}
        confirmLabel="Finalize Packing List"
        cancelLabel="Keep Editing"
        loading={finalizeMutation.isPending}
        error={finalizeMutation.isError ? formError : undefined}
        onConfirm={() => finalizeMutation.mutate()}
      />
    </div>
  );
}
