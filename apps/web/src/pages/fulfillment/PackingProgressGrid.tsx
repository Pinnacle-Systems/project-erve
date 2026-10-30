import { StyleThumbnailCell } from '../../components/style/StyleThumbnailCell.js';
import type { StyleImage } from '../master-data/types.js';
import { distinctSizeColumns, groupLinesByStyle } from './style-size-grouping.js';
import type { PackingListDestinationView } from './types.js';

type DestinationLine = PackingListDestinationView['lines'][number];
type QuantityPair = { packed: number; required: number };

function sumPair(a: QuantityPair, b: QuantityPair): QuantityPair {
  return { packed: a.packed + b.packed, required: a.required + b.required };
}

/**
 * ISS-083: a display-only Packed / Required matrix. The server's destination
 * line projections remain the single source of both quantities; this component
 * does not infer packing from carton counts or edit any quantities.
 */
export function PackingProgressGrid({ lines }: { lines: DestinationLine[] }) {
  const columns = distinctSizeColumns(lines);
  const groups = groupLinesByStyle(lines.map((line) => ({ ...line, quantity: line.requiredQuantity })));
  const cells = new Map<string, Map<string, QuantityPair>>();
  const images = new Map<string, StyleImage | null>();
  let overall: QuantityPair = { packed: 0, required: 0 };
  const columnTotals = new Map<string, QuantityPair>();

  for (const line of lines) {
    const sizes = cells.get(line.styleId) ?? new Map<string, QuantityPair>();
    sizes.set(
      line.sizeId,
      sumPair(sizes.get(line.sizeId) ?? { packed: 0, required: 0 }, {
        packed: line.packedQuantity,
        required: line.requiredQuantity,
      }),
    );
    cells.set(line.styleId, sizes);
    if (!images.has(line.styleId) || (!images.get(line.styleId) && line.primaryImage)) {
      images.set(line.styleId, line.primaryImage);
    }
    const quantity = { packed: line.packedQuantity, required: line.requiredQuantity };
    columnTotals.set(line.sizeId, sumPair(columnTotals.get(line.sizeId) ?? { packed: 0, required: 0 }, quantity));
    overall = sumPair(overall, quantity);
  }

  const ratio = ({ packed, required }: QuantityPair) => `${packed} / ${required}`;
  const textTone = ({ packed, required }: QuantityPair) =>
    packed === required ? 'text-foreground' : 'font-semibold text-warning';

  if (!groups.length) {
    return <p className="text-sm text-muted-foreground">No Style quantities for this destination.</p>;
  }

  return (
    <section aria-label="Packed / Required by Style and Size" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Packed / Required</h3>
        <span className="text-xs text-muted-foreground">Each cell: pieces packed / pieces required</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left">Style</th>
              {columns.map((column) => (
                <th scope="col" key={column.sizeId} className="px-2 py-2 text-right">{column.sizeCode}</th>
              ))}
              <th scope="col" className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {groups.map((group) => {
              const quantities = cells.get(group.styleId)!;
              const rowTotal = Array.from(quantities.values()).reduce(sumPair, { packed: 0, required: 0 });
              return (
                <tr key={group.styleId}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left font-normal">
                    <div className="flex items-center gap-2">
                      <StyleThumbnailCell styleId={group.styleId} image={images.get(group.styleId) ?? null} size={32} viewerTitle={group.styleNumber} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{group.styleNumber}</div>
                        {group.styleName && <div className="truncate text-xs text-muted-foreground">{group.styleName}</div>}
                      </div>
                    </div>
                  </th>
                  {columns.map((column) => {
                    const quantity = quantities.get(column.sizeId);
                    return (
                      <td key={column.sizeId} className="px-2 py-1.5 text-right tabular-nums">
                        {quantity ? (
                          <span className={textTone(quantity)} aria-label={`${group.styleNumber} ${column.sizeCode}: ${quantity.packed} packed of ${quantity.required} required`}>
                            {ratio(quantity)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                  <td className={`px-2 py-1.5 text-right tabular-nums ${textTone(rowTotal)}`}>
                    {ratio(rowTotal)}
                    <span className="block text-xs font-normal text-muted-foreground">{rowTotal.packed === rowTotal.required ? 'Complete' : 'Incomplete'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-subtle text-xs font-semibold">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left">Destination total</th>
              {columns.map((column) => {
                const quantity = columnTotals.get(column.sizeId)!;
                return <td key={column.sizeId} className={`px-2 py-2 text-right tabular-nums ${textTone(quantity)}`}>{ratio(quantity)}</td>;
              })}
              <td className={`px-2 py-2 text-right tabular-nums ${textTone(overall)}`}>{ratio(overall)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
