import type { EligibleStockLine, GlobalInventoryLine } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

export interface AvailabilityRow {
  released: number;
  committed: number;
  available: number;
}

// The single implementation of "how much of a QA release line is still free
// to allocate" — released quantity minus the sum of ACTIVE StockAllocation
// rows against it. Deliberately not denormalized onto QaReleaseLine (which
// must stay immutable) or the existing-but-unused
// DistributorPurchaseOrderLineSize.saleOrderedQuantity placeholder — this is
// the one place that recomputes it, from the StockAllocation ledger, every
// time. Call this AFTER acquiring the relevant advisory locks when used
// inside a mutating transaction; read-only call sites (list/detail/inventory
// views) accept ordinary read-committed staleness like any other list view.
export async function getAvailableQuantities(
  client: Client,
  qaReleaseLineIds: string[],
): Promise<Map<string, AvailabilityRow>> {
  const result = new Map<string, AvailabilityRow>();
  if (qaReleaseLineIds.length === 0) return result;

  const [releaseLines, committed] = await Promise.all([
    client.qaReleaseLine.findMany({
      where: { id: { in: qaReleaseLineIds } },
      select: { id: true, quantity: true },
    }),
    client.stockAllocation.groupBy({
      by: ['qaReleaseLineId'],
      where: { qaReleaseLineId: { in: qaReleaseLineIds }, status: 'ACTIVE' },
      _sum: { quantity: true },
    }),
  ]);

  const committedByLine = new Map(committed.map((row) => [row.qaReleaseLineId, row._sum.quantity ?? 0]));
  for (const line of releaseLines) {
    const committedQuantity = committedByLine.get(line.id) ?? 0;
    result.set(line.id, {
      released: line.quantity,
      committed: committedQuantity,
      available: line.quantity - committedQuantity,
    });
  }
  return result;
}

// A distributor's own available-to-request stock, aggregated to the PO
// line/size granularity a Sale Order line is created against (the same
// granularity qaPassedQuantity is already exposed at). Multiple QA release
// lines can feed one PO line/size (multiple Final batches over time) —
// they're summed here.
export async function getEligibleStockForDistributor(
  distributorId: string,
): Promise<EligibleStockLine[]> {
  const releaseLines = await prisma.qaReleaseLine.findMany({
    where: { purchaseOrderLineSize: { purchaseOrderLine: { purchaseOrder: { distributorId } } } },
    select: {
      id: true,
      purchaseOrderLineSize: {
        select: {
          id: true,
          sizeId: true,
          size: { select: { code: true, label: true } },
          purchaseOrderLine: {
            select: {
              purchaseOrderId: true,
              styleId: true,
              style: { select: { styleNumber: true, styleName: true } },
              purchaseOrder: { select: { poNumber: true } },
            },
          },
        },
      },
    },
  });

  const availability = await getAvailableQuantities(
    prisma,
    releaseLines.map((line) => line.id),
  );

  const byLineSize = new Map<string, EligibleStockLine>();
  for (const line of releaseLines) {
    const availabilityRow = availability.get(line.id);
    if (!availabilityRow) continue;
    const pols = line.purchaseOrderLineSize;
    const pol = pols.purchaseOrderLine;
    const existing = byLineSize.get(pols.id);
    if (existing) {
      existing.releasedQuantity += availabilityRow.released;
      existing.committedQuantity += availabilityRow.committed;
      existing.availableQuantity += availabilityRow.available;
      continue;
    }
    byLineSize.set(pols.id, {
      purchaseOrderLineSizeId: pols.id,
      purchaseOrderId: pol.purchaseOrderId,
      poNumber: pol.purchaseOrder.poNumber,
      styleId: pol.styleId,
      styleNumber: pol.style.styleNumber,
      styleName: pol.style.styleName,
      sizeId: pols.sizeId,
      sizeCode: pols.size.code,
      sizeLabel: pols.size.label,
      releasedQuantity: availabilityRow.released,
      committedQuantity: availabilityRow.committed,
      availableQuantity: availabilityRow.available,
    });
  }
  return [...byLineSize.values()];
}

// The global, release-line-granular inventory view for merchandisers —
// spans every distributor's released stock, used to pick sourcing when
// approving an increase. Deliberately release-line granular (not aggregated
// like the distributor-facing eligible-stock view) so a merchandiser can see
// and choose between individual release batches/job orders.
export async function getGlobalInventory(filters: {
  styleId?: string;
  sizeId?: string;
  distributorId?: string;
  onlyAvailable?: boolean;
}): Promise<GlobalInventoryLine[]> {
  const releaseLines = await prisma.qaReleaseLine.findMany({
    where: {
      purchaseOrderLineSize: {
        sizeId: filters.sizeId,
        purchaseOrderLine: {
          styleId: filters.styleId,
          purchaseOrder: { distributorId: filters.distributorId },
        },
      },
    },
    select: {
      id: true,
      release: {
        select: {
          releasedAt: true,
          jobOrder: {
            select: {
              id: true,
              jobOrderNumber: true,
              factory: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
      purchaseOrderLineSize: {
        select: {
          sizeId: true,
          size: { select: { code: true, label: true } },
          purchaseOrderLine: {
            select: {
              purchaseOrderId: true,
              styleId: true,
              style: { select: { styleNumber: true, styleName: true } },
              purchaseOrder: {
                select: {
                  poNumber: true,
                  distributor: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const availability = await getAvailableQuantities(
    prisma,
    releaseLines.map((line) => line.id),
  );

  const rows: GlobalInventoryLine[] = [];
  for (const line of releaseLines) {
    const availabilityRow = availability.get(line.id);
    if (!availabilityRow) continue;
    if (filters.onlyAvailable && availabilityRow.available <= 0) continue;
    const pols = line.purchaseOrderLineSize;
    const pol = pols.purchaseOrderLine;
    rows.push({
      qaReleaseLineId: line.id,
      distributor: pol.purchaseOrder.distributor,
      purchaseOrder: { id: pol.purchaseOrderId, poNumber: pol.purchaseOrder.poNumber },
      jobOrder: { id: line.release.jobOrder.id, jobOrderNumber: line.release.jobOrder.jobOrderNumber },
      factory: line.release.jobOrder.factory,
      styleId: pol.styleId,
      styleNumber: pol.style.styleNumber,
      styleName: pol.style.styleName,
      sizeId: pols.sizeId,
      sizeCode: pols.size.code,
      sizeLabel: pols.size.label,
      releasedQuantity: availabilityRow.released,
      committedQuantity: availabilityRow.committed,
      availableQuantity: availabilityRow.available,
      releasedAt: line.release.releasedAt.toISOString(),
    });
  }
  return rows;
}

// Resolves the owning distributorId for a set of QA release lines, needed by
// the approve algorithm to classify each sourcing entry as
// MERCHANDISER_ADJUSTMENT (same distributor) vs MERCHANDISER_REASSIGNMENT
// (different distributor).
export async function getReleaseLineDistributorIds(
  client: Client,
  qaReleaseLineIds: string[],
): Promise<Map<string, string>> {
  if (qaReleaseLineIds.length === 0) return new Map();
  const rows = await client.qaReleaseLine.findMany({
    where: { id: { in: qaReleaseLineIds } },
    select: {
      id: true,
      purchaseOrderLineSize: {
        select: { purchaseOrderLine: { select: { purchaseOrder: { select: { distributorId: true } } } } },
      },
    },
  });
  return new Map(
    rows.map((row) => [row.id, row.purchaseOrderLineSize.purchaseOrderLine.purchaseOrder.distributorId]),
  );
}
