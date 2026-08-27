import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
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

async function createMerchandiserToken() {
  const { token } = await createTestUserAndToken({
    email: `merch-${createId()}@test.local`,
    password: 'pass',
    roles: ['MERCHANDISER'],
  });
  return token;
}

// Builds a SUBMITTED sale order (one line) for a freshly seeded QA release,
// and returns everything a test typically needs to then approve it.
async function createSubmittedSaleOrder(requestedQuantity: number, releasedQuantity = requestedQuantity) {
  const stock = await createReleasedQaStock({ quantity: releasedQuantity });
  const distributorToken = await createDistributorUser(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: stock.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity }],
    })
    .expect(201);
  const submitted = await request(app)
    .post(`/sale-orders/${created.body.data.id}/actions/submit`)
    .set('Authorization', `Bearer ${distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: created.body.data.version })
    .expect(200);
  return { stock, distributorToken, saleOrder: submitted.body.data };
}

function approve(token: string, id: string, body: object, key = createId()) {
  return request(app)
    .post(`/sale-orders/${id}/actions/approve`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}

describe('Sale Order approval', () => {
  it('approves the exact requested quantity unchanged', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(40);
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 40 }],
    }).expect(200);

    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.lines[0]).toMatchObject({ requestedQuantity: 40, approvedQuantity: 40 });
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: line.id } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 40, status: 'ACTIVE' });

    const auditActions = await prisma.auditLog.findMany({ where: { entityId: line.id } });
    expect(auditActions.some((a) => a.action === 'SALE_ORDER_LINE_APPROVED')).toBe(true);
  });

  it('releases the excess back to availability on a reduced approval, keeping requestedQuantity untouched', async () => {
    const { stock, saleOrder } = await createSubmittedSaleOrder(50);
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 30 }],
    }).expect(200);

    expect(res.body.data.lines[0]).toMatchObject({ requestedQuantity: 50, approvedQuantity: 30 });
    const active = await prisma.stockAllocation.findMany({
      where: { saleOrderLineId: line.id, status: 'ACTIVE' },
    });
    expect(active.reduce((sum, a) => sum + a.quantity, 0)).toBe(30);

    const availableAfter = stock.quantity - active.reduce((sum, a) => sum + a.quantity, 0);
    expect(availableAfter).toBe(20);

    const dbLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(dbLine.requestedQuantity).toBe(50);
  });

  it('sources an increase from the same distributor’s other purchase order', async () => {
    const { stock, distributorToken, saleOrder } = await createSubmittedSaleOrder(20);
    const otherStock = await createReleasedQaStock({ quantity: 15, distributorId: stock.distributorId });
    void distributorToken;
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 35,
          sourcing: [{ qaReleaseLineId: otherStock.qaReleaseLineId, quantity: 15 }],
        },
      ],
    }).expect(200);

    expect(res.body.data.lines[0]).toMatchObject({ requestedQuantity: 20, approvedQuantity: 35 });
    const newAllocation = await prisma.stockAllocation.findFirstOrThrow({
      where: { saleOrderLineId: line.id, qaReleaseLineId: otherStock.qaReleaseLineId },
    });
    expect(newAllocation).toMatchObject({ quantity: 15, allocationSource: 'MERCHANDISER_ADJUSTMENT', status: 'ACTIVE' });
  });

  it('sources an increase from another distributor’s stock, requires a reason, and never leaks that distributor’s identity to the owning distributor', async () => {
    const { stock, distributorToken, saleOrder } = await createSubmittedSaleOrder(20);
    const otherDistributorStock = await createReleasedQaStock({ quantity: 15 });
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    // Missing reason for a cross-distributor source is rejected.
    await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 35,
          sourcing: [{ qaReleaseLineId: otherDistributorStock.qaReleaseLineId, quantity: 15 }],
        },
      ],
    }).expect(400);
    expect(await prisma.stockAllocation.count({ where: { qaReleaseLineId: otherDistributorStock.qaReleaseLineId } })).toBe(0);

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
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
    const allocation = res.body.data.lines[0].allocations.find(
      (a: { allocationSource: string }) => a.allocationSource === 'MERCHANDISER_REASSIGNMENT',
    );
    expect(allocation.source).not.toBeNull();

    // Source QaReleaseLine provenance is untouched.
    const releaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({
      where: { id: otherDistributorStock.qaReleaseLineId },
    });
    expect(releaseLine.purchaseOrderLineSizeId).toBe(otherDistributorStock.purchaseOrderLineSizeId);

    // The owning distributor never sees the other distributor's PO/JO identity.
    const distributorView = await request(app)
      .get(`/sale-orders/${saleOrder.id}`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    const reassignedAllocation = distributorView.body.data.lines[0].allocations.find(
      (a: { allocationSource: string }) => a.allocationSource === 'MERCHANDISER_REASSIGNMENT',
    );
    expect(reassignedAllocation.source).toBeNull();

    const merchandiserView = await request(app)
      .get(`/sale-orders/${saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    const fullAllocation = merchandiserView.body.data.lines[0].allocations.find(
      (a: { allocationSource: string }) => a.allocationSource === 'MERCHANDISER_REASSIGNMENT',
    );
    expect(fullAllocation.source.distributor.id).not.toBe(stock.distributorId);
  });

  it('rejects an increase that exceeds available stock across sources and leaves no partial allocation', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(20);
    const scarceStock = await createReleasedQaStock({ quantity: 10 });
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    const before = await prisma.stockAllocation.findMany();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 35,
          sourcing: [{ qaReleaseLineId: scarceStock.qaReleaseLineId, quantity: 15, reason: 'need more' }],
        },
      ],
    }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const after = await prisma.stockAllocation.findMany();
    expect(after).toEqual(before);
    const reloaded = await prisma.saleOrder.findUniqueOrThrow({ where: { id: saleOrder.id } });
    expect(reloaded.status).toBe('SUBMITTED');
    expect(reloaded.version).toBe(saleOrder.version);
  });

  it('never lets concurrent approvals over-commit the same QA release line', async () => {
    const scarceStock = await createReleasedQaStock({ quantity: 10 });
    const { saleOrder: orderA } = await createSubmittedSaleOrder(5);
    const { saleOrder: orderB } = await createSubmittedSaleOrder(5);
    const merchToken = await createMerchandiserToken();

    const results = await Promise.allSettled([
      approve(merchToken, orderA.id, {
        expectedVersion: orderA.version,
        lines: [
          {
            saleOrderLineId: orderA.lines[0].id,
            approvedQuantity: 12,
            sourcing: [{ qaReleaseLineId: scarceStock.qaReleaseLineId, quantity: 7, reason: 'top up A' }],
          },
        ],
      }),
      approve(merchToken, orderB.id, {
        expectedVersion: orderB.version,
        lines: [
          {
            saleOrderLineId: orderB.lines[0].id,
            approvedQuantity: 12,
            sourcing: [{ qaReleaseLineId: scarceStock.qaReleaseLineId, quantity: 7, reason: 'top up B' }],
          },
        ],
      }),
    ]);

    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));
    // Combined demand (14) exceeds the scarce release line's 10 units, so at
    // most one of the two concurrent approvals can succeed.
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);

    const committed = await prisma.stockAllocation.aggregate({
      where: { qaReleaseLineId: scarceStock.qaReleaseLineId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    expect(committed._sum.quantity ?? 0).toBeLessThanOrEqual(scarceStock.quantity);
  });

  it('replaying the same Idempotency-Key does not double-allocate', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(40);
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];
    const key = createId();
    const body = { expectedVersion: saleOrder.version, lines: [{ saleOrderLineId: line.id, approvedQuantity: 40 }] };

    await approve(merchToken, saleOrder.id, body, key).expect(200);
    await approve(merchToken, saleOrder.id, body, key).expect(200);

    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: line.id } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.quantity).toBe(40);
  });

  it('rejects approval attempts in an invalid state', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];
    await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 10 }],
    }).expect(200);

    await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version + 1,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 10 }],
    }).expect(400);
  });

  it('rejects a stale expectedVersion', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    const merchToken = await createMerchandiserToken();
    const line = saleOrder.lines[0];

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version + 99,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 10 }],
    }).expect(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
  });
});
