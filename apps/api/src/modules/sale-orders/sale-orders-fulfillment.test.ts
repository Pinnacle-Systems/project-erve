import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function createDistributorUser(distributorId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `dist-${createId()}@test.local`,
    password: 'pass',
    roles: ['DISTRIBUTOR'],
  });
  await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  return token;
}

async function createRoleToken(role: Role) {
  const { token } = await createTestUserAndToken({
    email: `${role.toLowerCase()}-${createId()}@test.local`,
    password: 'pass',
    roles: [role],
  });
  return token;
}

function submitSaleOrder(token: string, id: string, expectedVersion: number) {
  return request(app)
    .post(`/sale-orders/${id}/actions/submit`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion });
}

function approveSaleOrder(token: string, id: string, body: object) {
  return request(app)
    .post(`/sale-orders/${id}/actions/approve`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send(body);
}

async function createApprovedSaleOrder(quantity = 40) {
  const stock = await createReleasedQaStock({ quantity });
  const distributorToken = await createDistributorUser(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: stock.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: quantity }],
    })
    .expect(201);
  const submitted = await submitSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
    200,
  );
  const merchToken = await createRoleToken('MERCHANDISER');
  const line = submitted.body.data.lines[0];
  const approved = await approveSaleOrder(merchToken, submitted.body.data.id, {
    expectedVersion: submitted.body.data.version,
    lines: [{ saleOrderLineId: line.id, approvedQuantity: quantity }],
  }).expect(200);
  return { stock, distributorToken, merchToken, saleOrder: approved.body.data };
}

// The old manual "/actions/fulfill" action (arbitrary free-text reference, no
// quantity/line tracking) has been retired: FULFILLED is now set only
// automatically, from the physical Factory Packing -> Erve Consolidation ->
// Dispatch workflow's final recordErveDispatch transaction — see
// fulfillment-walkthrough.test.ts for that path end to end. This file covers
// only (a) the retired endpoint's absence and (b) legacy pre-milestone
// FULFILLED rows staying readable without fabricated Dispatch history.
describe('Sale Order fulfillment — legacy manual action retirement', () => {
  it('no longer exposes the manual /actions/fulfill endpoint', async () => {
    const { saleOrder, merchToken } = await createApprovedSaleOrder();

    const res = await request(app)
      .post(`/sale-orders/${saleOrder.id}/actions/fulfill`)
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: saleOrder.version });

    expect(res.status).toBe(404);
  });

  it('keeps a legacy FULFILLED sale order (no Erve Dispatch history) readable, flagged isLegacyFulfilled, with no fabricated dispatch data', async () => {
    const { saleOrder, merchToken } = await createApprovedSaleOrder();

    // Simulate a pre-milestone manually-fulfilled row directly, since the API
    // can no longer produce one — this is exactly the "legacy fulfilled"
    // shape the spec requires stay readable untouched.
    await prisma.saleOrder.update({
      where: { id: saleOrder.id },
      data: {
        status: 'FULFILLED',
        fulfilledById: (await prisma.user.findFirst({ where: { userRoles: { some: { role: { name: 'MERCHANDISER' } } } } }))!
          .id,
        fulfilledAt: new Date(),
        fulfillmentReference: 'DC-LEGACY-001',
      },
    });

    const res = await request(app)
      .get(`/sale-orders/${saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);

    expect(res.body.data.status).toBe('FULFILLED');
    expect(res.body.data.fulfillmentReference).toBe('DC-LEGACY-001');
    expect(res.body.data.fulfillment.isLegacyFulfilled).toBe(true);
    expect(res.body.data.fulfillment.totalDispatchedQuantity).toBe(0);

    const dispatchCount = await prisma.erveDispatch.count({ where: { saleOrderId: saleOrder.id } });
    expect(dispatchCount).toBe(0);
  });

  it('blocks cancellation of a FULFILLED sale order (legacy or new)', async () => {
    const { saleOrder, merchToken } = await createApprovedSaleOrder();
    await prisma.saleOrder.update({
      where: { id: saleOrder.id },
      data: { status: 'FULFILLED', fulfilledAt: new Date(), version: { increment: 1 } },
    });

    await request(app)
      .post(`/sale-orders/${saleOrder.id}/actions/cancel`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ expectedVersion: saleOrder.version + 1 })
      .expect(400);
  });
});
