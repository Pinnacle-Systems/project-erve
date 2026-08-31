import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestDistributor,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

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

function cancelSaleOrder(token: string, id: string, expectedVersion: number, reason?: string | null) {
  return request(app)
    .post(`/sale-orders/${id}/actions/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion, reason: reason ?? null });
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

// Builds an APPROVED sale order whose committed (ACTIVE) allocation is
// smaller than the requested quantity — the realistic "partial approval"
// shape from the spec: QA Released = 110, requested = 70, approved = 40.
async function createApprovedSaleOrder(options: {
  releasedQuantity: number;
  requestedQuantity: number;
  approvedQuantity: number;
  distributorId?: string;
}) {
  const stock = await createReleasedQaStock({
    quantity: options.releasedQuantity,
    distributorId: options.distributorId,
  });
  const distributorToken = await createDistributorUser(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: stock.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: options.requestedQuantity }],
    })
    .expect(201);
  const submitted = await submitSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
    200,
  );
  const merchToken = await createRoleToken('MERCHANDISER');
  const line = submitted.body.data.lines[0];
  const approved = await approveSaleOrder(merchToken, submitted.body.data.id, {
    expectedVersion: submitted.body.data.version,
    lines: [{ saleOrderLineId: line.id, approvedQuantity: options.approvedQuantity }],
  }).expect(200);
  return { stock, distributorToken, merchToken, saleOrder: approved.body.data };
}

describe('Sale Order cancellation — pre-approval statuses (regression)', () => {
  it('lets the owning distributor cancel their own DRAFT sale order', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await createDistributorUser(stock.distributorId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: stock.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 }],
      })
      .expect(201);

    const cancelled = await cancelSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
      200,
    );
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('lets the owning distributor cancel a SUBMITTED order and releases its allocation', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await createDistributorUser(stock.distributorId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: stock.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 }],
      })
      .expect(201);
    const submitted = await submitSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
      200,
    );

    const cancelled = await cancelSaleOrder(
      distributorToken,
      submitted.body.data.id,
      submitted.body.data.version,
    ).expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const allocations = await prisma.stockAllocation.findMany({ where: { qaReleaseLineId: stock.qaReleaseLineId } });
    expect(allocations.every((a) => a.status === 'RELEASED')).toBe(true);
  });

  it('does not let a merchandiser cancel a distributor’s private DRAFT order', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await createDistributorUser(stock.distributorId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: stock.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 }],
      })
      .expect(201);

    const merchToken = await createRoleToken('MERCHANDISER');
    await cancelSaleOrder(merchToken, created.body.data.id, created.body.data.version).expect(400);
  });

  it('does not let an unrelated distributor cancel another distributor’s DRAFT order', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await createDistributorUser(stock.distributorId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: stock.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 }],
      })
      .expect(201);

    const otherDistributor = await createTestDistributor();
    const otherToken = await createDistributorUser(otherDistributor.id);
    await cancelSaleOrder(otherToken, created.body.data.id, created.body.data.version).expect(403);
  });
});

describe('Sale Order cancellation — APPROVED (stock unwind)', () => {
  it('lets ADMIN cancel an APPROVED sale order', async () => {
    const { saleOrder } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });
    const adminToken = await createRoleToken('ADMIN');

    const cancelled = await cancelSaleOrder(adminToken, saleOrder.id, saleOrder.version).expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('lets MERCHANDISER cancel an APPROVED sale order', async () => {
    const { saleOrder, merchToken } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });

    const cancelled = await cancelSaleOrder(merchToken, saleOrder.id, saleOrder.version).expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('does not let the owning DISTRIBUTOR cancel an APPROVED sale order', async () => {
    const { saleOrder, distributorToken } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });

    await cancelSaleOrder(distributorToken, saleOrder.id, saleOrder.version).expect(400);
    const reloaded = await prisma.saleOrder.findUniqueOrThrow({ where: { id: saleOrder.id } });
    expect(reloaded.status).toBe('APPROVED');
  });

  it('does not let an unrelated DISTRIBUTOR cancel another distributor’s APPROVED sale order', async () => {
    const { saleOrder } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });
    const otherDistributor = await createTestDistributor();
    const otherToken = await createDistributorUser(otherDistributor.id);

    await cancelSaleOrder(otherToken, saleOrder.id, saleOrder.version).expect(403);
  });

  it.each(['QA_USER', 'FACTORY_USER', 'ACCOUNTANT', 'SENIOR_MANAGEMENT'] satisfies Role[])(
    'does not let %s cancel an APPROVED sale order',
    async (role) => {
      const { saleOrder } = await createApprovedSaleOrder({
        releasedQuantity: 110,
        requestedQuantity: 70,
        approvedQuantity: 40,
      });
      const token = await createRoleToken(role);

      const res = await cancelSaleOrder(token, saleOrder.id, saleOrder.version);
      expect([403, 401]).toContain(res.status);
    },
  );

  it('releases ACTIVE allocations, restores availability, and preserves requested/approved history (partial-approval scenario)', async () => {
    const { stock, saleOrder } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });
    const line = saleOrder.lines[0];

    const activeBefore = await prisma.stockAllocation.findMany({
      where: { saleOrderLineId: line.id, status: 'ACTIVE' },
    });
    expect(activeBefore.reduce((sum, a) => sum + a.quantity, 0)).toBe(40);
    const availableBefore =
      stock.quantity - (await prisma.stockAllocation.aggregate({
        where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'ACTIVE' },
        _sum: { quantity: true },
      }))._sum.quantity!;
    expect(availableBefore).toBe(70);

    const adminToken = await createRoleToken('ADMIN');
    const cancelled = await cancelSaleOrder(adminToken, saleOrder.id, saleOrder.version).expect(200);

    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.lines[0]).toMatchObject({ requestedQuantity: 70, approvedQuantity: 40 });

    const allocationsAfter = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: line.id } });
    expect(allocationsAfter.every((a) => a.status === 'RELEASED')).toBe(true);
    const activeAfter = allocationsAfter.filter((a) => a.status === 'ACTIVE');
    expect(activeAfter).toHaveLength(0);

    const committedAfter = await prisma.stockAllocation.aggregate({
      where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    const availableAfter = stock.quantity - (committedAfter._sum.quantity ?? 0);
    expect(availableAfter).toBe(110);

    const releaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({ where: { id: stock.qaReleaseLineId } });
    expect(releaseLine.quantity).toBe(110);

    const dbLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(dbLine.requestedQuantity).toBe(70);
    expect(dbLine.approvedQuantity).toBe(40);
  });

  it('releases cross-distributor (MERCHANDISER_REASSIGNMENT) allocations back to their original source on cancellation', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await createDistributorUser(stock.distributorId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: stock.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 }],
      })
      .expect(201);
    const submitted = await submitSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
      200,
    );
    const otherDistributorStock = await createReleasedQaStock({ quantity: 15 });
    const merchToken = await createRoleToken('MERCHANDISER');
    const line = submitted.body.data.lines[0];

    const approved = await approveSaleOrder(merchToken, submitted.body.data.id, {
      expectedVersion: submitted.body.data.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 35,
          sourcing: [
            {
              qaReleaseLineId: otherDistributorStock.qaReleaseLineId,
              quantity: 15,
              reason: 'Urgent rebalancing across distributors',
            },
          ],
        },
      ],
    }).expect(200);
    expect(approved.body.data.status).toBe('APPROVED');

    const adminToken = await createRoleToken('ADMIN');
    const cancelled = await cancelSaleOrder(adminToken, approved.body.data.id, approved.body.data.version).expect(
      200,
    );
    expect(cancelled.body.data.status).toBe('CANCELLED');

    // Both the distributor's own allocation and the reassigned one release.
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: line.id } });
    expect(allocations.every((a) => a.status === 'RELEASED')).toBe(true);
    expect(allocations.some((a) => a.qaReleaseLineId === stock.qaReleaseLineId)).toBe(true);
    expect(allocations.some((a) => a.qaReleaseLineId === otherDistributorStock.qaReleaseLineId)).toBe(true);

    // Availability returns under the reassigned stock's OWN source release
    // line — never "transferred" onto the recipient distributor's pool.
    const reassignedCommitted = await prisma.stockAllocation.aggregate({
      where: { qaReleaseLineId: otherDistributorStock.qaReleaseLineId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    expect(reassignedCommitted._sum.quantity ?? 0).toBe(0);
    const otherReleaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({
      where: { id: otherDistributorStock.qaReleaseLineId },
    });
    expect(otherReleaseLine.purchaseOrderLineSizeId).toBe(otherDistributorStock.purchaseOrderLineSizeId);
  });

  it('rejects cancelling an already-CANCELLED sale order (idempotency/duplicate protection)', async () => {
    const { saleOrder } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });
    const adminToken = await createRoleToken('ADMIN');

    const first = await cancelSaleOrder(adminToken, saleOrder.id, saleOrder.version).expect(200);
    expect(first.body.data.status).toBe('CANCELLED');

    const second = await cancelSaleOrder(adminToken, saleOrder.id, first.body.data.version).expect(400);
    expect(second.body.error).toBeDefined();

    const allocationsAfterDuplicate = await prisma.stockAllocation.findMany({
      where: { saleOrderLine: { saleOrderId: saleOrder.id } },
    });
    expect(allocationsAfterDuplicate.every((a) => a.status === 'RELEASED')).toBe(true);
  });

  it('records an audit entry capturing the actor, the prior APPROVED status, and released allocations', async () => {
    const { saleOrder } = await createApprovedSaleOrder({
      releasedQuantity: 110,
      requestedQuantity: 70,
      approvedQuantity: 40,
    });
    const { userId: adminUserId, token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    await cancelSaleOrder(adminToken, saleOrder.id, saleOrder.version).expect(200);

    const auditEntry = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: saleOrder.id, action: 'SALE_ORDER_CANCELLED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditEntry.actorId).toBe(adminUserId);
    expect(auditEntry.metadata).toMatchObject({ previousStatus: 'APPROVED', releasedAllocationCount: 1 });
  });
});
