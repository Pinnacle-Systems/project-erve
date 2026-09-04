import type { SaleOrderFulfillmentStage, SaleOrderFulfillmentSummary } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import type { SaleOrderStatus } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

// The single authoritative "how far has this Sale Order physically
// progressed?" computation. Deliberately read-time-derived, never persisted
// on SaleOrder.status (which stays APPROVED throughout packing/consolidation/
// partial dispatch — see the fulfillment schema module doc). factoryPacked
// counts ALL FactoryDispatchLine rows (DRAFT + READY_FOR_ERVE) against a
// line — "physically packed at the Factory so far" — while dispatched only
// counts lines whose FactoryDispatch has been consolidated into an
// ErvePackingList that itself has a recorded ErveDispatch.
export async function computeSaleOrderFulfillmentProgress(
  client: Client,
  saleOrderId: string,
  order: { status: SaleOrderStatus },
  lines: Array<{ id: string; approvedQuantity: number | null }>,
): Promise<SaleOrderFulfillmentSummary> {
  const [packedRows, dispatchedRows, unconsolidatedReadyCount, erveDispatchCount] = await Promise.all([
    client.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: { saleOrderLine: { saleOrderId } },
      _sum: { packedQuantity: true },
    }),
    client.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: {
        saleOrderLine: { saleOrderId },
        factoryDispatch: { ervePackingSource: { ervePackingList: { status: 'DISPATCHED' } } },
      },
      _sum: { packedQuantity: true },
    }),
    client.factoryDispatch.count({ where: { saleOrderId, status: 'READY_FOR_ERVE', ervePackingSource: null } }),
    client.erveDispatch.count({ where: { saleOrderId } }),
  ]);

  const packedByLine = new Map(packedRows.map((row) => [row.saleOrderLineId, row._sum.packedQuantity ?? 0]));
  const dispatchedByLine = new Map(dispatchedRows.map((row) => [row.saleOrderLineId, row._sum.packedQuantity ?? 0]));

  const lineProgress = lines.map((line) => {
    const approvedQuantity = line.approvedQuantity ?? 0;
    const factoryPackedQuantity = packedByLine.get(line.id) ?? 0;
    const dispatchedQuantity = dispatchedByLine.get(line.id) ?? 0;
    return {
      saleOrderLineId: line.id,
      approvedQuantity,
      factoryPackedQuantity,
      dispatchedQuantity,
      remainingToPackQuantity: Math.max(approvedQuantity - factoryPackedQuantity, 0),
      remainingToDispatchQuantity: Math.max(approvedQuantity - dispatchedQuantity, 0),
    };
  });

  const totalApprovedQuantity = lineProgress.reduce((sum, line) => sum + line.approvedQuantity, 0);
  const totalFactoryPackedQuantity = lineProgress.reduce((sum, line) => sum + line.factoryPackedQuantity, 0);
  const totalDispatchedQuantity = lineProgress.reduce((sum, line) => sum + line.dispatchedQuantity, 0);

  let stage: SaleOrderFulfillmentStage;
  if (order.status === 'FULFILLED') {
    stage = 'DISPATCHED_IN_FULL';
  } else if (order.status !== 'APPROVED') {
    stage = 'NOT_APPLICABLE';
  } else if (totalDispatchedQuantity > 0) {
    stage = 'PARTIALLY_DISPATCHED';
  } else if (unconsolidatedReadyCount > 0) {
    stage = 'READY_FOR_ERVE_PACKING';
  } else if (totalFactoryPackedQuantity > 0) {
    stage = 'PARTIALLY_FACTORY_PACKED';
  } else {
    stage = 'AWAITING_FACTORY_PACKING';
  }

  return {
    stage,
    totalApprovedQuantity,
    totalFactoryPackedQuantity,
    totalDispatchedQuantity,
    lines: lineProgress,
    isLegacyFulfilled: order.status === 'FULFILLED' && erveDispatchCount === 0,
  };
}
