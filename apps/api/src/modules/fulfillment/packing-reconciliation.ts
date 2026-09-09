import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

type Tx = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Phase 4: cartons are the sole BUSINESS physical-packing authority.
// FactoryDispatchLine.packedQuantity is a DERIVED StockAllocation-provenance
// ledger, reconciled FROM carton totals by this module — never read as the
// business "packed" number, and never the source cartons are checked
// against. Retired cartons (see FactoryPackingCarton's schema doc comment)
// are immutable historical records, excluded from every physical total here.
// ---------------------------------------------------------------------------

/** SUM(non-retired FactoryPackingCartonLine.quantity) grouped by saleOrderLineId. */
export async function getPhysicalPackedQuantitiesForLines(
  tx: Tx,
  saleOrderLineIds: string[],
): Promise<Map<string, number>> {
  if (saleOrderLineIds.length === 0) return new Map();
  const rows = await tx.factoryPackingCartonLine.groupBy({
    by: ['saleOrderLineId'],
    where: { saleOrderLineId: { in: saleOrderLineIds }, carton: { retiredAt: null } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.saleOrderLineId, r._sum.quantity ?? 0]));
}

/**
 * Recomputes (never incrementally patches) the FactoryDispatchLine
 * attribution for one SaleOrderLine against its ACTIVE StockAllocations,
 * same FIFO oldest-QaRelease-first order the original packing algorithm
 * used, so it always equals the current physical (non-retired) carton
 * total. Deletes a row that reconciles to zero rather than leaving a stale
 * zero-packed row lingering.
 */
export async function reconcileFactoryDispatchLineAttribution(
  tx: Tx,
  factoryDispatchId: string,
  saleOrderLineId: string,
): Promise<void> {
  const targetMap = await getPhysicalPackedQuantitiesForLines(tx, [saleOrderLineId]);
  let remaining = targetMap.get(saleOrderLineId) ?? 0;

  const allocations = await tx.stockAllocation.findMany({
    where: { saleOrderLineId, status: 'ACTIVE' },
    include: { qaReleaseLine: { include: { release: { select: { releasedAt: true } } } } },
  });
  const sorted = [...allocations].sort(
    (a, b) =>
      a.qaReleaseLine.release.releasedAt.getTime() - b.qaReleaseLine.release.releasedAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  for (const allocation of sorted) {
    const assign = Math.min(allocation.quantity, remaining);
    remaining -= assign;

    const existingLine = await tx.factoryDispatchLine.findUnique({
      where: { factoryDispatchId_stockAllocationId: { factoryDispatchId, stockAllocationId: allocation.id } },
    });
    if (assign > 0) {
      if (existingLine) {
        if (existingLine.packedQuantity !== assign) {
          await tx.factoryDispatchLine.update({ where: { id: existingLine.id }, data: { packedQuantity: assign } });
        }
      } else {
        await tx.factoryDispatchLine.create({
          data: {
            id: createId(),
            factoryDispatchId,
            saleOrderLineId,
            stockAllocationId: allocation.id,
            packedQuantity: assign,
          },
        });
      }
    } else if (existingLine) {
      await tx.factoryDispatchLine.delete({ where: { id: existingLine.id } });
    }
  }

  if (remaining > 0) {
    // Unreachable in normal operation: the carton ceiling check
    // (SUM(carton contents) <= SaleOrderLine.quantity, enforced at carton
    // create/update time) guarantees physical packed quantity never exceeds
    // this line's pooled reservation. Guarded defensively — an internal
    // consistency failure, never a business validation error — rather than
    // silently dropping quantity.
    throw HttpError.internal(
      `Unable to attribute all physical packed quantity for line ${saleOrderLineId} to a stock allocation`,
    );
  }
}
