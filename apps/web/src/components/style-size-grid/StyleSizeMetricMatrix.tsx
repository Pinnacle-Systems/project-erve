import type { ReactNode } from 'react';
import { cn } from '@erve/primitives';
import { StyleThumbnailCell } from '../style/StyleThumbnailCell.js';
import type {
  SizeColumn,
  StyleSizeMatrixRowModel,
  StyleSizeSourceLine,
} from '../../pages/fulfillment/style-size-grouping.js';

/** One labelled quantity measure shown for every Style row (e.g. Dispatched, Received, Short). */
export interface StyleSizeMetric<T extends StyleSizeSourceLine> {
  /** Stable identity for React keys and tests; never the label. */
  key: string;
  label: string;
  /**
   * What ONE source line contributes. `null` = not recorded (missing evidence, rendered with
   * `missingLabel`, never as 0); `undefined` = the measure does not apply to that line.
   * A cell aggregates only the displayed number across its sources; the sources themselves are untouched.
   */
  value: (source: T) => number | null | undefined;
  /** Replaces the plain number for editable measures; receives every source line behind the cell. */
  renderCell?: (cell: { row: StyleSizeMatrixRowModel<T>; column: SizeColumn; sources: T[] }) => ReactNode;
  /** Return 'danger' to emphasise a value (e.g. a positive shortage). */
  tone?: (total: number) => 'danger' | undefined;
  /** Shown for a not-recorded value. Defaults to an em dash. */
  missingLabel?: string;
  /** Omit this measure's row Total and column totals (measures that are not additive). Default true. */
  total?: boolean;
}

export interface StyleSizeMetricMatrixProps<T extends StyleSizeSourceLine> {
  /** Accessible name of the table. */
  label: string;
  columns: SizeColumn[];
  rows: StyleSizeMatrixRowModel<T>[];
  metrics: StyleSizeMetric<T>[];
  /** Context shown under the Style number/name (Dispatch, source order, Distributor...). */
  context?: (row: StyleSizeMatrixRowModel<T>) => ReactNode;
  /** Extra full-width content under a Style block (e.g. a source-line disclosure). */
  detail?: (row: StyleSizeMatrixRowModel<T>) => ReactNode;
  /** All-Styles footer block. Default true; automatically skipped for a single Style row. */
  showColumnTotals?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
}

type Aggregate = { kind: 'none' } | { kind: 'missing' } | { kind: 'value'; value: number };

function aggregate<T extends StyleSizeSourceLine>(metric: StyleSizeMetric<T>, sources: T[]): Aggregate {
  let sum = 0;
  let seen = false;
  let missing = false;
  for (const source of sources) {
    const value = metric.value(source);
    if (value === undefined) continue;
    seen = true;
    if (value === null) missing = true;
    else sum += value;
  }
  if (!seen) return { kind: 'none' };
  return missing ? { kind: 'missing' } : { kind: 'value', value: sum };
}

function combine(parts: Aggregate[]): Aggregate {
  let sum = 0;
  let seen = false;
  let missing = false;
  for (const part of parts) {
    if (part.kind === 'none') continue;
    seen = true;
    if (part.kind === 'missing') missing = true;
    else sum += part.value;
  }
  if (!seen) return { kind: 'none' };
  return missing ? { kind: 'missing' } : { kind: 'value', value: sum };
}

function AggregateText<T extends StyleSizeSourceLine>({
  metric,
  value,
}: {
  metric: StyleSizeMetric<T>;
  value: Aggregate;
}) {
  if (value.kind === 'none') return <span className="text-muted-foreground">—</span>;
  if (value.kind === 'missing') {
    return <span className="text-muted-foreground">{metric.missingLabel ?? '—'}</span>;
  }
  const danger = metric.tone?.(value.value) === 'danger';
  return (
    <span className={cn('tabular-nums', danger && 'font-medium text-danger')}>{value.value.toLocaleString()}</span>
  );
}

/**
 * Compact Style x Size matrix for post-dispatch screens that carry SEVERAL quantity measures per
 * Style/Size (the single-measure `StyleSizeGrid` cannot represent them without reverting to one
 * Style/Size per row). One block per logical Style: an identity row (primary-image thumbnail,
 * Style number/name, context) followed by one labelled row per measure, with the canonical Sizes as
 * columns and a per-measure Total. The table scrolls horizontally on narrow screens while the
 * measure labels stay pinned. Purely presentational: every cell keeps the original source lines
 * (`row.sourcesBySize`), so editable measures supply per-source controls through `renderCell` and
 * nothing is merged on the way back to the API.
 */
