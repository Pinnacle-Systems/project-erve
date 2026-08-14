import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { QualityForm } from './types.js';
import { componentLabel } from './quality-form-ui.js';

export function QualityFormListPage() {
  const query = useQuery({
    queryKey: ['quality-forms'],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QualityForm[]>>('/quality-forms')).data.data,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Quality Forms"
        subtitle="Versioned definitions of what quality activities collect; Process Flow controls when they occur."
        primaryAction={
          <Button asChild>
            <Link to="/master-data/quality-forms/new">Create Quality Form</Link>
          </Button>
        }
      />
      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (form) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/quality-forms/${form.id}`}
              >
                {form.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          {
            key: 'activity',
            header: 'Activity',
            render: (form) => componentLabel(form.activityType),
          },
          { key: 'scope', header: 'Scope', render: (form) => componentLabel(form.executionScope) },
          {
            key: 'version',
            header: 'Published Version',
            render: (form) => {
              const version = form.versions.find((item) => item.status === 'PUBLISHED');
              return version ? `v${version.versionNumber}` : '—';
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (form) => (
              <StatusBadge
                label={form.status}
                tone={form.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={query.data ?? []}
        loading={query.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading Quality Forms" />}
        emptyState={
          <EmptyState
            title="No Quality Forms found"
            description="Create a controlled, versioned form definition."
          />
        }
        error={
          query.isError ? (
            <ErrorState title="Unable to load Quality Forms" description={query.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
