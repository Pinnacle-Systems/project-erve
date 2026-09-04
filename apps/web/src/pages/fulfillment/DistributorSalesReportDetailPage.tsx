import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { DistributorSalesReportView } from './types.js';

export function DistributorSalesReportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['distributor-sales-report', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<DistributorSalesReportView>>(`/distributor-sales-reports/${id}`);
      return res.data.data;
    },
  });
  const report = query.data;

  if (query.isLoading) return <LoadingState label="Loading sales report" />;
  if (!report) return <EmptyState title="Sales report not found" tone="error" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Sales Report · ${new Date(report.reportDate).toLocaleDateString()}`}
        subtitle={report.distributor.name}
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-sales-reports')}>
            Back
          </Button>
        }
      />

      <Panel title="Report Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Distributor" value={report.distributor.name} />
          <DescriptionList.Item label="Submitted By" value={report.submittedBy.name} />
          <DescriptionList.Item label="Submitted At" value={new Date(report.submittedAt).toLocaleString()} />
          {report.remarks && <DescriptionList.Item label="Remarks" value={report.remarks} span={2} />}
        </DescriptionList>
      </Panel>

      <Panel title="Lines" padding="none">
        <DataTable
          rowKey="id"
          data={report.lines}
          emptyState={<EmptyState title="No lines" />}
          columns={[
            { key: 'dispatch', header: 'Erve Dispatch #', render: (r) => r.erveDispatch.erveDispatchNumber },
            { key: 'style', header: 'Style / Size', render: (r) => `${r.styleNumber} / ${r.sizeLabel}` },
            { key: 'qty', header: 'Quantity Sold', align: 'right', render: (r) => r.quantitySold.toLocaleString() },
          ]}
        />
      </Panel>
    </div>
  );
}
