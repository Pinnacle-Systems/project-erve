import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Status, Style } from './types.js';

export function StyleListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined }), [search, status]);

  const stylesQuery = useQuery({
    queryKey: ['styles', params],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style[]>>('/styles', { params });
      return response.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Styles"
        subtitle="Item master records"
        primaryAction={
          <Button asChild variant="default">
            <Link to="/master-data/styles/new">Create Style</Link>
          </Button>
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search styles"
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
            key: 'styleNumber',
            header: 'Style Number',
            render: (style) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/master-data/styles/${style.id}`}>
                {style.styleNumber}
              </Link>
            ),
          },
          { key: 'styleName', header: 'Style Name', accessor: 'styleName' },
          { key: 'ipName', header: 'IP', accessor: 'ipName' },
          { key: 'licensor', header: 'Licensor', accessor: 'licensor' },
          { key: 'colour', header: 'Colour', accessor: 'colour' },
          { key: 'lmixNumber', header: 'LMIX', accessor: 'lmixNumber' },
          { key: 'finalMrp', header: 'Final MRP', align: 'right', render: (style) => style.finalMrp.toFixed(2) },
          {
            key: 'status',
            header: 'Status',
            render: (style) => (
              <StatusBadge label={style.status} tone={style.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={stylesQuery.data ?? []}
        loading={stylesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading styles" />}
        emptyState={<EmptyState title="No styles found" description="Style records will appear here." />}
        error={
          stylesQuery.isError ? (
            <ErrorState title="Unable to load styles" description={stylesQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
