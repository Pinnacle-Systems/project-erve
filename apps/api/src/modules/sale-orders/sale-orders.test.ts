import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createPurchaseOrderLineSize,
  createReleasedQaStock,
  createTestDistributor,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// Creates a DISTRIBUTOR-role user mapped to the given distributor and
// returns a bearer token for them.
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

async function createAccountantToken() {
  const { token } = await createTestUserAndToken({
    email: `accountant-${createId()}@test.local`,
    password: 'pass',
    roles: ['ACCOUNTANT'],
  });
  return token;
}

function createDraftSaleOrder(
  token: string,
  distributorId: string,
  lines: Array<{ purchaseOrderLineSizeId: string; requestedQuantity: number }>,
) {
  return request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ distributorId, soDate: '2026-06-30', lines });
}

function submitSaleOrder(token: string, id: string, expectedVersion: number, key = createId()) {
  return request(app)
    .post(`/sale-orders/${id}/actions/submit`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ expectedVersion });
}

describe('Sale Orders — create, submit, visibility, authorization', () => {
  it('lets a distributor create and submit a sale order against their own released stock', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const token = await createDistributorUser(stock.distributorId);

    const created = await createDraftSaleOrder(token, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 },
    ]).expect(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.lines[0]).toMatchObject({ requestedQuantity: 20, approvedQuantity: null });
    expect(created.body.data.saleOrderNumber).toMatch(/^EISO\//);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.lines[0].allocations).toHaveLength(1);
    expect(submitted.body.data.lines[0].allocations[0]).toMatchObject({
      quantity: 20,
      status: 'ACTIVE',
      allocationSource: 'DISTRIBUTOR_REQUEST',
    });

    const allocations = await prisma.stockAllocation.findMany({ where: { qaReleaseLineId: stock.qaReleaseLineId } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.quantity).toBe(20);
  });

  it('allows submission above the requesting distributor’s own available stock — a Sale Order is a demand request, not a reservation', async () => {
    const stock = await createReleasedQaStock({ quantity: 5 });
    const token = await createDistributorUser(stock.distributorId);
    const created = await createDraftSaleOrder(token, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 10 },
    ]).expect(201);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    // requestedQuantity is stored exactly as requested, unconstrained by
    // stock; only the 5 units that actually exist get an opportunistic
    // DISTRIBUTOR_REQUEST allocation, the remaining 5 stay unallocated
    // pending Merchandiser review.
    expect(submitted.body.data.lines[0]).toMatchObject({ requestedQuantity: 10, approvedQuantity: null });
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: submitted.body.data.lines[0].id } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 5, status: 'ACTIVE', allocationSource: 'DISTRIBUTOR_REQUEST' });
  });

  it('submits successfully with zero allocations when the distributor has no released stock at all for the line', async () => {
    const lineSize = await createPurchaseOrderLineSize();
    const token = await createDistributorUser(lineSize.distributorId);
    const created = await createDraftSaleOrder(token, lineSize.distributorId, [
      { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 50 },
    ]).expect(201);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.lines[0]).toMatchObject({ requestedQuantity: 50, approvedQuantity: null });
    expect(submitted.body.data.lines[0].allocations).toHaveLength(0);
  });

  it('submits successfully when zero compatible QA-released stock exists anywhere system-wide', async () => {
    // No createReleasedQaStock call at all in this test — no QaReleaseLine
    // exists anywhere for this style/size, or for any style/size.
    const lineSize = await createPurchaseOrderLineSize();
    const token = await createDistributorUser(lineSize.distributorId);
    const created = await createDraftSaleOrder(token, lineSize.distributorId, [
      { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 100 },
    ]).expect(201);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    expect(submitted.body.data.lines[0]).toMatchObject({ requestedQuantity: 100 });
    expect(await prisma.stockAllocation.count()).toBe(0);
  });

  it('never lets a distributor’s submit silently draw on another distributor’s available stock', async () => {
    const shortStock = await createReleasedQaStock({ quantity: 5 });
    // Plenty of stock exists globally (for a different distributor, different
    // PO line/size) — but submit must only ever look at release lines tied
    // to this distributor's own purchaseOrderLineSizeId, and must never
    // auto-create a MERCHANDISER_REASSIGNMENT to reach it.
    await createReleasedQaStock({ quantity: 1000 });

    const token = await createDistributorUser(shortStock.distributorId);
    const created = await createDraftSaleOrder(token, shortStock.distributorId, [
      { purchaseOrderLineSizeId: shortStock.purchaseOrderLineSizeId, requestedQuantity: 10 },
    ]).expect(201);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    expect(submitted.body.data.lines[0].requestedQuantity).toBe(10);
    const allocations = await prisma.stockAllocation.findMany({
      where: { saleOrderLineId: submitted.body.data.lines[0].id },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 5, allocationSource: 'DISTRIBUTOR_REQUEST' });
    expect(await prisma.stockAllocation.count({ where: { allocationSource: 'MERCHANDISER_REASSIGNMENT' } })).toBe(0);
  });

  it('excludes stock already committed to another submitted sale order from availability, but still allows submission with zero allocation', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const tokenA = await createDistributorUser(stock.distributorId);

    const orderA = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 },
    ]).expect(201);
    await submitSaleOrder(tokenA, orderA.body.data.id, orderA.body.data.version).expect(200);

    const orderB = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 1 },
    ]).expect(201);
    const submittedB = await submitSaleOrder(tokenA, orderB.body.data.id, orderB.body.data.version).expect(200);
    expect(submittedB.body.data.lines[0]).toMatchObject({ requestedQuantity: 1 });
    expect(submittedB.body.data.lines[0].allocations).toHaveLength(0);

    // Only order A's original allocation is active — order B's demand is
    // recorded but backs onto no stock.
    expect(await prisma.stockAllocation.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('immutably preserves requestedQuantity through submission regardless of how much stock backs it', async () => {
    const lineSize = await createPurchaseOrderLineSize();
    const token = await createDistributorUser(lineSize.distributorId);
    const created = await createDraftSaleOrder(token, lineSize.distributorId, [
      { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 30 },
    ]).expect(201);

    const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
    const dbLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: submitted.body.data.lines[0].id } });
    expect(dbLine.requestedQuantity).toBe(30);

    // Attempting to change requestedQuantity post-submission is rejected —
    // PATCH is only permitted while still DRAFT.
    await request(app)
      .patch(`/sale-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 999 }] })
      .expect(400);
    const reloaded = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: submitted.body.data.lines[0].id } });
    expect(reloaded.requestedQuantity).toBe(30);
  });

  it('a distributor cannot view another distributor’s sale order', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const tokenA = await createDistributorUser(stock.distributorId);
    const created = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 },
    ]).expect(201);

    const otherDistributor = await createTestDistributor();
    const tokenB = await createDistributorUser(otherDistributor.id);
    await request(app)
      .get(`/sale-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
  });

  it('a merchandiser has global visibility across distributors', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const tokenA = await createDistributorUser(stock.distributorId);
    const created = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 },
    ]).expect(201);

    const merchToken = await createMerchandiserToken();
    await request(app)
      .get(`/sale-orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
  });

  describe('authorization', () => {
    it('forbids a DISTRIBUTOR from approving, reviewing, rejecting, or viewing global inventory', async () => {
      const stock = await createReleasedQaStock({ quantity: 20 });
      const token = await createDistributorUser(stock.distributorId);
      const created = await createDraftSaleOrder(token, stock.distributorId, [
        { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(201);
      const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);

      await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/approve`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: submitted.body.data.version, lines: [] })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/start-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(403);

      await request(app).get('/sale-orders/inventory').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('forbids a DISTRIBUTOR from creating a sale order for another distributor', async () => {
      const distributorA = await createTestDistributor();
      const distributorB = await createTestDistributor();
      const tokenA = await createDistributorUser(distributorA.id);
      const stockForB = await createReleasedQaStock({ quantity: 20, distributorId: distributorB.id });

      await createDraftSaleOrder(tokenA, distributorB.id, [
        { purchaseOrderLineSizeId: stockForB.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(403);
    });

    it('lets ACCOUNTANT list and view sale orders across every distributor, read-only', async () => {
      const stockA = await createReleasedQaStock({ quantity: 20 });
      const tokenA = await createDistributorUser(stockA.distributorId);
      const orderA = await createDraftSaleOrder(tokenA, stockA.distributorId, [
        { purchaseOrderLineSizeId: stockA.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(201);

      const stockB = await createReleasedQaStock({ quantity: 20 });
      const tokenB = await createDistributorUser(stockB.distributorId);
      const orderB = await createDraftSaleOrder(tokenB, stockB.distributorId, [
        { purchaseOrderLineSizeId: stockB.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(201);

      const accountantToken = await createAccountantToken();

      // Sees every distributor's orders in one unscoped list — not limited
      // to a single distributor's own orders the way a DISTRIBUTOR is.
      const list = await request(app)
        .get('/sale-orders')
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
      const listedIds = new Set((list.body.data.items as Array<{ id: string }>).map((item) => item.id));
      expect(listedIds.has(orderA.body.data.id)).toBe(true);
      expect(listedIds.has(orderB.body.data.id)).toBe(true);

      await request(app)
        .get(`/sale-orders/${orderA.body.data.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
    });

    it('forbids ACCOUNTANT from every Sale Order mutation and from global inventory', async () => {
      const stock = await createReleasedQaStock({ quantity: 20 });
      const distributorToken = await createDistributorUser(stock.distributorId);
      const created = await createDraftSaleOrder(distributorToken, stock.distributorId, [
        { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(201);
      const submitted = await submitSaleOrder(
        distributorToken,
        created.body.data.id,
        created.body.data.version,
      ).expect(200);

      const accountantToken = await createAccountantToken();

      await createDraftSaleOrder(accountantToken, stock.distributorId, [
        { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 1 },
      ]).expect(403);

      await request(app)
        .patch(`/sale-orders/${created.body.data.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ remarks: 'edited by accountant' })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/submit`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: created.body.data.version })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/start-review`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/reject`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: submitted.body.data.version, lines: [] })
        .expect(403);

      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/cancel`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(403);

      await request(app).get('/sale-orders/inventory').set('Authorization', `Bearer ${accountantToken}`).expect(403);
    });
  });
});

describe('Sale Orders — requestable catalog (demand-request style/size selector)', () => {
  it('lists a distributor’s own PO line/sizes even with zero QA-released stock, and never leaks another distributor’s catalog', async () => {
    const ownLineSize = await createPurchaseOrderLineSize();
    const otherDistributorLineSize = await createPurchaseOrderLineSize();
    const token = await createDistributorUser(ownLineSize.distributorId);

    const res = await request(app)
      .get('/sale-orders/requestable-catalog')
      .set('Authorization', `Bearer ${token}`)
      .query({ distributorId: ownLineSize.distributorId })
      .expect(200);

    const ids = new Set((res.body.data as Array<{ purchaseOrderLineSizeId: string }>).map((l) => l.purchaseOrderLineSizeId));
    expect(ids.has(ownLineSize.purchaseOrderLineSizeId)).toBe(true);
    expect(ids.has(otherDistributorLineSize.purchaseOrderLineSizeId)).toBe(false);
  });

  it('includes a distributor’s own PO line/size even when released QA stock already exists for it (catalog is stock-independent)', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const token = await createDistributorUser(stock.distributorId);

    const res = await request(app)
      .get('/sale-orders/requestable-catalog')
      .set('Authorization', `Bearer ${token}`)
      .query({ distributorId: stock.distributorId })
      .expect(200);

    const line = (res.body.data as Array<Record<string, unknown>>).find(
      (l) => l.purchaseOrderLineSizeId === stock.purchaseOrderLineSizeId,
    );
    expect(line).toBeTruthy();
  });

  it('never exposes a stock/availability quantity of any kind on the requestable catalog', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const token = await createDistributorUser(stock.distributorId);

    const res = await request(app)
      .get('/sale-orders/requestable-catalog')
      .set('Authorization', `Bearer ${token}`)
      .query({ distributorId: stock.distributorId })
      .expect(200);

    for (const line of res.body.data as Array<Record<string, unknown>>) {
      expect(line).not.toHaveProperty('releasedQuantity');
      expect(line).not.toHaveProperty('committedQuantity');
      expect(line).not.toHaveProperty('availableQuantity');
    }
  });

  it('forbids a distributor from requesting another distributor’s catalog', async () => {
    const distributorA = await createTestDistributor();
    const distributorB = await createPurchaseOrderLineSize();
    const tokenA = await createDistributorUser(distributorA.id);

    const res = await request(app)
      .get('/sale-orders/requestable-catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ distributorId: distributorB.distributorId })
      .expect(200);

    // A DISTRIBUTOR's own distributorId is always used server-side — the
    // query param is ignored for a non-ADMIN caller (matching /eligible-stock).
    const ids = new Set((res.body.data as Array<{ purchaseOrderLineSizeId: string }>).map((l) => l.purchaseOrderLineSizeId));
    expect(ids.has(distributorB.purchaseOrderLineSizeId)).toBe(false);
  });
});
