import { createHash } from 'node:crypto';
import { HttpError } from '../../errors/http-error.js';

// ---------------------------------------------------------------------------
// A4 (ISS-079/080) — pure planning for a Distributor's final receipt
// attestation. The Distributor enters actual received quantities per
// Style x Size; the ledger (ErveDispatchDeliveryLine) and the receipt's own
// evidence lines are per Sale Order line. This module resolves one into the
// other without touching the database:
//
//   * A Style x Size backed by a single Sale Order line, or any group
//     received in full or not at all, is allocated automatically — there is
//     only one possible split.
//   * A partial receipt of a Style x Size backed by SEVERAL Sale Order lines
//     is ambiguous (the lines may even differ in Purchase Mode), so the
//     Distributor must allocate it explicitly. A shortage is never silently
//     spread across lines here.
// ---------------------------------------------------------------------------

export interface ReceiptSourceLine {
  saleOrderLineId: string;
  styleId: string;
  sizeId: string;
  dispatchedQuantity: number;
}

export interface ReceiptGroupInput {
  styleId: string;
  sizeId: string;
  receivedQuantity: number;
  allocations?: Array<{ saleOrderLineId: string; receivedQuantity: number }>;
}

export interface ReceiptPlanLine {
  saleOrderLineId: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
}

export interface ReceiptPlan {
  lines: ReceiptPlanLine[];
  totalDispatchedQuantity: number;
  totalReceivedQuantity: number;
  hasShortage: boolean;
}

const groupKey = (styleId: string, sizeId: string) => `${styleId}\u0000${sizeId}`;

function assertQuantity(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw HttpError.badRequest(`${label} must be a whole number of zero or more`);
  }
}

export function buildReceiptPlan(sourceLines: ReceiptSourceLine[], groups: ReceiptGroupInput[]): ReceiptPlan {
  const sourceByGroup = new Map<string, ReceiptSourceLine[]>();
  for (const line of sourceLines) {
    const key = groupKey(line.styleId, line.sizeId);
    const list = sourceByGroup.get(key);
    if (list) list.push(line);
    else sourceByGroup.set(key, [line]);
  }

  const seen = new Set<string>();
  for (const group of groups) {
    const key = groupKey(group.styleId, group.sizeId);
    if (seen.has(key)) throw HttpError.badRequest('Duplicate Style / Size entries are not allowed');
    seen.add(key);
    if (!sourceByGroup.has(key)) {
      throw HttpError.badRequest('A received entry does not match any Style / Size dispatched on this Erve Dispatch');
    }
  }
  if (seen.size !== sourceByGroup.size) {
    throw HttpError.badRequest('The receipt must cover every Style / Size dispatched on this Erve Dispatch');
  }

  const lines: ReceiptPlanLine[] = [];
  for (const group of groups) {
    const members = sourceByGroup.get(groupKey(group.styleId, group.sizeId))!;
    const dispatchedTotal = members.reduce((sum, member) => sum + member.dispatchedQuantity, 0);
    assertQuantity(group.receivedQuantity, 'Received quantity');
    if (group.receivedQuantity > dispatchedTotal) {
      throw HttpError.badRequest(
        `Received quantity (${group.receivedQuantity}) cannot exceed the dispatched quantity (${dispatchedTotal})`,
      );
    }

    let resolved: Array<{ saleOrderLineId: string; receivedQuantity: number }>;
    const forced =
      members.length === 1 || group.receivedQuantity === 0 || group.receivedQuantity === dispatchedTotal;
    if (forced) {
      resolved = members.map((member) => ({
        saleOrderLineId: member.saleOrderLineId,
        receivedQuantity:
          members.length === 1
            ? group.receivedQuantity
            : group.receivedQuantity === 0
              ? 0
              : member.dispatchedQuantity,
      }));
      if (group.allocations?.length) assertAllocationsMatch(group.allocations, resolved, members);
    } else {
      if (!group.allocations?.length) {
        throw HttpError.badRequest(
          'A partial receipt of a Style / Size supplied by several Sale Order lines must be allocated to each source line',
        );
      }
      resolved = resolveExplicitAllocations(group.allocations, members, group.receivedQuantity);
    }
    for (const entry of resolved) {
      const member = members.find((m) => m.saleOrderLineId === entry.saleOrderLineId)!;
      lines.push({
        saleOrderLineId: entry.saleOrderLineId,
        dispatchedQuantity: member.dispatchedQuantity,
        receivedQuantity: entry.receivedQuantity,
      });
    }
  }

  lines.sort((a, b) => (a.saleOrderLineId < b.saleOrderLineId ? -1 : a.saleOrderLineId > b.saleOrderLineId ? 1 : 0));
  const totalDispatchedQuantity = lines.reduce((sum, line) => sum + line.dispatchedQuantity, 0);
  const totalReceivedQuantity = lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
  return {
    lines,
    totalDispatchedQuantity,
    totalReceivedQuantity,
    hasShortage: totalReceivedQuantity < totalDispatchedQuantity,
  };
}

