import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { PriceList, PriceListDistributor } from './types.js';
import { apiErrorMessage } from './price-list-ui.js';

export function PriceListFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const queryClient = useQueryClient();

  const [distributorId, setDistributorId] = useState('');
  const [name, setName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [error, setError] = useState('');

  const priceListQuery = useQuery({
    queryKey: ['price-list', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceList>>(`/price-lists/${id}`);
      return res.data.data;
    },
  });

  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
    enabled: !isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceListDistributor[]>>('/distributors', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  useEffect(() => {
    if (!priceListQuery.data) return;
    const priceList = priceListQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't available
    // for a lazy initial-state computation, so this can't be done without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDistributorId(priceList.distributor.id);
    setName(priceList.name);
    setEffectiveFrom(priceList.effectiveFrom ?? '');
    setEffectiveTo(priceList.effectiveTo ?? '');
  }, [priceListQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!isEdit && !distributorId) throw new Error('Distributor is required');
      if (!name.trim()) throw new Error('Name is required');
      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
        throw new Error('Effective-to date cannot be before the effective-from date');
      }

      if (isEdit) {
        const res = await apiClient.patch<ApiSuccessResponse<PriceList>>(`/price-lists/${id}`, {
          name: name.trim(),
          effectiveFrom: effectiveFrom || null,
          effectiveTo: effectiveTo || null,
        });
        return res.data.data;
      }
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>('/price-lists', {
        distributorId,
        name: name.trim(),
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
      });
      return res.data.data;
    },
    onSuccess: async (priceList) => {
      await queryClient.invalidateQueries({ queryKey: ['price-list', priceList.id] });
      navigate(`/price-lists/${priceList.id}`);
    },
    onError: (caught) => setError(apiErrorMessage(caught, 'Unable to save price list')),
  });

  if (isEdit && priceListQuery.isLoading) {
    return <LoadingState label="Loading price list" />;
  }
  if (isEdit && !priceListQuery.data) {
    return (
      <EmptyState
        title="Price list not found"
        description="The selected price list could not be loaded."
        tone="error"
      />
    );
  }
  if (isEdit && priceListQuery.data && priceListQuery.data.status !== 'DRAFT') {
    return (
      <EmptyState
        title="Price list is not editable"
        description="Only draft price lists can be edited. Create a new draft to change prices."
        tone="error"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Price List' : 'Create Price List'}
        subtitle={
          isEdit
            ? 'Update draft price-list details'
            : 'Create a draft price list for a distributor, then add style prices'
        }
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Panel>
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Price List Details">
            <FormGrid columns={2}>
              <SelectField
                label="Distributor *"
                value={distributorId || 'NONE'}
                disabled={isEdit}
                onValueChange={(value) => setDistributorId(value === 'NONE' ? '' : value)}
                width="fill"
              >
                <SelectItem value="NONE">Select distributor</SelectItem>
                {isEdit && priceListQuery.data ? (
                  <SelectItem value={priceListQuery.data.distributor.id}>
                    {priceListQuery.data.distributor.name}
                  </SelectItem>
                ) : (
                  (distributorsQuery.data ?? []).map((distributor) => (
                    <SelectItem key={distributor.id} value={distributor.id}>
                      {distributor.name}
                    </SelectItem>
                  ))
                )}
              </SelectField>

              <TextField
                label="Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                width="fill"
              />

              <DatePicker
                label="Effective From"
                value={effectiveFrom}
                onValueChange={(value) => setEffectiveFrom(value ?? '')}
                displayFormat="yyyy-mm-dd"
              />
              <DatePicker
                label="Effective To (optional)"
                value={effectiveTo}
                onValueChange={(value) => setEffectiveTo(value ?? '')}
                displayFormat="yyyy-mm-dd"
              />
            </FormGrid>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save Draft
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
