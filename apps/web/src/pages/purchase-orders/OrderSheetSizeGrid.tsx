import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import type { StyleSizeGridColumn, StyleSizeGridRow } from '../../components/style-size-grid/types.js';
import type { StyleImage } from '../master-data/types.js';

export interface OrderSheetSizeGridSize {
  sizeId: string;
  sizeCode: string;
  orderedQuantity: number | null;
}

export interface OrderSheetSizeGridProps {
  styleId: string;
  styleNumber: string;
  styleName?: string | null;
  primaryImage: StyleImage | null;
  sizes: OrderSheetSizeGridSize[];
  onQuantityChange: (sizeId: string, value: number | null) => void;
}

/**
 * Thin wrapper over the shared StyleSizeGrid for the Order Sheet form's
 * always-exactly-one-Style line — see the Style & Masters workstream plan's
 * "thin-wrapper pattern". Column totals are hidden (one row makes them
 * identical to the row total); the quantity-is-optional-per-size semantics
 * (blank/0 both mean "not ordering this Size", enforced at submit, never a
 * validation error) are unchanged from the bespoke fields this replaces.
 */
export function OrderSheetSizeGrid({
  styleId,
  styleNumber,
  styleName,
  primaryImage,
  sizes,
  onQuantityChange,
}: OrderSheetSizeGridProps) {
  const columns: StyleSizeGridColumn[] = sizes.map((sz) => ({ sizeId: sz.sizeId, sizeCode: sz.sizeCode }));
  const row: StyleSizeGridRow = {
    styleId,
    styleNumber,
    styleName,
    primaryImage,
    values: Object.fromEntries(sizes.map((sz) => [sz.sizeId, sz.orderedQuantity])),
  };

  return (
    <StyleSizeGrid
      columns={columns}
      rows={[row]}
      variant="editable"
      showColumnTotals={false}
      onCellChange={(_rowStyleId, sizeId, value) => onQuantityChange(sizeId, value)}
    />
  );
}
