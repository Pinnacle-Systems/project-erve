import type { ReactNode } from 'react';
import { cn, GridCellInput, NumericField, toFiniteNumber } from '@erve/primitives';
import { createEnterToNextHandler } from '@erve/app-components';

export interface QuantityMeasureGridColumn {
  sizeId: string;
  sizeCode: string;
  /** Defaults to true. Set false for a Size that must stay read-only regardless of the row's own editability (e.g. an inactive Size). */
  editable?: boolean;
}

export interface QuantityMeasureGridRow {
  /** Stable row identity across renders/data changes — never the display label. */
  key: string;
  label: string;
  /** Defaults to true. Set false for a row that is always read-only (e.g. Combined Forecast). */
  editable?: boolean;
  /** Quantity per Size, keyed by `sizeId`. A missing key means that Size doesn't apply to this row. */
  values: Record<string, number | null>;
  /** When set for a sizeId, that cell renders this node (e.g. "Not recorded") instead of a number/input — for historical-import honesty. */
  notRecorded?: Record<string, ReactNode>;
  /** Per-Size max override for this row only (e.g. Prepared's max varies by that Size's ordered quantity). Falls back to the grid-level `max`. */
  maxValues?: Record<string, number>;
}

export interface QuantityMeasureGridProps {
  columns: QuantityMeasureGridColumn[];
  rows: QuantityMeasureGridRow[];
  /** Never called for a read-only row/column or a notRecorded cell. */
  onCellChange?: (rowKey: string, sizeId: string, value: number | null) => void;
  /** Fires on every commit (blur) of an editable cell with whether the committed draft is in-range. Never called for a read-only row/column or a notRecorded cell. */
  onCellValidationChange?: (rowKey: string, sizeId: string, isValid: boolean) => void;
  min?: number;
  max?: number;
  /** One Total per row (never a grand total across rows — different measures are not additive). */
  showRowTotals?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
}

/**
 * The shared quantity-measure(rows) x Size(columns) grid — the sibling of
 * StyleSizeGrid for screens whose rows are quantity MEASURES (Combined
 * Forecast / Production Plan / Prepared) rather than Styles. Deliberately a
 * separate component/type, not a prop extension of StyleSizeGrid — see the
 * Job Order Style x Size Standardization (PR2A) plan.
 *
 * Reuses `createEnterToNextHandler()` on the grid container, same as
 * StyleSizeGrid — every editable cell sets `data-form-control` via
 * NumericField/GridCellInput, so Enter-to-Tab works with no extra wiring.
 */
export function QuantityMeasureGrid({
  columns,
  rows,
  onCellChange,
  onCellValidationChange,
  min = 0,
  max,
  showRowTotals = true,
  emptyMessage = 'No data to display.',
  className,
}: QuantityMeasureGridProps) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  const rowTotal = (row: QuantityMeasureGridRow) =>
    columns.reduce((sum, column) => sum + toFiniteNumber(row.values[column.sizeId]), 0);

  return (
    <div className={cn('overflow-x-auto', className)} onKeyDown={createEnterToNextHandler()}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
            <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-left">Measure</th>
            {columns.map((column) => (
              <th key={column.sizeId} className="px-2 py-2 text-right">
                {column.sizeCode}
              </th>
            ))}
            {showRowTotals && <th className="px-2 py-2 text-right">Total</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const rowEditable = row.editable ?? true;
            return (
              <tr key={row.key}>
                <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-medium text-foreground">
                  {row.label}
                </td>
                {columns.map((column) => {
                  const value = row.values[column.sizeId] ?? null;
                  const hasCell = column.sizeId in row.values;
                  const columnEditable = column.editable ?? true;
                  const notRecorded = row.notRecorded?.[column.sizeId];
                  const cellMax = row.maxValues?.[column.sizeId] ?? max;
                  return (
                    <td key={column.sizeId} className="px-2 py-1.5">
                      {!hasCell ? (
                        <span className="block text-right text-muted-foreground">—</span>
                      ) : notRecorded !== undefined ? (
                        <span className="block text-right text-muted-foreground">{notRecorded}</span>
                      ) : rowEditable && columnEditable ? (
                        <NumericField
                          variant="cell"
                          mode="integer"
                          min={min}
                          max={cellMax}
                          value={value}
                          aria-label={`${row.label} ${column.sizeCode} quantity`}
                          onChange={(next) => onCellChange?.(row.key, column.sizeId, next)}
                          onValidationChange={(isValid) =>
                            onCellValidationChange?.(row.key, column.sizeId, isValid)
                          }
                        />
                      ) : (
                        <GridCellInput
                          numeric
                          readOnly
                          aria-label={`${row.label} ${column.sizeCode} quantity`}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
