import { Fragment } from 'react';
import type { RetailStoreInventoryMeasures, RetailStoreInventoryStyleCard } from '@erve/types';
import { Badge, cn } from '@erve/primitives';
import { formatQuantity } from '../retail-store-inventory/measures.js';
import {
  GROUP_LABEL,
  NOT_RECORDED,
  STOCK_MEASURE_ROWS,
  SUMMARY_STATS,
  displayQuantity,
  stockFlags,
  type StockMeasureRow,
} from './stock-measures.js';

/** The compact headline figures for a Style / Distributor / Store. `n/r` = not recorded, never zero. */
export function StockStatGrid({ measures }: { measures: RetailStoreInventoryMeasures }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
      {SUMMARY_STATS.map((stat) => {
        const value = stat.value(measures);
        return (
          <div key={stat.key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className={cn('text-sm font-semibold tabular-nums', value === null && 'font-normal text-muted-foreground')}>
              {value === null ? (
                <>
                  <span aria-hidden="true">{NOT_RECORDED}</span>
                  <span className="sr-only">Not recorded</span>
                </>
              ) : (
                formatQuantity(value)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Pending / approved returns and receipt-evidence caveats; long notes wrap instead of widening the page. */
export function StockFlagList({ measures }: { measures: RetailStoreInventoryMeasures }) {
  const flags = stockFlags(measures);
  if (flags.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Stock notes">
      {flags.map((flag) => (
        <li key={flag.key} className="min-w-0 max-w-full">
          <Badge
            variant={flag.tone === 'muted' ? 'muted' : flag.tone}
            className="max-w-full whitespace-normal break-words rounded-md py-1 text-left leading-snug"
          >
            {flag.text}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function CellValue({
  row,
  measures,
  label,
  onClick,
}: {
  row: StockMeasureRow;
  measures: RetailStoreInventoryMeasures;
  label: string;
  onClick?: () => void;
}) {
  const value = row.value(measures);
  const text = displayQuantity(value);
  const className = cn('tabular-nums', value === null && 'text-muted-foreground');
  if (!onClick) {
    return (
      <span className={className} title={value === null ? row.nullMeaning : undefined}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={value === null ? row.nullMeaning : undefined}
      aria-label={`${row.label}, ${label}: ${value === null ? row.nullMeaning : formatQuantity(value)}. Show contributing dispatches`}
      className={cn(
        'min-h-8 min-w-8 rounded px-1.5 text-right underline-offset-2 hover:bg-surface-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        className,
      )}
    >
      {text}
    </button>
  );
}

/**
 * One Style's consolidated stock: its own native Size columns across, the measures down. Never
 * a universal Size table and never one Size per row. Cells and the Total column open the
 * contributing Dispatches for that Size / the whole Style. Horizontal overflow stays inside this
 * table's own scroller so a wide Size run cannot widen the page (375px safe).
 */
export function StockStyleMatrix({
  card,
  onDrill,
}: {
  card: RetailStoreInventoryStyleCard;
  onDrill: (size: { sizeId: string; sizeCode: string } | null) => void;
}) {
  const colCount = card.sizes.length + 2;
  return (
    <div>
      {/* `relative` keeps visually hidden cell labels inside this scroller. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label={`${card.styleNumber} consolidated stock by size`}>
          <thead>
            <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left">
                Measure
              </th>
              {card.sizes.map((size) => (
                <th
                  key={size.sizeId}
                  scope="col"
                  className="px-2 py-2 text-right"
                  title={size.active ? size.sizeLabel : `${size.sizeLabel} (no longer an active size for this Style)`}
                >
                  {size.sizeCode}
                  {!size.active && <span className="sr-only"> (inactive size)</span>}
                  {!size.active && <span aria-hidden="true">*</span>}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {STOCK_MEASURE_ROWS.map((row, index) => (
              <Fragment key={row.key}>
                {STOCK_MEASURE_ROWS[index - 1]?.group !== row.group && (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={colCount}
                      className="bg-surface-muted px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {GROUP_LABEL[row.group]}
                    </th>
                  </tr>
                )}
                <tr>
                  <th
                    scope="row"
                    title={row.help}
                    className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5 text-left font-medium text-foreground"
                  >
                    {row.label}
                  </th>
                  {card.sizes.map((size) => {
                    const cell = card.cells[size.sizeId];
                    return (
                      <td key={size.sizeId} className="px-2 py-1 text-right">
                        {cell ? (
                          <CellValue
                            row={row}
                            measures={cell}
                            label={`size ${size.sizeCode}`}
                            onClick={() => onDrill({ sizeId: size.sizeId, sizeCode: size.sizeCode })}
                          />
                        ) : (
                          <span className="text-muted-foreground" title="No dispatch of this size">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">No dispatch</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-medium">
                    <CellValue row={row} measures={card.total} label="total" onClick={() => onDrill(null)} />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {card.sizes.some((size) => !size.active) && (
        <p className="mt-1 text-xs text-muted-foreground">
          * No longer an active size for this Style; shown because it carries stock.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        n/r = not recorded (no evidence yet, not zero). — = no dispatch of that size. Quantities are totals of every
        contributing Dispatch.
      </p>
    </div>
  );
}
