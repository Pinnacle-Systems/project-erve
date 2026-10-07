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
import type { GstRuleSet, Status } from '../master-data/types.js';

function toErrorMessage(caught: unknown): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : 'Unable to save GST Rule Set';
}

export function GstRuleSetFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [error, setError] = useState('');

  const ruleSetQuery = useQuery({
    queryKey: ['gst-rule-set', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<GstRuleSet>>(`/gst-rule-sets/${id}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    if (!ruleSetQuery.data) return;
    const ruleSet = ruleSetQuery.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(ruleSet.code);
    setName(ruleSet.name);
    setStatus(ruleSet.status);
  }, [ruleSetQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!code.trim()) throw new Error('Code is required');
      if (!name.trim()) throw new Error('Name is required');
      const payload = { code: code.trim(), name: name.trim(), status };
      const res = isEdit
        ? await apiClient.patch<ApiSuccessResponse<GstRuleSet>>(`/gst-rule-sets/${id}`, payload)
        : await apiClient.post<ApiSuccessResponse<GstRuleSet>>('/gst-rule-sets', payload);
      return res.data.data;
    },
    onSuccess: async (ruleSet) => {
      await queryClient.invalidateQueries({ queryKey: ['gst-rule-sets'] });
      await queryClient.invalidateQueries({ queryKey: ['gst-rule-set', ruleSet.id] });
      navigate(`/gst-rule-sets/${ruleSet.id}`);
    },
    onError: (caught) => setError(toErrorMessage(caught)),
  });

  if (isEdit && ruleSetQuery.isLoading) {
    return <LoadingState label="Loading GST Rule Set" />;
  }
  if (isEdit && ruleSetQuery.isError) {
    return <ErrorState title="Unable to load GST Rule Set" description={ruleSetQuery.error.message} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit GST Rule Set' : 'Create GST Rule Set'}
        subtitle={
          isEdit
            ? 'Update this GST Rule Set — add or activate versions from its detail page'
            : 'Create a reusable GST Rule Set, then add effective-dated versions and value bands'
        }
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
          <FormSection title="Rule Set Identity">
            <FormGrid columns={3}>
              <TextField label="Code" required value={code} onChange={(e) => setCode(e.target.value)} />
              <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
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

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create GST Rule Set'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
