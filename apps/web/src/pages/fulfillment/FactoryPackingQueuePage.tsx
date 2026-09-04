import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import type { FactoryDispatchDetail, FactoryPackingQueueLine, PaginatedResult } from './types.js';

export function FactoryPackingQueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedQty, setSelectedQty] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  const queueQuery = useQuery({
    queryKey: ['factory-packing-queue'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FactoryPackingQueueLine[]>>('/factory-dispatches/packing-queue');
      return res.data.data;
    },
  });

  const dispatchesQuery = useQuery({
    queryKey: ['factory-dispatches', 'mine'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryDispatchDetail>>>('/factory-dispatches', {
        params: { limit: 25 },
      });
      return res.data.data.items;
    },
  });

  const selectedLines = useMemo(
    () =>
      (queueQuery.data ?? [])
        .filter((line) => (selectedQty[line.stockAllocationId] ?? '').trim() !== '')
        .map((line) => ({
          saleOrderLineId: line.saleOrderLineId,
          stockAllocationId: line.stockAllocationId,
          packedQuantity: Number(selectedQty[line.stockAllocationId]),
          saleOrderId: line.saleOrderId,
        })),
    [queueQuery.data, selectedQty],
  );

  const distinctSaleOrders = useMemo(
    () => new Set(selectedLines.map((l) => l.saleOrderId)),
    [selectedLines],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const saleOrderId = [...distinctSaleOrders][0]!;
      const res = await apiClient.post<ApiSuccessResponse<{ id: string }>>('/factory-dispatches', {
        saleOrderId,
        lines: selectedLines.map(({ saleOrderLineId, stockAllocationId, packedQuantity }) => ({
          saleOrderLineId,
          stockAllocationId,
          packedQuantity,
        })),
      });
      return res.data.data;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['factory-packing-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['factory-dispatches'] });
      navigate(`/fulfillment/factory-dispatches/${created.id}`);
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to create the Factory Dispatch.')),
  });

  const canCreate = selectedLines.length > 0 && distinctSaleOrders.size === 1 && selectedLines.every((l) => l.packedQuantity > 0);

  if (queueQuery.isLoading) return <LoadingState label="Loading your Factory packing queue" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Factory Packing Queue" subtitle="Approved goods allocated from your Factory, awaiting packing" />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {distinctSaleOrders.size > 1 && (
        <ValidationMessage tone="warning">
          A Factory Dispatch can only be created from one Sale Order at a time — enter quantities for lines on a single
          Sale Order.
        </ValidationMessage>
      )}

      <Panel title="Awaiting Packing" padding="none">
        <DataTable
          rowKey="stockAllocationId"
          data={queueQuery.data ?? []}
          emptyState={<EmptyState title="Nothing to pack" description="No approved goods are currently allocated from your Factory." />}
          columns={[
            { key: 'saleOrderNumber', header: 'Sale Order', accessor: 'saleOrderNumber' },
            { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
            { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
            { key: 'size', header: 'Size', accessor: 'sizeLabel' },
            { key: 'allocated', header: 'Allocated', align: 'right', render: (r) => r.allocatedQuantity.toLocaleString() },
            { key: 'packed', header: 'Already Packed', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
            { key: 'remaining', header: 'Remaining', align: 'right', render: (r) => r.remainingQuantity.toLocaleString() },
            {
              key: 'pack',
              header: 'Pack Quantity',
              align: 'right',
              render: (r) => (
                <TextField
                  aria-label={`Pack quantity for ${r.styleNumber} ${r.sizeLabel}`}
                  type="number"
                  min={0}
                  max={r.remainingQuantity}
                  density="compact"
                  width="xs"
                  value={selectedQty[r.stockAllocationId] ?? ''}
                  onChange={(e) =>
                    setSelectedQty((current) => ({ ...current, [r.stockAllocationId]: e.target.value }))
                  }
                />
              ),
            },
          ]}
        />
      </Panel>

      {(queueQuery.data ?? []).length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => createMutation.mutate()} disabled={!canCreate} loading={createMutation.isPending}>
            Create Factory Dispatch
          </Button>
        </div>
      )}

      <Panel title="Your Factory Dispatches">
        <DataTable
          rowKey="id"
          data={dispatchesQuery.data ?? []}
          loading={dispatchesQuery.isLoading}
          emptyState={<EmptyState title="No Factory Dispatches yet" />}
          onRowClick={(row) => navigate(`/fulfillment/factory-dispatches/${row.id}`)}
          columns={[
            { key: 'number', header: 'Dispatch #', accessor: 'factoryDispatchNumber' },
            { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder.saleOrderNumber },
            { key: 'distributor', header: 'Distributor', render: (r) => r.saleOrder.distributor.name },
            { key: 'qty', header: 'Packed Qty', align: 'right', render: (r) => r.totalPackedQuantity.toLocaleString() },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusBadge
                  label={r.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
                  tone={r.status === 'READY_FOR_ERVE' ? 'approved' : 'draft'}
                />
              ),
            },
            {
              key: 'consolidated',
              header: 'Consolidated',
              render: (r) => (r.consolidated ? 'Yes' : '—'),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
