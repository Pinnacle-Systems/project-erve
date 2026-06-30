import { forwardRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  accessor?: keyof T | ((row: T) => ReactNode);
  render?: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> extends Omit<React.TableHTMLAttributes<HTMLTableElement>, "data"> {
  columns: ColumnDef<T>[];
  data: T[];
  rowKey?: Extract<keyof T, string> | ((row: T) => string);
  density?: "compact" | "comfortable" | "touch";
  variant?: "default" | "bordered" | "striped";
  emptyState?: ReactNode;
  loading?: boolean;
  loadingState?: ReactNode;
  error?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string;
  containerClassName?: string;
}

// React component generic types with forwardRef are slightly tricky.
// We use a type assertion trick to keep the generic parameters.
const DataTableInner = <T extends Record<string, unknown>>(
  {
    className,
    containerClassName,
    columns,
    data,
    rowKey = "id" as Extract<keyof T, string>,
    density = "comfortable",
    variant = "default",
    emptyState,
    loading,
    loadingState,
    error,
    onRowClick,
    selectedRowKey,
    ...props
  }: DataTableProps<T>,
  ref: React.Ref<HTMLTableElement>
) => {
  const resolveRowKey = (row: T): string => {
    if (typeof rowKey === "function") {
      return rowKey(row);
    }
    return String(row[rowKey]);
  };

  const renderCell = (row: T, col: ColumnDef<T>) => {
    if (col.render) {
      return col.render(row);
    }
    if (typeof col.accessor === "function") {
      return col.accessor(row);
    }
    if (col.accessor) {
      return row[col.accessor] as ReactNode;
    }
    return row[col.key as keyof T] as ReactNode;
  };

  if (error) {
    return <div className="p-4">{error}</div>;
  }

  if (loading && (!data || data.length === 0)) {
    return <div className="p-4">{loadingState}</div>;
  }

  if ((!data || data.length === 0) && emptyState) {
    return <div className="p-4">{emptyState}</div>;
  }

  const isClickable = !!onRowClick;

  return (
    <div className={cn("w-full overflow-auto rounded-panel border border-border bg-surface shadow-sm", containerClassName)}>
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      >
        <thead className="bg-surface-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 text-left font-medium",
                  density === "compact" ? "py-2" : density === "touch" ? "py-4" : "py-3",
                  col.align === "center" && "text-center",
                  col.align === "right" && "text-right",
                  variant === "bordered" && "border-x border-border first:border-l-0 last:border-r-0",
                  col.width && `w-[${col.width}]`,
                  col.headerClassName
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle bg-surface text-data">
          {data.map((row) => {
            const rKey = resolveRowKey(row);
            const isSelected = selectedRowKey === rKey;
            
            return (
              <tr
                key={rKey}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(e) => {
                  if (isClickable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onRowClick?.(row);
                  }
                }}
                tabIndex={isClickable ? 0 : undefined}
                className={cn(
                  "transition-colors",
                  isClickable && "cursor-pointer hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-inset",
                  variant === "striped" && "even:bg-surface-muted",
                  isSelected && "bg-surface-raised"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]",
                      density === "compact" ? "py-2" : density === "touch" ? "py-4" : "py-3",
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right tabular-nums",
                      variant === "bordered" && "border-x border-border first:border-l-0 last:border-r-0",
                      col.className
                    )}
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const DataTable = forwardRef(DataTableInner) as <T>(
  props: DataTableProps<T> & { ref?: React.Ref<HTMLTableElement> }
) => ReturnType<typeof DataTableInner>;
// Casting forwardRef is needed for generics: https://fettblog.eu/typescript-react-generic-forward-refs/
