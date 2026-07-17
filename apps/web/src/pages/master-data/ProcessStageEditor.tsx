import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { EmptyState } from '@erve/data-display';

export interface DraftStage {
  key: string;
  name: string;
  code: string;
}

let stageKey = 0;

export function newDraftStage(stage?: { name?: string; code?: string | null }): DraftStage {
  stageKey += 1;
  return { key: `stage-${stageKey}`, name: stage?.name ?? '', code: stage?.code ?? '' };
}

export function validateDraftStages(stages: DraftStage[], requireOne: boolean): string {
  if (requireOne && stages.length === 0) return 'Add at least one stage';
  if (stages.some((stage) => !stage.name.trim())) return 'Every stage needs a name';
  if (stages.some((stage) => stage.name.trim().length > 120))
    return 'Stage names cannot exceed 120 characters';
  const names = stages.map((stage) => stage.name.trim().toLocaleLowerCase());
  if (new Set(names).size !== names.length) return 'Stage names must be unique';
  if (stages.some((stage) => stage.code.trim().length > 50))
    return 'Stage codes cannot exceed 50 characters';
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
  const update = (index: number, field: 'name' | 'code', value: string) => {
    onChange(
      stages.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, [field]: value } : stage,
      ),
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
          title="No stages yet"
          description="Add the first production stage to begin authoring this draft."
        />
      ) : (
        <ol className="space-y-3" aria-label="Ordered production stages">
          {stages.map((stage, index) => (
            <li
              key={stage.key}
              className="grid gap-3 rounded-card border border-border-subtle bg-surface-muted p-3 md:grid-cols-[48px_1fr_220px_auto] md:items-start"
            >
              <div
                className="flex h-control items-center justify-center rounded-control bg-surface text-sm font-semibold text-foreground"
                aria-label={`Sequence ${index + 1}`}
              >
                {index + 1}
              </div>
              <TextField
                label={`Stage ${index + 1} name *`}
                value={stage.name}
                maxLength={120}
                width="fill"
                errorMessage={!stage.name.trim() && error ? 'Required' : undefined}
                onChange={(event) => update(index, 'name', event.target.value)}
              />
              <TextField
                label="Code (optional)"
                value={stage.code}
                maxLength={50}
                width="fill"
                onChange={(event) => update(index, 'code', event.target.value)}
              />
              <div className="flex gap-1 md:pt-6">
                <Button
                  type="button"
                  variant="ghost"
                  density="compact"
                  aria-label={`Move ${stage.name || `stage ${index + 1}`} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  density="compact"
                  aria-label={`Move ${stage.name || `stage ${index + 1}`} down`}
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  density="compact"
                  aria-label={`Remove ${stage.name || `stage ${index + 1}`}`}
                  onClick={() => onChange(stages.filter((_, stageIndex) => stageIndex !== index))}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...stages, newDraftStage()])}
      >
        <Plus size={16} />
        Add Stage
      </Button>
    </div>
  );
}
