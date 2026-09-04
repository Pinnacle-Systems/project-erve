import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { DistributorReturnStatus, DistributorReturnView, PaginatedResult } from './types.js';

const statusTone: Record<DistributorReturnStatus, 'submitted' | 'approved' | 'rejected' | 'posted' | 'cancelled'> = {
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RECEIVED: 'posted',
  CANCELLED: 'cancelled',
};

const statusLabel: Record<DistributorReturnStatus, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export function DistributorReturnListPage() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['distributor-returns'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<DistributorReturnView>>>('/distributor-returns', {
        params: { limit: 100 },
      });
      return res.data.data.items;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Distributor Returns" subtitle="Unsold Sale-or-Return stock coming back from distributors" />

      {query.isLoading ? (
        <LoadingState label="Loading returns" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/distributor-returns/${row.id}`)}
            emptyState={<EmptyState title="No returns yet" />}
            columns={[
              { key: 'returnNumber', header: 'Return #', render: (r) => r.returnNumber },
              { key: 'date', header: 'Return Date', render: (r) => new Date(r.returnDate).toLocaleDateString() },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              { key: 'submittedBy', header: 'Submitted By', render: (r) => r.submittedBy.name },
              { key: 'lines', header: 'Lines', align: 'right', render: (r) => r.lines.length },
              {
                key: 'qty',
                header: 'Requested Qty',
                align: 'right',
                render: (r) => r.lines.reduce((sum, l) => sum + l.requestedQuantity, 0).toLocaleString(),
              },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge label={statusLabel[r.status]} tone={statusTone[r.status]} /> },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
