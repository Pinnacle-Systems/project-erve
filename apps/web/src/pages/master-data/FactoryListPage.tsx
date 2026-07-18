import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { Factory } from './types.js';

export function FactoryListPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage =
    user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER') ?? false;
  const [form, setForm] = useState({
    code: '',
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories');
      return response.data.data;
    },
  });
  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/factories', form),
    onSuccess: async () => {
      setForm({ code: '', name: '', contactName: '', contactEmail: '', contactPhone: '' });
      await queryClient.invalidateQueries({ queryKey: ['factories'] });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Factories" subtitle="Factory master records and contacts" />
      {canManage ? (
        <Panel title="Add Factory">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <FormGrid columns={4}>
              <TextField
                label="Code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
              <TextField
                label="Name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <TextField
                label="Contact"
                value={form.contactName}
                onChange={(event) => setForm({ ...form, contactName: event.target.value })}
              />
              <TextField
                label="Email"
                type="email"
                value={form.contactEmail}
                onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
              />
            </FormGrid>
            <div className="flex justify-end">
              <Button type="submit" loading={createMutation.isPending}>
                Add
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (factory) => (
              <Link
                className="font-medium text-primary hover:underline"
                to={`/master-data/factories/${factory.id}`}
              >
                {factory.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          {
            key: 'contactName',
            header: 'Contact',
            render: (factory) => factory.contactName ?? '—',
          },
          {
            key: 'contactEmail',
            header: 'Email',
            render: (factory) => factory.contactEmail ?? '—',
          },
          {
            key: 'contactPhone',
            header: 'Phone',
            render: (factory) => factory.contactPhone ?? '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (factory) => (
              <StatusBadge
                label={factory.status}
                tone={factory.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={factoriesQuery.data ?? []}
        loading={factoriesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading factories" />}
        emptyState={
          <EmptyState title="No factories found" description="Factory records will appear here." />
        }
        error={
          factoriesQuery.isError ? (
            <ErrorState
              title="Unable to load factories"
              description={factoriesQuery.error.message}
            />
          ) : undefined
        }
      />
    </div>
  );
}
