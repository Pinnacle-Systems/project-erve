import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ROLES, type Role } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
  SelectItem,
  ValidationMessage,
} from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { AdminUserSummary, DistributorSummary, Factory } from '../master-data/types.js';
import { PasswordField } from './PasswordField.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function RolesPanel({
  user,
  currentUserId,
}: {
  user: AdminUserSummary;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<Role | ''>('');
  const [removeTarget, setRemoveTarget] = useState<Role | null>(null);
  const [error, setError] = useState('');

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    ]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selectedRole) throw new Error('Select a role to assign');
      await apiClient.post(`/users/${user.id}/roles`, { roleName: selectedRole });
    },
    onSuccess: async () => {
      setSelectedRole('');
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign role')),
  });

  const removeMutation = useMutation({
    mutationFn: async (roleName: Role) => {
      setError('');
      await apiClient.delete(`/users/${user.id}/roles/${roleName}`);
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidate();
    },
    onError: (caught) => {
      setRemoveTarget(null);
      setError(toErrorMessage(caught, 'Unable to remove role'));
    },
  });

  const assignableRoles = ROLES.filter((role) => !user.roles.includes(role));
  const isSelf = user.id === currentUserId;

  return (
    <Panel title="Roles">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {user.roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles assigned.</p>
          ) : (
            user.roles.map((role) => (
              <span
                key={role}
                className="inline-flex items-center gap-2 rounded-control border border-border-subtle bg-surface-muted px-2.5 py-1 text-xs font-medium text-foreground"
              >
                {role}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-[var(--erp-color-danger)]"
                  onClick={() => setRemoveTarget(role as Role)}
                  aria-label={`Remove ${role} role`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        {assignableRoles.length > 0 ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              assignMutation.mutate();
            }}
          >
            <SelectField
              label="Assign role"
              value={selectedRole || 'NONE'}
              onValueChange={(value) => setSelectedRole(value === 'NONE' ? '' : (value as Role))}
            >
              <SelectItem value="NONE">Select a role</SelectItem>
              {assignableRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectField>
            <Button type="submit" loading={assignMutation.isPending}>
              Assign
            </Button>
          </form>
        ) : null}

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove role"
        description={
          removeTarget === 'ADMIN' && isSelf
            ? 'You cannot remove your own ADMIN role.'
            : removeTarget
              ? `Remove the ${removeTarget} role from ${user.name}?`
              : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget);
        }}
      />
    </Panel>
  );
}

function DistributorMappingPanel({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedDistributorId, setSelectedDistributorId] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');

  const mapped = user.distributors[0];

  const distributorsQuery = useQuery({
    queryKey: ['distributors', { status: 'ACTIVE' }],
    enabled: !mapped,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<DistributorSummary[]>>(
        '/distributors',
        {
          params: { status: 'ACTIVE' },
        },
      );
      return response.data.data;
    },
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    ]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selectedDistributorId) throw new Error('Select a distributor to assign');
      await apiClient.post(`/users/${user.id}/distributors`, {
        distributorId: selectedDistributorId,
      });
    },
    onSuccess: async () => {
      setSelectedDistributorId('');
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign distributor')),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!mapped) return;
      await apiClient.delete(`/users/${user.id}/distributors/${mapped.id}`);
    },
    onSuccess: async () => {
      setConfirmRemove(false);
      await invalidate();
    },
    onError: (caught) => {
      setConfirmRemove(false);
      setError(toErrorMessage(caught, 'Unable to remove distributor mapping'));
    },
  });

  return (
    <Panel title="Distributor Mapping">
      <div className="space-y-4">
        {mapped ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{mapped.name}</p>
              <p className="text-xs text-muted-foreground">{mapped.code}</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              density="compact"
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              assignMutation.mutate();
            }}
          >
            <SelectField
              label="Assign distributor"
              value={selectedDistributorId || 'NONE'}
              onValueChange={(value) => setSelectedDistributorId(value === 'NONE' ? '' : value)}
            >
              <SelectItem value="NONE">Select an active distributor</SelectItem>
              {(distributorsQuery.data ?? []).map((distributor) => (
                <SelectItem key={distributor.id} value={distributor.id}>
                  {distributor.name} ({distributor.code})
                </SelectItem>
              ))}
            </SelectField>
            <Button type="submit" loading={assignMutation.isPending}>
              Assign
            </Button>
          </form>
        )}

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove distributor mapping"
        description={
          mapped ? `${user.name} will lose access to ${mapped.name}'s purchase orders.` : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate()}
      />
    </Panel>
  );
}

