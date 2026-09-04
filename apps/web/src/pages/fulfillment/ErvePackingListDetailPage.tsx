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
import type { ErvePackingListDetail } from './types.js';

const PRINT_STYLE = `
@media print {
  body * { visibility: hidden; }
  #erve-packing-list, #erve-packing-list * { visibility: visible; }
  #erve-packing-list { position: absolute; top: 0; left: 0; width: 100%; }
}`;

export function ErvePackingListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [transporter, setTransporter] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');

  const query = useQuery({
    queryKey: ['erve-packing-list', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ErvePackingListDetail>>(`/erve-packing-lists/${id}`);
      return res.data.data;
    },
  });
  const packingList = query.data;

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
      void queryClient.invalidateQueries({ queryKey: ['erve-packing-list', id] });
      navigate(`/fulfillment/erve-dispatches/${created.id}`);
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to record this dispatch.')),
  });

  if (query.isLoading) return <LoadingState label="Loading Erve Packing List" />;
  if (!packingList) return <EmptyState title="Erve Packing List not found" tone="error" />;

  return (
    <div className="space-y-6">
      <style>{PRINT_STYLE}</style>
      <PageHeader
        title={packingList.ervePackingListNumber}
        subtitle={`${packingList.saleOrder.saleOrderNumber} · ${packingList.saleOrder.distributor.name}`}
        status={<StatusBadge label={packingList.status === 'DISPATCHED' ? 'Dispatched' : 'Open'} tone={packingList.status === 'DISPATCHED' ? 'approved' : 'pending'} />}
        secondaryActions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print Packing List
            </Button>
            <Button variant="secondary" onClick={() => navigate('/fulfillment/erve-packing-lists')}>
              Back
            </Button>
          </>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <div id="erve-packing-list" className="space-y-6">
        <Panel title="Erve India Packing List">
          <DescriptionList columns={4}>
            <DescriptionList.Item label="Sale Order" value={packingList.saleOrder.saleOrderNumber} />
            <DescriptionList.Item label="Distributor" value={packingList.saleOrder.distributor.name} />
            <DescriptionList.Item label="Created By" value={packingList.createdBy.name} />
            <DescriptionList.Item label="Created At" value={new Date(packingList.createdAt).toLocaleString()} />
            <DescriptionList.Item label="Total Quantity" value={packingList.totalQuantity.toLocaleString()} />
          </DescriptionList>
        </Panel>

        {packingList.sources.map((source) => (
          <Panel key={source.factoryDispatchId} title={`Factory Dispatch ${source.factoryDispatchNumber} — ${source.factory.name}`} padding="none">
            <DataTable
              rowKey="id"
              data={source.lines}
              columns={[
                { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
                { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                { key: 'packed', header: 'Packed Qty', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
              ]}
            />
            <div className="p-3 text-sm text-muted-foreground">
              Cartons: {source.cartons.map((c) => c.cartonNumber).join(', ') || '—'}
            </div>
          </Panel>
        ))}
      </div>

      {packingList.status === 'OPEN' ? (
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
      ) : (
        <ValidationMessage tone="success">This packing list has already been dispatched.</ValidationMessage>
      )}
    </div>
  );
}
