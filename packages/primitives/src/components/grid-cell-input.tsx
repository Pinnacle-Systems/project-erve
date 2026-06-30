import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface GridCellInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  numeric?: boolean;
}

/**
 * Minimal input for editable grid cells.
 * Renders flat/transparent at rest; shows border on hover and full focus ring on edit.
 * Use `numeric` for right-aligned tabular values (Qty, Rate, Amount).
 */
export const GridCellInput = forwardRef<HTMLInputElement, GridCellInputProps>(
  ({ className, error, numeric = false, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-(--erp-grid-cell-height) w-full bg-transparent text-(length:--erp-font-size-xs) leading-(--erp-line-height-dense) font-sans",
        "rounded-control border border-transparent px-(--erp-grid-cell-padding-x) py-0",
        "text-foreground placeholder:text-muted-foreground",
        "transition-colors duration-150 ease-out",
        "shadow-[inset_0_-1px_0_var(--color-border-subtle)]",
        "hover:border-border-subtle hover:bg-surface-muted hover:shadow-none",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:bg-surface-selected",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        "read-only:shadow-none read-only:bg-transparent read-only:hover:border-transparent read-only:hover:bg-transparent read-only:cursor-default",
        error && "border-danger focus-visible:border-danger focus-visible:ring-danger focus-visible:bg-danger/10",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  ),
);

GridCellInput.displayName = "GridCellInput";
