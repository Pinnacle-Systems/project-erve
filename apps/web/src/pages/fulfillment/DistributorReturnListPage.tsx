import { useNavigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import type { DistributorReturnStatus, DistributorReturnView } from './types.js';

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

  // Cursor-paginated: Load more appends every further page (the page size
  // is only the batch size, never a cap on what the list can reach).
  const { query, items } = useCursorList<DistributorReturnView>({
    queryKey: ['distributor-returns'],
    path: '/distributor-returns',
    params: { limit: 100 },
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
            data={items}
            onRowClick={(row) => navigate(`/fulfillment/distributor-returns/${row.id}`)}
            emptyState={<EmptyState title="No returns yet" />}
            error={
              query.isError ? (
                <ErrorState title="Unable to load returns" description={query.error.message} />
              ) : undefined
            }
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
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['return', 'returns'])} />
    </div>
  );
}
