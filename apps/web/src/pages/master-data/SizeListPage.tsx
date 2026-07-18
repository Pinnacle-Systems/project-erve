import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Size } from './types.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function SizeListPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', label: '', sizeType: 'AGE', sortOrder: '' });
  const sizesQuery = useQuery({
    queryKey: ['sizes'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Size[]>>('/sizes');
      return response.data.data;
    },
  });
  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/sizes', { ...form, sortOrder: Number(form.sortOrder) }),
    onSuccess: async () => {
      setForm({ code: '', label: '', sizeType: 'AGE', sortOrder: '' });
      await queryClient.invalidateQueries({ queryKey: ['sizes'] });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Sizes" subtitle="Size codes available for style mapping" />

      <Panel title="Add Size">
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
              label="Label"
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <SelectField
              label="Type"
              value={form.sizeType}
              onValueChange={(value) => setForm({ ...form, sizeType: value })}
              width="fill"
            >
              <SelectItem value="AGE">Age</SelectItem>
              <SelectItem value="ALPHA">Alpha</SelectItem>
              <SelectItem value="NUMERIC">Numeric</SelectItem>
              <SelectItem value="WAIST">Waist</SelectItem>
              <SelectItem value="FREE_SIZE">Free Size</SelectItem>
            </SelectField>
            <TextField
              label="Sort"
              type="number"
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </FormGrid>
          <div className="flex justify-end">
            <Button type="submit" loading={createMutation.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Panel>

      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            render: (size) => (
              <Link
                className="font-medium text-primary hover:underline"
                to={`/master-data/sizes/${size.id}`}
              >
                {size.code}
              </Link>
            ),
          },
          { key: 'label', header: 'Label', accessor: 'label' },
          { key: 'sizeType', header: 'Type', render: (size) => size.sizeType.replace('_', ' ') },
          { key: 'sortOrder', header: 'Sort', accessor: 'sortOrder', align: 'right' },
          {
            key: 'status',
            header: 'Status',
            render: (size) => (
              <StatusBadge
                label={size.status}
                tone={size.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={sizesQuery.data ?? []}
        loading={sizesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading sizes" />}
        emptyState={
          <EmptyState
            title="No sizes found"
            description="Create a size to use it in style mappings."
          />
        }
        error={
          sizesQuery.isError ? (
            <ErrorState title="Unable to load sizes" description={sizesQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
