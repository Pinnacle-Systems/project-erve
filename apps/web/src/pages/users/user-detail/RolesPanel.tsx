import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ROLES, type Role } from '@erve/types';
import { ConfirmDialog } from '@erve/app-components';
import { Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../../lib/api-client.js';
import type { AdminUserSummary, FactoryOption } from '../../master-data/types.js';
import { toErrorMessage } from './toErrorMessage.js';

export function RolesPanel({
  user,
  currentUserId,
}: {
  user: AdminUserSummary;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<Role | ''>('');
  const [factoryId, setFactoryId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Role | null>(null);
  const [error, setError] = useState('');

  const needsFactory = selectedRole === 'FACTORY_USER';

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'options'],
    enabled: needsFactory,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<FactoryOption[]>>('/factories/options');
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
      if (!selectedRole) throw new Error('Select a role to assign');
      if (needsFactory && !factoryId) throw new Error('Select a factory for the Factory User role');
      await apiClient.post(`/users/${user.id}/roles`, {
        roleName: selectedRole,
        factoryId: needsFactory ? factoryId : undefined,
      });
    },
    onSuccess: async () => {
      setSelectedRole('');
      setFactoryId('');
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
              onValueChange={(value) => {
                setSelectedRole(value === 'NONE' ? '' : (value as Role));
                setFactoryId('');
              }}
            >
              <SelectItem value="NONE">Select a role</SelectItem>
              {assignableRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectField>
            {needsFactory ? (
              <SelectField
                label="Factory"
                value={factoryId || 'NONE'}
                onValueChange={(value) => setFactoryId(value === 'NONE' ? '' : value)}
              >
                <SelectItem value="NONE">Select an active factory</SelectItem>
                {(factoriesQuery.data ?? []).map((factory) => (
                  <SelectItem key={factory.id} value={factory.id}>
                    {factory.name} ({factory.code})
                  </SelectItem>
                ))}
              </SelectField>
            ) : null}
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
