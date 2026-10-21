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

export interface BusinessKeyedStyleSizeLine {
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  quantity: number;
}

/**
 * Adapts a line that carries only the Style/Size *business* identifiers (styleNumber/sizeCode) into
 * the `groupLinesByStyle`/`distinctSizeColumns` identity shape (`styleId`/`sizeId`). ERVE consolidation
 * views (`EligibleErveCartonView`, `ErvePackingListCartonView`, `ErvePackingListStyleSizeSummaryRow`)
 * never carry a Style/Size foreign key — Erve Packing List cartons only ever need the Dispatch Order
 * line reference — so there is no `styleId`/`sizeId` to read. styleNumber/sizeCode are each entity's
 * own stable business key (already the display identity everywhere these views are shown), so
 * reusing them as the grouping key here is safe and avoids widening the API response just for this
 * presentation summary (ISS-023).
 */
export function withBusinessKeyIdentity<T extends BusinessKeyedStyleSizeLine>(
  line: T,
): T & { styleId: string; sizeId: string } {
  return { ...line, styleId: line.styleNumber, sizeId: line.sizeCode };
}

/** Distinct Size columns across all lines, in first-appearance order — see `groupLinesByStyle`'s doc comment on why not sortOrder/alphabetical. */
export function distinctSizeColumns<T extends { sizeId: string; sizeCode: string }>(lines: T[]): SizeColumn[] {
  const seen = new Map<string, string>();
  for (const line of lines) {
    if (!seen.has(line.sizeId)) seen.set(line.sizeId, line.sizeCode);
  }
  return [...seen.entries()].map(([sizeId, sizeCode]) => ({ sizeId, sizeCode }));
}

export interface FinancialStyleSizeLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
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

  return order.map((key) => groups.get(key)!);
}
