import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

type Client = Prisma.TransactionClient | typeof prisma;

export interface ResolvedFactory {
  id: string;
  code: string;
  name: string;
}

// The single authoritative "which Factory physically owns this allocated
// stock?" resolver. Walks StockAllocation -> QaReleaseLine -> QaRelease ->
// JobOrder.factoryId — per the fulfillment audit, no factoryId is
// denormalized anywhere higher up this chain, and every FK along it is
// required and single-valued (StockAllocation.qaReleaseLineId,
// QaReleaseLine.qaReleaseId, QaRelease.jobOrderId, JobOrder.factoryId), so
// this always resolves to exactly one Factory. Never infer Factory from the
// Sale Order itself, which may be sourced from multiple Factories across its
// allocations (MERCHANDISER_REASSIGNMENT, multiple Job Orders, etc.).
export async function resolveAllocationFactories(
  client: Client,
  stockAllocationIds: string[],
): Promise<Map<string, ResolvedFactory>> {
  if (stockAllocationIds.length === 0) return new Map();
  const rows = await client.stockAllocation.findMany({
    where: { id: { in: stockAllocationIds } },
    select: {
      id: true,
      qaReleaseLine: {
        select: {
          release: {
            select: { jobOrder: { select: { factory: { select: { id: true, code: true, name: true } } } } },
          },
        },
      },
    },
  });
  return new Map(rows.map((row) => [row.id, row.qaReleaseLine.release.jobOrder.factory]));
}

export async function resolveAllocationFactory(client: Client, stockAllocationId: string): Promise<ResolvedFactory> {
  const map = await resolveAllocationFactories(client, [stockAllocationId]);
  const factory = map.get(stockAllocationId);
  if (!factory) throw HttpError.notFound(`Stock allocation ${stockAllocationId} not found`);
  return factory;
}
