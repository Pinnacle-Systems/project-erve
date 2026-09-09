import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import type { EligibleErveCartonView } from './types.js';

function destinationGroupKeyOf(carton: EligibleErveCartonView): string {
  return `${carton.distributor.id}|${carton.destination.city}|${carton.destination.state}`;
}

export function ErvePackingListCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState('');

  const eligibleQuery = useQuery({
    queryKey: ['erve-packing-lists', 'eligible-cartons'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<EligibleErveCartonView[]>>('/erve-packing-lists/eligible-cartons');
      return res.data.data;
    },
  });

  const cartons = useMemo(() => eligibleQuery.data ?? [], [eligibleQuery.data]);
  const cartonsById = useMemo(() => new Map(cartons.map((c) => [c.id, c])), [cartons]);

  const selectedCartons = useMemo(() => [...selected].map((id) => cartonsById.get(id)).filter((c): c is EligibleErveCartonView => Boolean(c)), [selected, cartonsById]);
  const groupKey = selectedCartons[0] ? destinationGroupKeyOf(selectedCartons[0]) : null;

  const totalQuantity = selectedCartons.reduce((sum, c) => sum + c.totalQuantity, 0);
  const sourceFactories = useMemo(() => new Set(selectedCartons.map((c) => c.factory.id)), [selectedCartons]);
  const sourceDispatchOrders = useMemo(() => new Set(selectedCartons.map((c) => c.saleOrder.id)), [selectedCartons]);
  const styleSizeSummary = useMemo(() => {
    const byKey = new Map<string, { styleNumber: string; styleName: string; sizeCode: string; sizeLabel: string; quantity: number }>();
    for (const carton of selectedCartons) {
      for (const line of carton.lines) {
        const key = `${line.styleNumber}:${line.sizeCode}`;
        const existing = byKey.get(key);
        if (existing) existing.quantity += line.quantity;
        else byKey.set(key, { ...line });
      }
    }
    return [...byKey.values()];
  }, [selectedCartons]);

  function toggle(carton: EligibleErveCartonView) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(carton.id)) {
        next.delete(carton.id);
      } else {
        next.add(carton.id);
      }
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<{ id: string }>>('/erve-packing-lists', { cartonIds: [...selected] });
      return res.data.data;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['erve-packing-lists'] });
      navigate(`/fulfillment/erve-packing-lists/${created.id}`);
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to create this Erve Packing List.')),
  });

  if (eligibleQuery.isLoading) return <LoadingState label="Loading eligible cartons" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Create Erve Packing List" subtitle="Select audited Factory cartons bound for one destination to consolidate" />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      {groupKey && (
        <Panel title="Selected for consolidation">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-muted-foreground">Cartons</div>
              <div className="text-lg font-semibold">{selectedCartons.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Pieces</div>
              <div className="text-lg font-semibold">{totalQuantity.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Source Factories</div>
              <div className="text-lg font-semibold">{sourceFactories.size}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Source Dispatch Orders</div>
              <div className="text-lg font-semibold">{sourceDispatchOrders.size}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Destination</div>
              <div className="text-lg font-semibold">
                {selectedCartons[0]!.destination.city}, {selectedCartons[0]!.destination.state}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Distributor</div>
              <div className="text-lg font-semibold">{selectedCartons[0]!.distributor.name}</div>
            </div>
          </div>
          {styleSizeSummary.length > 0 && (
            <div className="mt-3 text-sm text-muted-foreground">
              {styleSizeSummary.map((row) => `${row.styleNumber}/${row.sizeCode}: ${row.quantity}`).join(' · ')}
            </div>
          )}
        </Panel>
      )}

      <Panel padding="none">
        <DataTable
          rowKey="id"
          data={cartons}
          emptyState={<EmptyState title="Nothing eligible" description="No audited, finalized Factory cartons are awaiting Erve consolidation." />}
          columns={[
            {
              key: 'select',
              header: '',
              render: (r: EligibleErveCartonView) => (
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  disabled={groupKey !== null && !selected.has(r.id) && destinationGroupKeyOf(r) !== groupKey}
                  onChange={() => toggle(r)}
                  aria-label={`Select carton ${r.cartonNumber}`}
                />
              ),
            },
            { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
            { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
            { key: 'dispatchOrder', header: 'Dispatch Order', render: (r) => r.saleOrder.saleOrderNumber },
            { key: 'destination', header: 'Destination', render: (r) => `${r.destination.city}, ${r.destination.state}` },
            { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
            { key: 'qty', header: 'Pieces', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
          ]}
        />
      </Panel>

      {cartons.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => createMutation.mutate()} disabled={selected.size === 0} loading={createMutation.isPending}>
            Create Erve Packing List
          </Button>
        </div>
      )}
    </div>
  );
}
