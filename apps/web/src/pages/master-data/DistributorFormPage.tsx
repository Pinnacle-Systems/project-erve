import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Distributor, Status } from './types.js';

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
  status: 'ACTIVE' as Status,
};

const fieldLabels: Record<keyof typeof emptyForm, string> = {
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
  status: 'Status',
};

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
      if (!form.code.trim() || !form.name.trim()) {
        throw new Error('Code and name are required');
      }
      const payload = { ...cleanPayload(form), code: form.code.trim(), name: form.name.trim(), status: form.status };
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
          <FormSection title="Distributor Details">
            <FormGrid columns={3}>
              {Object.keys(emptyForm).map((key) =>
                key === 'status' ? (
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
                ) : (
                  <TextField
                    key={key}
                    label={fieldLabels[key as keyof typeof emptyForm]}
                    type={key === 'contactEmail' ? 'email' : 'text'}
                    value={form[key as keyof typeof emptyForm]}
                    errorMessage={
                      error && ((key === 'code' && !form.code) || (key === 'name' && !form.name))
                        ? 'Required'
                        : undefined
                    }
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  />
                ),
              )}
            </FormGrid>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Distributor'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
