import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Size } from './types.js';

const types = ['AGE', 'ALPHA', 'NUMERIC', 'WAIST', 'FREE_SIZE'] as const;

function message(error: unknown) {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save size';
}

export function SizeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', label: '', sizeType: 'AGE', sortOrder: '0' });
  const [error, setError] = useState('');
  // True once the form has been hydrated from the loaded record and is safe to reveal. Gating on
  // this (see the render-time check below), not just query.isLoading, is load-bearing: isLoading
  // flips to false the moment query.data arrives, but this effect (which actually copies it into
  // `form`) only runs after that render commits — so a naive `if (query.isLoading)` guard still
  // lets the Type SelectField mount once, still showing the initial 'AGE' default, before this
  // effect corrects it a render later. That later correction is a controlled-value change on an
  // already-mounted Select, which reproduces the same Radix hidden-bubble-select clobber
  // documented in erve-radix-select-hydration-race-general-pattern (confirmed here via a
  // regression test: the Type trigger got stuck on the placeholder instead of showing the loaded
  // sizeType). Waiting for `hydrated` means the Select's first-ever render already carries the
  // correct value, so no such post-mount transition ever happens.
  const [hydrated, setHydrated] = useState(false);
  const query = useQuery({
    queryKey: ['size', id],
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<Size>>(`/sizes/${id}`)).data.data,
  });
  useEffect(() => {
    if (query.data) {
      // The record arrives asynchronously, so hydrate the controlled edit form once loaded.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        code: query.data.code,
        label: query.data.label,
        sizeType: query.data.sizeType,
        sortOrder: String(query.data.sortOrder),
      });
      setHydrated(true);
    }
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!form.code.trim() || !form.label.trim() || !form.sortOrder.trim() || Number.isNaN(Number(form.sortOrder))) {
        throw new Error('Code, label, and sort order are required');
      }
      return (
        await apiClient.patch<ApiSuccessResponse<Size>>(`/sizes/${id}`, {
          ...form,
          code: form.code.trim(),
          label: form.label.trim(),
          sortOrder: Number(form.sortOrder),
        })
      ).data.data;
    },
    onSuccess: async (size) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['size', id] }),
        queryClient.invalidateQueries({ queryKey: ['sizes'] }),
      ]);
      navigate(`/master-data/sizes/${size.id}`);
    },
    onError: (caught) => setError(message(caught)),
  });
  // isError must be checked before the hydrated gate below — hydrated only ever becomes true once
  // query.data arrives, so a fetch failure would otherwise leave the page stuck on LoadingState
  // forever with no escape.
  if (query.isError)
    return <ErrorState title="Unable to load size" description={query.error.message} />;
  if (query.isLoading || !hydrated) return <LoadingState label="Loading size" />;
  const locked =
    (query.data?.usage?.purchaseOrderLines ?? 0) > 0 || (query.data?.usage?.jobOrderLines ?? 0) > 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Edit Size"
        subtitle="Update size display and ordering details"
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />
      <Panel>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FormGrid columns={4}>
            <TextField
              label="Code *"
              value={form.code}
              disabled={locked}
              errorMessage={error && !form.code.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <TextField
              label="Label *"
              value={form.label}
              errorMessage={error && !form.label.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <SelectField
              label="Type *"
              value={form.sizeType}
              disabled={locked}
              onValueChange={(value) => setForm({ ...form, sizeType: value })}
              width="fill"
            >
              {types.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectField>
            <TextField
              label="Sort Order *"
              type="number"
              value={form.sortOrder}
              errorMessage={error && !form.sortOrder.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </FormGrid>
          {locked ? (
            <ValidationMessage tone="info">
              Code and type are locked because this size has transactional history — they cannot
              be edited. Label and sort order remain editable.
            </ValidationMessage>
          ) : null}
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
