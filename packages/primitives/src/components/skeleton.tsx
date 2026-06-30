import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

// Base shimmer bar — controls size via className (h-*, w-*)
export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("erp-skeleton", className)}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

// Non-animating subordinate bar — use for secondary/metadata lines
export const SkeletonSubtle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("erp-skeleton-subtle", className)}
      {...props}
    />
  ),
);
SkeletonSubtle.displayName = "SkeletonSubtle";

// Paired primary + subtle row that mimics a label/value pair in text content
export interface SkeletonTextRowProps extends HTMLAttributes<HTMLDivElement> {
  primaryWidth?: string;
  subtleWidth?: string;
}

export const SkeletonTextRow = forwardRef<HTMLDivElement, SkeletonTextRowProps>(
  ({ className, primaryWidth = "68%", subtleWidth = "44%", ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props}>
      <Skeleton className="h-3" style={{ width: primaryWidth }} />
      <SkeletonSubtle className="h-2" style={{ width: subtleWidth }} />
    </div>
  ),
);
SkeletonTextRow.displayName = "SkeletonTextRow";

// Table/list row — slightly taller to match row density in grids
export interface SkeletonTableRowProps extends HTMLAttributes<HTMLDivElement> {
  columns?: number;
  rowIndex?: number;
}

export const SkeletonTableRow = forwardRef<HTMLDivElement, SkeletonTableRowProps>(
  ({ className, columns = 4, rowIndex = 0, style, ...props }, ref) => {
    const fallbackWidths = ["58%", "76%", "64%", "48%", "54%", "42%"];
    const widthRows = [
      fallbackWidths,
      ["52%", "68%", "70%", "56%", "48%", "46%"],
      ["64%", "72%", "58%", "52%", "60%", "40%"],
    ];
    const widths = widthRows[rowIndex % widthRows.length] ?? fallbackWidths;
    return (
      <div
        ref={ref}
        className={cn("grid items-center gap-4", className)}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, ...style }}
        {...props}
      >
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton
            key={i}
            className="h-3.5"
            style={{ width: widths[i % widths.length] ?? fallbackWidths[0] }}
          />
        ))}
      </div>
    );
  },
);
SkeletonTableRow.displayName = "SkeletonTableRow";

// Card/content block — stacked text rows with configurable count
export interface SkeletonCardProps extends HTMLAttributes<HTMLDivElement> {
  rows?: number;
}

export const SkeletonCard = forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ className, rows = 3, ...props }, ref) => {
    const primaryWidths = ["75%", "63%", "82%", "57%", "70%"];
    const subtleWidths  = ["55%", "47%", "60%", "38%", "50%"];
    return (
      <div ref={ref} className={cn("flex flex-col gap-3.5", className)} {...props}>
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonTextRow
            key={i}
            primaryWidth={primaryWidths[i % primaryWidths.length]}
            subtleWidth={subtleWidths[i % subtleWidths.length]}
          />
        ))}
      </div>
    );
  },
);
SkeletonCard.displayName = "SkeletonCard";
