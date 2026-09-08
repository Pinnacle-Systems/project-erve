import { Prisma, prisma } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

// Dispatch Order Phase 3: the old "Fulfillment Progress" concept
// (remainingToPackQuantity/remainingToDispatchQuantity, PARTIALLY_*
// stages, isLegacyFulfilled) does not exist for a Dispatch Order — there is
// no partial-fulfilment lifecycle. This is a small set of discrete
// operational facts derived from FactoryDispatch/ErveDispatch state, never
// a percentage/remaining-balance computation.
export type DispatchOrderFulfillmentStage =
  | 'AWAITING_PACKING'
  | 'PACKING_IN_PROGRESS'
  | 'FACTORY_DISPATCHED'
  | 'ERVE_DISPATCHED'
  | 'DELIVERED';

export interface DispatchOrderFulfillmentSummary {
  stage: DispatchOrderFulfillmentStage;
  totalQuantity: number;
  totalFactoryPackedQuantity: number;
}

export async function computeDispatchOrderFulfillment(
  client: Client,
  saleOrderId: string,
  lines: Array<{ quantity: number }>,
): Promise<DispatchOrderFulfillmentSummary> {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const [packedRows, erveDispatch] = await Promise.all([
    client.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: { saleOrderLine: { saleOrderId } },
      _sum: { packedQuantity: true },
    }),
    client.erveDispatch.findFirst({ where: { saleOrderId }, select: { status: true } }),
  ]);
  const totalFactoryPackedQuantity = packedRows.reduce((sum, row) => sum + (row._sum.packedQuantity ?? 0), 0);

  let stage: DispatchOrderFulfillmentStage;
  if (erveDispatch?.status === 'DELIVERED') {
    stage = 'DELIVERED';
  } else if (erveDispatch) {
    stage = 'ERVE_DISPATCHED';
  } else {
    const readyFactoryDispatchCount = await client.factoryDispatch.count({
      where: { saleOrderId, status: 'READY_FOR_ERVE' },
    });
    if (readyFactoryDispatchCount > 0) {
      stage = 'FACTORY_DISPATCHED';
    } else if (totalFactoryPackedQuantity > 0) {
      stage = 'PACKING_IN_PROGRESS';
    } else {
      stage = 'AWAITING_PACKING';
    }
  }

  return { stage, totalQuantity, totalFactoryPackedQuantity };
}
