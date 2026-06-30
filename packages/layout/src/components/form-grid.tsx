import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const formGridVariants = cva("grid grid-cols-1", {
  variants: {
    columns: {
      1: "sm:grid-cols-1",
      2: "sm:grid-cols-2",
      3: "sm:grid-cols-2 lg:grid-cols-3",
      4: "sm:grid-cols-2 lg:grid-cols-4",
    },
    gap: {
      sm: "gap-3",
      md: "gap-4 lg:gap-5",
      lg: "gap-6 lg:gap-8",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  compoundVariants: [
    { density: "compact", gap: "md", className: "gap-3 lg:gap-4" },
    { density: "touch", gap: "md", className: "gap-5 lg:gap-6" },
  ],
  defaultVariants: {
    columns: 2,
    gap: "md",
    density: "comfortable",
  },
});

export interface FormGridProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof formGridVariants> {}

export const FormGrid = React.forwardRef<HTMLDivElement, FormGridProps>(
  ({ className, columns, gap, density, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(formGridVariants({ columns, gap, density }), className)}
        {...props}
      />
    );
  }
);
FormGrid.displayName = "FormGrid";
