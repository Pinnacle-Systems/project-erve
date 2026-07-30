import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { useResolvedDensity } from "../lib/density";
import { ValidationMessage } from "./validation-message";

const checkboxVariants = cva(
  "peer group inline-flex shrink-0 items-center justify-center rounded-xs ring-offset-background focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      density: {
        compact: "h-3.5 w-3.5",
        comfortable: "h-4 w-4",
        touch: "h-11 w-11",
      },
      error: {
        true: "focus-visible:ring-[var(--erp-color-danger)]",
      },
    },
  }
);

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "error">,
    Omit<VariantProps<typeof checkboxVariants>, "error"> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export const Checkbox = forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, density, error, label, description, required, id, ...props }, ref) => {
    const resolvedDensity = useResolvedDensity(density ?? undefined);
    const errorId = error && id ? `${id}-error` : undefined;
    const descId = description && id ? `${id}-description` : undefined;
    const ariaDescribedBy = [errorId, descId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;

    const checkbox = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={id}
        required={required}
        aria-describedby={ariaDescribedBy}
        aria-invalid={!!error}
        data-density={resolvedDensity}
        className={cn(checkboxVariants({ density: resolvedDensity, error: !!error }), className)}
        {...props}
      >
        <span className={cn(
          "flex shrink-0 items-center justify-center rounded-xs border border-[var(--erp-color-primary)] group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground",
          resolvedDensity === "compact" && "h-3.5 w-3.5",
          resolvedDensity === "comfortable" && "h-4 w-4",
          resolvedDensity === "touch" && "h-5 w-5",
          error && "border-[var(--erp-color-danger)]",
        )}>
          <CheckboxPrimitive.Indicator className="flex h-full w-full items-center justify-center text-current">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full p-[1px]" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </CheckboxPrimitive.Indicator>
        </span>
      </CheckboxPrimitive.Root>
    );

    if (!label && !description && !error) {
      return checkbox;
    }

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
          <div className={cn(resolvedDensity !== "touch" && "mt-[0.125rem]")}>
            {checkbox}
          </div>
          <div className="grid gap-1.5">
            {label && (
              <span className="text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {label}
                {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
              </span>
            )}
            {description && (
              <p id={descId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </label>
        {error && (
          <ValidationMessage id={errorId} tone="error">{error}</ValidationMessage>
        )}
      </div>
    );
  }
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
