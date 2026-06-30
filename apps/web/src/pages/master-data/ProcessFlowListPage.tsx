import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlow } from './types.js';

export function ProcessFlowListPage() {
  const flowsQuery = useQuery({
    queryKey: ['process-flows'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlow[]>>('/process-flows');
      return response.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Process Flows" subtitle="Operational process definitions and active versions" />
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (flow) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/master-data/process-flows/${flow.id}`}>
                {flow.name}
              </Link>
            ),
          },
          { key: 'code', header: 'Code', accessor: 'code' },
          {
            key: 'activeVersion',
            header: 'Active Version',
            render: (flow) => {
              const active = flow.versions.find((version) => version.status === 'ACTIVE');
              return active ? `v${active.versionNumber}` : '—';
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (flow) => <StatusBadge label={flow.status} tone={flow.status === 'ACTIVE' ? 'success' : 'muted'} />,
          },
        ]}
        data={flowsQuery.data ?? []}
        loading={flowsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading process flows" />}
        emptyState={<EmptyState title="No process flows found" description="Process flow records will appear here." />}
        error={
          flowsQuery.isError ? (
            <ErrorState title="Unable to load process flows" description={flowsQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
