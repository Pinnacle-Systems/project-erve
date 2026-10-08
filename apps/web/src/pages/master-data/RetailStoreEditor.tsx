import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, RetailStore } from '@erve/types';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection } from '@erve/layout';
import { createEnterToNextHandler } from '@erve/app-components';
import { DistributorLookupField, type DistributorLookupValue } from './DistributorLookupField.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

const empty = {
  code: '',
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: 'India',
  postalCode: '',
  gstin: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  status: 'ACTIVE',
};
const labels: Record<keyof typeof empty, string> = {
  code: 'Store Code',
  name: 'Store Name',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'State',
  country: 'Country',
  postalCode: 'PIN',
  gstin: 'GSTIN',
  contactName: 'Contact Person',
  contactEmail: 'Contact Email',
  contactPhone: 'Phone',
  status: 'Status',
};
const required = new Set([
  'code',
  'name',
  'addressLine1',
  'city',
  'state',
  'country',
  'postalCode',
]);

// Local state belongs to this editor. Inline use never replaces the parent
// Dispatch Order form. Key the editor by record id when editing a master.
export function RetailStoreEditor({
  store,
  distributor,
  onSaved,
  onCancel,
}: {
  store?: RetailStore;
  distributor?: DistributorLookupValue;
  onSaved: (store: RetailStore) => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const [owner, setOwner] = useState<DistributorLookupValue | null>(
    distributor ?? store?.distributor ?? null,
  );
  const [form, setForm] = useState(
    () =>
      Object.fromEntries(
        Object.entries(empty).map(([key, value]) => [
          key,
          store ? (store[key as keyof typeof empty] ?? '') : value,
        ]),
      ) as typeof empty,
  );
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!owner) throw new Error('Distributor is required');
      if ([...required].some((key) => !form[key as keyof typeof empty].trim()))
        throw new Error(
          'Store Code, Store Name, address, City, State, Country and PIN are required',
        );
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() || null]),
      );
      const response = store
        ? await apiClient.patch<ApiSuccessResponse<RetailStore>>(
            `/retail-stores/${store.id}`,
            payload,
          )
        : await apiClient.post<ApiSuccessResponse<RetailStore>>('/retail-stores', {
            ...payload,
            distributorId: owner.id,
          });
      return response.data.data;
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ['retail-stores'] });
      void client.invalidateQueries({ queryKey: ['retail-store', saved.id] });
      void client.invalidateQueries({ queryKey: ['retail-store-lookup', saved.distributorId] });
      onSaved(saved);
    },
    onError: (e) => setError(getApiErrorMessage(e, 'Unable to save Retail Store')),
  });
  function field(key: keyof typeof empty) {
    return (
      <TextField
        key={key}
        label={labels[key]}
        width={key.startsWith('address') ? 'lg' : 'md'}
        required={required.has(key)}
        type={key === 'contactEmail' ? 'email' : 'text'}
        value={form[key]}
        onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))}
        errorMessage={error && required.has(key) && !form[key].trim() ? 'Required' : undefined}
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
      <FormSection title="Store Identity">
        <FormGrid layout="content">
          {distributor || store ? (
            <TextField label="Distributor" value={owner?.name ?? ''} readOnly width="md" />
          ) : (
            <DistributorLookupField
              label="Distributor"
              value={owner}
              onChange={setOwner}
              required
              disabled={mutation.isPending}
            />
          )}
          {field('code')}
          {field('name')}
          {field('gstin')}
          <SelectField
            label="Status"
            value={form.status}
            onValueChange={(status) => setForm((current) => ({ ...current, status }))}
            width="sm"
            disabled={mutation.isPending || Boolean(distributor)}
          >
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectField>
        </FormGrid>
      </FormSection>
      <FormSection title="Address">
        <FormGrid layout="content">
          {(
            ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'] as const
          ).map(field)}
        </FormGrid>
      </FormSection>
      <FormSection title="Contact Information">
        <FormGrid layout="content">
          {(['contactName', 'contactPhone', 'contactEmail'] as const).map(field)}
        </FormGrid>
      </FormSection>
      {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
      <div className="flex gap-2">
        <Button type="submit" loading={mutation.isPending}>
          Save Retail Store
        </Button>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
