import type { AuthUser } from '@erve/types';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import type { JobOrder } from '../types.js';
import { getJobOrderRequiredActions } from './job-order-required-actions.js';

export interface JobOrderActionRequiredProps {
  jobOrder: JobOrder;
  user: AuthUser | null | undefined;
  onOpenTab(tab: 'production' | 'quality'): void;
  onOpenForm(path: string): void;
}

export function JobOrderActionRequired({
  jobOrder, user, onOpenTab, onOpenForm,
}: JobOrderActionRequiredProps) {
  const actions = getJobOrderRequiredActions(jobOrder, user);
  if (!actions.length) return null;

  return (
    <section aria-label="Action Required" className="px-6">
      <Panel
        padding="sm"
        title="Action Required"
        description="Eligible work for your role. Open an action to review its details before proceeding."
      >
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="secondary"
              density="compact"
              title={action.detail}
              onClick={() => action.target.kind === 'tab'
                ? onOpenTab(action.target.tab)
                : onOpenForm(action.target.path)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </Panel>
    </section>
  );
}
