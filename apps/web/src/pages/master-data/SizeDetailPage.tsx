import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Size } from './types.js';

export function SizeDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['size', id],
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<Size>>(`/sizes/${id}`)).data.data,
  });
  const mutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'INACTIVE') =>
      apiClient.patch(`/sizes/${id}/status`, { status }),
    onSuccess: async () => {
      setConfirm(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['size', id] }),
        client.invalidateQueries({ queryKey: ['sizes'] }),
      ]);
    },
    onError: (caught: Error) => {
      setConfirm(false);
      setError(caught.message);
    },
  });
  if (query.isLoading) return <LoadingState label="Loading size" />;
  if (query.isError)
    return <ErrorState title="Unable to load size" description={query.error.message} />;
  if (!query.data)
    return (
      <EmptyState title="Size not found" description="The selected size could not be loaded." />
    );
  const size = query.data;
  const active = size.status === 'ACTIVE';
  const usage = size.usage ?? { styleMappings: 0, purchaseOrderLines: 0, jobOrderLines: 0 };
  return (
    <div className="space-y-5">
      <PageHeader
        title={size.code}
        subtitle={size.label}
        status={<StatusBadge label={size.status} tone={active ? 'success' : 'muted'} />}
        primaryAction={
          <Button asChild>
            <Link to={`/master-data/sizes/${size.id}/edit`}>Edit</Link>
          </Button>
        }
        secondaryActions={
          <Button variant={active ? 'destructive' : 'secondary'} onClick={() => setConfirm(true)}>
            {active ? 'Deactivate' : 'Activate'}
          </Button>
        }
      />
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <Panel title="Size Details">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="Code" value={size.code} />
          <DescriptionList.Item label="Label" value={size.label} />
          <DescriptionList.Item label="Type" value={size.sizeType.replace('_', ' ')} />
          <DescriptionList.Item label="Sort order" value={String(size.sortOrder)} />
        </DescriptionList>
      </Panel>
      <Panel title="Usage and impact">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="Style mappings" value={String(usage.styleMappings)} />
          <DescriptionList.Item
            label="Purchase-order lines"
            value={String(usage.purchaseOrderLines)}
          />
          <DescriptionList.Item label="Job-order lines" value={String(usage.jobOrderLines)} />
        </DescriptionList>
      </Panel>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={active ? 'Deactivate size' : 'Activate size'}
        description={
          active
            ? `This size is mapped to ${usage.styleMappings} style(s) and used by ${usage.purchaseOrderLines + usage.jobOrderLines} transaction line(s). It will be blocked from new mappings and purchase orders; history remains unchanged.`
            : 'This size will become available for new mappings and purchase orders.'
        }
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        destructive={active}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate(active ? 'INACTIVE' : 'ACTIVE')}
      />
    </div>
  );
}
