import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import type { DistributorSalesReportView } from './types.js';

export function DistributorSalesReportListPage() {
  const navigate = useNavigate();

  // Cursor-paginated: Load more appends every further page (the page size
  // is only the batch size, never a cap on what the list can reach).
  const { query, items } = useCursorList<DistributorSalesReportView>({
    queryKey: ['distributor-sales-reports'],
    path: '/distributor-sales-reports',
    params: { limit: 100 },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Reports" subtitle="Distributor-reported Actual Sale of Sale-or-Return stock" />

      {query.isLoading ? (
        <LoadingState label="Loading sales reports" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={items}
            onRowClick={(row) => navigate(`/fulfillment/distributor-sales-reports/${row.id}`)}
            emptyState={<EmptyState title="No sales reports yet" />}
            error={
              query.isError ? (
                <ErrorState title="Unable to load sales reports" description={query.error.message} />
              ) : undefined
            }
            columns={[
              { key: 'date', header: 'Report Date', render: (r) => new Date(r.reportDate).toLocaleDateString() },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              { key: 'submittedBy', header: 'Submitted By', render: (r) => r.submittedBy.name },
              { key: 'lines', header: 'Lines', align: 'right', render: (r) => r.lines.length },
              { key: 'qty', header: 'Total Qty Sold', align: 'right', render: (r) => r.lines.reduce((sum, l) => sum + l.quantitySold, 0).toLocaleString() },
            ]}
          />
        </Panel>
      )}
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['sales report', 'sales reports'])} />
    </div>
  );
}
