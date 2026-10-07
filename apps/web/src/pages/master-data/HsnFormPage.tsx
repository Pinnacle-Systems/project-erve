import { useEffect, useState } from 'react';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { user } = useAuth();
  // RBAC finalization review: MERCHANDISER keeps full identity edit rights
  // on this form but must not assign/change the GST Rule Set — enforced
  // server-side regardless (hsn.service.ts), disabled here too so a
  // MERCHANDISER never sees a field they cannot actually use.
  const canAssignGst = canAssignHsnGstRuleSet(user);

  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [gstRuleSetId, setGstRuleSetId] = useState<string>(UNASSIGNED);
  const [error, setError] = useState('');

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
      const res = await apiClient.get<ApiSuccessResponse<GstRuleSetOption[]>>('/hsns/gst-rule-set-options');
      return res.data.data;
    },
  });

  useEffect(() => {
    if (!hsnQuery.data) return;
    const hsn = hsnQuery.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(hsn.code);
    setDescription(hsn.description ?? '');
    setStatus(hsn.status);
    setGstRuleSetId(hsn.gstRuleSet?.id ?? UNASSIGNED);
  }, [hsnQuery.data]);

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
        gstRuleSetId: gstRuleSetId === UNASSIGNED ? null : gstRuleSetId,
      };
      const res = isEdit
        ? await apiClient.patch<ApiSuccessResponse<Hsn>>(`/hsns/${id}`, payload)
        : await apiClient.post<ApiSuccessResponse<Hsn>>('/hsns', payload);
      return res.data.data;
    },
    onSuccess: async (hsn) => {
      await queryClient.invalidateQueries({ queryKey: ['hsns'] });
      await queryClient.invalidateQueries({ queryKey: ['hsn', hsn.id] });
      navigate(`/master-data/hsns/${hsn.id}`);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  if (isEdit && hsnQuery.isLoading) {
    return <LoadingState label="Loading HSN" />;
  }
  if (isEdit && hsnQuery.isError) {
    return <ErrorState title="Unable to load HSN" description={hsnQuery.error.message} />;
  }

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
            mutation.mutate();
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
                onValueChange={setGstRuleSetId}
                width="fill"
                disabled={!canAssignGst || ruleSetOptionsQuery.isLoading}
              >
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {(ruleSetOptionsQuery.data ?? []).map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.code} — {option.name}
                  </SelectItem>
                ))}
              </SelectField>
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
