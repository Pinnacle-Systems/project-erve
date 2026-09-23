import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Distributor, Status } from './types.js';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const emptyForm = {
  code: '',
  name: '',
  gstin: '',
  // Required at creation, immutable thereafter — never included in the
  // update payload (the backend rejects it there with a 400).
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
  status: 'ACTIVE' as Status,
};

const fieldLabels: Record<keyof typeof emptyForm, string> = {
  code: 'Code',
  name: 'Name',
  gstin: 'GSTIN',
  purchaseMode: 'Purchase Mode',
  contactName: 'Contact Name',
  contactEmail: 'Contact Email',
  contactPhone: 'Contact Phone',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'State',
  country: 'Country',
  postalCode: 'Postal Code',
  status: 'Status',
};

// Required at creation; the backend rejects a create/update without these.
const requiredFieldKeys = new Set<keyof typeof emptyForm>(['code', 'name', 'gstin']);

const identityFieldKeys = ['code', 'name', 'gstin', 'purchaseMode', 'status'] as const;
const contactFieldKeys = ['contactName', 'contactEmail', 'contactPhone'] as const;
const addressFieldKeys = [
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'country',
  'postalCode',
] as const;

export const PURCHASE_MODE_HELP_TEXT =
  'Locked after creation. If this distributor needs both Outright and Sale or Return, create separate distributor records.';

function cleanPayload(form: typeof emptyForm) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, value === '' ? null : value]),
  ) as Record<string, string | null>;
}

function toErrorMessage(caught: unknown): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : 'Unable to save distributor';
}

export function DistributorFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const distributorQuery = useQuery({
    queryKey: ['distributor', id],
    enabled: isEdit,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Distributor>>(`/distributors/${id}`);
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!distributorQuery.data) {
      return;
    }
    const distributor = distributorQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't available
    // for a lazy initial-state computation, so this can't be done without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      code: distributor.code,
      name: distributor.name,
      gstin: distributor.gstin,
      purchaseMode: distributor.purchaseMode,
      contactName: distributor.contactName ?? '',
      contactEmail: distributor.contactEmail ?? '',
      contactPhone: distributor.contactPhone ?? '',
      addressLine1: distributor.addressLine1 ?? '',
      addressLine2: distributor.addressLine2 ?? '',
      city: distributor.city ?? '',
      state: distributor.state ?? '',
      country: distributor.country ?? '',
      postalCode: distributor.postalCode ?? '',
      status: distributor.status,
    });
  }, [distributorQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.code.trim() || !form.name.trim() || !form.gstin.trim()) {
        throw new Error('Code, name, and GSTIN are required');
      }
      const gstin = form.gstin.trim().toUpperCase();
      if (!GSTIN_PATTERN.test(gstin)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)');
      }
      const payload: Record<string, string | null> = {
        ...cleanPayload(form),
        code: form.code.trim(),
        name: form.name.trim(),
        gstin,
        status: form.status,
      };
      // Purchase Mode is locked after creation — the update endpoint 400s if
      // it's present at all, so it's only ever sent on create.
      if (isEdit) delete payload.purchaseMode;
      const response = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Distributor>>(`/distributors/${id}`, payload)
        : await apiClient.post<ApiSuccessResponse<Distributor>>('/distributors', payload);
      return response.data.data;
    },
    onSuccess: async (distributor) => {
      await queryClient.invalidateQueries({ queryKey: ['distributors'] });
      await queryClient.invalidateQueries({ queryKey: ['distributor', distributor.id] });
      navigate(`/master-data/distributors/${distributor.id}`);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  if (isEdit && distributorQuery.isLoading) {
    return <LoadingState label="Loading distributor" />;
  }
  if (isEdit && distributorQuery.isError) {
    return (
      <ErrorState title="Unable to load distributor" description={distributorQuery.error.message} />
    );
  }

  function renderField(key: keyof typeof emptyForm) {
    if (key === 'status') {
      return (
        <SelectField
          key={key}
          label="Status"
          value={form.status}
          onValueChange={(value) => setForm((current) => ({ ...current, status: value as Status }))}
          width="fill"
        >
          <SelectItem value="ACTIVE">Active</SelectItem>
          <SelectItem value="INACTIVE">Inactive</SelectItem>
        </SelectField>
      );
    }
    if (key === 'purchaseMode') {
      return (
        <SelectField
          key={key}
          label="Purchase Mode *"
          helpText={PURCHASE_MODE_HELP_TEXT}
          value={form.purchaseMode}
          disabled={isEdit}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, purchaseMode: value as 'OUTRIGHT' | 'SALE_RETURN' }))
          }
          width="fill"
        >
          <SelectItem value="OUTRIGHT">Outright</SelectItem>
          <SelectItem value="SALE_RETURN">Sale or Return</SelectItem>
        </SelectField>
      );
    }
    const label = requiredFieldKeys.has(key) ? `${fieldLabels[key]} *` : fieldLabels[key];
    return (
      <TextField
        key={key}
        label={label}
        type={key === 'contactEmail' ? 'email' : 'text'}
        value={form[key]}
        errorMessage={
          error &&
          ((key === 'code' && !form.code) ||
            (key === 'name' && !form.name) ||
            (key === 'gstin' && !form.gstin))
            ? 'Required'
            : undefined
        }
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Distributor' : 'Create Distributor'}
        subtitle={isEdit ? 'Update distributor master details' : 'Create a distributor master record'}
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
          <FormSection title="Identity / Business">
            <FormGrid columns={3}>{identityFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          <FormSection title="Contact">
            <FormGrid columns={3}>{contactFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          <FormSection title="Address">
            <FormGrid columns={3}>{addressFieldKeys.map(renderField)}</FormGrid>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Distributor'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
