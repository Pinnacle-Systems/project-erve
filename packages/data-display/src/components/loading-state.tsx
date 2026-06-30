import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { Skeleton, SkeletonCard } from "@erve/primitives";

const loadingStateVariants = cva(
  "flex items-center justify-center w-full",
  {
    variants: {
      density: {
        compact: "p-4",
        comfortable: "p-8",
        touch: "p-12",
      },
    },
    defaultVariants: {
      density: "comfortable",
    },
  }
);

export interface LoadingStateProps extends VariantProps<typeof loadingStateVariants> {
  label?: ReactNode;
  variant?: "spinner" | "skeleton" | "rows";
  rows?: number;
  className?: string;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, density, label = "Loading...", variant = "spinner", rows = 3, ...props }, ref) => {
    // "rows" — full-width bar per row, for table/list contexts
    if (variant === "rows") {
      const rowWidths = ["74%", "58%", "67%", "49%", "63%", "42%"];
      return (
        <div ref={ref} className={cn("flex flex-col gap-2 w-full", className)} {...props}>
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-5"
              style={{ width: rowWidths[i % rowWidths.length] }}
            />
          ))}
          <span className="sr-only">{label}</span>
        </div>
      );
    }

    // "skeleton" — paired text rows for general content (panels, cards, forms)
    if (variant === "skeleton") {
      return (
        <div ref={ref} className={cn("w-full p-4", className)} {...props}>
          <SkeletonCard rows={rows} />
          <span className="sr-only">{label}</span>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(loadingStateVariants({ density }), className)}
        role="status"
        aria-label={typeof label === "string" ? label : "Loading"}
        {...props}
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <svg
            className="h-6 w-6 animate-spin text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {label && <span className="text-sm font-medium">{label}</span>}
        </div>
      </div>
    );
  }
);
LoadingState.displayName = "LoadingState";
