import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { QualityForm, QualityFormVersion } from './types.js';
import { componentLabel } from './quality-form-ui.js';

export function QualityFormDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['quality-form', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QualityForm>>(`/quality-forms/${id}`)).data.data,
  });
  const versionId = query.data?.versions[0]?.id;
  const versionQuery = useQuery({
    queryKey: ['quality-form-version', versionId],
    enabled: Boolean(versionId),
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<QualityFormVersion>>(
          `/quality-form-versions/${versionId}`,
        )
      ).data.data,
  });
  const createVersion = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<ApiSuccessResponse<QualityFormVersion>>(
          `/quality-forms/${id}/versions`,
          { copyFromVersionId: versionId },
        )
      ).data.data,
    onSuccess: async (version) => {
      await client.invalidateQueries({ queryKey: ['quality-form', id] });
      navigate(`/master-data/quality-form-versions/${version.id}/edit`);
    },
  });
  const publish = useMutation({
    mutationFn: async () =>
      (await apiClient.post(`/quality-form-versions/${versionId}/publish`)).data,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['quality-form', id] });
      await client.invalidateQueries({ queryKey: ['quality-form-version', versionId] });
    },
  });
  const toggle = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/quality-forms/${id}/status`, {
        status: query.data?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ['quality-form', id] }),
  });
  if (query.isLoading) return <LoadingState label="Loading Quality Form" />;
  if (query.isError)
    return <ErrorState title="Unable to load Quality Form" description={query.error.message} />;
  if (!query.data) return <EmptyState title="Quality Form not found" />;
  const form = query.data;
  const version = versionQuery.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${form.code} — ${form.name}`}
        subtitle="Quality Form Master defines what is collected; Process Flow will define when it is used."
        status={
          <StatusBadge label={form.status} tone={form.status === 'ACTIVE' ? 'success' : 'muted'} />
        }
        secondaryActions={
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link to={`/master-data/quality-forms/${form.id}/edit`}>Edit</Link>
            </Button>
            <Button variant="secondary" onClick={() => toggle.mutate()}>
              {form.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        }
      />
      <Panel title="Form details">
        <dl className="grid gap-4 md:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Code</dt>
            <dd>{form.code}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Lifecycle</dt>
            <dd>{componentLabel(form.status)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Description</dt>
            <dd>{form.description || '—'}</dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Versions">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {form.versions.map((item) => (
              <StatusBadge
                key={item.id}
                label={`v${item.versionNumber} ${item.status}`}
                tone={
                  item.status === 'PUBLISHED'
                    ? 'success'
                    : item.status === 'DRAFT'
                      ? 'pending'
                      : 'muted'
                }
              />
            ))}
          </div>
          {version ? (
            <>
              <dl className="grid gap-4 md:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Version activity</dt>
                  <dd>{componentLabel(version.activityType)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Version scope</dt>
                  <dd>{componentLabel(version.executionScope)}</dd>
                </div>
              </dl>
              <div className="flex gap-2">
                {version.status === 'DRAFT' ? (
                  <Button asChild variant="secondary">
                    <Link to={`/master-data/quality-form-versions/${version.id}/edit`}>
                      Edit Definition
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => createVersion.mutate()}>
                    Create New Draft
                  </Button>
                )}
                {version.status === 'DRAFT' ? (
                  <Button onClick={() => publish.mutate()}>Publish Version</Button>
                ) : null}
              </div>
              {version.sections.map((section) => (
                <div
                  key={section.id ?? section.sequence}
                  className="rounded-md border border-border-subtle p-4"
                >
                  <h3 className="font-semibold">
                    {section.sequence}. {section.title}
                  </h3>
                  <ol className="mt-2 list-decimal pl-6">
                    {section.components.map((component) => (
                      <li key={component.id ?? component.sequence}>
                        {component.title}{' '}
                        <span className="text-sm text-muted-foreground">
                          ({componentLabel(component.type)})
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
