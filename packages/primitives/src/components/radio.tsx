import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Density } from "@erve/theme";
import { cn } from "../lib/utils";
import { DensityOverrideProvider, useResolvedDensity } from "../lib/density";
import { ValidationMessage } from "./validation-message";

const radioVariants = cva(
  "group inline-flex shrink-0 items-center justify-center rounded-full text-primary ring-offset-background focus:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:cursor-not-allowed disabled:opacity-50",
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

export interface RadioGroupProps
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  density?: Density;
}

export const RadioGroup = forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, RadioGroupProps>(
  ({ className, orientation = "vertical", label, description, error, required, density, children, ...props }, ref) => {
    const resolvedDensity = useResolvedDensity(density);
    return (
      <div className="flex flex-col gap-3">
        {(label || description) && (
          <div className="flex flex-col gap-1.5">
            {label && (
              <label className="text-sm font-semibold text-foreground">
                {label}
                {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
              </label>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        <DensityOverrideProvider density={resolvedDensity}>
          <RadioGroupPrimitive.Root
            ref={ref}
            orientation={orientation}
            data-density={resolvedDensity}
            className={cn(
              "flex",
              orientation === "vertical" ? "flex-col gap-2" : "flex-row flex-wrap gap-4",
              className
            )}
            {...props}
          >
            {children}
          </RadioGroupPrimitive.Root>
        </DensityOverrideProvider>
        {error && (
          <ValidationMessage tone="error">{error}</ValidationMessage>
        )}
      </div>
    );
  }
);
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

export interface RadioProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "error">,
    Omit<VariantProps<typeof radioVariants>, "error"> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export const Radio = forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, RadioProps>(
  ({ className, density, error, label, description, id, ...props }, ref) => {
    const resolvedDensity = useResolvedDensity(density ?? undefined);
    const radio = (
      <RadioGroupPrimitive.Item
        ref={ref}
        id={id}
        data-density={resolvedDensity}
        className={cn(radioVariants({ density: resolvedDensity, error: !!error }), className)}
        {...props}
      >
        <span className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-[var(--erp-color-primary)]",
          resolvedDensity === "compact" && "h-3.5 w-3.5",
          resolvedDensity === "comfortable" && "h-4 w-4",
          resolvedDensity === "touch" && "h-5 w-5",
          error && "border-[var(--erp-color-danger)]",
        )}>
          <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current text-current" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </RadioGroupPrimitive.Indicator>
        </span>
      </RadioGroupPrimitive.Item>
    );

    if (!label && !description) {
      return radio;
    }

    return (
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
        <div className={cn("flex items-center", resolvedDensity !== "touch" && "h-5 pt-[0.125rem]")}>
          {radio}
        </div>
        <div className="grid gap-1 leading-none">
          {label && (
            <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              {label}
            </span>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </label>
    );
  }
);
Radio.displayName = RadioGroupPrimitive.Item.displayName;
