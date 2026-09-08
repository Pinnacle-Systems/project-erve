import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import type { Express } from 'express';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestUserAndToken, type ReleasedQaStock } from '../../test/helpers.js';

export async function createRoleToken(role: Role) {
  const { userId, token } = await createTestUserAndToken({
    email: `${role.toLowerCase()}-${createId()}@test.local`,
    password: 'pass',
    roles: [role],
  });
  return { userId, token };
}

export async function createDistributorToken(distributorId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `dist-${createId()}@test.local`,
    password: 'pass',
    roles: ['DISTRIBUTOR'],
  });
  await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  return token;
}

/**
 * Confirms full receipt (no shortage) for an Erve Dispatch — the Phase A
 * delivery-confirmation step DistributorSalesReport/DistributorReturn now
 * require before their ceiling checks admit any quantity. Defaults
 * `receivedQuantity` to `packedQuantity` for every line unless overridden.
 */
export async function confirmErveDispatchDelivery(
  app: Express,
  token: string,
  dispatchId: string,
  expectedVersion: number,
  lines: Array<{ saleOrderLineId: string; receivedQuantity: number }>,
  remarks?: string,
) {
  return request(app)
    .patch(`/erve-dispatches/${dispatchId}/delivery`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion, lines, remarks })
    .expect(200);
}

export async function createFactoryUserToken(factoryId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  await prisma.userFactory.create({ data: { id: createId(), userId, factoryId } });
  return token;
}

/**
 * Dispatch Order Phase 3: creation itself is the sole allocation point —
 * builds a Dispatch Order for `quantity`, sourced entirely from ONE
 * Factory's pooled released stock, as a MERCHANDISER (no distributor
 * submit/review/approve workflow exists any more). `purchaseMode` controls
 * the Distributor's own purchaseMode (Purchase Mode is Distributor-owned —
 * see invoice-handoff.service.ts for why this, not physical StockAllocation
 * source, drives invoice eligibility).
 */
export async function createSingleFactoryApprovedSaleOrder(
  app: Express,
  quantity = 40,
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT',
) {
  const stock = await createReleasedQaStock({ quantity, purchaseMode });
  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [
        { clientKey: 'd1', addressLine1: 'Test Address', city: 'Chennai', state: 'TN', country: 'India' },
      ],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity }],
    })
    .expect(201);

  const saleOrder = created.body.data;
  const line = saleOrder.lines[0];
  const allocation = await prisma.stockAllocation.findFirstOrThrow({
    where: { saleOrderLineId: line.id, status: 'ACTIVE' },
  });
  const distributorToken = await createDistributorToken(stock.distributorId);

  return {
    stock,
    distributorToken,
    merchToken,
    saleOrder,
    saleOrderLineId: line.id as string,
    stockAllocationId: allocation.id,
  };
}

export interface FixtureSaleOrder {
  id: string;
  version: number;
  status: string;
  lines: Array<{ id: string; quantity: number }>;
}

export interface TwoBatchSaleOrder {
  saleOrder: FixtureSaleOrder;
  saleOrderLineId: string;
  distributorToken: string;
  merchToken: string;
  factoryId: string;
  batchA: { stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
  batchB: { stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
}

/**
 * One Dispatch Order line whose full quantity is sourced from TWO different
 * Job Orders' QA-released stock at the SAME Factory (a Dispatch Order is
 * always single-factory by construction — see the Phase 3 plan; the old
 * cross-FACTORY sourcing-within-one-order scenario this fixture used to
 * exercise no longer exists). Exercises the deterministic oldest-release-
 * first allocation planner spanning multiple QaReleaseLines.
 */
export async function createTwoBatchApprovedSaleOrder(
  app: Express,
  quantityA: number,
  quantityB: number,
): Promise<TwoBatchSaleOrder> {
  const stockA = await createReleasedQaStock({ quantity: quantityA, releasedAt: new Date('2026-01-01') });
  const stockB = await createReleasedQaStock({
    distributorId: stockA.distributorId,
    styleId: stockA.styleId,
    sizeId: stockA.sizeId,
    factoryId: stockA.factoryId,
    quantity: quantityB,
    releasedAt: new Date('2026-02-01'),
  });

  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const totalQuantity = quantityA + quantityB;
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributorId: stockA.distributorId,
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      destinations: [
        { clientKey: 'd1', addressLine1: 'Test Address', city: 'Chennai', state: 'TN', country: 'India' },
      ],
      lines: [{ destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: totalQuantity }],
    })
    .expect(201);

  const saleOrder = created.body.data;
  const line = saleOrder.lines[0];
  const allocations = await prisma.stockAllocation.findMany({
    where: { saleOrderLineId: line.id, status: 'ACTIVE' },
  });
  const allocationA = allocations.find((a) => a.qaReleaseLineId === stockA.qaReleaseLineId)!;
  const allocationB = allocations.find((a) => a.qaReleaseLineId === stockB.qaReleaseLineId)!;
  const distributorToken = await createDistributorToken(stockA.distributorId);

  return {
    saleOrder,
    saleOrderLineId: line.id as string,
    distributorToken,
    merchToken,
    factoryId: stockA.factoryId,
    batchA: { stock: stockA, stockAllocationId: allocationA.id, quantity: quantityA },
    batchB: { stock: stockB, stockAllocationId: allocationB.id, quantity: quantityB },
  };
}
