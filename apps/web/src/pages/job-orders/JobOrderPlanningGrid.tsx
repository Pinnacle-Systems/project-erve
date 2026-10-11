import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import type { StyleSizeGridColumn, StyleSizeGridRow } from '../../components/style-size-grid/types.js';
import type { StyleImage } from '../master-data/types.js';

export interface JobOrderPlanningGridSize {
  sizeId: string;
  sizeCode: string;
  /** Currently valid for the Job Order's Style (ACTIVE StyleSize mapping + ACTIVE Size). An inactive Size still displays its quantity for historical/provenance context, but is never hand-editable. */
  active: boolean;
  quantity: number;
}

export interface JobOrderPlanningGridProps {
  styleId: string;
  styleNumber: string;
  styleName?: string | null;
  primaryImage: StyleImage | null;
  sizes: JobOrderPlanningGridSize[];
  onQuantityChange: (sizeId: string, value: number | null) => void;
}

/**
 * Thin wrapper over the shared StyleSizeGrid for the Job Order's own
 * (single-Style) production plan — see the Style & Masters workstream
 * plan's "thin-wrapper pattern". An inactive Size's column is marked
 * `editable: false` so it still displays (never hidden — historical/
 * provenance context) but can never be hand-edited, matching the bespoke
 * table this replaces.
 */
export function JobOrderPlanningGrid({
  styleId,
  styleNumber,
  styleName,
  primaryImage,
  sizes,
  onQuantityChange,
}: JobOrderPlanningGridProps) {
  const columns: StyleSizeGridColumn[] = sizes.map((sz) => ({
    sizeId: sz.sizeId,
    sizeCode: sz.sizeCode,
    editable: sz.active,
  }));
  const row: StyleSizeGridRow = {
    styleId,
    styleNumber,
    styleName,
    primaryImage,
    values: Object.fromEntries(sizes.map((sz) => [sz.sizeId, sz.quantity])),
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
