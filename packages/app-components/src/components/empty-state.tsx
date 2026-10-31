import { forwardRef, type ReactNode } from 'react';
import { cn } from '@erve/primitives';

export type EmptyStateDensity = 'compact' | 'comfortable' | 'touch';
export type EmptyStateTone = 'default' | 'search' | 'error' | 'permission';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  /**
   * UX-11: legacy Data Display presentation uses the same component implementation
   * through an adapter, without changing existing typography, spacing or action layout.
   * New application screens should use the default app presentation.
   */
  presentation?: 'app' | 'data-display';
  density?: EmptyStateDensity | null;
  tone?: EmptyStateTone | null;
  action?: ReactNode;
}

/** Canonical EmptyState for both app-components and data-display (UX-11).
 * The adapter preserves its existing API; avoid silently changing current screens.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  className,
  presentation = 'app',
  density = 'comfortable',
  tone = 'default',
  action,
}, ref) => {
  if (presentation === 'data-display') {
    const densityClass = density === 'compact'
      ? 'gap-2 py-6'
      : density === 'touch' ? 'gap-6 py-16' : 'gap-4 py-12';
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center justify-center text-center p-6',
          densityClass,
          tone === 'error' ? 'text-danger'
            : tone === 'permission' ? 'text-warning' : 'text-muted-foreground',
          className,
        )}
      >
        <div className="flex flex-col gap-1.5 items-center">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {description && (
            <p className={cn('text-sm', tone === 'error' ? 'text-danger' : 'text-muted-foreground')}>
              {description}
            </p>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }

  // Original app-components presentation, intentionally unchanged.
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 px-6 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-card bg-[var(--erp-color-primary-soft)] text-[var(--erp-text-accent)]">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
        )}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
});
EmptyState.displayName = 'EmptyState';
