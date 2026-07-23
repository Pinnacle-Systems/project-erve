import * as SwitchPrimitives from "@radix-ui/react-switch";
import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { useTheme } from "@erve/theme";
import { cn } from "../lib/utils";
import { ValidationMessage } from "./validation-message";

const switchVariants = cva(
  "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)] focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--erp-surface-muted)]",
  {
    variants: {
      density: {
        compact: "h-4 w-7",
        comfortable: "h-5 w-9",
        touch: "h-6 w-11",
      },
    },
  }
);

const thumbVariants = cva(
  "pointer-events-none block rounded-full bg-surface-raised shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0",
  {
    variants: {
      density: {
        compact: "h-3 w-3 data-[state=checked]:translate-x-3",
        comfortable: "h-4 w-4 data-[state=checked]:translate-x-4",
        touch: "h-5 w-5 data-[state=checked]:translate-x-5",
      },
    },
  }
);

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, density, error, label, description, id, ...props }, ref) => {
    const { densityName } = useTheme();
    const resolvedDensity = density ?? densityName;
    const errorId = error && id ? `${id}-error` : undefined;
    const descId = description && id ? `${id}-description` : undefined;
    const ariaDescribedBy = [errorId, descId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;

    const switchNode = (
      <SwitchPrimitives.Root
        ref={ref}
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={!!error}
        className={cn(switchVariants({ density: resolvedDensity }), className)}
        {...props}
      >
        <SwitchPrimitives.Thumb className={cn(thumbVariants({ density: resolvedDensity }))} />
      </SwitchPrimitives.Root>
    );

    if (!label && !description && !error) {
      return switchNode;
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {switchNode}
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
Switch.displayName = SwitchPrimitives.Root.displayName;
