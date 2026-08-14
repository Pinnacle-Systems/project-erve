import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { QualityFormSection, QualityFormVersion } from './types.js';
import { QualityFormDefinitionEditor } from './QualityFormDefinitionEditor.js';
import { qualityFormError } from './quality-form-ui.js';

export function QualityFormVersionEditorPage() {
  const { versionId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [sections, setSections] = useState<QualityFormSection[]>([]);
  const [activityType, setActivityType] = useState<'MEETING' | 'INSPECTION'>('INSPECTION');
  const [executionScope, setExecutionScope] = useState<'JOB_ORDER' | 'SIZE'>('JOB_ORDER');
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['quality-form-version', versionId],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<QualityFormVersion>>(
          `/quality-form-versions/${versionId}`,
        )
      ).data.data,
  });
  useEffect(() => {
    if (!query.data) return;
    // Hydrate the ordered editor once the selected draft has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSections(query.data.sections);
    setActivityType(query.data.activityType);
    setExecutionScope(query.data.executionScope);
  }, [query.data]);
  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put<ApiSuccessResponse<QualityFormVersion>>(
          `/quality-form-versions/${versionId}/definition`,
          { sections, activityType, executionScope },
        )
      ).data.data,
    onSuccess: async (version) => {
      await client.invalidateQueries({ queryKey: ['quality-form', version.qualityFormId] });
      navigate(`/master-data/quality-forms/${version.qualityFormId}`);
    },
    onError: (caught) => setError(qualityFormError(caught, 'Unable to save definition')),
  });
  if (query.isLoading) return <LoadingState label="Loading Quality Form version" />;
  if (query.isError)
    return (
      <ErrorState title="Unable to load Quality Form version" description={query.error.message} />
    );
  if (!query.data || query.data.status !== 'DRAFT')
    return (
      <EmptyState
        title="Version is read-only"
        description="Published and retired versions are immutable."
        tone="error"
      />
    );
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${query.data.qualityForm.name} v${query.data.versionNumber}`}
        subtitle="Structured, controlled components only. Runtime answers are not stored here."
      />
      <Panel>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            save.mutate();
          }}
        >
          <QualityFormDefinitionEditor sections={sections} onChange={setSections} error={error} />
          <div className="grid gap-4 md:grid-cols-2">
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
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save Definition
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
