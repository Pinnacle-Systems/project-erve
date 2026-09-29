import { cva } from 'class-variance-authority';
import {
  forwardRef,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { useResolvedDensity } from '../lib/density';
import { cn } from '../lib/utils';
import type { Density } from '@erve/theme';

const textareaVariants = cva(
  [
    'w-full rounded-control border bg-surface-raised font-sans',
    'text-foreground placeholder:text-[var(--erp-color-foreground-subtle)]',
    'transition-colors duration-150 ease-out',
    'focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] focus:ring-offset-[var(--erp-focus-ring-offset)]',
    'disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)] disabled:bg-[var(--erp-form-field-disabled-bg)] disabled:text-[var(--erp-text-disabled)] disabled:border-[var(--erp-border-disabled)]',
    'read-only:bg-[var(--erp-form-field-readonly-bg)] read-only:text-muted-foreground',
  ].join(' '),
  {
    variants: {
      state: {
        default:
          'border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]',
        error:
          'border-[var(--erp-form-field-error-border)] focus:ring-[var(--erp-focus-ring)] focus:border-[var(--erp-form-field-error-border)]',
      },
      density: {
        compact: 'px-2.5 py-1.5 text-xs min-h-16',
        comfortable: 'px-[var(--erp-control-padding-x)] py-2 text-control min-h-20',
        touch: 'px-4 py-2.5 text-base min-h-24',
      },
    },
    defaultVariants: {
      state: 'default',
    },
  },
);

export type TextareaDensity = Density;
export type TextareaWidth = 'full' | 'fill' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type TextareaResize = 'none' | 'vertical' | 'horizontal' | 'both';

const resizeClasses: Record<TextareaResize, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
};

const fieldWidthClasses: Record<TextareaWidth, string> = {
  full: 'w-full',
  fill: 'w-[var(--erp-size-intent-fill)]',
  xs: 'w-[var(--erp-control-width-xs)] max-w-full',
  sm: 'w-[var(--erp-control-width-sm)] max-w-full',
  md: 'w-[var(--erp-control-width-md)] max-w-full',
  lg: 'w-[var(--erp-control-width-lg)] max-w-full',
  xl: 'w-[var(--erp-control-width-xl)] max-w-full',
};

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'> {
  label?: ReactNode;
  errorMessage?: ReactNode;
  helpText?: ReactNode;
  description?: ReactNode;
  density?: TextareaDensity;
  width?: TextareaWidth;
  resize?: TextareaResize;
  error?: boolean | ReactNode;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      containerClassName,
      label,
      errorMessage,
      helpText,
      description,
      error,
      density,
      width = 'full',
      resize = 'vertical',
      id,
      rows = 3,
      required,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const resolvedDensity = useResolvedDensity(density);
    const generatedId = useId();
    const textareaId =
      id ??
      (typeof label === 'string' && label.trim().length > 0
        ? `field-${label.toLowerCase().replace(/[^a-z0-9_-]/gi, '-')}`
        : generatedId);

    const hasError = Boolean(error || errorMessage);
    const resolvedError =
      errorMessage ?? (typeof error !== 'boolean' ? error : undefined);
    const resolvedHelpText = !hasError ? (description ?? helpText) : undefined;

    const errorId = `${textareaId}-error`;
    const helpId = `${textareaId}-help`;

    const describedByIds = [
      resolvedError ? errorId : undefined,
      resolvedHelpText ? helpId : undefined,
      ariaDescribedBy,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div
        data-width={width}
        className={cn('flex flex-col gap-1.5', fieldWidthClasses[width], containerClassName)}
      >
        {label && (
          <label
            htmlFor={textareaId}
            className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
          >
            {label}
            {required && (
              <span className="ml-1 text-danger" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          className={cn(
            textareaVariants({
              state: hasError ? 'error' : 'default',
              density: resolvedDensity,
            }),
            resizeClasses[resize],
            className,
          )}
          aria-invalid={hasError || undefined}
          aria-describedby={describedByIds}
          {...props}
        />
        {resolvedError && (
          <p
            id={errorId}
            className="text-xs text-[var(--erp-form-field-error-text-color)] leading-normal"
            role="alert"
          >
            {resolvedError}
          </p>
        )}
        {resolvedHelpText && (
          <p
            id={helpId}
            className="text-xs text-[var(--erp-form-field-help-text-color)] leading-normal"
          >
            {resolvedHelpText}
          </p>
        )}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
