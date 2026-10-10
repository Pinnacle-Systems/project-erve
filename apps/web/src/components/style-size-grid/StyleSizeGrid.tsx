import type { ReactNode } from 'react';
import { cn, GridCellInput, NumericField, toFiniteNumber } from '@erve/primitives';
import { createEnterToNextHandler } from '@erve/app-components';
import { StyleThumbnailCell } from '../style/StyleThumbnailCell.js';
import type { StyleSizeGridColumn, StyleSizeGridRow, StyleSizeGridVariant } from './types.js';

export interface StyleSizeGridProps {
  columns: StyleSizeGridColumn[];
  rows: StyleSizeGridRow[];
  variant: StyleSizeGridVariant;
  /** Required when variant === 'editable'. Never called for 'computed'/'readOnly' grids — there is nothing to edit. */
  onCellChange?: (styleId: string, sizeId: string, value: number | null) => void;
  min?: number;
  max?: number;
  showRowTotals?: boolean;
  showColumnTotals?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
}

/**
 * The shared Style(rows) x Size(columns) quantity engine — see the Style &
 * Masters workstream plan's "thin-wrapper pattern": screens with their own
 * domain needs (Order Sheet, Job Order, Dispatch Order) wrap this in a small
 * configured component rather than every screen reaching for this generic
 * signature directly.
 *
 * Reuses `createEnterToNextHandler()` (`@erve/app-components`) on the grid
 * container — every editable cell already sets `data-form-control` via
 * `NumericField`/`GridCellInput`, so Enter-to-Tab works with no extra wiring.
 */
export function StyleSizeGrid({
  columns,
  rows,
  variant,
  onCellChange,
  min = 0,
  max,
  showRowTotals = true,
  showColumnTotals = true,
  emptyMessage = 'No styles to display.',
  className,
}: StyleSizeGridProps) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  const rowTotal = (row: StyleSizeGridRow) =>
    columns.reduce((sum, column) => sum + toFiniteNumber(row.values[column.sizeId]), 0);

  const columnTotal = (column: StyleSizeGridColumn) =>
    rows.reduce((sum, row) => sum + toFiniteNumber(row.values[column.sizeId]), 0);

  return (
    <div className={cn('overflow-x-auto', className)} onKeyDown={createEnterToNextHandler()}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
            <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-left">Style</th>
            {columns.map((column) => (
              <th key={column.sizeId} className="px-2 py-2 text-right">
                {column.sizeCode}
              </th>
            ))}
            {showRowTotals && <th className="px-2 py-2 text-right">Total</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <tr key={row.styleId}>
              <td className="sticky left-0 z-10 bg-surface px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <StyleThumbnailCell styleId={row.styleId} image={row.primaryImage ?? null} size={32} viewerTitle={row.styleNumber} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{row.styleNumber}</div>
                    {row.styleName && (
                      <div className="truncate text-xs text-muted-foreground">{row.styleName}</div>
                    )}
                  </div>
                </div>
              </td>
              {columns.map((column) => {
                const value = row.values[column.sizeId] ?? null;
                const hasCell = column.sizeId in row.values;
                return (
                  <td key={column.sizeId} className="px-2 py-1.5">
                    {!hasCell ? (
                      <span className="block text-right text-muted-foreground">—</span>
                    ) : variant === 'editable' ? (
                      <NumericField
                        variant="cell"
                        mode="integer"
                        min={min}
                        max={max}
                        value={value}
                        aria-label={`${row.styleNumber} ${column.sizeCode} quantity`}
                        onChange={(next) => onCellChange?.(row.styleId, column.sizeId, next)}
                      />
                    ) : (
                      <GridCellInput
                        numeric
                        readOnly
                        aria-label={`${row.styleNumber} ${column.sizeCode} quantity`}
                        value={value === null ? '' : String(value)}
                        onChange={() => {}}
                      />
                    )}
                  </td>
                );
              })}
              {showRowTotals && (
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{rowTotal(row)}</td>
              )}
            </tr>
          ))}
        </tbody>
        {showColumnTotals && (
          <tfoot>
            <tr className="border-t border-border-subtle text-xs font-semibold">
              <td className="sticky left-0 z-10 bg-surface px-2 py-2">Total</td>
              {columns.map((column) => (
                <td key={column.sizeId} className="px-2 py-2 text-right tabular-nums">
                  {columnTotal(column)}
                </td>
              ))}
              {showRowTotals && (
                <td className="px-2 py-2 text-right tabular-nums">
                  {rows.reduce((sum, row) => sum + rowTotal(row), 0)}
                </td>
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
