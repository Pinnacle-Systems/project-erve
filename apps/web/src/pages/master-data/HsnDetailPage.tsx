import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageHsns } from '../../auth/permissions.js';
import type { Hsn } from './types.js';

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function HsnDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageHsns(user);

  const hsnQuery = useQuery({
    queryKey: ['hsn', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Hsn>>(`/hsns/${id}`);
      return res.data.data;
    },
  });
  const hsn = hsnQuery.data;

  if (hsnQuery.isLoading) {
    return <LoadingState label="Loading HSN" />;
  }
  if (!hsn) {
    return <EmptyState title="HSN not found" description="The selected HSN could not be loaded." tone="error" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={hsn.code}
        subtitle={hsn.description ?? 'No description recorded'}
        status={<StatusBadge label={hsn.status} tone={hsn.status === 'ACTIVE' ? 'success' : 'muted'} />}
        secondaryActions={
          <>
            {canManage && (
              <Button asChild variant="secondary">
                <Link to={`/master-data/hsns/${id}/edit`}>Edit</Link>
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/master-data/hsns')}>
              Back
            </Button>
          </>
        }
      />

      <Panel title="Details">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="HSN Code" value={hsn.code} />
          <DescriptionList.Item label="Description" value={hsn.description ?? '—'} />
          <DescriptionList.Item
            label="GST Rule Set"
            value={
              hsn.gstRuleSet ? (
                <Link className="text-[var(--erp-text-link)]" to={`/gst-rule-sets/${hsn.gstRuleSet.id}`}>
                  {hsn.gstRuleSet.code} — {hsn.gstRuleSet.name}
                </Link>
              ) : (
                'Unassigned'
              )
            }
          />
          <DescriptionList.Item label="Created" value={formatTimestamp(hsn.createdAt)} />
          <DescriptionList.Item label="Last Updated" value={formatTimestamp(hsn.updatedAt)} />
        </DescriptionList>
      </Panel>
    </div>
  );
}
