import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { ValidationMessage } from "./validation-message";

const radioVariants = cva(
  "aspect-square rounded-full border border-[var(--erp-color-primary)] text-primary ring-offset-background focus:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] disabled:cursor-not-allowed disabled:opacity-50",
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

export interface RadioGroupProps
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  density?: "compact" | "comfortable" | "touch";
}

export const RadioGroup = forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, RadioGroupProps>(
  ({ className, orientation = "vertical", label, description, error, required, density = "comfortable", children, ...props }, ref) => {
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
        <RadioGroupPrimitive.Root
          ref={ref}
          orientation={orientation}
          className={cn(
            "flex",
            orientation === "vertical" ? "flex-col gap-2" : "flex-row flex-wrap gap-4",
            className
          )}
          {...props}
        >
          {children}
        </RadioGroupPrimitive.Root>
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
    const radio = (
      <RadioGroupPrimitive.Item
        ref={ref}
        id={id}
        className={cn(radioVariants({ density, error: !!error }), className)}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current text-current">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    );

    if (!label && !description) {
      return radio;
    }

    return (
      <div className="flex items-start gap-2">
        <div className="flex items-center h-5 pt-[0.125rem]">
          {radio}
        </div>
        <div className="grid gap-1 leading-none">
          {label && (
            <label
              htmlFor={id}
              className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {label}
            </label>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    );
  }
);
Radio.displayName = RadioGroupPrimitive.Item.displayName;
