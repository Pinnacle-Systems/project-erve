import type { ErveDispatchQuantityLine, PurchaseMode, SubmitDistributorReceiptRequest } from '@erve/types';
import { distinctSizeColumns } from '../style-size-grouping.js';

// ---------------------------------------------------------------------------
// A4 (ISS-079/080) — pure model for the Distributor's final receipt entry.
// The Distributor works in Style x Size; the API keys evidence and the ledger
// per Sale Order line. A Style x Size backed by several Sale Order lines needs
// an explicit source-line allocation only when it is received partially.
// ---------------------------------------------------------------------------

export interface ReceiptSourceLine {
  saleOrderLineId: string;
  saleOrderNumber: string | null;
  purchaseMode: PurchaseMode | null;
  dispatchedQuantity: number;
}

export interface ReceiptEntryGroup {
  key: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  primaryImage: ErveDispatchQuantityLine['primaryImage'];
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sizeSortOrder?: number;
  dispatchedQuantity: number;
  sources: ReceiptSourceLine[];
}

export const receiptGroupKey = (styleId: string, sizeId: string) => `${styleId}::${sizeId}`;

export function buildReceiptEntryGroups(lines: ErveDispatchQuantityLine[]): ReceiptEntryGroup[] {
  const groups = new Map<string, ReceiptEntryGroup>();
  for (const line of lines) {
    const key = receiptGroupKey(line.styleId, line.sizeId);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        styleId: line.styleId,
        styleNumber: line.styleNumber,
        styleName: line.styleName,
        primaryImage: line.primaryImage,
        sizeId: line.sizeId,
        sizeCode: line.sizeCode,
        sizeLabel: line.sizeLabel,
        sizeSortOrder: line.sizeSortOrder,
        dispatchedQuantity: 0,
        sources: [],
      };
      groups.set(key, group);
    }
    group.dispatchedQuantity += line.quantity;
    group.sources.push({
      saleOrderLineId: line.saleOrderLineId,
      saleOrderNumber: line.saleOrderNumber ?? null,
      purchaseMode: line.purchaseMode ?? null,
      dispatchedQuantity: line.quantity,
    });
  }
  for (const group of groups.values()) {
    group.sources.sort(
      (a, b) =>
        (a.saleOrderNumber ?? '').localeCompare(b.saleOrderNumber ?? '') ||
        a.saleOrderLineId.localeCompare(b.saleOrderLineId),
    );
  }
  return [...groups.values()];
}

/** Size columns in the canonical Style x Size order the rest of the workspace uses. */
export function receiptSizeColumns(groups: ReceiptEntryGroup[]) {
  return distinctSizeColumns(groups);
}

/** Entered received quantities: null/absent = not yet entered. Allocation drafts are raw strings per source line. */
export type ReceivedEntries = Record<string, number | null | undefined>;
export type AllocationDrafts = Record<string, Record<string, string> | undefined>;

/** A partial receipt of a multi-line Style x Size: the only case needing explicit source allocation. */
export function needsAllocation(group: ReceiptEntryGroup, received: number | null | undefined): boolean {
  return (
    group.sources.length > 1 &&
    received !== null &&
    received !== undefined &&
    received > 0 &&
    received < group.dispatchedQuantity
  );
}

function parseWhole(draft: string | undefined): number | null {
  if (draft === undefined || draft.trim() === '' || !/^\d+$/.test(draft.trim())) return null;
  return Number(draft.trim());
}

export interface ReceiptValidation {
  /** Per group key: a message to show beside the cell / allocation block. */
  groupErrors: Record<string, string>;
  allEntered: boolean;
  totalDispatched: number;
  totalReceived: number;
  totalShortage: number;
  hasShortage: boolean;
  /** Entry is complete and internally consistent (remarks excluded). */
  entriesValid: boolean;
}

export function validateReceiptEntries(
  groups: ReceiptEntryGroup[],
  received: ReceivedEntries,
  allocations: AllocationDrafts,
): ReceiptValidation {
  const groupErrors: Record<string, string> = {};
  let allEntered = true;
  let totalDispatched = 0;
  let totalReceived = 0;
  for (const group of groups) {
    totalDispatched += group.dispatchedQuantity;
    const value = received[group.key];
    if (value === null || value === undefined) {
      allEntered = false;
      continue;
    }
    totalReceived += value;
    if (value > group.dispatchedQuantity) {
      groupErrors[group.key] = `Cannot exceed dispatched ${group.dispatchedQuantity}`;
      continue;
    }
    if (needsAllocation(group, value)) {
      const drafts = allocations[group.key] ?? {};
      let sum = 0;
      let message = '';
      for (const source of group.sources) {
        const parsed = parseWhole(drafts[source.saleOrderLineId]);
        if (parsed === null) {
          message = 'Allocate the received quantity to every source line';
          break;
        }
        if (parsed > source.dispatchedQuantity) {
          message = `A source line cannot exceed its dispatched ${source.dispatchedQuantity}`;
          break;
        }
        sum += parsed;
      }
      if (!message && sum !== value) message = `Allocations total ${sum}; they must total ${value}`;
      if (message) groupErrors[group.key] = message;
    }
  }
  const totalShortage = totalDispatched - totalReceived;
  return {
    groupErrors,
    allEntered,
    totalDispatched,
    totalReceived,
    totalShortage,
    hasShortage: allEntered && totalShortage > 0,
    entriesValid: allEntered && Object.keys(groupErrors).length === 0,
  };
}

export function buildReceiptRequest(
  groups: ReceiptEntryGroup[],
  received: ReceivedEntries,
  allocations: AllocationDrafts,
  options: { expectedVersion: number; remarks: string },
): SubmitDistributorReceiptRequest {
  return {
    expectedVersion: options.expectedVersion,
    acknowledged: true,
    remarks: options.remarks.trim() || null,
    groups: groups.map((group) => {
      const receivedQuantity = received[group.key] ?? 0;
      const entry: SubmitDistributorReceiptRequest['groups'][number] = {
        styleId: group.styleId,
        sizeId: group.sizeId,
        receivedQuantity,
      };
      if (needsAllocation(group, receivedQuantity)) {
        const drafts = allocations[group.key] ?? {};
        entry.allocations = group.sources.map((source) => ({
          saleOrderLineId: source.saleOrderLineId,
          receivedQuantity: parseWhole(drafts[source.saleOrderLineId]) ?? 0,
        }));
      }
      return entry;
    }),
  };
}
