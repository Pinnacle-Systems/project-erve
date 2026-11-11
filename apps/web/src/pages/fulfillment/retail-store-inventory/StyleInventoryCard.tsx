import { Fragment } from 'react';
import type { RetailStoreInventoryMeasures, RetailStoreInventoryStyleCard, StoreFifoAction } from '@erve/types';
import { Badge, Button, cn } from '@erve/primitives';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import {
  OUTRIGHT_NOTE,
  PURCHASE_MODE_LABEL,
  SALE_RETURN_ROWS,
  SHIPMENT_ROWS,
  evidenceFlags,
  formatQuantity,
  type MeasureRow,
} from './measures.js';

export interface DrillTarget {
  storeKey: string;
  storeName: string;
  distributorId: string;
  card: RetailStoreInventoryStyleCard;
  /** Null drills into the whole Style card (every Size). */
  size: { sizeId: string; sizeCode: string } | null;
}

interface Props {
  storeKey: string;
  storeName: string;
  distributorId: string;
  card: RetailStoreInventoryStyleCard;
  onDrill: (target: DrillTarget) => void;
  /**
   * ISS-089: present only for a Distributor looking at a mapped Store's Sale-or-Return card.
   * Adds the Report sold / Request return actions to every Size column that has stock.
   */
  onFifoAction?: (action: StoreFifoAction, size: { sizeId: string; sizeCode: string }) => void;
}

function ValueButton({
  row,
  measures,
  label,
  onClick,
}: {
  row: MeasureRow;
  measures: RetailStoreInventoryMeasures;
  label: string;
  onClick: () => void;
}) {
  const value = row.value(measures);
  const text = value === null ? 'n/r' : formatQuantity(value);
  return (
    <button
      type="button"
      onClick={onClick}
      title={value === null ? row.nullMeaning : undefined}
      aria-label={`${row.label}, ${label}: ${value === null ? row.nullMeaning : formatQuantity(value)}. Show source dispatches`}
      className={cn(
        'min-h-8 min-w-8 rounded px-1.5 text-right tabular-nums underline-offset-2 hover:bg-surface-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        value === null && 'text-muted-foreground',
      )}
    >
      {text}
    </button>
  );
}

/**
 * One Style (at one purchase mode) inside a Store: the Style's own native Size
 * columns with the measures as rows. Never a universal Size table and never one
 * Size per row. Horizontal overflow stays inside this table's own scroller.
 */
export function StyleInventoryCard({ storeKey, storeName, distributorId, card, onDrill, onFifoAction }: Props) {
  const rows = card.purchaseMode === 'SALE_RETURN' ? [...SHIPMENT_ROWS, ...SALE_RETURN_ROWS] : [...SHIPMENT_ROWS];
  const flags = evidenceFlags(card.total);
  const drill = (size: { sizeId: string; sizeCode: string } | null) =>
    onDrill({ storeKey, storeName, distributorId, card, size });
  const modeLabel = PURCHASE_MODE_LABEL[card.purchaseMode];

  return (
    <section
      className="min-w-0 rounded-md border border-border-subtle bg-surface p-3"
      aria-label={`${card.styleNumber} ${modeLabel}`}
    >
      <header className="mb-2 flex min-w-0 flex-wrap items-start gap-3">
        <StyleThumbnailCell
          styleId={card.styleId}
          image={card.primaryImage}
          size={48}
          viewerTitle={card.styleNumber}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">{card.styleNumber}</h4>
            <Badge variant={card.purchaseMode === 'SALE_RETURN' ? 'info' : 'muted'}>{modeLabel}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{card.styleName}</p>
          {flags.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Evidence notes">
              {flags.map((flag) => (
                <li key={flag.key} className="min-w-0 max-w-full">
                  {/* Long evidence notes wrap inside the card instead of widening the page. */}
                  <Badge
                    variant={flag.tone === 'muted' ? 'muted' : flag.tone}
                    className="max-w-full whitespace-normal break-words rounded-md py-1 text-left leading-snug"
                  >
                    {flag.text}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {/* `relative` keeps the visually hidden (absolutely positioned) cell labels inside this scroller. */}
      <div className="relative overflow-x-auto">
        <table
          className="w-full border-collapse text-sm"
          aria-label={`${card.styleNumber} ${modeLabel} quantities by size`}
        >
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
            {rows.map((row, index) => (
              <Fragment key={row.key}>
                {row.group === 'saleReturn' && rows[index - 1]?.group !== 'saleReturn' && (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={card.sizes.length + 2}
                      className="bg-surface-muted px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Sale-or-Return position
                    </th>
                  </tr>
                )}
                <tr>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5 text-left font-medium text-foreground"
                  >
                    {row.label}
                  </th>
                  {card.sizes.map((size) => {
                    const cell = card.cells[size.sizeId];
                    return (
                      <td key={size.sizeId} className="px-2 py-1 text-right">
                        {cell ? (
                          <ValueButton
                            row={row}
                            measures={cell}
                            label={`size ${size.sizeCode}`}
                            onClick={() => drill({ sizeId: size.sizeId, sizeCode: size.sizeCode })}
                          />
                        ) : (
                          <span className="text-muted-foreground" title="No shipment for this size">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">No shipment</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-medium">
                    <ValueButton row={row} measures={card.total} label="total" onClick={() => drill(null)} />
                  </td>
                </tr>
              </Fragment>
            ))}
            {onFifoAction && card.purchaseMode === 'SALE_RETURN' && (
              <tr data-testid="store-fifo-actions">
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5 text-left font-medium text-foreground"
                >
                  Actions
                </th>
                {card.sizes.map((size) => {
                  const position = card.cells[size.sizeId]?.saleReturn ?? null;
                  const target = { sizeId: size.sizeId, sizeCode: size.sizeCode };
                  const canSell = (position?.availableForActualSale ?? 0) > 0;
                  const canReturn = (position?.availableForNewReturn ?? 0) > 0;
                  return (
                    <td key={size.sizeId} className="px-1 py-1 text-right align-top">
                      {position ? (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            density="compact"
                            disabled={!canSell}
                            title={canSell ? undefined : 'No stock available to report as sold'}
                            aria-label={`Report sold, size ${size.sizeCode}`}
                            onClick={() => onFifoAction('SALE', target)}
                          >
                            Sold
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            density="compact"
                            disabled={!canReturn}
                            title={canReturn ? undefined : 'No stock available to return'}
                            aria-label={`Request return, size ${size.sizeCode}`}
                            onClick={() => onFifoAction('RETURN', target)}
                          >
                            Return
                          </Button>
                        </div>
                      ) : (
                        <span aria-hidden="true" className="text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {card.sizes.some((size) => !size.active) && (
        <p className="mt-1 text-xs text-muted-foreground">* No longer an active size for this Style; shown because it carries shipments.</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        n/r = not recorded (no evidence yet — not zero). — = no shipment of that size.
      </p>
      {card.purchaseMode === 'OUTRIGHT' && <p className="mt-1 text-xs text-muted-foreground">{OUTRIGHT_NOTE}</p>}
    </section>
  );
}
