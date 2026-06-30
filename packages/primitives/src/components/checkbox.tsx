import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { ValidationMessage } from "./validation-message";

const checkboxVariants = cva(
  "peer shrink-0 rounded-sm border border-[var(--erp-color-primary)] ring-offset-background focus-visible:outline-none focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
  {
    variants: {
      density: {
        compact: "h-3.5 w-3.5",
        comfortable: "h-4 w-4",
        touch: "h-5 w-5",
      },
      error: {
        true: "border-[var(--erp-color-danger)] focus-visible:ring-[var(--erp-color-danger)]",
      },
    },
    defaultVariants: {
      density: "comfortable",
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
        className={cn(checkboxVariants({ density, error: !!error }), className)}
        {...props}
      >
        <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full p-[1px]">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label && !description && !error) {
      return checkbox;
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <div className="mt-[0.125rem]">
            {checkbox}
          </div>
          <div className="grid gap-1.5">
            {label && (
              <label
                htmlFor={id}
                className="text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                {label}
                {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
              </label>
            )}
            {description && (
              <p id={descId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {error && (
          <ValidationMessage id={errorId} tone="error">{error}</ValidationMessage>
        )}
      </div>
    );
  }
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
