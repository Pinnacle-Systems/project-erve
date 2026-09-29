import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { useTheme } from '@erve/theme';
import { cn } from '../lib/utils';

const inputVariants = cva(
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
        compact: 'h-8 px-3 text-xs',
        comfortable: 'h-control px-[var(--erp-control-padding-x)] text-control',
        touch: 'h-11 px-4 text-base',
      },
    },
    defaultVariants: {
      state: 'default',
    },
  },
);

export type TextFieldDensity = NonNullable<VariantProps<typeof inputVariants>['density']>;
export type TextFieldWidth = 'full' | 'fill' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  errorMessage?: ReactNode;
  helpText?: ReactNode;
  density?: TextFieldDensity;
  width?: TextFieldWidth;
  error?: boolean | ReactNode;
  endAdornment?: ReactNode;
}

const fieldWidthClasses: Record<TextFieldWidth, string> = {
  full: 'w-full',
  fill: 'w-[var(--erp-size-intent-fill)]',
  xs: 'w-[var(--erp-control-width-xs)] max-w-full',
  sm: 'w-[var(--erp-control-width-sm)] max-w-full',
  md: 'w-[var(--erp-control-width-md)] max-w-full',
  lg: 'w-[var(--erp-control-width-lg)] max-w-full',
  xl: 'w-[var(--erp-control-width-xl)] max-w-full',
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      className,
      label,
      errorMessage,
      helpText,
      error,
      density,
      width = 'md',
      id,
      endAdornment,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const { densityName } = useTheme();
    const resolvedDensity = density ?? densityName;
    const generatedId = useId();
    const inputId =
      id ??
      (typeof label === 'string' && label.trim().length > 0
        ? `field-${label.toLowerCase().replace(/[^a-z0-9_-]/gi, '-')}`
        : generatedId);
    const hasError = Boolean(error || errorMessage);
    const resolvedError =
      errorMessage ?? (typeof error !== 'boolean' ? error : undefined);
    const resolvedHelpText = !hasError ? helpText : undefined;
    const errorId = `${inputId}-error`;
    const helpId = `${inputId}-help`;

    const describedByIds = [
      resolvedError ? errorId : undefined,
      resolvedHelpText ? helpId : undefined,
      ariaDescribedBy,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    const inputElement = (
      <input
        ref={ref}
        id={inputId}
        data-form-control=""
        className={cn(
          inputVariants({ state: hasError ? 'error' : 'default', density: resolvedDensity }),
          className,
        )}
        aria-invalid={hasError || undefined}
        aria-describedby={describedByIds}
        {...props}
      />
    );

    return (
      <div data-width={width} className={cn('flex flex-col gap-1.5', fieldWidthClasses[width])}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
          >
            {label}
            {props.required && (
              <span className="ml-1 text-danger" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {endAdornment ? (
          <div className="relative">
            {inputElement}
            {endAdornment}
          </div>
        ) : (
          inputElement
        )}
        {resolvedError && (
          <p
            id={errorId}
            className="text-xs text-[var(--erp-form-field-error-text-color)] leading-none"
            role="alert"
          >
            {resolvedError}
          </p>
        )}
        {resolvedHelpText && (
          <p
            id={helpId}
            className="text-xs text-[var(--erp-form-field-help-text-color)] leading-none"
          >
            {resolvedHelpText}
          </p>
        )}
      </div>
    );
  },
);

TextField.displayName = 'TextField';
