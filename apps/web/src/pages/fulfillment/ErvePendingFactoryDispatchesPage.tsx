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
import { canMutateErveDispatches } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { FactoryDispatchSummary, PaginatedResult } from './types.js';

export function ErvePendingFactoryDispatchesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canConsolidate = canMutateErveDispatches(user);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState('');

  const pendingQuery = useQuery({
    queryKey: ['factory-dispatches', 'pending-consolidation'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { status: 'READY_FOR_ERVE', unconsolidatedOnly: true, limit: 100 },
      });
      return res.data.data.items;
    },
  });

  const selectedRows = useMemo(
    () => (pendingQuery.data ?? []).filter((row) => selected.has(row.id)),
    [pendingQuery.data, selected],
  );
  const distinctSaleOrders = useMemo(() => new Set(selectedRows.map((r) => r.saleOrder.id)), [selectedRows]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const consolidateMutation = useMutation({
    mutationFn: async () => {
      const saleOrderId = [...distinctSaleOrders][0]!;
      const res = await apiClient.post<ApiSuccessResponse<{ id: string }>>('/erve-packing-lists', {
        saleOrderId,
        factoryDispatchIds: [...selected],
      });
      return res.data.data;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['factory-dispatches', 'pending-consolidation'] });
      navigate(`/fulfillment/erve-packing-lists/${created.id}`);
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to consolidate the selected Factory Dispatches.')),
  });

  if (pendingQuery.isLoading) return <LoadingState label="Loading pending Factory Dispatches" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Pending Factory Dispatches" subtitle="Finalized Factory packing waiting for Erve India consolidation" />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {distinctSaleOrders.size > 1 && (
        <ValidationMessage tone="warning">
          Select Factory Dispatches from only one Sale Order at a time to consolidate them into one Erve Packing List.
        </ValidationMessage>
      )}

      <Panel padding="none">
        <DataTable
          rowKey="id"
          data={pendingQuery.data ?? []}
          emptyState={<EmptyState title="Nothing pending" description="No finalized Factory Dispatches are awaiting consolidation." />}
          columns={[
            ...(canConsolidate
              ? [
                  {
                    key: 'select',
                    header: '',
                    render: (r: FactoryDispatchSummary) => (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.factoryDispatchNumber}`}
                      />
                    ),
                  },
                ]
              : []),
            { key: 'number', header: 'Factory Dispatch #', accessor: 'factoryDispatchNumber' },
            { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
            { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder.saleOrderNumber },
            { key: 'distributor', header: 'Distributor', render: (r) => r.saleOrder.distributor.name },
            { key: 'qty', header: 'Packed Qty', align: 'right', render: (r) => r.totalPackedQuantity.toLocaleString() },
            { key: 'finalizedAt', header: 'Finalized', render: (r) => (r.finalizedAt ? new Date(r.finalizedAt).toLocaleDateString() : '—') },
          ]}
        />
      </Panel>

      {canConsolidate && (pendingQuery.data ?? []).length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={() => consolidateMutation.mutate()}
            disabled={selected.size === 0 || distinctSaleOrders.size !== 1}
            loading={consolidateMutation.isPending}
          >
            Consolidate into Erve Packing List
          </Button>
        </div>
      )}
    </div>
  );
}
