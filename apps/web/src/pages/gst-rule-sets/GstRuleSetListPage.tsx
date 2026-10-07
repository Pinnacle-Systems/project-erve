import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageGstRuleSets } from '../../auth/permissions.js';
import type { GstRuleSetSummary, Status } from '../master-data/types.js';

export function GstRuleSetListPage() {
  const { user } = useAuth();
  const canManage = canManageGstRuleSets(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );

  const { query: ruleSetsQuery, items: ruleSets } = useCursorList<GstRuleSetSummary>({
    queryKey: ['gst-rule-sets'],
    path: '/gst-rule-sets',
    params: { ...params, limit: 25 },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="GST Rule Sets"
        subtitle="Reusable, effective-dated GST value-band rules referenced by HSN codes"
        primaryAction={
          canManage ? (
            <Button asChild variant="default">
              <Link to="/gst-rule-sets/new">Create GST Rule Set</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by code or name"
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
            render: (ruleSet) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/gst-rule-sets/${ruleSet.id}`}>
                {ruleSet.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          { key: 'versionCount', header: 'Versions', align: 'right' as const, render: (ruleSet) => String(ruleSet.versionCount) },
          {
            key: 'status',
            header: 'Status',
            render: (ruleSet) => (
              <StatusBadge label={ruleSet.status} tone={ruleSet.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={ruleSets}
        loading={ruleSetsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading GST Rule Sets" />}
        emptyState={
          <EmptyState title="No GST Rule Sets found" description="GST Rule Sets will appear here." />
        }
        error={
          ruleSetsQuery.isError ? (
            <ErrorState title="Unable to load GST Rule Sets" description={ruleSetsQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(ruleSetsQuery, ruleSets.length, ['GST Rule Set', 'GST Rule Sets'])} />
    </div>
  );
}
