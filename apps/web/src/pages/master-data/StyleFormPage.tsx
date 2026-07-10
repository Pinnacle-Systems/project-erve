import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, Checkbox, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel, Stack } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import type { Factory, Size, Status, Style } from './types.js';

const emptyForm = {
  styleNumber: '',
  styleName: '',
  description: '',
  categoryDescription: '',
  itemNameGroup: '',
  ipName: '',
  licensor: '',
  colour: '',
  lmixNumber: '',
  hsnCode: '',
  hsnDescription: '',
  finalMrp: '',
  royaltyPercentage: '',
  status: 'ACTIVE' as Status,
};

const fieldLabels: Record<keyof typeof emptyForm, string> = {
  styleNumber: 'Style Number',
  styleName: 'Style Name',
  description: 'Description',
  categoryDescription: 'Category',
  itemNameGroup: 'Item Name Group',
  ipName: 'IP Name',
  licensor: 'Licensor',
  colour: 'Colour',
  lmixNumber: 'LMIX Number',
  hsnCode: 'HSN Code',
  hsnDescription: 'HSN Description',
  finalMrp: 'Final MRP',
  royaltyPercentage: 'Royalty %',
  status: 'Status',
};

function cleanPayload(form: typeof emptyForm) {
  return {
    ...form,
    finalMrp: Number(form.finalMrp),
    royaltyPercentage: form.royaltyPercentage === '' ? null : Number(form.royaltyPercentage),
  };
}

