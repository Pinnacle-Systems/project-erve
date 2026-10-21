import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, DistributorOption } from '@erve/types';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection } from '@erve/layout';
import { createEnterToNextHandler } from '@erve/app-components';
import { GstinVerificationPanel } from '../gst-compliance/GstinVerificationPanel.js';
import { apiClient } from '../../lib/api-client.js';

import { isValidGstinFormat, normalizeGstin } from '@erve/shared';

const emptyForm = {
  code: '',
  name: '',
  gstin: '',
  purchaseMode: 'OUTRIGHT' as 'OUTRIGHT' | 'SALE_RETURN',
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
type DistributorFormFields = typeof emptyForm;
const labels: Record<Exclude<keyof DistributorFormFields, 'purchaseMode'>, string> = {
  code: 'Code',
  name: 'Name',
  gstin: 'GSTIN',
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
  return caught instanceof Error ? caught.message : 'Unable to save Distributor';
}

// Minimal inline-create editor (DEMO-015) — same POST /distributors call,
// GSTIN validation and Purchase-Mode-locked-at-creation rule as the full
// DistributorFormPage, just embedded in a lookup's create dialog. Edit is
// intentionally out of scope here; this component only ever creates.
export function DistributorEditor({
  onSaved,
  onCancel,
}: {
  onSaved: (distributor: DistributorOption) => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState<DistributorFormFields>(emptyForm);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.name.trim() || !form.gstin.trim()) {
        throw new Error('Name and GSTIN are required');
      }
      const gstin = normalizeGstin(form.gstin);
      if (!isValidGstinFormat(gstin)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)');
      }
      const payload = Object.fromEntries(
        Object.entries(form).filter(([key]) => key !== 'code').map(([key, value]) => [key, value === '' ? null : value]),
      );
      const response = await apiClient.post<ApiSuccessResponse<DistributorOption>>('/distributors', {
        ...payload,
        name: form.name.trim(),
        gstin,
      });
      return response.data.data;
    },
    onSuccess: async (distributor) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['distributors'] }),
        client.invalidateQueries({ queryKey: ['distributor-lookup'] }),
      ]);
      onSaved(distributor);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  function field(key: Exclude<keyof DistributorFormFields, 'purchaseMode'>) {
    return (
      <TextField
        key={key}
        label={labels[key]}
        required={key === 'name' || key === 'gstin'}
        type={key === 'contactEmail' ? 'email' : 'text'}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        errorMessage={
          error && (key === 'name' || key === 'gstin') && !form[key].trim()
            ? 'Required'
            : undefined
        }
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
      <FormSection title="Identity / Business">
        <FormGrid layout="content">
          {field('name')}
          {field('gstin')}
          <SelectField
            label="Purchase Mode"
            required
            helpText="Locked after creation. If this Distributor needs both Outright and Sale or Return, create separate Distributor records."
            value={form.purchaseMode}
            disabled={mutation.isPending}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, purchaseMode: value as 'OUTRIGHT' | 'SALE_RETURN' }))
            }
          >
            <SelectItem value="OUTRIGHT">Outright</SelectItem>
            <SelectItem value="SALE_RETURN">Sale or Return</SelectItem>
          </SelectField>
        </FormGrid>
      </FormSection>
      <GstinVerificationPanel gstin={form.gstin} />
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
          Create Distributor
        </Button>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