function resolveExplicitAllocations(
  allocations: Array<{ saleOrderLineId: string; receivedQuantity: number }>,
  members: ReceiptSourceLine[],
  enteredTotal: number,
): Array<{ saleOrderLineId: string; receivedQuantity: number }> {
  const byLine = new Map<string, number>();
  for (const allocation of allocations) {
    if (byLine.has(allocation.saleOrderLineId)) {
      throw HttpError.badRequest('Duplicate source-line allocations are not allowed');
    }
    byLine.set(allocation.saleOrderLineId, allocation.receivedQuantity);
  }
  if (byLine.size !== members.length || members.some((member) => !byLine.has(member.saleOrderLineId))) {
    throw HttpError.badRequest('The allocation must cover exactly the source lines of this Style / Size');
  }
  let allocatedTotal = 0;
  const resolved = members.map((member) => {
    const quantity = byLine.get(member.saleOrderLineId)!;
    assertQuantity(quantity, 'Allocated quantity');
    if (quantity > member.dispatchedQuantity) {
      throw HttpError.badRequest(
        `Allocated quantity (${quantity}) cannot exceed the dispatched quantity of its source line (${member.dispatchedQuantity})`,
      );
    }
    allocatedTotal += quantity;
    return { saleOrderLineId: member.saleOrderLineId, receivedQuantity: quantity };
  });
  if (allocatedTotal !== enteredTotal) {
    throw HttpError.badRequest(
      `Source-line allocations total ${allocatedTotal} but ${enteredTotal} was entered for the Style / Size`,
    );
  }
  return resolved;
}

function assertAllocationsMatch(
  provided: Array<{ saleOrderLineId: string; receivedQuantity: number }>,
  forced: Array<{ saleOrderLineId: string; receivedQuantity: number }>,
  members: ReceiptSourceLine[],
): void {
  const explicit = resolveExplicitAllocations(
    provided,
    members,
    provided.reduce((sum, allocation) => sum + allocation.receivedQuantity, 0),
  );
  const expected = new Map(forced.map((entry) => [entry.saleOrderLineId, entry.receivedQuantity]));
  if (explicit.some((entry) => expected.get(entry.saleOrderLineId) !== entry.receivedQuantity)) {
    throw HttpError.badRequest('The allocation does not match the quantity entered for this Style / Size');
  }
}

/**
 * Deterministic digest of the submitted business content, used for
 * Idempotency-Key replay: order of groups/allocations, surrounding whitespace
 * in remarks and an empty allocation list never change it. expectedVersion is
 * deliberately excluded — a retry after an uncertain outcome must replay the
 * original attestation regardless of the version it was sent with.
 */
export function computeReceiptPayloadDigest(input: {
  remarks?: string | null;
  groups: ReceiptGroupInput[];
}): string {
  const groups = [...input.groups]
    .sort((a, b) => groupKey(a.styleId, a.sizeId).localeCompare(groupKey(b.styleId, b.sizeId)))
    .map((group) => ({
      styleId: group.styleId,
      sizeId: group.sizeId,
      receivedQuantity: group.receivedQuantity,
      allocations: group.allocations?.length
        ? [...group.allocations]
            .sort((a, b) => a.saleOrderLineId.localeCompare(b.saleOrderLineId))
            .map((a) => ({ saleOrderLineId: a.saleOrderLineId, receivedQuantity: a.receivedQuantity }))
        : null,
    }));
  const canonical = JSON.stringify({ remarks: input.remarks?.trim() || null, groups });
  return createHash('sha256').update(canonical).digest('hex');
}
