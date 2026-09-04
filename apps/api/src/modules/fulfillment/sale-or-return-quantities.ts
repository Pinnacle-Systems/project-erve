import type { Prisma } from '../../db/prisma.js';
import { prisma } from '../../db/prisma.js';

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

// ---------------------------------------------------------------------------
// Shared per-(erveDispatchId, saleOrderLineId) quantity helpers for the
// SALE_RETURN consignment position. This is the single source of truth for
// dispatched/received/actual-sold/returned/reserved quantities, used by
// distributor-sales-report.service.ts, distributor-return.service.ts and
// erve-dispatch.service.ts alike — avoids re-deriving this math three times
// and avoids a circular import between the sales-report and return services.
//
// Quantity model (see distributor-return.service.ts module doc for the full
// lifecycle this feeds):
//
//   dispatchedQuantity            -- historical outward-movement fact, never rewritten
//   receivedQuantity              -- confirmed "received by distributor" fact (Phase A)
//   actualSoldQuantity            -- distributor-reported ACTUAL SALE
//   returnedQuantity              -- physically RECEIVED-back-at-Erve returns
//   approvedAwaitingReceiptQuantity -- Finance-approved returns not yet physically received
//   pendingRequestedQuantity      -- Distributor return requests not yet reviewed by Finance
//
//   remainingWithDistributor = receivedQuantity - actualSoldQuantity - returnedQuantity
//   availableForActualSale   = remainingWithDistributor - approvedAwaitingReceiptQuantity
//   availableForNewReturn    = availableForActualSale - pendingRequestedQuantity
// ---------------------------------------------------------------------------

export interface SaleOrReturnPairQuantities {
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
}

export interface SaleOrReturnAvailability {
  remainingWithDistributor: number;
  availableForActualSale: number;
  availableForNewReturn: number;
}

export async function getDispatchedQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const dispatch = await client.erveDispatch.findUnique({ where: { id: erveDispatchId }, select: { ervePackingListId: true } });
  if (!dispatch) return 0;
  const rows = await client.factoryDispatchLine.findMany({
    where: { saleOrderLineId, factoryDispatch: { ervePackingSource: { ervePackingListId: dispatch.ervePackingListId } } },
    select: { packedQuantity: true },
  });
  return rows.reduce((sum, row) => sum + row.packedQuantity, 0);
}

export async function getReceivedQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const row = await client.erveDispatchDeliveryLine.findUnique({
    where: { erveDispatchId_saleOrderLineId: { erveDispatchId, saleOrderLineId } },
    select: { receivedQuantity: true },
  });
  return row?.receivedQuantity ?? 0;
}

export async function getActualSoldQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const result = await client.distributorSalesReportLine.aggregate({
    where: { erveDispatchId, saleOrderLineId },
    _sum: { quantitySold: true },
  });
  return result._sum.quantitySold ?? 0;
}

export async function getReturnedQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const result = await client.distributorReturnLine.aggregate({
    where: { erveDispatchId, saleOrderLineId, distributorReturn: { status: 'RECEIVED' } },
    _sum: { receivedQuantity: true },
  });
  return result._sum.receivedQuantity ?? 0;
}

export async function getApprovedAwaitingReceiptQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const result = await client.distributorReturnLine.aggregate({
    where: { erveDispatchId, saleOrderLineId, distributorReturn: { status: 'APPROVED' } },
    _sum: { approvedQuantity: true },
  });
  return result._sum.approvedQuantity ?? 0;
}

export async function getPendingRequestedQuantityForPair(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<number> {
  const result = await client.distributorReturnLine.aggregate({
    where: { erveDispatchId, saleOrderLineId, distributorReturn: { status: 'SUBMITTED' } },
    _sum: { requestedQuantity: true },
  });
  return result._sum.requestedQuantity ?? 0;
}

export async function getSaleOrReturnPairQuantities(
  client: Client,
  erveDispatchId: string,
  saleOrderLineId: string,
): Promise<SaleOrReturnPairQuantities> {
  const [
    dispatchedQuantity,
    receivedQuantity,
    actualSoldQuantity,
    returnedQuantity,
    approvedAwaitingReceiptQuantity,
    pendingRequestedQuantity,
  ] = await Promise.all([
    getDispatchedQuantityForPair(client, erveDispatchId, saleOrderLineId),
    getReceivedQuantityForPair(client, erveDispatchId, saleOrderLineId),
    getActualSoldQuantityForPair(client, erveDispatchId, saleOrderLineId),
    getReturnedQuantityForPair(client, erveDispatchId, saleOrderLineId),
    getApprovedAwaitingReceiptQuantityForPair(client, erveDispatchId, saleOrderLineId),
    getPendingRequestedQuantityForPair(client, erveDispatchId, saleOrderLineId),
  ]);
  return {
    dispatchedQuantity,
    receivedQuantity,
    actualSoldQuantity,
    returnedQuantity,
    approvedAwaitingReceiptQuantity,
    pendingRequestedQuantity,
  };
}

export function computeAvailability(
  q: Pick<
    SaleOrReturnPairQuantities,
    'receivedQuantity' | 'actualSoldQuantity' | 'returnedQuantity' | 'approvedAwaitingReceiptQuantity' | 'pendingRequestedQuantity'
  >,
): SaleOrReturnAvailability {
  const remainingWithDistributor = q.receivedQuantity - q.actualSoldQuantity - q.returnedQuantity;
  const availableForActualSale = remainingWithDistributor - q.approvedAwaitingReceiptQuantity;
  const availableForNewReturn = availableForActualSale - q.pendingRequestedQuantity;
  return { remainingWithDistributor, availableForActualSale, availableForNewReturn };
}

/** The advisory-lock key every sale-or-return-position mutation shares for a given pair. */
export function saleOrReturnPositionLockKey(erveDispatchId: string, saleOrderLineId: string): string {
  return `sale-or-return-position-${erveDispatchId}:${saleOrderLineId}`;
}