export function StyleFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [factoryMappings, setFactoryMappings] = useState<Array<{ factoryId: string; exFactoryPrice: string }>>([]);
  const [error, setError] = useState('');

  const styleQuery = useQuery({
    queryKey: ['style', id],
    enabled: isEdit,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${id}`);
      return response.data.data;
    },
  });
  const sizesQuery = useQuery({
    queryKey: ['sizes', 'active'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Size[]>>('/sizes', { params: { status: 'ACTIVE' } });
      return response.data.data;
    },
  });
  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', {
        params: { status: 'ACTIVE' },
      });
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!styleQuery.data) {
      return;
    }
    // Hydrates the edit form from an async-loaded record; the data isn't available
    // for a lazy initial-state computation, so this can't be done without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      styleNumber: styleQuery.data.styleNumber,
      styleName: styleQuery.data.styleName,
      description: styleQuery.data.description ?? '',
      categoryDescription: styleQuery.data.categoryDescription ?? '',
      itemNameGroup: styleQuery.data.itemNameGroup ?? '',
      ipName: styleQuery.data.ipName ?? '',
      licensor: styleQuery.data.licensor ?? '',
      colour: styleQuery.data.colour ?? '',
      lmixNumber: styleQuery.data.lmixNumber ?? '',
      hsnCode: styleQuery.data.hsnCode ?? '',
      hsnDescription: styleQuery.data.hsnDescription ?? '',
      finalMrp: String(styleQuery.data.finalMrp),
      royaltyPercentage: styleQuery.data.royaltyPercentage === null ? '' : String(styleQuery.data.royaltyPercentage),
      status: styleQuery.data.status,
    });
    setSelectedSizeIds(styleQuery.data.sizes.map((size) => size.id));
    setFactoryMappings(
      styleQuery.data.factories.map((factory) => ({
        factoryId: factory.id,
        exFactoryPrice: String(factory.exFactoryPrice),
      })),
    );
  }, [styleQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.styleNumber || !form.styleName || Number(form.finalMrp) <= 0) {
        throw new Error('Style number, style name, and final MRP are required');
      }
      const response = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Style>>(`/styles/${id}`, cleanPayload(form))
        : await apiClient.post<ApiSuccessResponse<Style>>('/styles', cleanPayload(form));
      const style = response.data.data;

      const currentSizeIds = new Set(style.sizes.map((size) => size.id));
      await Promise.all(
        style.sizes
          .filter((size) => !selectedSizeIds.includes(size.id))
          .map((size) => apiClient.delete(`/styles/${style.id}/sizes/${size.id}`)),
      );
      await Promise.all(
        selectedSizeIds
          .filter((sizeId) => !currentSizeIds.has(sizeId))
          .map((sizeId) => apiClient.post(`/styles/${style.id}/sizes`, { sizeId })),
      );

      const submittedFactories = factoryMappings.filter((mapping) => mapping.factoryId);
      const submittedFactoryIds = new Set(submittedFactories.map((mapping) => mapping.factoryId));
      await Promise.all(
        style.factories
          .filter((factory) => !submittedFactoryIds.has(factory.id))
          .map((factory) => apiClient.delete(`/styles/${style.id}/factories/${factory.id}`)),
      );
      await Promise.all(
        style.factories
          .filter((factory) => {
            const submitted = submittedFactories.find((mapping) => mapping.factoryId === factory.id);
            return submitted && Number(submitted.exFactoryPrice) !== factory.exFactoryPrice;
          })
          .map((factory) => apiClient.delete(`/styles/${style.id}/factories/${factory.id}`)),
      );
      const currentFactoryIds = new Set(
        style.factories
          .filter((factory) => {
            const submitted = submittedFactories.find((mapping) => mapping.factoryId === factory.id);
            return submitted && Number(submitted.exFactoryPrice) === factory.exFactoryPrice;
          })
          .map((factory) => factory.id),
      );
      await Promise.all(
        submittedFactories
          .filter((mapping) => !currentFactoryIds.has(mapping.factoryId))
          .map((mapping) =>
            apiClient.post(`/styles/${style.id}/factories`, {
              factoryId: mapping.factoryId,
              exFactoryPrice: Number(mapping.exFactoryPrice),
            }),
          ),
      );

      return style;
    },
    onSuccess: (style) => navigate(`/master-data/styles/${style.id}`),
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'Unable to save style'),
  });

  const availableFactories = useMemo(() => factoriesQuery.data ?? [], [factoriesQuery.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Style' : 'Create Style'}
        subtitle={isEdit ? 'Update item master details and mappings' : 'Create an item master record'}
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
          <FormSection title="Style Details">
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
                  type={key.includes('Mrp') || key.includes('Percentage') ? 'number' : 'text'}
                  value={form[key as keyof typeof emptyForm]}
                  errorMessage={
                    error && ((key === 'styleNumber' && !form.styleNumber) || (key === 'styleName' && !form.styleName))
                      ? 'Required'
                      : undefined
                  }
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              ),
            )}
          </FormGrid>
          </FormSection>

          <FormSection title="Valid Sizes">
            <div className="grid gap-2 md:grid-cols-4">
              {(sizesQuery.data ?? []).map((size) => (
                <label
                  key={size.id}
                  className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-muted p-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={selectedSizeIds.includes(size.id)}
                    onCheckedChange={(checked) =>
                      setSelectedSizeIds((current) =>
                        checked === true ? [...current, size.id] : current.filter((sizeId) => sizeId !== size.id),
                      )
                    }
                  />
                  {size.code}
                </label>
              ))}
            </div>
          </FormSection>

          <FormSection
            title="Factory Mappings"
            actions={
              <Button type="button" variant="secondary" onClick={() => setFactoryMappings((current) => [...current, { factoryId: '', exFactoryPrice: '' }])}>
                Add Factory
              </Button>
            }
          >
            <Stack gap="sm">
              {factoryMappings.map((mapping, index) => (
                <div key={index} className="grid gap-3 md:grid-cols-[1fr_160px_100px]">
                  <SelectField
                    aria-label="Factory"
                    value={mapping.factoryId || 'NONE'}
                    onValueChange={(value) =>
                      setFactoryMappings((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, factoryId: value === 'NONE' ? '' : value } : item,
                        ),
                      )
                    }
                    width="fill"
                  >
                    <SelectItem value="NONE">Select factory</SelectItem>
                    {availableFactories.map((factory) => (
                      <SelectItem key={factory.id} value={factory.id}>
                        {factory.name}
                      </SelectItem>
                    ))}
                  </SelectField>
                  <TextField
                    type="number"
                    aria-label="Ex-factory price"
                    value={mapping.exFactoryPrice}
                    onChange={(event) =>
                      setFactoryMappings((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, exFactoryPrice: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setFactoryMappings((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </Stack>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save Style
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
