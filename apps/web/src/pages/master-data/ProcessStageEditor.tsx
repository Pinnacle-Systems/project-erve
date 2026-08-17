import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { EmptyState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlowActivity, QualityForm } from './types.js';

export interface DraftStage {
  key: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  activityType: 'PRODUCTION' | 'QUALITY';
  qualityFormVersionId: string;
  qualityExecutionMode: 'SEQUENTIAL_GATE' | 'IN_PROCESS';
  associatedProductionActivityKey: string;
  qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' | 'PROGRESS_PERCENTAGE';
  progressThresholdPercent: string;
  historicalQualityFormLabel?: string;
}

let stageKey = 0;

export function newDraftStage(stage?: Partial<ProcessFlowActivity>): DraftStage {
  stageKey += 1;
  return {
    key: stage?.id ?? `stage-${stageKey}`,
    name: stage?.name ?? '',
    code: stage?.code ?? '',
    status: stage?.status ?? 'ACTIVE',
    activityType: stage?.activityType ?? 'PRODUCTION',
    qualityFormVersionId: stage?.qualityFormVersionId ?? '',
    qualityExecutionMode: stage?.qualityExecutionMode ?? 'SEQUENTIAL_GATE',
    associatedProductionActivityKey: stage?.associatedProductionActivityId ?? '',
    qualityAvailabilityPolicy:
      stage?.qualityAvailabilityPolicy ?? 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
    progressThresholdPercent: stage?.progressThresholdPercent?.toString() ?? '',
    historicalQualityFormLabel: stage?.qualityFormVersion
      ? `${stage.qualityFormVersion.qualityForm.code} — ${stage.qualityFormVersion.qualityForm.name} — v${stage.qualityFormVersion.versionNumber}`
      : undefined,
  };
}

export function validateDraftStages(stages: DraftStage[], requireOne: boolean): string {
  if (requireOne && stages.length === 0) return 'Add at least one activity';
  if (stages.some((stage) => !stage.name.trim())) return 'Every activity needs a name';
  if (stages.some((stage) => stage.name.trim().length > 120))
    return 'Activity names cannot exceed 120 characters';
  const names = stages.map((stage) => stage.name.trim().toLocaleLowerCase());
  if (new Set(names).size !== names.length) return 'Activity names must be unique';
  if (stages.some((stage) => stage.code.trim().length > 50))
    return 'Activity codes cannot exceed 50 characters';
  for (const stage of stages) {
    if (stage.activityType !== 'QUALITY') continue;
    if (!stage.qualityFormVersionId) return 'Every Quality activity needs a Quality Form version';
    if (stage.qualityExecutionMode === 'IN_PROCESS') {
      const associated = stages.find(
        (candidate) => candidate.key === stage.associatedProductionActivityKey,
      );
      if (!associated || associated.activityType !== 'PRODUCTION')
        return 'Select a Production activity from this version';
      if (stage.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE') {
        const threshold = Number(stage.progressThresholdPercent);
        if (!stage.progressThresholdPercent || threshold <= 0 || threshold > 100)
          return 'Progress threshold must be greater than 0 and no more than 100';
      }
    }
  }
  return '';
}

