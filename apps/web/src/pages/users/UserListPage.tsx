import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ROLES } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { AdminUserSummary } from '../master-data/types.js';

type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export function UserListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [role, setRole] = useState<(typeof ROLES)[number] | ''>('');
  const params = useMemo(
    () => ({ search: search || undefined, status: status || undefined, role: role || undefined }),
    [search, status, role],
  );

  const usersQuery = useQuery({
    queryKey: ['admin-users', params],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<AdminUserSummary[]>>('/users', {
        params,
      });
      return response.data.data;
    },
  });

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
            render: (user) => user.distributors[0]?.name ?? '—',
          },
          {
            key: 'factories',
            header: 'Factories',
            render: (user) => (user.factories.length > 0 ? `${user.factories.length} mapped` : '—'),
          },
          {
            key: 'createdAt',
            header: 'Created',
            render: (user) =>
              user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—',
          },
        ]}
        data={usersQuery.data ?? []}
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
    </div>
  );
}
