import { Check, Circle, CircleDot } from 'lucide-react';
import { cn } from '@erve/primitives';
import { formatDateTime } from './job-order-ui.js';
import type { JobOrderStage } from './types.js';

interface ProductionStageStepperProps {
  stages: JobOrderStage[];
  currentStageId?: string;
  isPreparedQuantitiesUnlocked: boolean;
}

export function ProductionStageStepper({
  stages,
  currentStageId,
  isPreparedQuantitiesUnlocked,
}: ProductionStageStepperProps) {
  if (stages.length === 0) return null;

  return (
    <div className="py-6 overflow-hidden">
      <ol className="flex flex-col md:flex-row w-full gap-8 md:gap-0">
        {stages.map((stage) => {
          const isCompleted = stage.status === 'COMPLETED';
          const isCurrent = stage.id === currentStageId;
          const isUpcoming = !isCompleted && !isCurrent;

          return (
            <li
              key={stage.id}
              className={cn('relative flex flex-col md:flex-1', isUpcoming && 'opacity-60')}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* Connector line for desktop */}
              <div
                className={cn(
                  'hidden md:block absolute top-4 left-[50%] w-full h-[2px]',
                  isCompleted ? 'bg-primary' : 'bg-muted',
                )}
                aria-hidden="true"
              />

              {/* Connector line for mobile */}
              <div
                className={cn(
                  'md:hidden absolute left-[15px] top-[32px] w-[2px] h-[calc(100%+32px)]',
                  isCompleted ? 'bg-primary' : 'bg-muted',
                )}
                aria-hidden="true"
              />

              <div className="flex flex-row md:flex-col items-start md:items-center gap-3 relative z-10 w-full">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                    isCompleted
                      ? 'border-primary text-primary'
                      : isCurrent
                        ? 'border-primary text-primary'
                        : 'border-muted text-muted-foreground',
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : isCurrent ? (
                    <CircleDot className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </div>

                <div className="flex flex-col md:items-center md:text-center mt-1 md:mt-0">
                  <span className="text-sm font-medium">{stage.stageNameSnapshot}</span>

                  {/* Textual state indicator for accessibility */}
                  <span className="sr-only">
                    {isCompleted ? 'Completed' : isCurrent ? 'Current' : 'Upcoming'}
                  </span>

                  {isCompleted && (
                    <div className="mt-1 flex flex-col md:items-center text-xs text-muted-foreground">
                      {formatDateTime(stage.completedAt) && (
                        <span>{formatDateTime(stage.completedAt)}</span>
                      )}
                      {stage.completedBy?.name && <span>by {stage.completedBy.name}</span>}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}

        {/* Final step: Prepared Quantities */}
        <li
          className={cn(
            'relative flex flex-col md:flex-1',
            !isPreparedQuantitiesUnlocked && 'opacity-60',
          )}
        >
          <div className="flex flex-row md:flex-col items-start md:items-center gap-3 relative z-10 w-full">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                isPreparedQuantitiesUnlocked
                  ? 'border-primary text-primary'
                  : 'border-muted text-muted-foreground',
              )}
            >
              {isPreparedQuantitiesUnlocked ? (
                <Check className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>

            <div className="flex flex-col md:items-center md:text-center mt-1 md:mt-0">
              <span className="text-sm font-medium">Prepared Quantities</span>
              <span className="sr-only">
                {isPreparedQuantitiesUnlocked ? 'Unlocked' : 'Locked'}
              </span>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