export function ProcessStageEditor({
  stages,
  onChange,
  error,
}: {
  stages: DraftStage[];
  onChange: (stages: DraftStage[]) => void;
  error?: string;
}) {
  const qualityFormsQuery = useQuery({
    queryKey: ['quality-forms', 'process-flow-selector'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<QualityForm[]>>('/quality-forms');
      return response.data.data;
    },
  });
  const publishedVersions = useMemo(
    () =>
      (qualityFormsQuery.data ?? []).flatMap((form) =>
        form.status === 'ACTIVE'
          ? form.versions
              .filter((version) => version.status === 'PUBLISHED')
              .map((version) => ({
                id: version.id,
                label: `${form.code} — ${form.name} — v${version.versionNumber}`,
              }))
          : [],
      ),
    [qualityFormsQuery.data],
  );

  const update = (index: number, patch: Partial<DraftStage>) => {
    onChange(
      stages.map((stage, stageIndex) => (stageIndex === index ? { ...stage, ...patch } : stage)),
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const reordered = [...stages];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    onChange(reordered);
  };

  return (
    <div className="space-y-3">
      {stages.length === 0 ? (
        <EmptyState
          title="No activities yet"
          description="Add the first Production or Quality activity to begin authoring this draft."
        />
      ) : (
        <ol className="space-y-3" aria-label="Ordered process activities">
          {stages.map((stage, index) => {
            const historicalOption =
              stage.qualityFormVersionId &&
              !publishedVersions.some((version) => version.id === stage.qualityFormVersionId)
                ? {
                    id: stage.qualityFormVersionId,
                    label: `${stage.historicalQualityFormLabel ?? 'Historical Quality Form version'} — RETIRED`,
                  }
                : null;
            return (
              <li
                key={stage.key}
                className="space-y-3 rounded-card border border-border-subtle bg-surface-muted p-3"
              >
                <div className="grid gap-3 md:grid-cols-[48px_180px_1fr_220px_auto] md:items-start">
                  <div
                    className="flex h-control items-center justify-center rounded-control bg-surface text-sm font-semibold text-foreground"
                    aria-label={`Sequence ${index + 1}`}
                  >
                    {index + 1}
                  </div>
                  <SelectField
                    label="Activity Type"
                    value={stage.activityType}
                    onValueChange={(value) =>
                      update(index, {
                        activityType: value as DraftStage['activityType'],
                        qualityFormVersionId: '',
                        associatedProductionActivityKey: '',
                        progressThresholdPercent: '',
                      })
                    }
                    width="fill"
                  >
                    <SelectItem value="PRODUCTION">Production</SelectItem>
                    <SelectItem value="QUALITY">Quality</SelectItem>
                  </SelectField>
                  <TextField
                    label={`Activity ${index + 1} name *`}
                    value={stage.name}
                    maxLength={120}
                    width="fill"
                    errorMessage={!stage.name.trim() && error ? 'Required' : undefined}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                  <TextField
                    label="Code (optional)"
                    value={stage.code}
                    maxLength={50}
                    width="fill"
                    onChange={(event) => update(index, { code: event.target.value })}
                  />
                  <div className="flex gap-1 md:pt-6">
                    <Button
                      type="button"
                      variant="ghost"
                      density="compact"
                      aria-label={`Move ${stage.name || `activity ${index + 1}`} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      density="compact"
                      aria-label={`Move ${stage.name || `activity ${index + 1}`} down`}
                      disabled={index === stages.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      density="compact"
                      aria-label={`Remove ${stage.name || `activity ${index + 1}`}`}
                      onClick={() =>
                        onChange(stages.filter((_, stageIndex) => stageIndex !== index))
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
                {stage.activityType === 'QUALITY' ? (
                  <div className="grid gap-3 border-t border-border-subtle pt-3 md:grid-cols-2 lg:grid-cols-4">
                    <SelectField
                      label="Quality Form version *"
                      value={stage.qualityFormVersionId || undefined}
                      onValueChange={(value) => update(index, { qualityFormVersionId: value })}
                      width="fill"
                    >
                      {historicalOption ? (
                        <SelectItem value={historicalOption.id}>
                          {historicalOption.label}
                        </SelectItem>
                      ) : null}
                      {publishedVersions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.label}
                        </SelectItem>
                      ))}
                    </SelectField>
                    <SelectField
                      label="Execution"
                      value={stage.qualityExecutionMode}
                      onValueChange={(value) =>
                        update(index, {
                          qualityExecutionMode: value as DraftStage['qualityExecutionMode'],
                          associatedProductionActivityKey: '',
                          progressThresholdPercent: '',
                        })
                      }
                      width="fill"
                    >
                      <SelectItem value="SEQUENTIAL_GATE">Sequential gate</SelectItem>
                      <SelectItem value="IN_PROCESS">In-process</SelectItem>
                    </SelectField>
                    {stage.qualityExecutionMode === 'IN_PROCESS' ? (
                      <>
                        <SelectField
                          label="Associated Production Activity *"
                          value={stage.associatedProductionActivityKey || undefined}
                          onValueChange={(value) =>
                            update(index, { associatedProductionActivityKey: value })
                          }
                          width="fill"
                        >
                          {stages
                            .filter((candidate) => candidate.activityType === 'PRODUCTION')
                            .map((candidate) => (
                              <SelectItem key={candidate.key} value={candidate.key}>
                                {candidate.name || 'Unnamed Production activity'}
                              </SelectItem>
                            ))}
                        </SelectField>
                        <SelectField
                          label="Available when"
                          value={stage.qualityAvailabilityPolicy}
                          onValueChange={(value) =>
                            update(index, {
                              qualityAvailabilityPolicy:
                                value as DraftStage['qualityAvailabilityPolicy'],
                              progressThresholdPercent: '',
                            })
                          }
                          width="fill"
                        >
                          <SelectItem value="WHILE_ASSOCIATED_ACTIVITY_ACTIVE">
                            While production activity is active
                          </SelectItem>
                          <SelectItem value="PROGRESS_PERCENTAGE">
                            Production progress percentage
                          </SelectItem>
                        </SelectField>
                        {stage.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE' ? (
                          <TextField
                            label="Progress threshold (%) *"
                            type="number"
                            min="0.01"
                            max="100"
                            value={stage.progressThresholdPercent}
                            width="fill"
                            onChange={(event) =>
                              update(index, { progressThresholdPercent: event.target.value })
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...stages, newDraftStage()])}
      >
        <Plus size={16} /> Add Activity
      </Button>
    </div>
  );
}
