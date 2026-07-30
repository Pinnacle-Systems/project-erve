import { type ReactNode } from "react";
import {
  TextField,
  Button,
  SelectField,
  SelectItem,
  cn,
} from "@erve/primitives";
import { useTheme, type Density } from "@erve/theme";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  statusOptions?: FilterOption[];
  statusValue?: string;
  onStatusChange?: (value: string) => void;
  dateFrom?: string;
  onDateFromChange?: (value: string) => void;
  dateTo?: string;
  onDateToChange?: (value: string) => void;
  actions?: ReactNode;
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  className?: string;
  density?: Density;
}

export const FilterBar = ({
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  statusOptions,
  statusValue,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  actions,
  onClearFilters,
  hasActiveFilters,
  className,
  density,
}: FilterBarProps) => {
  const { densityName } = useTheme();
  const resolvedDensity = density ?? densityName;
  const showDateFrom = onDateFromChange !== undefined || dateFrom !== undefined;
  const showDateTo = onDateToChange !== undefined || dateTo !== undefined;

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-2 border-b border-border-subtle bg-surface-muted px-4 py-2.5",
        className,
      )}
      data-density={resolvedDensity}
    >
      <TextField
        value={searchValue}
        onChange={(e) => onSearchChange?.(e.target.value)}
        placeholder={searchPlaceholder}
        density={resolvedDensity}
        width="md"
        aria-label="Search"
      />

      {statusOptions && statusOptions.length > 0 && (
        <SelectField
          value={statusValue}
          onValueChange={onStatusChange}
          placeholder="All statuses"
          density={resolvedDensity}
          width="sm"
          aria-label="Status"
        >
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectField>
      )}

      {showDateFrom && (
        <TextField
          type="date"
          value={dateFrom ?? ""}
          onChange={(e) => onDateFromChange?.(e.target.value)}
          density={resolvedDensity}
          width="sm"
          aria-label="From date"
        />
      )}

      {showDateTo && (
        <TextField
          type="date"
          value={dateTo ?? ""}
          onChange={(e) => onDateToChange?.(e.target.value)}
          density={resolvedDensity}
          width="sm"
          aria-label="To date"
        />
      )}

      <div className="flex items-center gap-2 ml-auto">
        {hasActiveFilters && onClearFilters && (
          <Button
            variant="ghost"
            density={resolvedDensity}
            width="hug"
            onClick={onClearFilters}
            type="button"
          >
            Clear filters
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
};

FilterBar.displayName = "FilterBar";
