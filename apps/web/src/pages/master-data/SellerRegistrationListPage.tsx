import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageSellerRegistrations } from '../../auth/permissions.js';
import type { SellerRegistrationSummary, Status } from './types.js';

export function SellerRegistrationListPage() {
  const { user } = useAuth();
  const canManage = canManageSellerRegistrations(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );

  const { query: registrationsQuery, items: registrations } =
    useCursorList<SellerRegistrationSummary>({
      queryKey: ['seller-registrations'],
      path: '/seller-registrations',
      params: { ...params, limit: 25 },
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Seller Registrations"
        subtitle="ERVE's own GST/legal registrations (ERVE Branches)"
        primaryAction={
          canManage ? (
            <Button asChild variant="default">
              <Link to="/master-data/seller-registrations/new">Create Seller Registration</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by branch code, legal name or GSTIN"
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
            key: 'branchCode',
            header: 'Branch Code',
            render: (registration) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/seller-registrations/${registration.id}`}
              >
                {registration.branchCode}
              </Link>
            ),
          },
          { key: 'legalName', header: 'Legal Name', accessor: 'legalName' },
          { key: 'gstin', header: 'GSTIN', accessor: 'gstin' },
          { key: 'city', header: 'City', accessor: 'city' },
          {
            key: 'status',
            header: 'Status',
            render: (registration) => (
              <StatusBadge
                label={registration.status}
                tone={registration.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={registrations}
        loading={registrationsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading seller registrations" />}
        emptyState={
          <EmptyState
            title="No seller registrations found"
            description="ERVE Branch / Seller Registration records will appear here."
          />
        }
        error={
          registrationsQuery.isError ? (
            <ErrorState
              title="Unable to load seller registrations"
              description={registrationsQuery.error.message}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter
        {...loadMoreProps(registrationsQuery, registrations.length, [
          'seller-registration',
          'seller-registrations',
        ])}
      />
    </div>
  );
}
