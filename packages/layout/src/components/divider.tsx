import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const dividerVariants = cva("shrink-0", {
  variants: {
    orientation: {
      horizontal: "w-full h-px",
      vertical: "h-full w-px",
    },
    variant: {
      default: "bg-border",
      subtle: "bg-border-subtle",
      strong: "bg-[var(--erp-color-border-strong)]",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
    variant: "default",
  },
});

export interface DividerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dividerVariants> {}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ className, orientation, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
        className={cn(dividerVariants({ orientation, variant }), className)}
        {...props}
      />
    );
  }
);
Divider.displayName = "Divider";
