import { forwardRef, type ReactNode } from "react";

import { TextField } from "@erve/primitives";
import { cn } from "../lib/utils";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
  children?: ReactNode;
  density?: "compact" | "comfortable" | "touch";
}

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(
  (
    {
      className,
      searchValue,
      onSearchChange,
      searchPlaceholder = "Search...",
      actions,
      children,
      density = "comfortable",
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
          density === "compact" ? "p-3" : "p-4",
          className
        )}
        {...props}
      >
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative">
            <TextField
              type="search"
              width="fill"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              density={density}
              className="pl-9"
              aria-label="Search"
            />
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
          </div>
          {children && (
            <div className="flex flex-wrap items-end gap-3">
              {children}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            {actions}
          </div>
        )}
      </div>
    );
  }
);
FilterBar.displayName = "FilterBar";
