import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  ReportDistributorReturns,
  ReportFilters,
  ReportFulfillment,
  ReportProduction,
  ReportSaleOrReturn,
} from '@erve/types';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../../lib/api-client.js';
import {
  FactoryWorkloadPanel,
  ProductionPipelinePanel,
  ProductionQuantityFlowPanel,
} from './ProductionCharts.js';
import { FulfillmentStatusCharts } from './FulfillmentCharts.js';
import { DistributorReturnStatusPanel, DistributorSorPositionPanel } from './DistributorCharts.js';

interface ChartsSectionProps {
  filters: ReportFilters;
  canViewProduction: boolean;
  canViewFulfillment: boolean;
  canViewSaleReturn: boolean;
}

async function get<T>(path: string, params: ReportFilters) {
  const res = await apiClient.get<ApiSuccessResponse<T>>(path, { params });
  return res.data.data;
}

// The default export of this module — kept as the sole default export so
// React.lazy(() => import('./charts/ChartsSection.js')) code-splits Recharts
// (and this whole chart bundle) out of the Dashboard's initial load.
export default function ChartsSection({
  filters,
  canViewProduction,
  canViewFulfillment,
  canViewSaleReturn,
}: ChartsSectionProps) {
  const productionQuery = useQuery({
    queryKey: ['reports', 'production', filters],
    enabled: canViewProduction,
    queryFn: () => get<ReportProduction>('/reports/production', filters),
  });
  const fulfillmentQuery = useQuery({
    queryKey: ['reports', 'fulfillment', filters],
    enabled: canViewFulfillment,
    queryFn: () => get<ReportFulfillment>('/reports/fulfillment', filters),
  });
  const saleOrReturnQuery = useQuery({
    queryKey: ['reports', 'sale-or-return', filters],
    enabled: canViewSaleReturn,
    queryFn: () => get<ReportSaleOrReturn>('/reports/sale-or-return', filters),
  });
  const distributorReturnsQuery = useQuery({
    queryKey: ['reports', 'distributor-returns', filters, 'status'],
    enabled: canViewSaleReturn,
    queryFn: () => get<ReportDistributorReturns>('/reports/distributor-returns', { ...filters, groupBy: 'status' } as never),
  });

  const anyLoading =
    (canViewProduction && productionQuery.isLoading) ||
    (canViewFulfillment && fulfillmentQuery.isLoading) ||
    (canViewSaleReturn && (saleOrReturnQuery.isLoading || distributorReturnsQuery.isLoading));
  const anyError =
    (canViewProduction && productionQuery.isError) ||
    (canViewFulfillment && fulfillmentQuery.isError) ||
    (canViewSaleReturn && (saleOrReturnQuery.isError || distributorReturnsQuery.isError));

  if (anyLoading) {
    return <LoadingState variant="rows" label="Loading charts" rows={6} />;
  }
  if (anyError) {
    return <ErrorState title="Unable to load charts" description="Something went wrong loading chart data. Try again." />;
  }

  return (
    <div className="space-y-4">
      {canViewProduction && productionQuery.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ProductionPipelinePanel pipeline={productionQuery.data.pipeline} />
          <FactoryWorkloadPanel workload={productionQuery.data.factoryWorkload} />
          <div className="xl:col-span-2">
            <ProductionQuantityFlowPanel quantityFlow={productionQuery.data.quantityFlow} />
          </div>
        </div>
      ) : null}
      {canViewFulfillment && fulfillmentQuery.data ? (
        <FulfillmentStatusCharts fulfillment={fulfillmentQuery.data} />
      ) : null}
      {canViewSaleReturn && saleOrReturnQuery.data && distributorReturnsQuery.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DistributorSorPositionPanel rows={saleOrReturnQuery.data.rows} />
          <DistributorReturnStatusPanel rows={distributorReturnsQuery.data.rows} />
        </div>
      ) : null}
    </div>
  );
}
