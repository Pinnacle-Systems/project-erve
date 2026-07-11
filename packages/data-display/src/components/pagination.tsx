import { forwardRef } from "react";
import { cn } from "../lib/utils";
import { Button } from "@erve/primitives";


export interface PaginationProps extends React.HTMLAttributes<HTMLDivElement> {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  density?: "compact" | "comfortable" | "touch";
}

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      className,
      page,
      pageSize,
      total,
      pageSizeOptions = [10, 25, 50, 100],
      onPageChange,
      onPageSizeChange,
      density = "comfortable",
      ...props
    },
    ref
  ) => {
    const totalPages = Math.ceil(total / pageSize);
    const hasPrevious = page > 1;
    const hasNext = page < totalPages;
    const startItem = (page - 1) * pageSize + 1;
    const endItem = Math.min(page * pageSize, total);

    return (
      <div
        ref={ref}
        className={cn("flex items-center justify-between px-2 py-3 text-sm text-muted-foreground", className)}
        {...props}
      >
        <div className="flex items-center gap-4">
          <span>
            {total > 0 ? (
              <>
                <span className="font-medium text-foreground">{startItem}</span>–
                <span className="font-medium text-foreground">{endItem}</span> of{" "}
                <span className="font-medium text-foreground">{total}</span>
              </>
            ) : (
              "No results"
            )}
          </span>
          {pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-block">Rows per page:</span>
              <select
                aria-label="Rows per page"
                className="h-8 rounded-[var(--erp-radius-md)] border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)]"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            density="compact"
            disabled={!hasPrevious}
            onClick={() => onPageChange?.(1)}
            aria-label="Go to first page"
            className="hidden sm:flex"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>
          </Button>
          <Button
            variant="ghost"
            density="compact"
            disabled={!hasPrevious}
            onClick={() => onPageChange?.(page - 1)}
            aria-label="Go to previous page"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m15 18-6-6 6-6"/></svg>
          </Button>
          <span className="px-2 text-foreground font-medium text-sm">
            {page} / {Math.max(1, totalPages)}
          </span>
          <Button
            variant="ghost"
            density="compact"
            disabled={!hasNext}
            onClick={() => onPageChange?.(page + 1)}
            aria-label="Go to next page"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m9 18 6-6-6-6"/></svg>
          </Button>
          <Button
            variant="ghost"
            density="compact"
            disabled={!hasNext}
            onClick={() => onPageChange?.(totalPages)}
            aria-label="Go to last page"
            className="hidden sm:flex"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>
          </Button>
        </div>
      </div>
    );
  }
);
Pagination.displayName = "Pagination";
