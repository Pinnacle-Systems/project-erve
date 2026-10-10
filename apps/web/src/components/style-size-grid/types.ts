import type { StyleImage } from '../../pages/master-data/types.js';

export interface StyleSizeGridColumn {
  sizeId: string;
  sizeCode: string;
}

export interface StyleSizeGridRow {
  styleId: string;
  styleNumber: string;
  styleName?: string | null;
  primaryImage?: StyleImage | null;
  /** Quantity per Size, keyed by `sizeId`. A missing key means that Size doesn't apply to this Style/row. */
  values: Record<string, number | null>;
}

/**
 * - `editable`: NumericField cells the user can type into.
 * - `computed`: system-calculated values (e.g. an equal-distribution split) rendered read-only — the grid never lets these be hand-edited, by design, not just by styling.
 * - `readOnly`: plain display (e.g. already-committed ordered quantities).
 */
export type StyleSizeGridVariant = 'editable' | 'computed' | 'readOnly';