export function StyleSizeMetricMatrix<T extends StyleSizeSourceLine>({
  label,
  columns,
  rows,
  metrics,
  context,
  detail,
  showColumnTotals = true,
  emptyMessage = 'No Style / Size quantities to display.',
  className,
}: StyleSizeMetricMatrixProps<T>) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }
  const span = columns.length + 2;
  const additive = metrics.filter((metric) => metric.total !== false);

  const rowTotal = (metric: StyleSizeMetric<T>, row: StyleSizeMatrixRowModel<T>) =>
    combine(columns.map((column) => aggregate(metric, row.sourcesBySize[column.sizeId] ?? [])));
  const columnTotal = (metric: StyleSizeMetric<T>, column: SizeColumn) =>
    combine(rows.map((row) => aggregate(metric, row.sourcesBySize[column.sizeId] ?? [])));

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
            <th scope="col" className="sticky left-0 z-10 w-28 min-w-28 bg-surface px-2 py-2 text-left">
              Measure
            </th>
            {columns.map((column) => (
              <th key={column.sizeId} scope="col" className="min-w-14 px-2 py-2 text-right">
                {column.sizeCode}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right">
              Total
            </th>
          </tr>
        </thead>
        {rows.map((row) => (
          <tbody key={row.key} className="border-b border-border-subtle">
            <tr>
              <th scope="rowgroup" colSpan={span} className="px-2 pt-3 pb-1 text-left font-normal">
                <div className="sticky left-2 flex w-fit max-w-[min(20rem,calc(100vw-4rem))] items-center gap-2">
                  <StyleThumbnailCell styleId={row.styleId} image={row.primaryImage} size={40} viewerTitle={row.styleNumber} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{row.styleNumber}</div>
                    {row.styleName && <div className="truncate text-xs text-muted-foreground">{row.styleName}</div>}
                    {context?.(row)}
                  </div>
                </div>
              </th>
            </tr>
            {metrics.map((metric) => (
              <tr key={metric.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-28 min-w-28 bg-surface px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                >
                  {metric.label}
                </th>
                {columns.map((column) => {
                  const sources = row.sourcesBySize[column.sizeId] ?? [];
                  return (
                    <td key={column.sizeId} className="px-2 py-1 text-right align-top">
                      {sources.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : metric.renderCell ? (
                        metric.renderCell({ row, column, sources })
                      ) : (
                        <AggregateText metric={metric} value={aggregate(metric, sources)} />
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right align-top font-medium">
                  {metric.total === false ? null : <AggregateText metric={metric} value={rowTotal(metric, row)} />}
                </td>
              </tr>
            ))}
            {detail && (
              <tr>
                <td colSpan={span} className="px-2 pt-0 pb-2">
                  <div className="sticky left-2 w-fit max-w-[calc(100vw-4rem)]">{detail(row)}</div>
                </td>
              </tr>
            )}
          </tbody>
        ))}
        {showColumnTotals && rows.length > 1 && additive.length > 0 && (
          <tfoot>
            <tr>
              <th scope="rowgroup" colSpan={span} className="px-2 pt-3 pb-1 text-left text-xs font-semibold">
                All Styles
              </th>
            </tr>
            {additive.map((metric) => (
              <tr key={metric.key} className="text-xs font-semibold">
                <th scope="row" className="sticky left-0 z-10 w-28 min-w-28 bg-surface px-2 py-1 text-left font-medium text-muted-foreground">
                  {metric.label}
                </th>
                {columns.map((column) => (
                  <td key={column.sizeId} className="px-2 py-1 text-right">
                    <AggregateText metric={metric} value={columnTotal(metric, column)} />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <AggregateText
                    metric={metric}
                    value={combine(rows.map((row) => rowTotal(metric, row)))}
                  />
                </td>
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Collapsible per-source drilldown for a Style block (`StyleSizeMetricMatrix`'s `detail`). */
export function SourceLinesDisclosure({
  summary,
  open,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="text-xs" open={open}>
      <summary className="cursor-pointer text-muted-foreground">{summary}</summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
