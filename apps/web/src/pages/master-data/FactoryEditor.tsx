import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection } from '@erve/layout';
import { createEnterToNextHandler } from '@erve/app-components';
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
const labels: Record<keyof FactoryFormFields, string> = {
  code: 'Code',
  name: 'Name',
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

function toErrorMessage(caught: unknown): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : 'Unable to save Factory';
}

// Minimal inline-create editor (DEMO-015) — same POST /factories call and
// validation as the full FactoryFormPage, just embedded in a lookup's
// create dialog rather than its own route. Edit is intentionally out of
// scope here; this component only ever creates.
export function FactoryEditor({ onSaved, onCancel }: { onSaved: (factory: Factory) => void; onCancel: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState<FactoryFormFields>(emptyForm);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.name.trim()) throw new Error('Name is required');
      const payload = Object.fromEntries(
        Object.entries(form).filter(([key]) => key !== 'code').map(([key, value]) => [key, value.trim() || null]),
      );
      const response = await apiClient.post<ApiSuccessResponse<Factory>>('/factories', {
        ...payload,
        name: form.name.trim(),
      });
      return response.data.data;
    },
    onSuccess: async (factory) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['factories'] }),
        client.invalidateQueries({ queryKey: ['factories', 'options'] }),
      ]);
      onSaved(factory);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  function field(key: keyof FactoryFormFields) {
    return (
      <TextField
        key={key}
        label={labels[key]}
        required={key === 'name'}
        type={key === 'contactEmail' ? 'email' : 'text'}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        errorMessage={error && key === 'name' && !form[key].trim() ? 'Required' : undefined}
        disabled={mutation.isPending}
      />
    );
  }

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
      <FormSection title="Identity">
        <FormGrid layout="content">
          {field('name')}
        </FormGrid>
      </FormSection>
      <FormSection title="Contact">
        <FormGrid layout="content">
          {field('contactName')}
          {field('contactEmail')}
          {field('contactPhone')}
        </FormGrid>
      </FormSection>
      <FormSection title="Address">
        <FormGrid layout="content">
          {(['addressLine1', 'addressLine2', 'city', 'state', 'country', 'postalCode'] as const).map(field)}
        </FormGrid>
      </FormSection>
      {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
      <div className="flex gap-2">
        <Button type="submit" loading={mutation.isPending}>
          Create Factory
        </Button>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
