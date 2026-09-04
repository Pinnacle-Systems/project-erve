import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { DistributorSalesReportView, PaginatedResult } from './types.js';

export function DistributorSalesReportListPage() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['distributor-sales-reports'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<DistributorSalesReportView>>>('/distributor-sales-reports', {
        params: { limit: 100 },
      });
      return res.data.data.items;
    },
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
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/distributor-sales-reports/${row.id}`)}
            emptyState={<EmptyState title="No sales reports yet" />}
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
    </div>
  );
}
