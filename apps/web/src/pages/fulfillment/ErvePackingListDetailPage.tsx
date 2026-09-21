import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, LoadingState, EmptyState, ErrorState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canMutateErveDispatches } from '../../auth/permissions.js';
import type { EligibleErveCartonView, ErvePackingListDetail } from './types.js';

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

  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [transporter, setTransporter] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
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
    onSuccess: () => invalidate(),
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
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <div className="space-y-6">
        <Panel title="Erve India Consolidated Packing List">
          <DescriptionList columns={4}>
            <DescriptionList.Item label="Distributor" value={packingList.distributor?.name ?? '—'} />
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
            <DescriptionList.Item label="Source Factories" value={packingList.sourceFactories.map((f) => f.name).join(', ') || '—'} />
            <DescriptionList.Item label="Source Dispatch Orders" value={packingList.sourceDispatchOrders.map((s) => s.saleOrderNumber).join(', ') || '—'} />
          </DescriptionList>
        </Panel>

        <Panel title="Cartons" padding="none">
          <DataTable
            rowKey="id"
            data={packingList.cartons}
            emptyState={<EmptyState title="No cartons selected yet" />}
            columns={[
              { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
              { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
              { key: 'dispatchOrder', header: 'Dispatch Order', render: (r) => r.saleOrder.saleOrderNumber },
              { key: 'factoryDispatch', header: 'Factory Packing List', accessor: 'factoryDispatchNumber' },
              { key: 'lines', header: 'Contents', render: (r) => r.lines.map((l) => `${l.styleNumber}/${l.sizeCode}: ${l.quantity}`).join(', ') },
              { key: 'qty', header: 'Total Qty', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
              ...(isOpen && canMutate
                ? [
                    {
                      key: 'remove',
                      header: '',
                      render: (r: ErvePackingListDetail['cartons'][number]) => (
                        <Button variant="secondary" onClick={() => removeCartonMutation.mutate(r.id)} loading={removeCartonMutation.isPending}>
                          Remove
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Panel>

        {packingList.styleSizeSummary.length > 0 && (
          <Panel title="Style / Size Summary" padding="none">
            <DataTable
              rowKey={(r) => `${r.styleNumber}-${r.sizeCode}`}
              data={packingList.styleSizeSummary}
              columns={[
                { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
                { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                { key: 'qty', header: 'Quantity', align: 'right', render: (r) => r.quantity.toLocaleString() },
              ]}
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

      {isOpen && canMutate && (
        <div className="flex justify-end">
          <Button onClick={() => finalizeMutation.mutate()} disabled={packingList.cartonCount === 0} loading={finalizeMutation.isPending}>
            Finalize Packing List
          </Button>
        </div>
      )}

      {packingList.status === 'FINALIZED' && canMutate && (
        <Panel title="Record Erve Dispatch">
          <div className="flex flex-wrap gap-3">
            <TextField label="Dispatch Date" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
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
