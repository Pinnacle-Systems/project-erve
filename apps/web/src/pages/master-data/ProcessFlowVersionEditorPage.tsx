import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { FormSection, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlowVersion } from './types.js';
import {
  newDraftStage,
  ProcessStageEditor,
  validateDraftStages,
  type DraftStage,
} from './ProcessStageEditor.js';
import { processFlowErrorMessage } from './process-flow-ui.js';

export function ProcessFlowVersionEditorPage() {
  const { versionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [initialSignature, setInitialSignature] = useState('');
  const [error, setError] = useState('');

  const versionQuery = useQuery({
    queryKey: ['process-flow-version', versionId],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flow-versions/${versionId}`,
      );
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!versionQuery.data) return;
    const hydrated = versionQuery.data.stages.map((stage) => newDraftStage(stage));
    // Hydrates the editor once the selected version has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStages(hydrated);
    setInitialSignature(JSON.stringify(hydrated.map(({ name, code }) => ({ name, code }))));
  }, [versionQuery.data]);

  const signature = useMemo(
    () => JSON.stringify(stages.map(({ name, code }) => ({ name, code }))),
    [stages],
  );
  const dirty = Boolean(versionQuery.data) && signature !== initialSignature;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const back = () => {
    if (dirty && !window.confirm('Discard unsaved stage changes?')) return;
    navigate(`/master-data/process-flows/${versionQuery.data!.processFlowId}?version=${versionId}`);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const validationError = validateDraftStages(stages, false);
      if (validationError) throw new Error(validationError);
      const response = await apiClient.put<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flow-versions/${versionId}/stages`,
        {
          stages: stages.map((stage) => ({
            name: stage.name.trim(),
            code: stage.code.trim() || null,
          })),
        },
      );
      return response.data.data;
    },
    onSuccess: async (version) => {
      await queryClient.invalidateQueries({ queryKey: ['process-flow', version.processFlowId] });
      await queryClient.invalidateQueries({ queryKey: ['process-flow-version', version.id] });
      navigate(`/master-data/process-flows/${version.processFlowId}?version=${version.id}`);
    },
    onError: (caught) => setError(processFlowErrorMessage(caught, 'Unable to save draft stages')),
  });

  if (versionQuery.isLoading) return <LoadingState label="Loading draft version" />;
  if (versionQuery.isError) {
    return (
      <ErrorState
        title="Unable to load draft version"
        description={versionQuery.error.message}
        action={<Button onClick={() => void versionQuery.refetch()}>Retry</Button>}
      />
    );
  }
  if (!versionQuery.data)
    return (
      <EmptyState
        title="Version not found"
        description="The selected process-flow version could not be loaded."
        tone="error"
      />
    );
  if (versionQuery.data.status !== 'DRAFT') {
    return (
      <EmptyState
        title="Version is read-only"
        description="Active and retired versions are immutable. Create a new version to make changes."
        tone="error"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${versionQuery.data.processFlowName} v${versionQuery.data.versionNumber}`}
        subtitle="Changes remain in draft until this version is activated"
        status={<StatusBadge label="DRAFT" tone="pending" />}
        secondaryActions={
          <Button type="button" variant="secondary" onClick={back}>
            Cancel
          </Button>
        }
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
          <FormSection title="Ordered Stages">
            <ProcessStageEditor stages={stages} onChange={setStages} error={error} />
          </FormSection>
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={back}>
              Cancel
            </Button>
            <Button type="submit" variant="default" loading={mutation.isPending} disabled={!dirty}>
              Save Stages
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
