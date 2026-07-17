import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { DistributorSummary, Status } from './types.js';

export function DistributorListPage() {
  const { user } = useAuth();
  const canManage = user?.roles.includes('ADMIN') ?? false;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined }), [search, status]);

  const distributorsQuery = useQuery({
    queryKey: ['distributors', params],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<DistributorSummary[]>>('/distributors', { params });
      return response.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Distributors"
        subtitle="Distributor master records and contacts"
        primaryAction={
          canManage ? (
            <Button asChild variant="default">
              <Link to="/master-data/distributors/new">Create Distributor</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search distributors"
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          { label: 'Active', value: 'ACTIVE' },
          { label: 'Inactive', value: 'INACTIVE' },
        ]}
        statusValue={status || 'ALL'}
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as Status))}
        hasActiveFilters={Boolean(search || status)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
        }}
      />

      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (distributor) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/distributors/${distributor.id}`}
              >
                {distributor.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          { key: 'contactName', header: 'Contact', render: (distributor) => distributor.contactName ?? '—' },
          { key: 'city', header: 'City', render: (distributor) => distributor.city ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (distributor) => (
              <StatusBadge label={distributor.status} tone={distributor.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={distributorsQuery.data ?? []}
        loading={distributorsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading distributors" />}
        emptyState={<EmptyState title="No distributors found" description="Distributor records will appear here." />}
        error={
          distributorsQuery.isError ? (
            <ErrorState title="Unable to load distributors" description={distributorsQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
