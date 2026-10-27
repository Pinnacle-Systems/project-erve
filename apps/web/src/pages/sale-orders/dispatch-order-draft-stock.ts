import type { DispatchOrderStyleOption } from './DispatchOrderStyleField.js';

export interface DraftSizeAvailability {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  available: number;
  requested: number;
  remaining: number;
  shortfall: number;
}

export interface DraftStyleAvailability {
  styleId: string;
  totalRequested: number;
  totalAvailable: number;
  usableAvailable: number;
  totalShortfall: number;
  sizes: DraftSizeAvailability[];
}

/**
 * ISS-094/095: pool availability is Factory + Style + Size, NOT destination
 * or Distributor. The server preview excludes the current order's own
 * allocation in edit mode; these draft quantities are deducted exactly once
 * from that server-supplied available amount.
 *
 * Incomplete/uneven Style totals cannot be split reliably; the separate
 * equal-split validation handles them before submit. Do not misrepresent
 * their per-Size demand.
 */
export function computeDraftStyleAvailability(
  style: DispatchOrderStyleOption,
  totalsAcrossAllDestinations: Array<number | null>,
): DraftStyleAvailability {
  const count = style.sizes.length;
  const validTotals = totalsAcrossAllDestinations.filter(
    (value): value is number =>
      value !== null && Number.isInteger(value) && value > 0 && count > 0 && value % count === 0,
  );
  const perSizeRequested = validTotals.reduce((sum, total) => sum + total / count, 0);
  const sizes = style.sizes.map((size) => {
    const available = Math.max(0, size.availableQuantity ?? 0);
    return {
      sizeId: size.sizeId,
      sizeCode: size.sizeCode,
      sizeLabel: size.sizeLabel,
      available,
      requested: perSizeRequested,
      remaining: Math.max(0, available - perSizeRequested),
      shortfall: Math.max(0, perSizeRequested - available),
    };
  });
  return {
    styleId: style.styleId,
    totalRequested: validTotals.reduce((sum, total) => sum + total, 0),
    totalAvailable: sizes.reduce((sum, size) => sum + size.available, 0),
    usableAvailable: sizes.reduce((sum, size) => sum + Math.min(size.available, size.requested), 0),
    totalShortfall: sizes.reduce((sum, size) => sum + size.shortfall, 0),
    sizes,
  };
}
