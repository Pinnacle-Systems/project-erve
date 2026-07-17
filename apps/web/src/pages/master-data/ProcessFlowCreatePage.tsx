import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlow } from './types.js';
import {
  newDraftStage,
  ProcessStageEditor,
  validateDraftStages,
  type DraftStage,
} from './ProcessStageEditor.js';
import { processFlowErrorMessage } from './process-flow-ui.js';

export function ProcessFlowCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<DraftStage[]>([newDraftStage()]);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const stageError = validateDraftStages(stages, true);
      if (!code.trim()) throw new Error('Process-flow code is required');
      if (!name.trim()) throw new Error('Process-flow name is required');
      if (stageError) throw new Error(stageError);
      const response = await apiClient.post<ApiSuccessResponse<ProcessFlow>>('/process-flows', {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        stages: stages.map((stage) => ({
          name: stage.name.trim(),
          code: stage.code.trim() || null,
        })),
      });
      return response.data.data;
    },
    onSuccess: async (flow) => {
      await queryClient.invalidateQueries({ queryKey: ['process-flows'] });
      navigate(`/master-data/process-flows/${flow.id}?version=${flow.versions[0]!.id}`);
    },
    onError: (caught) => setError(processFlowErrorMessage(caught, 'Unable to create process flow')),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create Process Flow"
        subtitle="Define the flow and author its initial draft version"
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
            setError('');
            mutation.mutate();
          }}
        >
          <FormSection title="Flow Details">
            <FormGrid columns={2}>
              <TextField
                label="Code *"
                value={code}
                maxLength={50}
                width="fill"
                onChange={(event) => setCode(event.target.value)}
              />
              <TextField
                label="Name *"
                value={name}
                maxLength={120}
                width="fill"
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                label="Description"
                value={description}
                width="fill"
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormGrid>
          </FormSection>
          <FormSection title="Initial Stages">
            <ProcessStageEditor
              stages={stages}
              onChange={setStages}
              error={error.includes('stage') || error.includes('Stage') ? error : undefined}
            />
          </FormSection>
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="default" loading={mutation.isPending}>
              Create Draft
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
