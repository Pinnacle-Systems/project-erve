import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import { distinctSizeColumns, groupLinesByStyle } from './style-size-grouping.js';
import type { PackingListLineView } from './types.js';

export type CartonQuantities = Record<string, number | null>;

export function cartonLineCapacity(line: PackingListLineView, original: Record<string, number> = {}): number {
  return Math.max(0, line.requiredQuantity - line.packedQuantity + (original[line.saleOrderLineId] ?? 0));
}

/** Validates the complete selection before creating a desired-state payload. Never drops stale positive IDs. */
export function selectedCartonLines(
  lines: PackingListLineView[],
  quantities: CartonQuantities,
  original: Record<string, number> = {},
): Array<{ saleOrderLineId: string; quantity: number }> | null {
  const byId = new Map(lines.map((line) => [line.saleOrderLineId, line]));
  const selected: Array<{ saleOrderLineId: string; quantity: number }> = [];
  for (const [saleOrderLineId, quantity] of Object.entries(quantities)) {
    if (quantity === null || quantity === 0) continue;
    const line = byId.get(saleOrderLineId);
    if (!line || !Number.isInteger(quantity) || quantity < 0 || quantity > cartonLineCapacity(line, original)) return null;
    selected.push({ saleOrderLineId, quantity });
  }
  return selected.length ? selected : null;
}

export interface CartonQuantityPickerProps {
  lines: PackingListLineView[];
  quantities: CartonQuantities;
  originalQuantities?: Record<string, number>;
  onChange: (saleOrderLineId: string, quantity: number | null) => void;
  onValidationChange: (saleOrderLineId: string, valid: boolean) => void;
}

/** A destination's authorized lines adapted to the shared Style × Size editor. */
export function CartonQuantityPicker({ lines, quantities, originalQuantities = {}, onChange, onValidationChange }: CartonQuantityPickerProps) {
  const visible = lines.filter((line) => cartonLineCapacity(line, originalQuantities) > 0 || line.saleOrderLineId in quantities);
  const byCell = new Map(visible.map((line) => [JSON.stringify([line.styleId, line.sizeId]), line]));
  const imageByStyle = new Map(lines.map((line) => [line.styleId, line.primaryImage]));
  const findLine = (styleId: string, sizeId: string) => byCell.get(JSON.stringify([styleId, sizeId]))!;
  const rows = groupLinesByStyle(visible.map((line) => ({ ...line, quantity: 0 }))).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: imageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, quantities[findLine(group.styleId, entry.sizeId).saleOrderLineId] ?? null])),
  }));
  return <StyleSizeGrid columns={distinctSizeColumns(visible)} rows={rows} variant="editable"
    emptyMessage="No quantities available for this destination."
    cellOptions={(styleId, sizeId) => {
      const line = findLine(styleId, sizeId);
      if (!line) return {};
      const capacity = cartonLineCapacity(line, originalQuantities);
      return { max: capacity, helpText: `${capacity} available`, ariaLabel: `Quantity for ${line.styleNumber} ${line.sizeLabel}` };
    }}
    onCellChange={(styleId, sizeId, quantity) => onChange(findLine(styleId, sizeId).saleOrderLineId, quantity)}
    onCellValidationChange={(styleId, sizeId, valid) => onValidationChange(findLine(styleId, sizeId).saleOrderLineId, valid)}
  />;
}
