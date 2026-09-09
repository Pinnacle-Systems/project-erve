import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { FactoryDispatchSummary, FactoryPackingQueueLine, PaginatedResult } from './types.js';

// Phase 4: packing itself now happens on the Dispatch Order's own Packing
// List page (cartons are the sole physical packing fact) — this page is a
// pure progress view, required vs. physical-carton-packed, that links there.
export function FactoryPackingQueuePage() {
  const navigate = useNavigate();

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
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { limit: 25 },
      });
      return res.data.data.items;
    },
  });

  if (queueQuery.isLoading) return <LoadingState label="Loading your Factory packing queue" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Factory Packing Queue" subtitle="Approved goods allocated from your Factory, awaiting packing" />

      <Panel title="Awaiting Packing" padding="none">
        <DataTable
          rowKey="saleOrderLineId"
          data={queueQuery.data ?? []}
          emptyState={<EmptyState title="Nothing to pack" description="No approved goods are currently allocated from your Factory." />}
          onRowClick={(row) => navigate(`/sale-orders/${row.saleOrderId}/packing-list`)}
          columns={[
            { key: 'saleOrderNumber', header: 'Sale Order', accessor: 'saleOrderNumber' },
            { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
            { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
            { key: 'size', header: 'Size', accessor: 'sizeLabel' },
            { key: 'allocated', header: 'Required', align: 'right', render: (r) => r.allocatedQuantity.toLocaleString() },
            { key: 'packed', header: 'Packed', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
            { key: 'remaining', header: 'Remaining', align: 'right', render: (r) => r.remainingQuantity.toLocaleString() },
          ]}
        />
      </Panel>

      <Panel title="Your Factory Dispatches">
        <DataTable
          rowKey="id"
          data={dispatchesQuery.data ?? []}
          loading={dispatchesQuery.isLoading}
          emptyState={<EmptyState title="No Factory Dispatches yet" />}
          onRowClick={(row) => navigate(`/sale-orders/${row.saleOrder.id}/packing-list`)}
          columns={[
            { key: 'number', header: 'Dispatch #', accessor: 'factoryDispatchNumber' },
            { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder.saleOrderNumber },
            { key: 'distributor', header: 'Distributor', render: (r) => r.saleOrder.distributor.name },
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
