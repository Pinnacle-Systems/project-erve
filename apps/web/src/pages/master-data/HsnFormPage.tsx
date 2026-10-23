import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, createEnterToNextHandler } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canAssignHsnGstRuleSet } from '../../auth/permissions.js';
import type { GstRuleSetOption, Hsn, Status } from './types.js';

const UNASSIGNED = 'UNASSIGNED';

function toErrorMessage(caught: unknown): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : 'Unable to save HSN';
}

export function HsnFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);

  const hsnQuery = useQuery({
    queryKey: ['hsn', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Hsn>>(`/hsns/${id}`);
      return res.data.data;
    },
  });

  const ruleSetOptionsQuery = useQuery({
    queryKey: ['hsn-gst-rule-set-options'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<GstRuleSetOption[]>>(
        '/hsns/gst-rule-set-options',
      );
      return res.data.data;
    },
  });

  if (isEdit && !hsnQuery.data) {
    if (hsnQuery.isError) {
      return <ErrorState title="Unable to load HSN" description={hsnQuery.error.message} />;
    }
    return <LoadingState label="Loading HSN" />;
  }
  if (ruleSetOptionsQuery.isPending) {
    return <LoadingState label="Loading HSN" />;
  }

  return (
    <HsnForm
      key={id ?? 'create'}
      hsn={isEdit ? hsnQuery.data : undefined}
      options={ruleSetOptionsQuery.data ?? []}
      optionsUnavailable={ruleSetOptionsQuery.isError}
    />
  );
}

function HsnForm({
  hsn,
  options,
  optionsUnavailable,
}: {
  hsn?: Hsn;
  options: GstRuleSetOption[];
  optionsUnavailable: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canAssignGst = canAssignHsnGstRuleSet(user);
  // Mount once per record, with its values already loaded. Refetches must
  // never hydrate over a draft or change a mounted Radix select's value.
  const [initialHsn] = useState(hsn);
  const id = initialHsn?.id;
  const isEdit = Boolean(id);
  const [code, setCode] = useState(initialHsn?.code ?? '');
  const [description, setDescription] = useState(initialHsn?.description ?? '');
  const [status, setStatus] = useState<Status>(initialHsn?.status ?? 'ACTIVE');
  const [selectedRuleSet, setSelectedRuleSet] = useState(initialHsn?.gstRuleSet ?? null);
  const [error, setError] = useState('');
  const gstRuleSetId = selectedRuleSet?.id ?? UNASSIGNED;
  // The options endpoint offers ACTIVE records only. Retain the saved and
  // selected entries so an inactive assignment or a refetch cannot blank it.
  const ruleSets = new Map(
    options.filter((option) => option.status === 'ACTIVE').map((option) => [option.id, option]),
  );
  if (initialHsn?.gstRuleSet && !ruleSets.has(initialHsn.gstRuleSet.id)) {
    ruleSets.set(initialHsn.gstRuleSet.id, initialHsn.gstRuleSet);
  }
  if (selectedRuleSet && !ruleSets.has(selectedRuleSet.id)) {
    ruleSets.set(selectedRuleSet.id, selectedRuleSet);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!/^\d{8}$/.test(code.trim())) {
        throw new Error('HSN Code must be exactly 8 digits');
      }
      const payload = {
        code: code.trim(),
        description: description.trim() || null,
        status,
        // Omission preserves the relationship, including concurrent changes
        // made elsewhere. Only an authorized, explicit change is submitted.
        ...(canAssignGst && (selectedRuleSet?.id ?? null) !== (initialHsn?.gstRuleSet?.id ?? null)
          ? { gstRuleSetId: selectedRuleSet?.id ?? null }
          : {}),
      };
      const res = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Hsn>>(`/hsns/${id}`, payload)
        : await apiClient.post<ApiSuccessResponse<Hsn>>('/hsns', payload);
      return res.data.data;
    },
    onSuccess: async (hsn) => {
      await queryClient.invalidateQueries({ queryKey: ['hsns'] });
      await queryClient.invalidateQueries({ queryKey: ['hsn', hsn.id] });
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit HSN' : 'Create HSN'}
        subtitle={isEdit ? 'Update this HSN record' : 'Create a new HSN master record'}
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Panel>
        <form
          noValidate
          className="space-y-6"
          onKeyDown={createEnterToNextHandler()}
          onSubmit={(event) => {
            event.preventDefault();
            // Per-call callbacks do not run after this record's form unmounts.
            mutation.mutate(undefined, { onSuccess: (saved) => navigate(`/hsns/${saved.id}`) });
          }}
        >
          <FormSection title="HSN Identity">
            <FormGrid columns={3}>
              <TextField
                label="HSN Code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="8 digits"
              />
              <TextField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <SelectField
                label="Status"
                value={status}
                onValueChange={(value) => setStatus(value as Status)}
                width="fill"
              >
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectField>
            </FormGrid>
          </FormSection>

          <FormSection title="GST Rule Set">
            <FormGrid columns={3}>
              <SelectField
                label="GST Rule Set"
                value={gstRuleSetId}
                onValueChange={(value) => {
                  // Ignore empty native select hydration events. Clearing
                  // requires choosing the explicit Unassigned option.
                  if (!canAssignGst || optionsUnavailable || !value) return;
                  if (value === UNASSIGNED) setSelectedRuleSet(null);
                  else {
                    const option = ruleSets.get(value);
                    if (option) setSelectedRuleSet(option);
                  }
                }}
                width="fill"
                disabled={!canAssignGst || optionsUnavailable}
              >
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {Array.from(ruleSets.values()).map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.code} — {option.name}
                    {option.status === 'INACTIVE' ? ' (inactive)' : ''}
                  </SelectItem>
                ))}
              </SelectField>
              {optionsUnavailable && (
                <ValidationMessage tone="error">
                  Unable to load GST Rule Sets. The existing assignment is preserved; other HSN
                  fields can still be saved.
                </ValidationMessage>
              )}
              {!canAssignGst && (
                <p className="col-span-full text-sm text-muted-foreground">
                  Only Admin or Accountant may assign or change the GST Rule Set.
                </p>
              )}
            </FormGrid>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create HSN'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
