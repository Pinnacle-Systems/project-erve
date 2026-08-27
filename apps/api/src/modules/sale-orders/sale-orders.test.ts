import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
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

  it('rejects submission that would exceed the requesting distributor’s own available stock', async () => {
    const stock = await createReleasedQaStock({ quantity: 5 });
    const token = await createDistributorUser(stock.distributorId);
    const created = await createDraftSaleOrder(token, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 10 },
    ]).expect(201);

    await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(409);
    expect(await prisma.stockAllocation.count()).toBe(0);
    const reloaded = await prisma.saleOrder.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(reloaded.status).toBe('DRAFT');
  });

  it('never lets a distributor’s submit silently draw on another distributor’s available stock', async () => {
    const shortStock = await createReleasedQaStock({ quantity: 5 });
    // Plenty of stock exists globally (for a different distributor, different
    // PO line/size) — but submit must only ever look at release lines tied
    // to this distributor's own purchaseOrderLineSizeId.
    await createReleasedQaStock({ quantity: 1000 });

    const token = await createDistributorUser(shortStock.distributorId);
    const created = await createDraftSaleOrder(token, shortStock.distributorId, [
      { purchaseOrderLineSizeId: shortStock.purchaseOrderLineSizeId, requestedQuantity: 10 },
    ]).expect(201);

    await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(409);
  });

  it('excludes stock already committed to another submitted sale order from availability', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const tokenA = await createDistributorUser(stock.distributorId);

    const orderA = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 },
    ]).expect(201);
    await submitSaleOrder(tokenA, orderA.body.data.id, orderA.body.data.version).expect(200);

    const orderB = await createDraftSaleOrder(tokenA, stock.distributorId, [
      { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 1 },
    ]).expect(201);
    await submitSaleOrder(tokenA, orderB.body.data.id, orderB.body.data.version).expect(409);

    expect(await prisma.stockAllocation.count({ where: { status: 'ACTIVE' } })).toBe(1);
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
  });
});
