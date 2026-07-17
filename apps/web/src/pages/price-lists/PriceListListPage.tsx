import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { PriceListDistributor, PriceListStatus, PriceListSummary } from './types.js';
import {
  PRICE_LIST_STATUS_LABELS,
  formatEffectiveDate,
  priceListStatusTone,
} from './price-list-ui.js';

export function PriceListListPage() {
  const { user } = useAuth();
  const canManage = user?.roles.some((role) => ['ADMIN', 'MERCHANDISER'].includes(role)) ?? false;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PriceListStatus | ''>('');
  const [distributorId, setDistributorId] = useState('');

  const params = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      distributorId: distributorId || undefined,
    }),
    [search, status, distributorId],
  );

  const priceListsQuery = useQuery({
    queryKey: ['price-lists', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceListSummary[]>>('/price-lists', { params });
      return res.data.data;
    },
  });

  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceListDistributor[]>>('/distributors', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Price Lists"
        subtitle="Distributor-specific selling prices with effective periods"
        primaryAction={
          canManage ? (
            <Button asChild>
              <Link to="/price-lists/new">Create Price List</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search code or name"
        statusValue={status || 'ALL'}
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as PriceListStatus))}
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          ...(Object.keys(PRICE_LIST_STATUS_LABELS) as PriceListStatus[]).map((value) => ({
            label: PRICE_LIST_STATUS_LABELS[value],
            value,
          })),
        ]}
        hasActiveFilters={Boolean(search || status || distributorId)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          setDistributorId('');
        }}
        actions={
          <SelectField
            aria-label="Distributor"
            value={distributorId || 'ALL'}
            onValueChange={(value) => setDistributorId(value === 'ALL' ? '' : value)}
            density="compact"
            width="md"
          >
            <SelectItem value="ALL">All distributors</SelectItem>
            {(distributorsQuery.data ?? []).map((distributor) => (
              <SelectItem key={distributor.id} value={distributor.id}>
                {distributor.name}
              </SelectItem>
            ))}
          </SelectField>
        }
      />

      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (priceList) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/price-lists/${priceList.id}`}>
                {priceList.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          { key: 'distributor', header: 'Distributor', render: (priceList) => priceList.distributor.name },
          {
            key: 'effectiveFrom',
            header: 'Effective From',
            render: (priceList) => formatEffectiveDate(priceList.effectiveFrom),
          },
          {
            key: 'effectiveTo',
            header: 'Effective To',
            render: (priceList) => (priceList.effectiveTo ? formatEffectiveDate(priceList.effectiveTo) : 'Open-ended'),
          },
          { key: 'lineCount', header: 'Lines', align: 'right', render: (priceList) => priceList.lineCount },
          {
            key: 'status',
            header: 'Status',
            render: (priceList) => (
              <StatusBadge
                label={PRICE_LIST_STATUS_LABELS[priceList.status]}
                tone={priceListStatusTone(priceList.status)}
              />
            ),
          },
        ]}
        data={priceListsQuery.data ?? []}
        loading={priceListsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading price lists" />}
        emptyState={
          <EmptyState
            title="No price lists found"
            description="Distributor price lists will appear here once created."
          />
        }
        error={
          priceListsQuery.isError ? (
            <ErrorState title="Unable to load price lists" description={priceListsQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
