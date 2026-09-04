import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createPurchaseOrderLineSize,
  createReleasedQaStock,
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

// Builds a SUBMITTED sale order for a distributor with NO QA-released stock
// behind the line at all — the demand-request scenario: requestedQuantity >
// 0, allocations = 0, entering review purely on the Merchandiser's decision.
async function createSubmittedSaleOrderWithNoStock(requestedQuantity: number) {
  const lineSize = await createPurchaseOrderLineSize();
  const distributorToken = await createDistributorUser(lineSize.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: lineSize.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity }],
    })
    .expect(201);
  const submitted = await request(app)
    .post(`/sale-orders/${created.body.data.id}/actions/submit`)
    .set('Authorization', `Bearer ${distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: created.body.data.version })
    .expect(200);
  return { lineSize, distributorToken, saleOrder: submitted.body.data };
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

  it('reviews and approves a submitted line that has zero allocations, sourcing the full amount fresh at approval time', async () => {
    const { lineSize, saleOrder } = await createSubmittedSaleOrderWithNoStock(40);
    const line = saleOrder.lines[0];
    expect(line.allocations).toHaveLength(0);

    // Stock only shows up after submission — the Merchandiser is the one who
    // discovers/allocates it, never the distributor at submit time.
    const stock = await createReleasedQaStock({
      quantity: 40,
      distributorId: lineSize.distributorId,
      styleId: lineSize.styleId,
      sizeId: lineSize.sizeId,
    });
    const merchToken = await createMerchandiserToken();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 40,
          sourcing: [{ qaReleaseLineId: stock.qaReleaseLineId, quantity: 40 }],
        },
      ],
    }).expect(200);

    expect(res.body.data.lines[0]).toMatchObject({ requestedQuantity: 40, approvedQuantity: 40 });
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: line.id } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      quantity: 40,
      status: 'ACTIVE',
      allocationSource: 'MERCHANDISER_ADJUSTMENT',
    });
  });

  it('lets a Merchandiser reduce/reject a zero-allocation line exactly as an already-backed one', async () => {
    const { saleOrder } = await createSubmittedSaleOrderWithNoStock(40);
    const line = saleOrder.lines[0];
    const merchToken = await createMerchandiserToken();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 0 }],
    }).expect(200);

    expect(res.body.data.lines[0]).toMatchObject({ requestedQuantity: 40, approvedQuantity: 0 });
    expect(await prisma.stockAllocation.count({ where: { saleOrderLineId: line.id, status: 'ACTIVE' } })).toBe(0);
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

    // ACCOUNTANT can view any distributor's sale order (unlike DISTRIBUTOR),
    // but is still read-only, not a privileged reviewer — it must get the
    // same sanitized (source: null) reassignment view as the owning
    // DISTRIBUTOR, never the other distributor's identity.
    const { token: accountantToken } = await createTestUserAndToken({
      email: `accountant-${createId()}@test.local`,
      password: 'pass',
      roles: ['ACCOUNTANT'],
    });
    const accountantView = await request(app)
      .get(`/sale-orders/${saleOrder.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const accountantAllocation = accountantView.body.data.lines[0].allocations.find(
      (a: { allocationSource: string }) => a.allocationSource === 'MERCHANDISER_REASSIGNMENT',
    );
    expect(accountantAllocation.source).toBeNull();
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

// cancelPurchaseOrder now refuses to cancel a PO while a SUBMITTED/
// UNDER_REVIEW/APPROVED Sale Order references it (see
// purchase-order-cancellation-guard.test.ts), so this inconsistent state
// ("PO CANCELLED" + "SO still active") can no longer arise through the
// normal API. Every test below therefore manufactures it directly via
// Prisma — simulating legacy data, a manual DB edit, or a future lifecycle
// change — to exercise the defense-in-depth check inside approveSaleOrder.
describe('Sale Order approval — defends against a referenced Purchase Order that is no longer eligible', () => {
  it('refuses to approve when the sale order’s (only) referenced PO has since become CANCELLED', async () => {
    const { stock, saleOrder } = await createSubmittedSaleOrder(10);
    await prisma.distributorPurchaseOrder.update({
      where: { id: stock.purchaseOrderId },
      data: { status: 'CANCELLED' },
    });
    const merchToken = await createMerchandiserToken();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: saleOrder.lines[0].id, approvedQuantity: 0 }],
    }).expect(400);
    expect(res.body.error.message).toMatch(/no longer valid/i);

    // Nothing was committed — no allocation change, no status change.
    const reloaded = await prisma.saleOrder.findUniqueOrThrow({ where: { id: saleOrder.id } });
    expect(reloaded.status).toBe('SUBMITTED');
    expect(reloaded.version).toBe(saleOrder.version);
  });

  it('refuses to approve when only one of several lines references a now-ineligible PO', async () => {
    const validLineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    const ineligibleLineSize = await createPurchaseOrderLineSize({
      poStatus: 'SUBMITTED',
      distributorId: validLineSize.distributorId,
    });
    const { userId, token: distributorToken } = await createTestUserAndToken({
      email: `dist-${createId()}@test.local`,
      password: 'pass',
      roles: ['DISTRIBUTOR'],
    });
    await prisma.userDistributor.create({
      data: { id: createId(), userId, distributorId: validLineSize.distributorId },
    });

    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: validLineSize.distributorId,
        soDate: '2026-06-30',
        lines: [
          { purchaseOrderLineSizeId: validLineSize.purchaseOrderLineSizeId, requestedQuantity: 5 },
          { purchaseOrderLineSizeId: ineligibleLineSize.purchaseOrderLineSizeId, requestedQuantity: 5 },
        ],
      })
      .expect(201);
    const submitted = await request(app)
      .post(`/sale-orders/${created.body.data.id}/actions/submit`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: created.body.data.version })
      .expect(200);

    // Simulate the second line's parent PO becoming CANCELLED afterward.
    await prisma.distributorPurchaseOrder.update({
      where: { id: ineligibleLineSize.purchaseOrderId },
      data: { status: 'CANCELLED' },
    });
    const merchToken = await createMerchandiserToken();

    await approve(merchToken, submitted.body.data.id, {
      expectedVersion: submitted.body.data.version,
      lines: submitted.body.data.lines.map((line: { id: string }) => ({
        saleOrderLineId: line.id,
        approvedQuantity: 0,
      })),
    }).expect(400);

    const reloaded = await prisma.saleOrder.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    expect(reloaded.status).toBe('SUBMITTED');
  });

  it('still approves normally when the referenced PO remains eligible', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(40);
    const merchToken = await createMerchandiserToken();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: saleOrder.lines[0].id, approvedQuantity: 40 }],
    }).expect(200);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('still allows a zero-allocation demand-request line to reach approval when the PO is eligible', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    const { userId, token: distributorToken } = await createTestUserAndToken({
      email: `dist-${createId()}@test.local`,
      password: 'pass',
      roles: ['DISTRIBUTOR'],
    });
    await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId: lineSize.distributorId } });

    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: lineSize.distributorId,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 40 }],
      })
      .expect(201);
    const submitted = await request(app)
      .post(`/sale-orders/${created.body.data.id}/actions/submit`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    expect(submitted.body.data.lines[0].allocations).toHaveLength(0);

    const merchToken = await createMerchandiserToken();
    const res = await approve(merchToken, submitted.body.data.id, {
      expectedVersion: submitted.body.data.version,
      lines: [{ saleOrderLineId: submitted.body.data.lines[0].id, approvedQuantity: 0 }],
    }).expect(200);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('still sources a cross-distributor MERCHANDISER_REASSIGNMENT normally when the PO is eligible', async () => {
    const { stock, saleOrder } = await createSubmittedSaleOrder(20);
    const otherStock = await createReleasedQaStock({ quantity: 15 });
    void stock;
    const merchToken = await createMerchandiserToken();

    const res = await approve(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [
        {
          saleOrderLineId: saleOrder.lines[0].id,
          approvedQuantity: 35,
          sourcing: [{ qaReleaseLineId: otherStock.qaReleaseLineId, quantity: 15, reason: 'cross-source' }],
        },
      ],
    }).expect(200);

    const allocation = await prisma.stockAllocation.findFirstOrThrow({
      where: { saleOrderLineId: saleOrder.lines[0].id, qaReleaseLineId: otherStock.qaReleaseLineId },
    });
    expect(allocation).toMatchObject({ allocationSource: 'MERCHANDISER_REASSIGNMENT', quantity: 15 });
    expect(res.body.data.status).toBe('APPROVED');
  });
});
