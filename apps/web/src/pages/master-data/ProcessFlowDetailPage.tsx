import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlow, ProcessFlowVersion } from './types.js';

export function ProcessFlowDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const flowQuery = useQuery({
    queryKey: ['process-flow', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlow>>(`/process-flows/${id}`);
      return response.data.data;
    },
  });
  const selectedVersionId = flowQuery.data?.versions[0]?.id;
  const versionQuery = useQuery({
    queryKey: ['process-flow-version', selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flow-versions/${selectedVersionId}`,
      );
      return response.data.data;
    },
  });
  const activateMutation = useMutation({
    mutationFn: (versionId: string) => apiClient.post(`/process-flow-versions/${versionId}/activate`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['process-flow', id] });
      await queryClient.invalidateQueries({ queryKey: ['process-flow-version'] });
    },
  });
  const flow = flowQuery.data;

  if (!flow) {
    return <LoadingState label="Loading process flow" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={flow.name}
        subtitle={flow.code}
        status={<StatusBadge label={flow.status} tone={flow.status === 'ACTIVE' ? 'success' : 'muted'} />}
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Panel title="Versions">
          <div className="divide-y divide-border-subtle">
            {flow.versions.map((version) => (
              <div key={version.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">Version {version.versionNumber}</div>
                  <StatusBadge
                    label={version.status}
                    tone={version.status === 'ACTIVE' ? 'success' : version.status === 'DRAFT' ? 'pending' : 'muted'}
                  />
                </div>
                {version.effectiveFrom ? (
                  <DescriptionList columns={1} density="compact" className="mt-2">
                    <DescriptionList.Item label="Effective From" value={new Date(version.effectiveFrom).toLocaleDateString('en-IN')} />
                  </DescriptionList>
                ) : null}
                {version.status === 'DRAFT' ? (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    onClick={() => activateMutation.mutate(version.id)}
                    disabled={activateMutation.isPending}
                  >
                    Activate
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title={versionQuery.data ? `Stages: Version ${versionQuery.data.versionNumber}` : 'Stages'}>
          <DataTable
            columns={[
              { key: 'sequence', header: '#', accessor: 'sequence', align: 'right', width: '72px' },
              { key: 'name', header: 'Stage', accessor: 'name' },
              { key: 'code', header: 'Code', render: (stage) => stage.code ?? '—' },
              {
                key: 'status',
                header: 'Status',
                render: (stage) => <StatusBadge label={stage.status} tone={stage.status === 'ACTIVE' ? 'success' : 'muted'} />,
              },
            ]}
            data={versionQuery.data?.stages ?? []}
            loading={versionQuery.isLoading}
            loadingState={<LoadingState variant="rows" label="Loading stages" />}
            emptyState={<EmptyState title="No stages found" description="Stages for this version will appear here." />}
            containerClassName="shadow-none"
          />
        </Panel>
      </div>
    </div>
  );
}
