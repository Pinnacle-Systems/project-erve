// Test-only snapshot of getPooledFactoryInventory at 10191be2 (pre-PAG-P1-08).
// Keep the historical query/aggregation algorithm independent of production SQL.
import type { PooledFactoryInventoryLine } from '@erve/types';
import { Prisma, prisma } from '../db/prisma.js';
import {
  stylePrimaryImageInclude,
  toPrimaryImageView,
} from '../modules/master-data/style-images.service.js';
type Client = Prisma.TransactionClient | typeof prisma;

export async function getReferencePooledFactoryInventory(
  client: Client,
  filters?: {
    factoryId?: string;
    styleId?: string;
    sizeId?: string;
    // RPT1 6.4 — reporting-only filters. "Current Style Season" (RPT0 2.3):
    // the pool is grouped by Style, and a Style's Season is a fixed,
    // point-in-time attribute, so this filters by the Style's own current
    // seasonId, never a reconstructed transaction-time Season.
    seasonId?: string;
    recordOrigin?: 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT';
    // BUG-007: when editing an existing Dispatch Order, its own ACTIVE
    // allocations are still committed against the pool and would otherwise
    // make availableQuantity understate what the edit can actually reserve
    // (the edit releases-and-re-reserves in one transaction — mirrors
    // reserveAcrossPools's effectiveAvailable in sale-orders.service.ts).
    // Passing the order being edited adds its own committed quantity back.
    excludeSaleOrderId?: string;
  },
): Promise<PooledFactoryInventoryLine[]> {
  const releaseLines = await client.qaReleaseLine.findMany({
    where: {
      jobOrderLineSize: {
        sizeId: filters?.sizeId,
        jobOrderLine: {
          styleId: filters?.styleId,
          style: filters?.seasonId ? { seasonId: filters.seasonId } : undefined,
          jobOrder: { factoryId: filters?.factoryId, recordOrigin: filters?.recordOrigin },
        },
      },
    },
    select: {
      id: true,
      quantity: true,
      jobOrderLineSize: {
        select: {
          sizeId: true,
          size: { select: { code: true, label: true, sortOrder: true } },
          jobOrderLine: {
            select: {
              styleId: true,
              style: {
                select: { styleNumber: true, styleName: true, images: stylePrimaryImageInclude },
              },
              jobOrder: {
                select: { factoryId: true, factory: { select: { code: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });

  const committed = await client.stockAllocation.groupBy({
    by: ['qaReleaseLineId'],
    where: { qaReleaseLineId: { in: releaseLines.map((line) => line.id) }, status: 'ACTIVE' },
    _sum: { quantity: true },
  });
  const committedByLine = new Map(
    committed.map((row) => [row.qaReleaseLineId, row._sum.quantity ?? 0]),
  );

  const ownCommittedByLine = filters?.excludeSaleOrderId
    ? new Map(
        (
          await client.stockAllocation.groupBy({
            by: ['qaReleaseLineId'],
            where: {
              qaReleaseLineId: { in: releaseLines.map((line) => line.id) },
              status: 'ACTIVE',
              saleOrderLine: { saleOrderId: filters.excludeSaleOrderId },
            },
            _sum: { quantity: true },
          })
        ).map((row) => [row.qaReleaseLineId, row._sum.quantity ?? 0] as const),
      )
    : new Map<string, number>();

  const pool = new Map<string, PooledFactoryInventoryLine>();
  for (const line of releaseLines) {
    const jobOrderLine = line.jobOrderLineSize.jobOrderLine;
    const jobOrder = jobOrderLine.jobOrder;
    const key = `${jobOrder.factoryId}:${jobOrderLine.styleId}:${line.jobOrderLineSize.sizeId}`;
    const committedQuantity = committedByLine.get(line.id) ?? 0;
    const ownCommittedQuantity = ownCommittedByLine.get(line.id) ?? 0;
    const availableQuantity = line.quantity - committedQuantity + ownCommittedQuantity;
    const existing = pool.get(key);
    if (existing) {
      existing.releasedQuantity += line.quantity;
      existing.committedQuantity += committedQuantity;
      existing.availableQuantity += availableQuantity;
      continue;
    }
    pool.set(key, {
      factoryId: jobOrder.factoryId,
      factoryCode: jobOrder.factory.code,
      factoryName: jobOrder.factory.name,
      styleId: jobOrderLine.styleId,
      styleNumber: jobOrderLine.style.styleNumber,
      styleName: jobOrderLine.style.styleName,
      primaryImage: toPrimaryImageView(jobOrderLine.style.images),
      sizeId: line.jobOrderLineSize.sizeId,
      sizeCode: line.jobOrderLineSize.size.code,
      sizeLabel: line.jobOrderLineSize.size.label,
      sizeSortOrder: line.jobOrderLineSize.size.sortOrder,
      releasedQuantity: line.quantity,
      committedQuantity,
      availableQuantity,
    });
  }
  return [...pool.values()];
}
