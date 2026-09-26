import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { AdminUserSummary } from '../master-data/types.js';

type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

function formatMappings(mappings: Array<{ name: string }>): string {
  if (mappings.length === 0) return '—';
  const extra = mappings.length - 1;
  return extra > 0 ? `${mappings[0]!.name} +${extra} more` : mappings[0]!.name;
}

export function UserListPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [role, setRole] = useState<(typeof ROLES)[number] | ''>('');
  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      role: role || undefined,
    }),
    [debouncedSearch, status, role],
  );

  // Opt-in cursor pagination (limit sent): Load more appends further pages; a
  // filter change restarts at page 1. The 'admin-users' prefix is what the
  // user detail/mapping screens invalidate. The PDF fetches every matching page.
  const { query: usersQuery, items: users } = useCursorList<AdminUserSummary>({
    queryKey: ['admin-users'],
    path: '/users',
    params: { ...params, limit: 25 },
  });

  const generateUserListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateUserListPdfBlob } = await import('./pdf/generateUserListPdf.js');
    return generateUserListPdfBlob(
      await fetchAllListPages<AdminUserSummary>('/users', params),
      { search: debouncedSearch, status, role },
      { generatedAt: new Date().toISOString(), generatedBy: currentUser?.name },
    );
  }, [params, debouncedSearch, status, role, currentUser?.name]);

  const userListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Users', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({ generate: generateUserListPdf, filename: userListPdfFilename });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        subtitle="Manage application users, roles, and organization mappings"
        primaryAction={
          <Button asChild variant="default">
            <Link to="/master-data/users/new">Create User</Link>
          </Button>
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by name or email"
            statusOptions={[
              { label: 'All statuses', value: 'ALL' },
              { label: 'Active', value: 'ACTIVE' },
              { label: 'Inactive', value: 'INACTIVE' },
              { label: 'Suspended', value: 'SUSPENDED' },
            ]}
            statusValue={status || 'ALL'}
            onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as UserStatus))}
            hasActiveFilters={Boolean(search || status || role)}
            onClearFilters={() => {
              setSearch('');
              setStatus('');
              setRole('');
            }}
            actions={
              <SelectField
                value={role || 'ALL'}
                onValueChange={(value) =>
                  setRole(value === 'ALL' ? '' : (value as (typeof ROLES)[number]))
                }
                placeholder="All roles"
                density="compact"
                width="sm"
                aria-label="Role"
              >
                <SelectItem value="ALL">All roles</SelectItem>
                {ROLES.map((roleName) => (
                  <SelectItem key={roleName} value={roleName}>
                    {roleName}
                  </SelectItem>
                ))}
              </SelectField>
            }
          />
        </div>
        <PdfActionButtons
          isGenerating={pdfAction.isGenerating}
          error={pdfAction.error}
          onDownload={pdfAction.handleDownload}
          onPrint={pdfAction.handlePrint}
        />
      </div>

      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (user) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/users/${user.id}`}
              >
                {user.name}
              </Link>
            ),
          },
          { key: 'email', header: 'Email', accessor: 'email' },
          {
            key: 'status',
            header: 'Status',
            render: (user) => (
              <StatusBadge
                label={user.status}
                tone={user.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
          { key: 'roles', header: 'Roles', render: (user) => user.roles.join(', ') || '—' },
          {
            key: 'distributor',
            header: 'Distributor',
            render: (user) => formatMappings(user.distributors),
          },
          {
            key: 'factory',
            header: 'Factory',
            render: (user) => formatMappings(user.factories),
          },
          {
            key: 'createdAt',
            header: 'Created',
            render: (user) =>
              user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—',
          },
        ]}
        data={users}
        loading={usersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading users" />}
        emptyState={
          <EmptyState title="No users found" description="Users will appear here once created." />
        }
        error={
          usersQuery.isError ? (
            <ErrorState title="Unable to load users" description={usersQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(usersQuery, users.length, ['user', 'users'])} />
    </div>
  );
}
