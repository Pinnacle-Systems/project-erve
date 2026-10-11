import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import type { StyleSizeGridColumn, StyleSizeGridRow } from '../../components/style-size-grid/types.js';
import type { DispatchOrderStyleOption } from './DispatchOrderStyleField.js';

export interface DispatchOrderQuantityGridProps {
  style: DispatchOrderStyleOption;
  totalQuantity: number | null;
}

// DEMO-016/SM-005: a single-Style, read-only preview of the server's own
// equal-distribution split (see expandStyleTotalsToLines in
// sale-orders.service.ts) — this grid never lets a Size be hand-edited, by
// design, not just by styling. The server independently recomputes and
// validates the same split at submit time; this is a live preview only.
export function DispatchOrderQuantityGrid({ style, totalQuantity }: DispatchOrderQuantityGridProps) {
  const sizeCount = style.sizes.length;
  const dividesEvenly = totalQuantity !== null && sizeCount > 0 && totalQuantity % sizeCount === 0;
  const perSize = dividesEvenly ? totalQuantity! / sizeCount : null;

  const columns: StyleSizeGridColumn[] = style.sizes.map((size) => ({
    sizeId: size.sizeId,
    sizeCode: size.sizeCode,
    editable: false,
  }));
  const row: StyleSizeGridRow = {
    styleId: style.styleId,
    styleNumber: style.styleNumber,
    styleName: style.styleName,
    primaryImage: style.primaryImage,
    values: Object.fromEntries(style.sizes.map((size) => [size.sizeId, perSize])),
  };

  return (
    <div className="space-y-1.5">
      {sizeCount === 0 ? (
        <p className="text-xs text-[var(--erp-form-field-error-text-color)]" role="alert">
          This Style has no pooled stock and no configured Sizes at the selected Factory, and cannot be allocated.
        </p>
      ) : (
        <>
          <StyleSizeGrid columns={columns} rows={[row]} variant="computed" showColumnTotals={false} />
          {totalQuantity !== null && !dividesEvenly && (
            <p className="text-xs text-[var(--erp-form-field-error-text-color)]" role="alert">
              {totalQuantity} does not divide evenly across {sizeCount} Size(s). Enter a total that is an
              exact multiple of {sizeCount}.
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {style.sizes.map((size) => (
              <span key={size.sizeId}>
                {size.sizeLabel || size.sizeCode}: {size.availableQuantity ?? 'n/a'} available
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
