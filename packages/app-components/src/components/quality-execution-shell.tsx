import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@erve/primitives';

export const qualityExecutionControlClass =
  'h-control w-full rounded-control border border-[var(--erp-form-field-border)] bg-surface-raised px-[var(--erp-control-padding-x)] text-control text-foreground outline-hidden focus:border-[var(--erp-form-field-focus-border)] focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] disabled:opacity-[var(--erp-disabled-opacity)]';
export const qualityExecutionTextAreaClass = `${qualityExecutionControlClass} min-h-24 py-2`;

export interface QualityExecutionPageShellProps extends HTMLAttributes<HTMLElement> {
  jobOrderId: string;
  jobOrderNumber: string;
}

export function QualityExecutionPageShell({
  jobOrderId,
  jobOrderNumber,
  children,
  className,
  ...props
}: QualityExecutionPageShellProps) {
  return (
    <main
      className={cn('min-h-full bg-background px-4 py-6 sm:px-6 lg:px-8', className)}
      data-quality-execution-shell="true"
      {...props}
    >
      <div className="mx-auto max-w-[90rem] space-y-5">
        <nav aria-label="Quality execution navigation">
          <a
            href={`/job-orders/${jobOrderId}`}
            aria-label={`Back to Job Order ${jobOrderNumber}`}
            className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-control px-1 py-2 text-sm font-semibold text-foreground/80 transition hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-focus-ring)]"
          >
            <span aria-hidden="true" className="shrink-0 text-base leading-none">
              ←
            </span>
            <span className="min-w-0 truncate">Job Order {jobOrderNumber}</span>
          </a>
        </nav>
        {children}
      </div>
    </main>
  );
}

export interface QualityExecutionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  formName: ReactNode;
  versionNumber?: number | string;
  attemptNumber: number;
  status: ReactNode;
  context?: ReactNode;
}

export function QualityExecutionHeader({
  title,
  formName,
  versionNumber,
  attemptNumber,
  status,
  context,
  className,
  ...props
}: QualityExecutionHeaderProps) {
  return (
    <header className={cn('space-y-1', className)} data-quality-execution-header="true" {...props}>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {formName}
        {versionNumber === undefined ? null : ` v${versionNumber}`} · Attempt {attemptNumber} ·{' '}
        <span className="font-medium text-foreground">{status}</span>
      </p>
      {context ? <div className="text-sm text-muted-foreground">{context}</div> : null}
    </header>
  );
}

export interface QualityExecutionSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function QualityExecutionSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: QualityExecutionSectionProps) {
  return (
    <section
      className={cn(
        'space-y-5 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5',
        className,
      )}
      data-quality-execution-section="true"
      {...props}
    >
      {title || description || actions ? (
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-3">
          <div className="space-y-1">
            {title ? <h2 className="text-lg font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface QualityExecutionActionsProps extends HTMLAttributes<HTMLElement> {
  message?: ReactNode;
}

export function QualityExecutionActions({
  message,
  children,
  className,
  ...props
}: QualityExecutionActionsProps) {
  return (
    <footer
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4',
        className,
      )}
      data-quality-execution-actions="true"
      {...props}
    >
      <div>{message}</div>
      <div className="flex flex-wrap justify-end gap-3">{children}</div>
    </footer>
  );
}
