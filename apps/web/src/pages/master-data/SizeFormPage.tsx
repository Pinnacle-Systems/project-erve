import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Size } from './types.js';

const types = ['AGE', 'ALPHA', 'NUMERIC', 'WAIST', 'FREE_SIZE'] as const;

function message(error: unknown) {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save size';
}

export function SizeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', label: '', sizeType: 'AGE', sortOrder: '0' });
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['size', id],
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<Size>>(`/sizes/${id}`)).data.data,
  });
  useEffect(() => {
    if (query.data) {
      // The record arrives asynchronously, so hydrate the controlled edit form once loaded.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        code: query.data.code,
        label: query.data.label,
        sizeType: query.data.sizeType,
        sortOrder: String(query.data.sortOrder),
      });
    }
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      return (
        await apiClient.patch<ApiSuccessResponse<Size>>(`/sizes/${id}`, {
          ...form,
          code: form.code.trim(),
          label: form.label.trim(),
          sortOrder: Number(form.sortOrder),
        })
      ).data.data;
    },
    onSuccess: async (size) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['size', id] }),
        queryClient.invalidateQueries({ queryKey: ['sizes'] }),
      ]);
      navigate(`/master-data/sizes/${size.id}`);
    },
    onError: (caught) => setError(message(caught)),
  });
  if (query.isLoading) return <LoadingState label="Loading size" />;
  if (query.isError)
    return <ErrorState title="Unable to load size" description={query.error.message} />;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Edit Size"
        subtitle="Update size display and ordering details"
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />
      <Panel>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
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
              {types.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectField>
            <TextField
              label="Sort order"
              type="number"
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </FormGrid>
          {(query.data?.usage?.purchaseOrderLines ?? 0) > 0 ||
          (query.data?.usage?.jobOrderLines ?? 0) > 0 ? (
            <ValidationMessage tone="info">
              Code and type are locked by the API once this size has transactional history.
            </ValidationMessage>
          ) : null}
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
