import { Link } from 'react-router-dom';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import type { ProcessFlow } from './types.js';

export function ProcessFlowListPage() {
  // Opt-in cursor pagination (limit sent): Load more appends further pages.
  const { query: flowsQuery, items: flows } = useCursorList<ProcessFlow>({
    queryKey: ['process-flows'],
    path: '/process-flows',
    params: { limit: 25 },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Process Flows"
        subtitle="Operational process definitions and active versions"
        primaryAction={
          <Button asChild variant="default">
            <Link to="/master-data/process-flows/new">Create Process Flow</Link>
          </Button>
        }
      />
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (flow) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/process-flows/${flow.id}`}
              >
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
            render: (flow) => (
              <StatusBadge
                label={flow.status}
                tone={flow.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={flows}
        loading={flowsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading process flows" />}
        emptyState={
          <EmptyState
            title="No process flows found"
            description="Process flow records will appear here."
          />
        }
        error={
          flowsQuery.isError ? (
            <ErrorState
              title="Unable to load process flows"
              description={flowsQuery.error.message}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(flowsQuery, flows.length, ['process flow', 'process flows'])} />
    </div>
  );
}
