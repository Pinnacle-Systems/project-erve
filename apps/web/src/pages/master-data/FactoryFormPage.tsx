import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory } from './types.js';

const empty = {
  code: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
};
const labels: Record<keyof typeof empty, string> = {
  code: 'Code',
  name: 'Name',
  contactName: 'Contact name',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  city: 'City',
  state: 'State',
  country: 'Country',
  postalCode: 'Postal code',
};
function message(error: unknown) {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save factory';
}
export function FactoryFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['factory', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<Factory>>(`/factories/${id}`)).data.data,
  });
  useEffect(() => {
    if (!query.data) return;
    const factory = query.data;
    // The record arrives asynchronously, so hydrate the controlled edit form once loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(
      Object.fromEntries(
        Object.keys(empty).map((key) => [key, factory[key as keyof typeof empty] ?? '']),
      ) as typeof empty,
    );
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim() || null]),
      );
      return (
        await apiClient.patch<ApiSuccessResponse<Factory>>(`/factories/${id}`, {
          ...payload,
          code: form.code.trim(),
          name: form.name.trim(),
        })
      ).data.data;
    },
    onSuccess: async (factory) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['factory', id] }),
        client.invalidateQueries({ queryKey: ['factories'] }),
      ]);
      navigate(`/master-data/factories/${factory.id}`);
    },
    onError: (caught) => setError(message(caught)),
  });
  if (query.isLoading) return <LoadingState label="Loading factory" />;
  if (query.isError)
    return <ErrorState title="Unable to load factory" description={query.error.message} />;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Edit Factory"
        subtitle="Update factory master details"
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
          <FormGrid columns={3}>
            {Object.keys(empty).map((key) => (
              <TextField
                key={key}
                label={labels[key as keyof typeof empty]}
                type={key === 'contactEmail' ? 'email' : 'text'}
                value={form[key as keyof typeof empty]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            ))}
          </FormGrid>
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
