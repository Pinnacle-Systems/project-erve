import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { canMutateErveDispatches } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { ErvePackingListSummary, PaginatedResult } from './types.js';

const STATUS_LABEL: Record<ErvePackingListSummary['status'], string> = {
  OPEN: 'Open',
  FINALIZED: 'Finalized',
  DISPATCHED: 'Dispatched',
};

export function ErvePackingListListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['erve-packing-lists'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<ErvePackingListSummary>>>('/erve-packing-lists', {
        params: { limit: 50 },
      });
      return res.data.data.items;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Erve Packing Lists"
        subtitle="Destination-specific consolidation of finalized Factory Packing cartons"
        secondaryActions={
          canMutateErveDispatches(user) && (
            <Button onClick={() => navigate('/fulfillment/erve-packing-lists/new')}>Create Erve Packing List</Button>
          )
        }
      />

      {query.isLoading ? (
        <LoadingState label="Loading Erve Packing Lists" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/erve-packing-lists/${row.id}`)}
            emptyState={<EmptyState title="No Erve Packing Lists yet" />}
            columns={[
              { key: 'number', header: 'Packing List #', accessor: 'ervePackingListNumber' },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor?.name ?? '—' },
              { key: 'destination', header: 'Destination', render: (r) => (r.destination.city ? `${r.destination.city}, ${r.destination.state}` : '—') },
              { key: 'cartons', header: 'Cartons', align: 'right', render: (r) => r.cartonCount.toLocaleString() },
              { key: 'qty', header: 'Pieces', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
              { key: 'factories', header: 'Factories', align: 'right', render: (r) => r.sourceFactories.length },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusBadge
                    label={STATUS_LABEL[r.status]}
                    tone={r.status === 'DISPATCHED' ? 'approved' : r.status === 'FINALIZED' ? 'pending' : 'draft'}
                  />
                ),
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
