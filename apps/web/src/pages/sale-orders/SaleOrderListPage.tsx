import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { toCompactFinancialYearCode } from '../../lib/financial-years.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageSaleOrdersAsDistributor, canApproveSaleOrders } from '../../auth/permissions.js';
import type { Distributor, SaleOrder, SaleOrderStatus } from './types.js';

const STATUS_LABELS: Record<SaleOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FULFILLED: 'Fulfilled',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusTone(status: SaleOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'UNDER_REVIEW') return 'pending';
  if (status === 'APPROVED') return 'approved';
  if (status === 'REJECTED') return 'rejected';
  if (status === 'FULFILLED') return 'approved';
  return 'cancelled';
}

export function SaleOrderListPage() {
  const { user } = useAuth();
  const canCreate = canManageSaleOrdersAsDistributor(user);
  const showDistributorFilter = canApproveSaleOrders(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<SaleOrderStatus | ''>('');
  const [distributorId, setDistributorId] = useState('');

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      distributorId: distributorId || undefined,
    }),
    [debouncedSearch, status, distributorId],
  );

  const ordersQuery = useQuery({
    queryKey: ['sale-orders', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<SaleOrder>>>('/sale-orders', {
        params,
      });
      return res.data.data;
    },
  });

  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
    enabled: showDistributorFilter,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Distributor[]>>('/distributors', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sale Orders"
        subtitle="Distributor stock requests against QA-released inventory"
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link to="/sale-orders/new">Create Sale Order</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search Sale Order number"
        statusValue={status || 'ALL'}
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as SaleOrderStatus))}
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          ...(Object.keys(STATUS_LABELS) as SaleOrderStatus[]).map((s) => ({
            label: STATUS_LABELS[s],
            value: s,
          })),
        ]}
        hasActiveFilters={Boolean(search || status || distributorId)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          setDistributorId('');
        }}
        actions={
          showDistributorFilter ? (
            <SelectField
              aria-label="Distributor"
              value={distributorId || 'ALL'}
              onValueChange={(value) => setDistributorId(value === 'ALL' ? '' : value)}
              density="compact"
              width="md"
            >
              <SelectItem value="ALL">All distributors</SelectItem>
              {(distributorsQuery.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectField>
          ) : undefined
        }
      />

      <DataTable
        columns={[
          {
            key: 'saleOrderNumber',
            header: 'Sale Order Number',
            render: (so) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/sale-orders/${so.id}`}>
                {so.saleOrderNumber}
              </Link>
            ),
          },
          { key: 'distributor', header: 'Distributor', render: (so) => so.distributor.name },
          { key: 'soDate', header: 'SO Date', render: (so) => formatDate(so.soDate) },
          {
            key: 'financialYear',
            header: 'FY',
            render: (so) => toCompactFinancialYearCode(so.financialYear.code),
          },
          {
            key: 'status',
            header: 'Status',
            render: (so) => <StatusBadge label={STATUS_LABELS[so.status]} tone={statusTone(so.status)} />,
          },
          {
            key: 'totalRequestedQuantity',
            header: 'Requested',
            align: 'right',
            render: (so) => so.totalRequestedQuantity.toLocaleString(),
          },
          {
            key: 'totalApprovedQuantity',
            header: 'Approved',
            align: 'right',
            render: (so) => so.totalApprovedQuantity.toLocaleString(),
          },
        ]}
        data={ordersQuery.data?.items ?? []}
        loading={ordersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading sale orders" />}
        emptyState={
          <EmptyState
            title="No sale orders found"
            description={
              canCreate
                ? 'Create a sale order to request QA-released stock against your purchase orders.'
                : 'Sale orders will appear here when they are available.'
            }
            action={
              canCreate ? (
                <Button asChild>
                  <Link to="/sale-orders/new">Create Sale Order</Link>
                </Button>
              ) : undefined
            }
          />
        }
        error={
          ordersQuery.isError ? (
            <ErrorState title="Unable to load sale orders" description={ordersQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
