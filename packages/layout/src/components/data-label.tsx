import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const dataLabelVariants = cva("flex", {
  variants: {
    orientation: {
      vertical: "flex-col gap-1",
      horizontal: "flex-row items-baseline gap-2",
    },
    emphasis: {
      default: "",
      strong: "",
      muted: "",
    },
  },
  defaultVariants: {
    orientation: "vertical",
    emphasis: "default",
  },
});

const labelVariants = cva("text-label text-muted-foreground", {
  variants: {
    emphasis: {
      default: "",
      strong: "font-medium text-foreground",
      muted: "text-[var(--erp-color-foreground-subtle)]",
    },
  },
  defaultVariants: {
    emphasis: "default",
  },
});

const valueVariants = cva("text-data text-foreground", {
  variants: {
    emphasis: {
      default: "font-medium",
      strong: "font-semibold",
      muted: "font-normal",
    },
  },
  defaultVariants: {
    emphasis: "default",
  },
});

export interface DataLabelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dataLabelVariants> {
  label: React.ReactNode;
  value?: React.ReactNode;
  emptyValue?: React.ReactNode;
}

export const DataLabel = React.forwardRef<HTMLDivElement, DataLabelProps>(
  (
    {
      className,
      orientation,
      emphasis,
      label,
      value,
      emptyValue = "—",
      ...props
    },
    ref
  ) => {
    const displayValue = value === undefined || value === null || value === "" ? emptyValue : value;

    return (
      <div
        ref={ref}
        className={cn(dataLabelVariants({ orientation, emphasis }), className)}
        {...props}
      >
        <div className={cn(labelVariants({ emphasis }))}>{label}</div>
        <div className={cn(valueVariants({ emphasis }), "break-words")}>
          {displayValue}
        </div>
      </div>
    );
  }
);
DataLabel.displayName = "DataLabel";
