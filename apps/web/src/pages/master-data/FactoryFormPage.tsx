import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory } from './types.js';

const emptyForm = {
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

type FactoryFormFields = typeof emptyForm;

const identityFields: Array<keyof FactoryFormFields> = ['code', 'name'];
const contactFields: Array<keyof FactoryFormFields> = ['contactName', 'contactEmail', 'contactPhone'];
const addressFields: Array<keyof FactoryFormFields> = [
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'country',
  'postalCode',
];

const labels: Record<keyof FactoryFormFields, string> = {
  code: 'Code *',
  name: 'Name *',
  contactName: 'Contact Name',
  contactEmail: 'Contact Email',
  contactPhone: 'Contact Phone',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'State',
  country: 'Country',
  postalCode: 'Postal Code',
};

function message(error: unknown): string {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save factory';
}

function cleanPayload(form: FactoryFormFields) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, value.trim() || null]),
  ) as Record<string, string | null>;
}

export function FactoryFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState<FactoryFormFields>(emptyForm);
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['factory', id],
    enabled: isEdit,
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
        Object.keys(emptyForm).map((key) => [key, factory[key as keyof FactoryFormFields] ?? '']),
      ) as FactoryFormFields,
    );
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.code.trim() || !form.name.trim()) {
        throw new Error('Code and name are required');
      }
      const payload = {
        ...cleanPayload(form),
        code: form.code.trim(),
        name: form.name.trim(),
      };
      const response = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Factory>>(`/factories/${id}`, payload)
        : await apiClient.post<ApiSuccessResponse<Factory>>('/factories', payload);
      return response.data.data;
    },
    onSuccess: async (factory) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['factory', factory.id] }),
        client.invalidateQueries({ queryKey: ['factories'] }),
      ]);
      navigate(`/master-data/factories/${factory.id}`);
    },
    onError: (caught) => setError(message(caught)),
  });

  if (isEdit && query.isLoading) return <LoadingState label="Loading factory" />;
  if (isEdit && query.isError)
    return <ErrorState title="Unable to load factory" description={query.error.message} />;

  const renderField = (key: keyof FactoryFormFields) => (
    <TextField
      key={key}
      label={labels[key]}
      type={key === 'contactEmail' ? 'email' : 'text'}
      value={form[key]}
      errorMessage={
        error && ((key === 'code' && !form.code.trim()) || (key === 'name' && !form.name.trim()))
          ? 'Required'
          : undefined
      }
      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Factory' : 'Create Factory'}
        subtitle={isEdit ? 'Update factory master details' : 'Create a factory master record'}
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate(-1)}>
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
          <FormSection title="Identity">
            <FormGrid columns={2}>{identityFields.map(renderField)}</FormGrid>
          </FormSection>
          <FormSection title="Contact">
            <FormGrid columns={3}>{contactFields.map(renderField)}</FormGrid>
          </FormSection>
          <FormSection title="Address">
            <FormGrid columns={3}>{addressFields.map(renderField)}</FormGrid>
          </FormSection>
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end border-t border-border-subtle pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Factory'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
