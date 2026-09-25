import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { DistributorLookupField } from '../master-data/DistributorLookupField.js';
import type { PriceList, PriceListDistributor } from './types.js';
import { apiErrorMessage } from './price-list-ui.js';

export function PriceListFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const queryClient = useQueryClient();

  // Create mode only — the distributor is fixed once the price list exists.
  const [distributor, setDistributor] = useState<PriceListDistributor | null>(null);
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

  useEffect(() => {
    if (!priceListQuery.data) return;
    const priceList = priceListQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't available
    // for a lazy initial-state computation, so this can't be done without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(priceList.name);
    setEffectiveFrom(priceList.effectiveFrom ?? '');
    setEffectiveTo(priceList.effectiveTo ?? '');
  }, [priceListQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!isEdit && !distributor) throw new Error('Distributor is required');
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
        distributorId: distributor!.id,
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
            <FormGrid layout="content">
              {isEdit && priceListQuery.data ? (
                // The distributor is fixed after creation — shown straight
                // from the loaded price list, never looked up.
                <TextField
                  label="Distributor *"
                  value={priceListQuery.data.distributor.name}
                  disabled
                  width="md"
                />
              ) : (
                // Price-List-specific lookup: ACCOUNTANT can create Price
                // Lists but is denied on the broad /distributors master, so
                // this searches /price-lists/distributor-options (ACTIVE only).
                <DistributorLookupField<PriceListDistributor>
                  label="Distributor *"
                  value={distributor}
                  onChange={setDistributor}
                  searchPath="/price-lists/distributor-options"
                  searchParams={{ status: 'ACTIVE' }}
                  width="md"
                />
              )}

              <TextField
                label="Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                width="md"
              />

              <DatePicker
                label="Effective From"
                value={effectiveFrom}
                onValueChange={(value) => setEffectiveFrom(value ?? '')}
                displayFormat="dd/mm/yyyy"
                width="sm"
              />
              <DatePicker
                label="Effective To (optional)"
                value={effectiveTo}
                onValueChange={(value) => setEffectiveTo(value ?? '')}
                displayFormat="dd/mm/yyyy"
                width="sm"
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
