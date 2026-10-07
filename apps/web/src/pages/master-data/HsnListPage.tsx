import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageHsns } from '../../auth/permissions.js';
import type { HsnSummary, Status } from './types.js';

export function HsnListPage() {
  const { user } = useAuth();
  const canManage = canManageHsns(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );

  const { query: hsnsQuery, items: hsns } = useCursorList<HsnSummary>({
    queryKey: ['hsns'],
    path: '/hsns',
    params: { ...params, limit: 25 },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="HSN Codes"
        subtitle="Canonical HSN identity and its reusable GST Rule Set assignment"
        primaryAction={
          canManage ? (
            <Button asChild variant="default">
              <Link to="/master-data/hsns/new">Create HSN</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by HSN code or description"
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
            header: 'HSN Code',
            render: (hsn) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/master-data/hsns/${hsn.id}`}>
                {hsn.code}
              </Link>
            ),
          },
          { key: 'description', header: 'Description', render: (hsn) => hsn.description ?? '—' },
          {
            key: 'gstRuleSet',
            header: 'GST Rule Set',
            render: (hsn) =>
              hsn.gstRuleSet ? (
                <Link className="text-[var(--erp-text-link)]" to={`/gst-rule-sets/${hsn.gstRuleSet.id}`}>
                  {hsn.gstRuleSet.code}
                </Link>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (hsn) => (
              <StatusBadge label={hsn.status} tone={hsn.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={hsns}
        loading={hsnsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading HSN codes" />}
        emptyState={
          <EmptyState title="No HSN codes found" description="HSN master records will appear here." />
        }
        error={
          hsnsQuery.isError ? (
            <ErrorState title="Unable to load HSN codes" description={hsnsQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(hsnsQuery, hsns.length, ['hsn', 'hsns'])} />
    </div>
  );
}
