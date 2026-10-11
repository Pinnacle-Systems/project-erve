import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, Role } from '@erve/types';
import { ROLES } from '@erve/types';
import { createEnterToNextHandler } from '@erve/app-components';
import { Button, Checkbox, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import type { AdminUserSummary } from '../master-data/types.js';
import { PasswordField } from './PasswordField.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

export interface InlineUserCreateDialogProps {
  // Pre-checked from where this dialog was opened (e.g. a Factory's "Mapped
  // Users" panel implies FACTORY_USER) — still an ordinary, editable
  // checkbox the admin themselves submits, never a hidden grant. DEMO-015:
  // "no new capability granted" means this dialog runs under the exact same
  // POST /users permission (ADMIN-only) as the full Users > Create page,
  // never a relaxed one.
  defaultRoles: Role[];
  // Embedded directly in the create call when FACTORY_USER is checked — a
  // Factory User must be mapped to exactly one factory at creation time
  // (see UserFormPage.tsx's identical needsFactory handling).
  factoryId?: string;
  onCancel: () => void;
  onCreated: (user: AdminUserSummary) => void;
}

// Reuses POST /users exactly as the full Users > Create page does — same
// validation, same ADMIN-only RBAC gate — just pre-populated for the
// mapping context that opened it (DEMO-015).
export function InlineUserCreateDialog({ defaultRoles, factoryId, onCancel, onCreated }: InlineUserCreateDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roles, setRoles] = useState<Role[]>(defaultRoles);
  const [error, setError] = useState('');

  const needsFactory = roles.includes('FACTORY_USER');

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!name.trim() || !email.trim()) throw new Error('Name and email are required');
      if (roles.length === 0) throw new Error('Select at least one role');
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      if (password !== confirmPassword) throw new Error('Passwords do not match');
      if (needsFactory && !factoryId) throw new Error('A Factory User must be mapped to a factory');
      const response = await apiClient.post<ApiSuccessResponse<AdminUserSummary>>('/users', {
        name: name.trim(),
        email: email.trim(),
        password,
        roles,
        factoryId: needsFactory ? factoryId : undefined,
      });
      return response.data.data;
    },
    onSuccess: async (user) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      ]);
      onCreated(user);
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to create user')),
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onKeyDown={createEnterToNextHandler()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        mutation.mutate();
      }}
    >
      <FormSection title="Profile">
        <FormGrid layout="content">
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            errorMessage={error && !name.trim() ? 'Required' : undefined}
            disabled={mutation.isPending}
          />
          <TextField
            label="Email"
            required
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            errorMessage={error && !email.trim() ? 'Required' : undefined}
            disabled={mutation.isPending}
          />
        </FormGrid>
      </FormSection>
      <FormSection title="Initial Password" description="At least 8 characters.">
        <FormGrid layout="content">
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordField label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        </FormGrid>
      </FormSection>
      <FormSection
        title="Roles"
        description="Pre-selected from where you opened this — review before saving. A user must have at least one role."
      >
        <div className="grid gap-2 md:grid-cols-3">
          {ROLES.map((roleName) => (
            <label
              key={roleName}
              className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-muted p-2 text-sm text-foreground"
            >
              <Checkbox
                checked={roles.includes(roleName)}
                disabled={mutation.isPending}
                onCheckedChange={(checked) =>
                  setRoles((current) =>
                    checked === true ? [...current, roleName] : current.filter((r) => r !== roleName),
                  )
                }
              />
              {roleName}
            </label>
          ))}
        </div>
      </FormSection>
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={mutation.isPending}>
          Create User
        </Button>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
