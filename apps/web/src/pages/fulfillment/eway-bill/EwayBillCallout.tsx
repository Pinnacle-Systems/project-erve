import type { ReactNode } from 'react';
import { cn } from '@erve/primitives';

type CalloutTone = 'info' | 'warning' | 'danger';

const TONE_CLASSES: Record<CalloutTone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200',
  danger:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200',
};

/** Reserved for real risks: synthetic documents, unverified references, unknown outcomes. */
export function EwayBillCallout({
  tone,
  title,
  children,
  role,
}: {
  tone: CalloutTone;
  title: string;
  children?: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={cn('rounded-lg border p-4', TONE_CLASSES[tone])}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 space-y-1 text-sm">{children}</div>}
    </div>
  );
}
