export interface StyleSizeQuantityLine {
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

export interface StyleSizeGroupEntry {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

export interface StyleSizeGroup {
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeEntries: StyleSizeGroupEntry[];
  totalQuantity: number;
}

export interface SizeColumn {
  sizeId: string;
  sizeCode: string;
}

/**
 * Groups Style+Size quantity lines by stable Style identity (`styleId`, never
 * display name) for the ISS-007/009/010 Style x Size presentation standard.
 *
 * Preserves each Style's and Size's first-appearance order from the source
 * lines. None of the carton/packing-list view types carry `Size.sortOrder`,
 * and the one endpoint that does (`GET /sizes`) is restricted to roles
 * narrower than who can view these screens (e.g. FACTORY_USER), so adding it
 * would mean an API/type contract change this batch is scoped to avoid —
 * first-appearance order is used instead of alphabetical as the next-best
 * signal.
 *
 * Duplicate Style+Size lines (defensive — not expected given the
 * `@@unique([cartonId, saleOrderLineId])` / per-destination Style+Size
 * uniqueness already enforced upstream) are summed into one entry rather than
 * producing a second row.
 */
export function groupLinesByStyle<T extends StyleSizeQuantityLine>(lines: T[]): StyleSizeGroup[] {
  const styleOrder: string[] = [];
  const groups = new Map<string, StyleSizeGroup>();

  for (const line of lines) {
    let group = groups.get(line.styleId);
    if (!group) {
      group = { styleId: line.styleId, styleNumber: line.styleNumber, styleName: line.styleName, sizeEntries: [], totalQuantity: 0 };
      groups.set(line.styleId, group);
      styleOrder.push(line.styleId);
    }
    const existingEntry = group.sizeEntries.find((entry) => entry.sizeId === line.sizeId);
    if (existingEntry) {
      existingEntry.quantity += line.quantity;
    } else {
      group.sizeEntries.push({ sizeId: line.sizeId, sizeCode: line.sizeCode, sizeLabel: line.sizeLabel, quantity: line.quantity });
    }
    group.totalQuantity += line.quantity;
  }

  return styleOrder.map((styleId) => groups.get(styleId)!);
}

/** Distinct Size columns across all lines, in first-appearance order — see `groupLinesByStyle`'s doc comment on why not sortOrder/alphabetical. */
export function distinctSizeColumns<T extends { sizeId: string; sizeCode: string }>(lines: T[]): SizeColumn[] {
  const seen = new Map<string, string>();
  for (const line of lines) {
    if (!seen.has(line.sizeId)) seen.set(line.sizeId, line.sizeCode);
  }
  return [...seen.entries()].map(([sizeId, sizeCode]) => ({ sizeId, sizeCode }));
}
