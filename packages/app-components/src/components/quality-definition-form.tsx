import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@erve/primitives';

export interface QualityDefinitionComponentProps extends Omit<
  HTMLAttributes<HTMLFieldSetElement>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

export function QualityDefinitionComponent({
  title,
  description,
  required,
  disabled,
  readOnly,
  children,
  className,
  ...props
}: QualityDefinitionComponentProps) {
  return (
    <fieldset
      disabled={disabled}
      aria-readonly={readOnly || undefined}
      data-quality-definition-component="true"
      data-read-only={readOnly || undefined}
      className={cn('min-w-0 space-y-3', className)}
      {...props}
    >
      <legend className="mb-2 text-sm font-semibold text-foreground">
        {title}
        {required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </fieldset>
  );
}

export interface QualityFieldGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3;
}

export function QualityFieldGrid({
  columns = 3,
  children,
  className,
  ...props
}: QualityFieldGridProps) {
  return (
    <div
      data-quality-field-grid="true"
      className={cn(
        'grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface QualityReadOnlyGridProps extends HTMLAttributes<HTMLDListElement> {
  columns?: 2 | 3;
  tiles?: boolean;
}

export function QualityReadOnlyGrid({
  columns = 3,
  tiles = false,
  children,
  className,
  ...props
}: QualityReadOnlyGridProps) {
  return (
    <dl
      data-quality-read-only-grid="true"
      data-tiles={tiles || undefined}
      className={cn(
        'grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className,
      )}
      {...props}
    >
      {children}
    </dl>
  );
}

export interface QualityReadOnlyValueProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value?: ReactNode;
  emptyLabel?: ReactNode;
  tile?: boolean;
}

export function QualityReadOnlyValue({
  label,
  value,
  emptyLabel = '\u2014',
  tile = false,
  className,
  ...props
}: QualityReadOnlyValueProps) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div
      data-quality-read-only-value="true"
      className={cn('min-w-0', tile && 'rounded-md bg-surface-muted px-3 py-2', className)}
      {...props}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 break-words text-sm font-medium',
          hasValue ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {hasValue ? value : emptyLabel}
      </dd>
    </div>
  );
}

export type QualityRepeatingListProps = HTMLAttributes<HTMLDivElement>;

export function QualityRepeatingList({ children, className, ...props }: QualityRepeatingListProps) {
  return (
    <div data-quality-repeating-list="true" className={cn('space-y-2', className)} {...props}>
      {children}
    </div>
  );
}

export interface QualityRepeatingRowProps extends HTMLAttributes<HTMLDivElement> {
  rowNumber?: number;
}

export function QualityRepeatingRow({
  rowNumber,
  children,
  className,
  ...props
}: QualityRepeatingRowProps) {
  return (
    <div
      data-quality-repeating-row="true"
      className={cn('rounded-md border border-border-subtle bg-surface-muted p-3', className)}
      {...props}
    >
      {rowNumber === undefined ? null : (
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Item {rowNumber}</p>
      )}
      {children}
    </div>
  );
}

export function formatQualityDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
