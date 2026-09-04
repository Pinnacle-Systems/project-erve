import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import type { Express } from 'express';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestFactory, createTestUserAndToken, type ReleasedQaStock } from '../../test/helpers.js';

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
 * Builds a Sale Order approved for `quantity`, sourced entirely from ONE
 * Factory's released stock via the normal DISTRIBUTOR_REQUEST submit path.
 * `purchaseMode` controls the COMMERCIAL Purchase Order backing this Sale
 * Order's single line — see invoice-handoff.service.ts for why this (not the
 * physical StockAllocation source) is what drives invoice eligibility.
 */
export async function createSingleFactoryApprovedSaleOrder(
  app: Express,
  quantity = 40,
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT',
) {
  const stock = await createReleasedQaStock({ quantity, purchaseMode });
  const distributorToken = await createDistributorToken(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: stock.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: quantity }],
    })
    .expect(201);
  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const submitted = await request(app)
    .post(`/sale-orders/${created.body.data.id}/actions/submit`)
    .set('Authorization', `Bearer ${distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: created.body.data.version })
    .expect(200);
  const line = submitted.body.data.lines[0];
  const approved = await request(app)
    .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: submitted.body.data.version, lines: [{ saleOrderLineId: line.id, approvedQuantity: quantity }] })
    .expect(200);

  const saleOrder = approved.body.data;
  const allocation = saleOrder.lines[0].allocations[0];
  return { stock, distributorToken, merchToken, saleOrder, saleOrderLineId: line.id, stockAllocationId: allocation.id as string };
}

export interface FixtureSaleOrder {
  id: string;
  version: number;
  status: string;
  lines: Array<{ id: string; allocations: Array<{ id: string; quantity: number }> }>;
}

export interface TwoFactorySaleOrder {
  saleOrder: FixtureSaleOrder;
  saleOrderLineId: string;
  distributorToken: string;
  merchToken: string;
  factoryA: { id: string; stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
  factoryB: { id: string; stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
}

/**
 * The acceptance-scenario fixture: one Sale Order line whose approved
 * quantity is sourced from TWO different Factories' released stock — Factory
 * A via the distributor's own submit-time DISTRIBUTOR_REQUEST allocation,
 * Factory B via a same-distributor MERCHANDISER_ADJUSTMENT sourced at
 * approval time from a different released batch. Both release lines share
 * the same distributor/style/size but are independent PO line/sizes (a
 * distributor's stock commonly spans multiple Job Orders/Factories for the
 * same style/size — see the fulfillment audit Q1-3).
 */
export async function createTwoFactoryApprovedSaleOrder(
  app: Express,
  quantityA: number,
  quantityB: number,
): Promise<TwoFactorySaleOrder> {
  const factoryA = await createTestFactory();
  const factoryB = await createTestFactory();
  const stockA = await createReleasedQaStock({ factoryId: factoryA.id, quantity: quantityA });
  const stockB = await createReleasedQaStock({
    distributorId: stockA.distributorId,
    styleId: stockA.styleId,
    sizeId: stockA.sizeId,
    factoryId: factoryB.id,
    quantity: quantityB,
  });

  const distributorToken = await createDistributorToken(stockA.distributorId);
  const totalQuantity = quantityA + quantityB;
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: stockA.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stockA.purchaseOrderLineSizeId, requestedQuantity: totalQuantity }],
    })
    .expect(201);
  const submitted = await request(app)
    .post(`/sale-orders/${created.body.data.id}/actions/submit`)
    .set('Authorization', `Bearer ${distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: created.body.data.version })
    .expect(200);
  // Submit best-effort-allocates up to quantityA from the distributor's own
  // (Factory A backed) release line — matches DISTRIBUTOR_REQUEST semantics.
  const line = submitted.body.data.lines[0];

  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const approved = await request(app)
    .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion: submitted.body.data.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: totalQuantity,
          sourcing: [{ qaReleaseLineId: stockB.qaReleaseLineId, quantity: quantityB }],
        },
      ],
    })
    .expect(200);

  const saleOrder = approved.body.data;
  const allocations: Array<{ id: string; quantity: number }> = saleOrder.lines[0].allocations;
  const allocationA = allocations.find((a) => a.quantity === quantityA)!;
  const allocationB = allocations.find((a) => a.quantity === quantityB)!;

  return {
    saleOrder,
    saleOrderLineId: line.id,
    distributorToken,
    merchToken,
    factoryA: { id: factoryA.id, stock: stockA, stockAllocationId: allocationA.id, quantity: quantityA },
    factoryB: { id: factoryB.id, stock: stockB, stockAllocationId: allocationB.id, quantity: quantityB },
  };
}
