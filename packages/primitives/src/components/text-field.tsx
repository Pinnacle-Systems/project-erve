import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

const inputVariants = cva(
  [
    "w-full rounded-control border bg-surface-raised font-sans",
    "text-foreground placeholder:text-[var(--erp-color-foreground-subtle)]",
    "transition-colors duration-150 ease-out",
    "focus:outline-none focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] focus:ring-offset-[var(--erp-focus-ring-offset)]",
    "disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)] disabled:bg-[var(--erp-form-field-disabled-bg)] disabled:text-[var(--erp-text-disabled)] disabled:border-[var(--erp-border-disabled)]",
    "read-only:bg-[var(--erp-form-field-readonly-bg)] read-only:text-muted-foreground",
  ].join(" "),
  {
    variants: {
      state: {
        default:
          "border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]",
        error:
          "border-[var(--erp-form-field-error-border)] focus:ring-[var(--erp-focus-ring)] focus:border-[var(--erp-form-field-error-border)]",
      },
      density: {
        compact: "h-8 px-3 text-xs",
        comfortable:
          "h-control px-[var(--erp-control-padding-x)] text-control",
        touch: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      state: "default",
      density: "comfortable",
    },
  },
);

export type TextFieldDensity = NonNullable<
  VariantProps<typeof inputVariants>["density"]
>;
export type TextFieldWidth = "fill" | "xs" | "sm" | "md" | "lg" | "xl";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  errorMessage?: string;
  helpText?: string;
  density?: TextFieldDensity;
  width?: TextFieldWidth;
  error?: boolean;
}

const fieldWidthClasses: Record<TextFieldWidth, string> = {
  fill: "w-[var(--erp-size-intent-fill)]",
  xs: "w-[var(--erp-control-width-xs)] max-w-full",
  sm: "w-[var(--erp-control-width-sm)] max-w-full",
  md: "w-[var(--erp-control-width-md)] max-w-full",
  lg: "w-[var(--erp-control-width-lg)] max-w-full",
  xl: "w-[var(--erp-control-width-xl)] max-w-full",
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      className,
      label,
      errorMessage,
      helpText,
      error,
      density = "comfortable",
      width = "md",
      id,
      ...props
    },
    ref,
  ) => {
    const inputId =
      id ?? (label ? `field-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
    const hasError = Boolean(error || errorMessage);
    const errorId = inputId ? `${inputId}-error` : undefined;
    const helpId = inputId ? `${inputId}-help` : undefined;

    return (
      <div data-width={width} className={cn("flex flex-col gap-1.5", fieldWidthClasses[width])}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            inputVariants({ state: hasError ? "error" : "default", density }),
            className,
          )}
          aria-invalid={hasError || undefined}
          aria-describedby={
            errorMessage ? errorId : helpText ? helpId : undefined
          }
          {...props}
        />
        {errorMessage && (
          <p id={errorId} className="text-xs text-[var(--erp-form-field-error-text-color)] leading-none" role="alert">
            {errorMessage}
          </p>
        )}
        {!errorMessage && helpText && (
          <p id={helpId} className="text-xs text-[var(--erp-form-field-help-text-color)] leading-none">
            {helpText}
          </p>
        )}
      </div>
    );
  },
);

TextField.displayName = "TextField";
