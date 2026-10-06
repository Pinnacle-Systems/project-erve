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

  const [packedRows, cartonLines] = await Promise.all([
    client.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: { saleOrderLine: { saleOrderId } },
      _sum: { packedQuantity: true },
    }),
    // Authoritative Dispatch Order -> carton provenance: FactoryDispatch has
    // exactly one root per Dispatch Order (@@unique([saleOrderId]) on
    // FactoryDispatch), so every non-retired carton found this way
    // unambiguously belongs to this Dispatch Order. ErveDispatch.saleOrderId
    // is NOT used here — Phase 6 carton consolidation can leave it null (a
    // dispatch spanning several Dispatch Orders) or scoped to only one of
    // several Dispatch Orders whose cartons were split across dispatches.
    client.factoryPackingCartonLine.findMany({
      where: { carton: { retiredAt: null, factoryDispatch: { saleOrderId } } },
      select: { quantity: true, carton: { select: { ervePackingListId: true } } },
    }),
  ]);
  const totalFactoryPackedQuantity = packedRows.reduce((sum, row) => sum + (row._sum.packedQuantity ?? 0), 0);

  const cartonPackedQuantity = cartonLines.reduce((sum, line) => sum + line.quantity, 0);
  const packingListIds = [
    ...new Set(cartonLines.map((line) => line.carton.ervePackingListId).filter((id): id is string => id !== null)),
  ];
  const dispatchStatusByPackingListId = new Map(
    packingListIds.length === 0
      ? []
      : (
          await client.erveDispatch.findMany({
            where: { ervePackingListId: { in: packingListIds } },
            select: { ervePackingListId: true, status: true },
          })
        ).map((dispatch) => [dispatch.ervePackingListId, dispatch.status]),
  );

  // Coverage, not existence (Phase 6): a Dispatch Order is ERVE_DISPATCHED/
  // DELIVERED only once ALL of its own physically packed cartons have
  // reached that stage — one dispatched Erve Dispatch among several carrying
  // this Dispatch Order's cartons must never overstate the whole order.
  let erveDispatchedQuantity = 0;
  let deliveredQuantity = 0;
  for (const line of cartonLines) {
    const packingListId = line.carton.ervePackingListId;
    if (!packingListId) continue;
    const status = dispatchStatusByPackingListId.get(packingListId);
    if (!status) continue;
    erveDispatchedQuantity += line.quantity;
    if (status === 'DELIVERED') deliveredQuantity += line.quantity;
  }

  let stage: DispatchOrderFulfillmentStage;
  if (cartonPackedQuantity > 0 && deliveredQuantity === cartonPackedQuantity) {
    stage = 'DELIVERED';
  } else if (cartonPackedQuantity > 0 && erveDispatchedQuantity === cartonPackedQuantity) {
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