function FactoryMappingsPanel({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedFactoryId, setSelectedFactoryId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');

  const factoriesQuery = useQuery({
    queryKey: ['factories', { status: 'ACTIVE' }],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', {
        params: { status: 'ACTIVE' },
      });
      return response.data.data;
    },
  });

  const mappedIds = new Set(user.factories.map((factory) => factory.id));
  const availableFactories = (factoriesQuery.data ?? []).filter(
    (factory) => !mappedIds.has(factory.id),
  );

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    ]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selectedFactoryId) throw new Error('Select a factory to add');
      await apiClient.post(`/users/${user.id}/factories`, { factoryId: selectedFactoryId });
    },
    onSuccess: async () => {
      setSelectedFactoryId('');
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to add factory mapping')),
  });

  const removeMutation = useMutation({
    mutationFn: async (factoryId: string) => {
      setError('');
      await apiClient.delete(`/users/${user.id}/factories/${factoryId}`);
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidate();
    },
    onError: (caught) => {
      setRemoveTarget(null);
      setError(toErrorMessage(caught, 'Unable to remove factory mapping'));
    },
  });

  return (
    <Panel title="Factory Mappings">
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            assignMutation.mutate();
          }}
        >
          <SelectField
            label="Add factory"
            value={selectedFactoryId || 'NONE'}
            onValueChange={(value) => setSelectedFactoryId(value === 'NONE' ? '' : value)}
          >
            <SelectItem value="NONE">Select an active factory</SelectItem>
            {availableFactories.map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>
                {factory.name} ({factory.code})
              </SelectItem>
            ))}
          </SelectField>
          <Button type="submit" loading={assignMutation.isPending}>
            Add
          </Button>
        </form>

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

        <DataTable
          columns={[
            { key: 'code', header: 'Code', accessor: 'code' },
            { key: 'name', header: 'Name', accessor: 'name' },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (factory) => (
                <Button
                  type="button"
                  variant="destructive"
                  density="compact"
                  onClick={() => setRemoveTarget(factory)}
                >
                  Remove
                </Button>
              ),
            },
          ]}
          data={user.factories}
          emptyState={
            <EmptyState title="No factories mapped" description="Add a factory to grant access." />
          }
        />
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove factory mapping"
        description={
          removeTarget ? `${user.name} will lose access to ${removeTarget.name}.` : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget.id);
        }}
      />
    </Panel>
  );
}

function ResetPasswordDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      await apiClient.post(`/users/${userId}/reset-password`, { password });
    },
    onSuccess: () => {
      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to reset password')),
  });

  const close = () => {
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="space-y-4">
            <ValidationMessage tone="success">
              Password reset. The user&apos;s existing sessions were revoked — they must sign in
              again with the new password.
            </ValidationMessage>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              At least 8 characters. The current password is never shown. Existing sessions will be
              revoked.
            </p>
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
            {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                Reset Password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UserDetailPage() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);

  const userQuery = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<AdminUserSummary>>(`/users/${id}`);
      return response.data.data;
    },
  });
  const user = userQuery.data;

  const statusMutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'INACTIVE') => {
      setStatusError('');
      await apiClient.patch(`/users/${id}/status`, { status });
    },
    onSuccess: async () => {
      setStatusDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-user', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
    },
    onError: (caught) => {
      setStatusDialogOpen(false);
      setStatusError(toErrorMessage(caught, 'Unable to update user status'));
    },
  });

  const isSelf = useMemo(() => user?.id === currentUser?.id, [user, currentUser]);

  if (userQuery.isLoading) {
    return <LoadingState label="Loading user" />;
  }
  if (userQuery.isError) {
    return <ErrorState title="Unable to load user" description={userQuery.error.message} />;
  }
  if (!user) {
    return (
      <EmptyState title="User not found" description="The selected user could not be loaded." />
    );
  }

  const isActive = user.status === 'ACTIVE';
  const fields = [
    ['Name', user.name],
    ['Email', user.email],
    [
      'Status',
      <StatusBadge key="status" label={user.status} tone={isActive ? 'success' : 'muted'} />,
    ],
    ['Created', user.createdAt ? new Date(user.createdAt).toLocaleString() : '—'],
    ['Updated', user.updatedAt ? new Date(user.updatedAt).toLocaleString() : '—'],
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={user.name}
        subtitle={user.email}
        status={<StatusBadge label={user.status} tone={isActive ? 'success' : 'muted'} />}
        primaryAction={
          <Button asChild>
            <Link to={`/master-data/users/${user.id}/edit`}>Edit</Link>
          </Button>
        }
        secondaryActions={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setResetPasswordOpen(true)}>
              Reset Password
            </Button>
            <Button
              type="button"
              variant={isActive ? 'destructive' : 'secondary'}
              onClick={() => setStatusDialogOpen(true)}
              loading={statusMutation.isPending}
              disabled={isActive && isSelf}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        }
      />

      {isActive && isSelf ? (
        <ValidationMessage tone="warning">
          You cannot deactivate your own account. Ask another administrator to do this if needed.
        </ValidationMessage>
      ) : null}
      {statusError ? <ValidationMessage tone="error">{statusError}</ValidationMessage> : null}

      <Panel title="User Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <RolesPanel user={user} currentUserId={currentUser?.id} />

      {user.roles.includes('DISTRIBUTOR') ? <DistributorMappingPanel user={user} /> : null}
      {user.roles.includes('FACTORY_USER') ? <FactoryMappingsPanel user={user} /> : null}

      <ConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={isActive ? 'Deactivate user' : 'Activate user'}
        description={
          isActive
            ? `${user.name} will be signed out of all active sessions and will not be able to sign in again until reactivated.`
            : `${user.name} will be able to sign in again, subject to their existing roles and mappings.`
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        destructive={isActive}
        loading={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(isActive ? 'INACTIVE' : 'ACTIVE')}
      />

      <ResetPasswordDialog
        userId={user.id}
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
      />
    </div>
  );
}
