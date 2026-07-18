import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import type { AdminUserSummary, Factory, FactoryUser } from './types.js';

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : fallback;
}

function MappedUsers({ factory }: { factory: Factory }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const [remove, setRemove] = useState<FactoryUser | null>(null);
  const [error, setError] = useState('');
  const mapped = useQuery({
    queryKey: ['factory-users', factory.id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<FactoryUser[]>>(`/factories/${factory.id}/users`))
        .data.data,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<AdminUserSummary[]>>('/users')).data.data,
  });
  const eligible = useMemo(() => {
    const mappedIds = new Set((mapped.data ?? []).map((user) => user.id));
    return (users.data ?? []).filter(
      (user) =>
        user.status === 'ACTIVE' && user.roles.includes('FACTORY_USER') && !mappedIds.has(user.id),
    );
  }, [mapped.data, users.data]);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['factory-users', factory.id] }),
      client.invalidateQueries({ queryKey: ['users'] }),
      client.invalidateQueries({ queryKey: ['factory', factory.id] }),
    ]);
  const assign = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selected) throw new Error('Select a factory user');
      await apiClient.post(`/users/${selected}/factories`, { factoryId: factory.id });
    },
    onSuccess: async () => {
      setSelected('');
      await refresh();
    },
    onError: (caught) => setError(errorMessage(caught, 'Unable to assign user')),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/users/${userId}/factories/${factory.id}`),
    onSuccess: async () => {
      setRemove(null);
      await refresh();
    },
    onError: (caught) => {
      setRemove(null);
      setError(errorMessage(caught, 'Unable to remove mapping'));
    },
  });
  return (
    <Panel title="Mapped Factory Users">
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate();
          }}
        >
          <SelectField
            label="Assign user"
            value={selected || 'NONE'}
            onValueChange={(value) => setSelected(value === 'NONE' ? '' : value)}
            disabled={factory.status !== 'ACTIVE'}
          >
            <SelectItem value="NONE">Select a factory user</SelectItem>
            {eligible.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name} ({user.email})
              </SelectItem>
            ))}
          </SelectField>
          <Button type="submit" loading={assign.isPending} disabled={factory.status !== 'ACTIVE'}>
            Assign
          </Button>
        </form>
        {factory.status !== 'ACTIVE' ? (
          <p className="text-sm text-muted-foreground">
            Users cannot be assigned to an inactive factory.
          </p>
        ) : null}
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
        <DataTable
          columns={[
            { key: 'name', header: 'Name', accessor: 'name' },
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
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (user) => (
                <Button density="compact" variant="destructive" onClick={() => setRemove(user)}>
                  Remove
                </Button>
              ),
            },
          ]}
          data={mapped.data ?? []}
          loading={mapped.isLoading}
          loadingState={<LoadingState variant="rows" label="Loading mapped users" />}
          emptyState={
            <EmptyState
              title="No users mapped"
              description="Assign an eligible factory user to grant factory access."
            />
          }
          error={
            mapped.isError ? (
              <ErrorState title="Unable to load mapped users" description={mapped.error.message} />
            ) : undefined
          }
        />
      </div>
      <ConfirmDialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Remove factory-user mapping"
        description={
          remove ? `${remove.name} will lose operational access to ${factory.name}.` : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (remove) removeMutation.mutate(remove.id);
        }}
      />
    </Panel>
  );
}

export function FactoryDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const canEdit = user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER') ?? false;
  const isAdmin = user?.roles.includes('ADMIN') ?? false;
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['factory', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<Factory>>(`/factories/${id}`)).data.data,
  });
  const mutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'INACTIVE') =>
      apiClient.patch(`/factories/${id}/status`, { status }),
    onSuccess: async () => {
      setConfirm(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['factory', id] }),
        client.invalidateQueries({ queryKey: ['factories'] }),
      ]);
    },
    onError: (caught) => {
      setConfirm(false);
      setError(errorMessage(caught, 'Unable to update status'));
    },
  });
  if (query.isLoading) return <LoadingState label="Loading factory" />;
  if (query.isError)
    return <ErrorState title="Unable to load factory" description={query.error.message} />;
  if (!query.data)
    return (
      <EmptyState
        title="Factory not found"
        description="The selected factory could not be loaded."
      />
    );
  const factory = query.data;
  const active = factory.status === 'ACTIVE';
  const fields = [
    ['Code', factory.code],
    ['Name', factory.name],
    ['Contact name', factory.contactName ?? '—'],
    ['Contact email', factory.contactEmail ?? '—'],
    ['Contact phone', factory.contactPhone ?? '—'],
    ['Address line 1', factory.addressLine1 ?? '—'],
    ['Address line 2', factory.addressLine2 ?? '—'],
    ['City', factory.city ?? '—'],
    ['State', factory.state ?? '—'],
    ['Country', factory.country ?? '—'],
    ['Postal code', factory.postalCode ?? '—'],
  ] as const;
  const usage = factory.usage ?? { styleMappings: 0, jobOrders: 0, mappedUsers: 0 };
  return (
    <div className="space-y-5">
      <PageHeader
        title={factory.code}
        subtitle={factory.name}
        status={<StatusBadge label={factory.status} tone={active ? 'success' : 'muted'} />}
        primaryAction={
          canEdit ? (
            <Button asChild>
              <Link to={`/master-data/factories/${factory.id}/edit`}>Edit</Link>
            </Button>
          ) : undefined
        }
        secondaryActions={
          canEdit ? (
            <Button variant={active ? 'destructive' : 'secondary'} onClick={() => setConfirm(true)}>
              {active ? 'Deactivate' : 'Activate'}
            </Button>
          ) : undefined
        }
      />
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <Panel title="Factory Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>
      <Panel title="Usage and impact">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="Style mappings" value={String(usage.styleMappings)} />
          <DescriptionList.Item label="Job orders" value={String(usage.jobOrders)} />
          <DescriptionList.Item label="Mapped users" value={String(usage.mappedUsers)} />
        </DescriptionList>
      </Panel>
      {isAdmin ? <MappedUsers factory={factory} /> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={active ? 'Deactivate factory' : 'Activate factory'}
        description={
          active
            ? `This factory has ${usage.jobOrders} job order(s), ${usage.styleMappings} style mapping(s), and ${usage.mappedUsers} mapped user(s). New mappings and operational actions will be blocked; history and user mappings remain unchanged.`
            : 'This factory will become available for new mappings and job orders.'
        }
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        destructive={active}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate(active ? 'INACTIVE' : 'ACTIVE')}
      />
    </div>
  );
}
