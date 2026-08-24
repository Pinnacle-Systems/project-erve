import type { QualityProductionContext as QualityProductionContextValue } from '@erve/types';
import { QualityReadOnlyGrid, QualityReadOnlyValue } from './quality-definition-form.js';

const stageStatusLabel = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Complete',
} as const;

const sentenceCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/(^|[_\s-])\S/g, (character) => character.toUpperCase())
    .replaceAll('_', ' ');

export function QualityProductionContext({
  context,
  stageCodes,
}: {
  context: QualityProductionContextValue | null;
  stageCodes?: readonly string[];
}) {
  const configuredCodes = new Set(stageCodes?.filter(Boolean));
  const stages =
    configuredCodes.size > 0
      ? (context?.stages.filter((stage) => stage.code && configuredCodes.has(stage.code)) ?? [])
      : (context?.stages ?? []);

  if (stages.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Production lifecycle context has not been recorded.
      </p>
    );

  return (
    <div data-quality-production-context="true" className="space-y-2">
      <QualityReadOnlyGrid tiles>
        {stages.map((stage) => (
          <QualityReadOnlyValue
            key={stage.id}
            tile
            label={sentenceCase(stage.name)}
            value={
              <>
                {stageStatusLabel[stage.status]}
                {stage.relationship === 'ASSOCIATED' ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Associated Production activity
                  </span>
                ) : null}
              </>
            }
          />
        ))}
      </QualityReadOnlyGrid>
      <p className="text-xs text-muted-foreground">Read-only · Production lifecycle state.</p>
    </div>
  );
}
