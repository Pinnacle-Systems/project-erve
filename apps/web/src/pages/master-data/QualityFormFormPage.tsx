import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { QualityForm, QualityFormSection } from './types.js';
import { emptyDefinition, qualityFormError } from './quality-form-ui.js';
import { QualityFormDefinitionEditor } from './QualityFormDefinitionEditor.js';

export function QualityFormFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const editing = Boolean(id);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activityType, setActivityType] = useState<'MEETING' | 'INSPECTION'>('INSPECTION');
  const [executionScope, setExecutionScope] = useState<'JOB_ORDER' | 'SIZE'>('JOB_ORDER');
  const [sections, setSections] = useState<QualityFormSection[]>(emptyDefinition());
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['quality-form', id],
    enabled: editing,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QualityForm>>(`/quality-forms/${id}`)).data.data,
  });
  useEffect(() => {
    if (!query.data) return;
    // Hydrate the edit form once its master record has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(query.data.code);
    setName(query.data.name);
    setDescription(query.data.description ?? '');
    setActivityType(query.data.activityType);
    setExecutionScope(query.data.executionScope);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!code.trim() || !name.trim()) throw new Error('Code and name are required');
      const master = { code, name, description: description || null };
      return editing
        ? (await apiClient.patch<ApiSuccessResponse<QualityForm>>(`/quality-forms/${id}`, master))
            .data.data
        : (
            await apiClient.post<ApiSuccessResponse<QualityForm>>('/quality-forms', {
              ...master,
              activityType,
              executionScope,
              sections,
            })
          ).data.data;
    },
    onSuccess: async (form) => {
      await client.invalidateQueries({ queryKey: ['quality-forms'] });
      navigate(`/master-data/quality-forms/${form.id}`);
    },
    onError: (caught) => setError(qualityFormError(caught, 'Unable to save Quality Form')),
  });
  if (query.isLoading) return <LoadingState label="Loading Quality Form" />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={editing ? 'Edit Quality Form' : 'Create Quality Form'}
        subtitle="Define what information is collected. Workflow timing belongs in Process Flow."
      />
      <Panel>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            mutation.mutate();
          }}
        >
          <FormSection title="Form identity">
            <FormGrid columns={2}>
              <TextField
                label="Code *"
                value={code}
                maxLength={30}
                width="fill"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
              <TextField
                label="Name *"
                value={name}
                maxLength={160}
                width="fill"
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                label="Description"
                value={description}
                width="fill"
                onChange={(event) => setDescription(event.target.value)}
              />
              {!editing ? (
                <>
                  <SelectField
                    label="Activity type"
                    value={activityType}
                    onValueChange={(value) => setActivityType(value as typeof activityType)}
                  >
                    <SelectItem value="MEETING">Meeting</SelectItem>
                    <SelectItem value="INSPECTION">Inspection</SelectItem>
                  </SelectField>
                  <SelectField
                    label="Execution scope"
                    value={executionScope}
                    onValueChange={(value) => setExecutionScope(value as typeof executionScope)}
                  >
                    <SelectItem value="JOB_ORDER">Job Order</SelectItem>
                    <SelectItem value="SIZE">Size</SelectItem>
                  </SelectField>
                </>
              ) : null}
            </FormGrid>
          </FormSection>
          {!editing ? (
            <FormSection title="Initial draft definition">
              <QualityFormDefinitionEditor
                sections={sections}
                onChange={setSections}
                error={error}
              />
            </FormSection>
          ) : null}
          {error && editing ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {editing ? 'Save Changes' : 'Create Draft'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
