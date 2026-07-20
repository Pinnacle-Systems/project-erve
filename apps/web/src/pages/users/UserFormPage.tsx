import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ROLES, type Role } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, Checkbox, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { LoadingState } from '@erve/data-display';
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

export function UserFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState('');

  const userQuery = useQuery({
    queryKey: ['admin-user', id],
    enabled: isEdit,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<AdminUserSummary>>(`/users/${id}`);
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!userQuery.data) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(userQuery.data.name);
    setEmail(userQuery.data.email);
  }, [userQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!name.trim() || !email.trim()) {
        throw new Error('Name and email are required');
      }
      if (isEdit) {
        const response = await apiClient.patch<ApiSuccessResponse<AdminUserSummary>>(
          `/users/${id}`,
          {
            name: name.trim(),
            email: email.trim(),
          },
        );
        return response.data.data;
      }

      if (roles.length === 0) {
        throw new Error('Select at least one role');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      const response = await apiClient.post<ApiSuccessResponse<AdminUserSummary>>('/users', {
        name: name.trim(),
        email: email.trim(),
        password,
        roles,
      });
      return response.data.data;
    },
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] });
      navigate(`/master-data/users/${user.id}`);
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to save user')),
  });

  if (isEdit && userQuery.isLoading) {
    return <LoadingState label="Loading user" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit User' : 'Create User'}
        subtitle={isEdit ? 'Update name and email' : 'Create a new user account'}
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Panel>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Profile">
            <FormGrid columns={2}>
              <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                errorMessage={error && !name.trim() ? 'Required' : undefined}
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                errorMessage={error && !email.trim() ? 'Required' : undefined}
                autoComplete="off"
              />
            </FormGrid>
          </FormSection>

          {!isEdit ? (
            <>
              <FormSection
                title="Initial Password"
                description="At least 8 characters. The user can be issued a new password later from their detail page."
              >
                <FormGrid columns={2}>
                  <PasswordField
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    label="Confirm Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                  />
                </FormGrid>
              </FormSection>

              <FormSection title="Roles" description="A user must have at least one role.">
                <div className="grid gap-2 md:grid-cols-3">
                  {ROLES.map((roleName) => (
                    <label
                      key={roleName}
                      className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-muted p-2 text-sm text-foreground"
                    >
                      <Checkbox
                        checked={roles.includes(roleName)}
                        onCheckedChange={(checked) =>
                          setRoles((current) =>
                            checked === true
                              ? [...current, roleName]
                              : current.filter((value) => value !== roleName),
                          )
                        }
                      />
                      {roleName}
                    </label>
                  ))}
                </div>
              </FormSection>
            </>
          ) : null}

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create User'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
