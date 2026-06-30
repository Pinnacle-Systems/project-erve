import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const cardVariants = cva("rounded-card border bg-surface", {
  variants: {
    variant: {
      default: "border-border shadow-card",
      subtle: "border-border-subtle shadow-none bg-surface-muted",
      elevated: "border-border shadow-panel",
    },
    padding: {
      none: "p-0",
      sm: "p-3",
      md: "p-5",
      lg: "p-8",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  compoundVariants: [
    { density: "compact", padding: "sm", className: "p-2" },
    { density: "compact", padding: "md", className: "p-4" },
    { density: "compact", padding: "lg", className: "p-6" },
    { density: "touch", padding: "sm", className: "p-4" },
    { density: "touch", padding: "md", className: "p-6" },
    { density: "touch", padding: "lg", className: "p-10" },
  ],
  defaultVariants: {
    variant: "default",
    padding: "md",
    density: "comfortable",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  as?: React.ElementType;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, density, as: Comp = "div", ...props }, ref) => {
    return (
      <Comp
        ref={ref}
        className={cn(cardVariants({ variant, padding, density }), className)}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";
