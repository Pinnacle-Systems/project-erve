export interface StyleSizeQuantityLine {
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sizeSortOrder?: number;
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
 * Preserves Style first appearance. Sizes follow authoritative Size.sortOrder,
 * then code, when finite ordering metadata is available. Legacy inputs without
 * any finite metadata retain first appearance; mixed inputs place missing
 * ranks last. This compatibility policy is inferred from the existing master
 * ordering, not a historical document snapshot rule.
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

  const columns = distinctSizeColumns(lines);
  const hasOrdering = lines.some((line) => Number.isFinite(line.sizeSortOrder));
  return styleOrder.map((styleId) => {
    const group = groups.get(styleId)!;
    if (hasOrdering) group.sizeEntries = orderEntries(group.sizeEntries, columns);
    return group;
  });
}

export interface BusinessKeyedStyleSizeLine {
  sizeSortOrder?: number;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

/**
 * Adapts a line that carries only the Style/Size *business* identifiers (styleNumber/sizeCode) into
 * the `groupLinesByStyle`/`distinctSizeColumns` identity shape (`styleId`/`sizeId`). `EligibleErveCartonView`
 * (the Erve Packing List "Add Cartons" preview) never carries a Style/Size foreign key — it only ever
 * needs the Dispatch Order line reference — so there is no `styleId`/`sizeId` to read there.
 * styleNumber/sizeCode are each entity's own stable business key (already the display identity
 * everywhere these views are shown), so reusing them as the grouping key here is safe and avoids
 * widening that endpoint's response just for this presentation summary (ISS-023).
 *
 * `ErvePackingListCartonView`/`ErvePackingListStyleSizeSummaryRow` used to need this same shim, but
 * now carry a real `styleId` (ISS-053, so the authenticated Style image endpoint has a real UUID to
 * address) — use `withSizeIdentity` for those instead, which leaves the already-real `styleId` alone.
 */
export function withBusinessKeyIdentity<T extends BusinessKeyedStyleSizeLine>(
  line: T,
): T & { styleId: string; sizeId: string } {
  return { ...line, styleId: line.styleNumber, sizeId: line.sizeCode };
}

export interface SizeKeyedLine {
  sizeSortOrder?: number;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

/**
 * Adapts a line that already carries a real `styleId` (ISS-053's `ErvePackingListCartonView`/
 * `ErvePackingListStyleSizeSummaryRow`) but only a Size business key (`sizeCode`) into the
 * `groupLinesByStyle`/`distinctSizeColumns` identity shape. Unlike `withBusinessKeyIdentity`, this
 * never touches `styleId` — substituting `styleNumber` for an already-real Style UUID would break
 * the authenticated Style image lookup (`/styles/:id/images/:imageId/content`).
 */
export function withSizeIdentity<T extends SizeKeyedLine>(line: T): T & { sizeId: string } {
  return { ...line, sizeId: line.sizeCode };
}

/** Canonical Size columns with backward-compatible ordering for legacy inputs. */
export function distinctSizeColumns<T extends { sizeId: string; sizeCode: string; sizeSortOrder?: number }>(lines: T[]): SizeColumn[] {
  const seen = new Map<string, { sizeId: string; sizeCode: string; rank: number }>();
  for (const line of lines) {
    const rank = Number.isFinite(line.sizeSortOrder) ? line.sizeSortOrder! : Number.POSITIVE_INFINITY;
    const existing = seen.get(line.sizeId);
    if (!existing) seen.set(line.sizeId, { sizeId: line.sizeId, sizeCode: line.sizeCode, rank });
    else existing.rank = Math.min(existing.rank, rank);
  }
  const columns = [...seen.values()];
  if (columns.some((column) => Number.isFinite(column.rank))) {
    columns.sort((a, b) => (a.rank === b.rank ? 0 : a.rank - b.rank) || a.sizeCode.localeCompare(b.sizeCode));
  }
  return columns.map(({ sizeId, sizeCode }) => ({ sizeId, sizeCode }));
}

function orderEntries<T extends { sizeId: string }>(entries: T[], columns: SizeColumn[]): T[] {
  const positions = new Map(columns.map((column, index) => [column.sizeId, index]));
  return entries.sort((a, b) => positions.get(a.sizeId)! - positions.get(b.sizeId)!);
}

export interface FinancialStyleSizeLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sizeSortOrder?: number;
  quantity: number;
  unitRate: number;
  defaultRate: number;
  lineAmount: number;
}

export interface FinancialSizeEntry {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

export interface FinancialStyleGroup {
  /** Stable React/table row key — styleId alone is not unique once a Style splits across incompatible rates. */
  groupKey: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  unitRate: number;
  defaultRate: number;
  rateOverridden: boolean;
  sizeEntries: FinancialSizeEntry[];
  totalQuantity: number;
  /** Sum of each source line's own persisted lineAmount — never totalQuantity × rate, so historical per-line rounding survives aggregation exactly. */
  amount: number;
  sourceLineIds: string[];
}

/**
 * Groups financial lines (e.g. Factory Invoice lines) into one row per
 * Style — ISS-010's financial-document presentation standard, distinct from
 * `groupLinesByStyle`'s operational Size-columns standard above.
 *
 * A Style only collapses into one row when every one of its lines also
 * shares the same `unitRate`: an ACCOUNTANT may override unitRate per source
 * line (see factory-invoice.service.ts's updateFactoryInvoiceFinancials), so
 * two lines of the same Style can end up financially incompatible after an
 * edit — those stay separate rows (distinguished by their different Rate
 * column value) rather than being averaged or silently merged.
 *
 * `defaultRate` never varies for a given styleId (it's an immutable
 * Style<->Factory snapshot taken once at invoice generation), so it is not
 * part of the compatibility key, only carried through for the "overridden"
 * presentation note.
 */
export function groupFinancialLinesByStyle<T extends FinancialStyleSizeLine>(lines: T[]): FinancialStyleGroup[] {
  const order: string[] = [];
  const groups = new Map<string, FinancialStyleGroup>();

  for (const line of lines) {
    const key = `${line.styleId}::${line.unitRate}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        groupKey: key,
        styleId: line.styleId,
        styleNumber: line.styleNumber,
        styleName: line.styleName,
        unitRate: line.unitRate,
        defaultRate: line.defaultRate,
        rateOverridden: line.unitRate !== line.defaultRate,
        sizeEntries: [],
        totalQuantity: 0,
        amount: 0,
        sourceLineIds: [],
      };
      groups.set(key, group);
      order.push(key);
    }
    const existingEntry = group.sizeEntries.find((entry) => entry.sizeId === line.sizeId);
    if (existingEntry) {
      existingEntry.quantity += line.quantity;
    } else {
      group.sizeEntries.push({ sizeId: line.sizeId, sizeCode: line.sizeCode, sizeLabel: line.sizeLabel, quantity: line.quantity });
    }
    group.totalQuantity += line.quantity;
    group.amount += line.lineAmount;
    group.sourceLineIds.push(line.id);
  }

  const columns = distinctSizeColumns(lines);
  const hasOrdering = lines.some((line) => Number.isFinite(line.sizeSortOrder));
  return order.map((key) => {
    const group = groups.get(key)!;
    if (hasOrdering) group.sizeEntries = orderEntries(group.sizeEntries, columns);
    return group;
  });
}
