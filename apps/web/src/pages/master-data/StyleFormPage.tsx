import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { imageErrorMessage, StyleImagesPanel } from './StyleImagesPanel.js';
import { StyleIdentitySection } from './style/StyleIdentitySection.js';
import { StyleCommercialSection } from './style/StyleCommercialSection.js';
import { StyleSizesField } from './style/StyleSizesField.js';
import {
  StyleFactoryMappingsField,
  nextFactoryMappingRowId,
  type StyleFactoryMappingRow,
} from './style/StyleFactoryMappingsField.js';
import { cleanPayload, emptyForm, validateStyleForm } from './style/style-form-state.js';
import type { FactoryOption, SeasonOption, SizeOption, Style } from './types.js';

export function StyleFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [factoryMappings, setFactoryMappings] = useState<StyleFactoryMappingRow[]>([]);
  const [error, setError] = useState('');
  // Create-mode only: an image picked before the style exists. The style
  // must be created first (the image endpoint needs a style ID), so this is
  // an explicit two-step flow — see the mutation below for the honest
  // partial-failure handling. StyleImagesPanel (deferred mode) owns the
  // picker UI and preview lifecycle; this page only needs the current File.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [createdWithImageFailure, setCreatedWithImageFailure] = useState<Style | null>(null);

  const styleQuery = useQuery({
    queryKey: ['style', id],
    enabled: isEdit,
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${id}`);
      return response.data.data;
    },
  });
  const sizesQuery = useQuery({
    queryKey: ['sizes', 'options'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<SizeOption[]>>('/sizes/options');
      return response.data.data;
    },
  });
  const factoriesQuery = useQuery({
    queryKey: ['factories', 'options'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<FactoryOption[]>>('/factories/options');
      return response.data.data;
    },
  });
  // Every Season, any status (GET /seasons/options): the identity section offers ACTIVE ones plus
  // this Style's saved Season, even if INACTIVE.
  const seasonsQuery = useQuery({ queryKey: ['seasons', 'options'], queryFn: async () => (await apiClient.get<ApiSuccessResponse<SeasonOption[]>>('/seasons/options')).data.data });

  // Edit mode only: true once the form has been hydrated from the loaded record and is safe to
  // reveal. Gating on this (see the render-time check below), not just styleQuery.isLoading, is
  // load-bearing: it keeps the Season SelectField from ever mounting with an empty value and then
  // being reassigned a real one by this effect on a later render. That external post-mount value
  // change — regardless of whether matching <SelectItem>s already exist by then — is what makes
  // Radix's hidden native bubble-select fire its own change handler back to "", silently clobbering
  // the just-hydrated season to empty with no error (confirmed live via a console trace on
  // onValueChange; see erve-sale-order-edit-hydration-fix memory for the same root cause in a
  // different form). Waiting to hydrate everything — Season included — until both styleQuery and
  // seasonsQuery have resolved means the SelectField's first-ever render already carries the
  // correct value, so no such post-mount change ever happens.
  const [hydrated, setHydrated] = useState(!isEdit);

  useEffect(() => {
    if (!styleQuery.data || !seasonsQuery.data) {
      return;
    }
    // Hydrates the edit form from async-loaded records; the data isn't available for a lazy
    // initial-state computation, so this can't be done without an effect.
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
      royaltyPercentage:
        styleQuery.data.royaltyPercentage === null ? '' : String(styleQuery.data.royaltyPercentage),
      status: styleQuery.data.status,
    });
    setSelectedSizeIds(styleQuery.data.sizes.map((size) => size.id));
    setSeasonId(styleQuery.data.season.id);
    setFactoryMappings(
      styleQuery.data.factories.map((factory) => ({
        rowId: nextFactoryMappingRowId(),
        factoryId: factory.id,
        exFactoryPrice: String(factory.exFactoryPrice),
      })),
    );
    setHydrated(true);
  }, [styleQuery.data, seasonsQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      const validationError = validateStyleForm(form, seasonId);
      if (validationError) {
        throw new Error(validationError);
      }
      const response = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Style>>(`/styles/${id}`, cleanPayload(form, seasonId))
        : await apiClient.post<ApiSuccessResponse<Style>>('/styles', cleanPayload(form, seasonId));
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
            const submitted = submittedFactories.find(
              (mapping) => mapping.factoryId === factory.id,
            );
            return submitted && Number(submitted.exFactoryPrice) !== factory.exFactoryPrice;
          })
          .map((factory) => apiClient.delete(`/styles/${style.id}/factories/${factory.id}`)),
      );
      const currentFactoryIds = new Set(
        style.factories
          .filter((factory) => {
            const submitted = submittedFactories.find(
              (mapping) => mapping.factoryId === factory.id,
            );
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

      if (!isEdit && pendingImage) {
        // The style row is already committed at this point. If the image
        // upload fails we do not pretend the whole save failed — the user
        // gets an honest message plus a link to the created style, and the
        // form is locked against re-submitting (which would try to create
        // the same style number again).
        const body = new FormData();
        body.append('image', pendingImage);
        try {
          await apiClient.post(`/styles/${style.id}/images`, body);
        } catch (caught) {
          setCreatedWithImageFailure(style);
          throw new Error(
            `The style was created, but the image upload failed: ${imageErrorMessage(
              caught,
              'upload error',
            )}. Open the style to retry the upload.`,
            { cause: caught },
          );
        }
      }

      return style;
    },
    onSuccess: (style) => navigate(`/master-data/styles/${style.id}`),
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : 'Unable to save style'),
  });

  const availableFactories = useMemo(() => factoriesQuery.data ?? [], [factoriesQuery.data]);

  if (isEdit && styleQuery.isError) {
    return <ErrorState title="Unable to load style" description={styleQuery.error.message} />;
  }
  // Hydration also depends on seasonsQuery (see the hydration effect above) — surface its failure
  // too, rather than leaving the page stuck on the loading state forever if it errors while
  // styleQuery succeeds.
  if (isEdit && seasonsQuery.isError) {
    return <ErrorState title="Unable to load seasons" description={seasonsQuery.error.message} />;
  }
  if (isEdit && (styleQuery.isLoading || !hydrated)) {
    return <LoadingState label="Loading style" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Style' : 'Create Style'}
        subtitle={
          isEdit ? 'Update item master details and mappings' : 'Create an item master record'
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
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <StyleIdentitySection
            form={form}
            onFieldChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
            seasonId={seasonId}
            onSeasonChange={setSeasonId}
            seasons={seasonsQuery.data ?? []}
            error={error}
          />

          <StyleCommercialSection
            form={form}
            onFieldChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
            error={error}
          />

          <StyleSizesField
            sizes={sizesQuery.data ?? []}
            selectedSizeIds={selectedSizeIds}
            onChange={setSelectedSizeIds}
          />

          <StyleFactoryMappingsField
            mappings={factoryMappings}
            availableFactories={availableFactories}
            onChange={setFactoryMappings}
          />

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          {createdWithImageFailure ? (
            <div className="flex justify-end">
              <Button asChild variant="secondary">
                <Link to={`/master-data/styles/${createdWithImageFailure.id}`}>
                  Open {createdWithImageFailure.styleNumber}
                </Link>
              </Button>
            </div>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={createdWithImageFailure !== null}
            >
              Save Style
            </Button>
          </div>
        </form>
      </Panel>

      {isEdit && id ? (
        <StyleImagesPanel styleId={id} images={styleQuery.data?.images ?? []} canManage />
      ) : (
        <StyleImagesPanel canManage deferred={{ pendingImage, onSelect: setPendingImage }} />
      )}
    </div>
  );
}
