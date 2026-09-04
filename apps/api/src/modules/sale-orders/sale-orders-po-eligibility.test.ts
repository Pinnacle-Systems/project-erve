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

async function requestableCatalog(token: string, distributorId: string) {
  const res = await request(app)
    .get('/sale-orders/requestable-catalog')
    .set('Authorization', `Bearer ${token}`)
    .query({ distributorId })
    .expect(200);
  return new Set((res.body.data as Array<{ purchaseOrderLineSizeId: string }>).map((l) => l.purchaseOrderLineSizeId));
}

describe('Sale Orders — requestable catalog & line validation respect parent PO eligibility', () => {
  describe('catalog', () => {
    it('includes a line whose parent PO is SUBMITTED (eligible) with an ACTIVE lineStatus', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const token = await createDistributorUser(lineSize.distributorId);

      const ids = await requestableCatalog(token, lineSize.distributorId);
      expect(ids.has(lineSize.purchaseOrderLineSizeId)).toBe(true);
    });

    it('excludes a line whose parent PO is still DRAFT', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'DRAFT' });
      const token = await createDistributorUser(lineSize.distributorId);

      const ids = await requestableCatalog(token, lineSize.distributorId);
      expect(ids.has(lineSize.purchaseOrderLineSizeId)).toBe(false);
    });

    it('excludes a line whose parent PO is CANCELLED', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'CANCELLED' });
      const token = await createDistributorUser(lineSize.distributorId);

      const ids = await requestableCatalog(token, lineSize.distributorId);
      expect(ids.has(lineSize.purchaseOrderLineSizeId)).toBe(false);
    });

    it('excludes a line whose parent PO is CLOSED', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'CLOSED' });
      const token = await createDistributorUser(lineSize.distributorId);

      const ids = await requestableCatalog(token, lineSize.distributorId);
      expect(ids.has(lineSize.purchaseOrderLineSizeId)).toBe(false);
    });

    it('includes lines whose parent PO has progressed past submission (PARTIALLY_JOB_ORDERED, FULLY_FULFILLED)', async () => {
      const partiallyJobOrdered = await createPurchaseOrderLineSize({ poStatus: 'PARTIALLY_JOB_ORDERED' });
      const token = await createDistributorUser(partiallyJobOrdered.distributorId);
      const fullyFulfilled = await createPurchaseOrderLineSize({
        poStatus: 'FULLY_FULFILLED',
        distributorId: partiallyJobOrdered.distributorId,
      });

      const ids = await requestableCatalog(token, partiallyJobOrdered.distributorId);
      expect(ids.has(partiallyJobOrdered.purchaseOrderLineSizeId)).toBe(true);
      expect(ids.has(fullyFulfilled.purchaseOrderLineSizeId)).toBe(true);
    });

    it('excludes a CANCELLED line even when its parent PO is otherwise eligible (existing line-status rule)', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED', lineStatus: 'CANCELLED' });
      const token = await createDistributorUser(lineSize.distributorId);

      const ids = await requestableCatalog(token, lineSize.distributorId);
      expect(ids.has(lineSize.purchaseOrderLineSizeId)).toBe(false);
    });

    it('never leaks another distributor’s eligible line/size into this distributor’s catalog', async () => {
      const ownLineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const otherDistributorLineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const token = await createDistributorUser(ownLineSize.distributorId);

      const ids = await requestableCatalog(token, ownLineSize.distributorId);
      expect(ids.has(ownLineSize.purchaseOrderLineSizeId)).toBe(true);
      expect(ids.has(otherDistributorLineSize.purchaseOrderLineSizeId)).toBe(false);
    });
  });

  describe('backend line validation (create/update) — must agree with the catalog', () => {
    it('creates/submits a sale order against a valid (SUBMITTED-PO) line/size exactly as before', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const token = await createDistributorUser(lineSize.distributorId);

      const created = await createDraftSaleOrder(token, lineSize.distributorId, [
        { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 25 },
      ]).expect(201);
      const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
      expect(submitted.body.data.lines[0]).toMatchObject({ requestedQuantity: 25, approvedQuantity: null });
      // Demand semantics untouched: zero own stock still submits with zero
      // allocations rather than being rejected.
      expect(submitted.body.data.lines[0].allocations).toHaveLength(0);
    });

    it('rejects a direct create attempt referencing a line/size whose parent PO is still DRAFT', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'DRAFT' });
      const token = await createDistributorUser(lineSize.distributorId);

      const res = await createDraftSaleOrder(token, lineSize.distributorId, [
        { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 10 },
      ]).expect(400);
      expect(res.body.error.message).toMatch(/not available for sale order requests/i);
      expect(await prisma.saleOrder.count()).toBe(0);
    });

    it('rejects a direct create attempt referencing a line/size whose parent PO is CANCELLED, even though lineStatus is ACTIVE', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'CANCELLED', lineStatus: 'ACTIVE' });
      const token = await createDistributorUser(lineSize.distributorId);

      await createDraftSaleOrder(token, lineSize.distributorId, [
        { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 10 },
      ]).expect(400);
      expect(await prisma.saleOrderLine.count()).toBe(0);
    });

    it('rejects a direct create attempt referencing a CANCELLED line even on an otherwise-eligible PO — no bypass of catalog filtering via direct API', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED', lineStatus: 'CANCELLED' });
      const token = await createDistributorUser(lineSize.distributorId);

      await createDraftSaleOrder(token, lineSize.distributorId, [
        { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 10 },
      ]).expect(400);
      expect(await prisma.saleOrderLine.count()).toBe(0);
    });

    it('rejects an update (PATCH) that swaps in a line/size from an ineligible PO', async () => {
      const validLineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const token = await createDistributorUser(validLineSize.distributorId);
      const created = await createDraftSaleOrder(token, validLineSize.distributorId, [
        { purchaseOrderLineSizeId: validLineSize.purchaseOrderLineSizeId, requestedQuantity: 5 },
      ]).expect(201);

      const cancelledLineSize = await createPurchaseOrderLineSize({
        poStatus: 'CANCELLED',
        distributorId: validLineSize.distributorId,
      });
      await request(app)
        .patch(`/sale-orders/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ purchaseOrderLineSizeId: cancelledLineSize.purchaseOrderLineSizeId, requestedQuantity: 5 }] })
        .expect(400);

      // The original DRAFT line is untouched by the rejected update.
      const reloaded = await request(app)
        .get(`/sale-orders/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(reloaded.body.data.lines).toHaveLength(1);
      expect(reloaded.body.data.lines[0].purchaseOrderLineSizeId).toBe(validLineSize.purchaseOrderLineSizeId);
    });

    it('still allows a requested quantity greater than currently available stock, and requestedQuantity stays immutable after submission', async () => {
      const stock = await createReleasedQaStock({ quantity: 5 });
      const token = await createDistributorUser(stock.distributorId);
      const created = await createDraftSaleOrder(token, stock.distributorId, [
        { purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 50 },
      ]).expect(201);

      const submitted = await submitSaleOrder(token, created.body.data.id, created.body.data.version).expect(200);
      expect(submitted.body.data.lines[0]).toMatchObject({ requestedQuantity: 50 });
      const allocations = await prisma.stockAllocation.findMany({
        where: { saleOrderLineId: submitted.body.data.lines[0].id },
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0]).toMatchObject({ quantity: 5, allocationSource: 'DISTRIBUTOR_REQUEST' });

      await request(app)
        .patch(`/sale-orders/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 999 }] })
        .expect(400);
      const reloadedLine = await prisma.saleOrderLine.findUniqueOrThrow({
        where: { id: submitted.body.data.lines[0].id },
      });
      expect(reloadedLine.requestedQuantity).toBe(50);
    });
  });

  describe('regression — approval/reassignment on an eligible-PO order is unaffected', () => {
    it('still sources a cross-distributor MERCHANDISER_REASSIGNMENT on approval for an order created against an eligible PO', async () => {
      const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
      const distributorToken = await createDistributorUser(lineSize.distributorId);
      const created = await createDraftSaleOrder(distributorToken, lineSize.distributorId, [
        { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId, requestedQuantity: 15 },
      ]).expect(201);
      const submitted = await submitSaleOrder(
        distributorToken,
        created.body.data.id,
        created.body.data.version,
      ).expect(200);
      expect(submitted.body.data.lines[0].allocations).toHaveLength(0);

      const otherStock = await createReleasedQaStock({ quantity: 15 });
      const merchToken = await createMerchandiserToken();

      const approved = await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
        .set('Authorization', `Bearer ${merchToken}`)
        .set('Idempotency-Key', createId())
        .send({
          expectedVersion: submitted.body.data.version,
          lines: [
            {
              saleOrderLineId: submitted.body.data.lines[0].id,
              approvedQuantity: 15,
              sourcing: [{ qaReleaseLineId: otherStock.qaReleaseLineId, quantity: 15, reason: 'cross-source' }],
            },
          ],
        })
        .expect(200);

      const allocation = await prisma.stockAllocation.findFirstOrThrow({
        where: { saleOrderLineId: submitted.body.data.lines[0].id, qaReleaseLineId: otherStock.qaReleaseLineId },
      });
      expect(allocation).toMatchObject({ allocationSource: 'MERCHANDISER_REASSIGNMENT', quantity: 15 });
      expect(approved.body.data.lines[0].approvedQuantity).toBe(15);
    });
  });
});
