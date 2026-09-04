import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createPurchaseOrderLineSize, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

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

function cancelPO(token: string, id: string) {
  return request(app).post(`/purchase-orders/${id}/actions/cancel`).set('Authorization', `Bearer ${token}`);
}

function createDraftSaleOrder(token: string, distributorId: string, purchaseOrderLineSizeId: string, requestedQuantity = 10) {
  return request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ distributorId, soDate: '2026-06-30', lines: [{ purchaseOrderLineSizeId, requestedQuantity }] });
}

function submitSaleOrder(token: string, id: string, expectedVersion: number, key = createId()) {
  return request(app)
    .post(`/sale-orders/${id}/actions/submit`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ expectedVersion });
}

// Builds a Sale Order (owned by an ADMIN-managed distributor fixture) in the
// given status, with zero stock backing it — the demand-request model makes
// this valid at every status up to APPROVED (approvedQuantity: 0 requires no
// sourcing), so no QA-release fixture is needed anywhere in this file.
async function createSaleOrderInStatus(
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
  purchaseOrderLineSizeId: string,
  distributorId: string,
) {
  const distributorToken = await createDistributorUser(distributorId);
  const created = await createDraftSaleOrder(distributorToken, distributorId, purchaseOrderLineSizeId).expect(201);
  if (status === 'DRAFT') return { saleOrderId: created.body.data.id, status: 'DRAFT' as const };

  const submitted = await submitSaleOrder(distributorToken, created.body.data.id, created.body.data.version).expect(
    200,
  );
  if (status === 'SUBMITTED') return { saleOrderId: submitted.body.data.id, status: 'SUBMITTED' as const };

  const merchToken = await createMerchandiserToken();
  if (status === 'UNDER_REVIEW') {
    const review = await request(app)
      .post(`/sale-orders/${submitted.body.data.id}/actions/start-review`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ expectedVersion: submitted.body.data.version })
      .expect(200);
    return { saleOrderId: review.body.data.id, status: 'UNDER_REVIEW' as const };
  }

  if (status === 'REJECTED') {
    const rejected = await request(app)
      .post(`/sale-orders/${submitted.body.data.id}/actions/reject`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ expectedVersion: submitted.body.data.version })
      .expect(200);
    return { saleOrderId: rejected.body.data.id, status: 'REJECTED' as const };
  }

  if (status === 'CANCELLED') {
    const cancelled = await request(app)
      .post(`/sale-orders/${submitted.body.data.id}/actions/cancel`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({ expectedVersion: submitted.body.data.version })
      .expect(200);
    return { saleOrderId: cancelled.body.data.id, status: 'CANCELLED' as const };
  }

  // APPROVED
  const approved = await request(app)
    .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion: submitted.body.data.version,
      lines: [{ saleOrderLineId: submitted.body.data.lines[0].id, approvedQuantity: 0 }],
    })
    .expect(200);
  return { saleOrderId: approved.body.data.id, status: 'APPROVED' as const };
}

describe('Purchase Order cancellation — blocked by active/open Sale Order demand', () => {
  it('cancels a PO with no Sale Orders at all, exactly as before', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('rejects PO cancellation when a SUBMITTED Sale Order references one of its line/sizes', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('SUBMITTED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(400);
    expect(res.body.error.message).toMatch(/active sale orders/i);

    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    expect(po.status).toBe('SUBMITTED');
  });

  it('rejects PO cancellation when an UNDER_REVIEW Sale Order references it', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('UNDER_REVIEW', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    await cancelPO(adminToken, lineSize.purchaseOrderId).expect(400);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    expect(po.status).toBe('SUBMITTED');
  });

  it('rejects PO cancellation when an APPROVED Sale Order references it', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('APPROVED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    await cancelPO(adminToken, lineSize.purchaseOrderId).expect(400);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    expect(po.status).toBe('SUBMITTED');
  });

  it('allows PO cancellation when the only referencing Sale Order is REJECTED (terminal, non-blocking)', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('REJECTED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('allows PO cancellation when the only referencing Sale Order is itself CANCELLED (terminal, non-blocking)', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('CANCELLED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('allows PO cancellation when the only referencing Sale Order is a DRAFT — no commitment/reservation exists yet', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await createSaleOrderInStatus('DRAFT', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');

    // The stale DRAFT is left untouched (no auto-delete/mutate) — but is now
    // unsubmittable, caught by validateSaleOrderLines / submitSaleOrder's own
    // PO-eligibility check.
    const draftLine = await prisma.saleOrderLine.findFirstOrThrow({
      where: { purchaseOrderLineSizeId: lineSize.purchaseOrderLineSizeId },
    });
    expect(draftLine).toBeTruthy();
  });

  it('rejects cancellation when one referencing Sale Order is terminal and another is blocking', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED', orderedQuantity: 200 });
    await createSaleOrderInStatus('REJECTED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    // A second Sale Order line against a distinct-but-same-PO line/size would
    // collide on the (saleOrderId, purchaseOrderLineSizeId) unique key within
    // one order, but two separate Sale Orders against the same line/size are
    // fine — this is exactly the "multiple Sale Orders" scenario.
    await createSaleOrderInStatus('SUBMITTED', lineSize.purchaseOrderLineSizeId, lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    await cancelPO(adminToken, lineSize.purchaseOrderId).expect(400);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    expect(po.status).toBe('SUBMITTED');
  });

  it('does not block cancellation of a PO when the blocking Sale Order references a different PO entirely', async () => {
    const targetLineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    const otherLineSize = await createPurchaseOrderLineSize({
      poStatus: 'SUBMITTED',
      distributorId: targetLineSize.distributorId,
    });
    await createSaleOrderInStatus('SUBMITTED', otherLineSize.purchaseOrderLineSizeId, otherLineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, targetLineSize.purchaseOrderId).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('still enforces the existing jobOrderedQuantity guard even with no Sale Orders at all', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    await prisma.distributorPurchaseOrderLineSize.update({
      where: { id: lineSize.purchaseOrderLineSizeId },
      data: { jobOrderedQuantity: 5 },
    });
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const res = await cancelPO(adminToken, lineSize.purchaseOrderId).expect(400);
    expect(res.body.error.message).toMatch(/job ordered quantities/i);
    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    expect(po.status).toBe('SUBMITTED');
  });

  it('never lets a concurrent PO cancellation and Sale Order submission against the same PO both succeed', async () => {
    const lineSize = await createPurchaseOrderLineSize({ poStatus: 'SUBMITTED' });
    const distributorToken = await createDistributorUser(lineSize.distributorId);
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const draft = await createDraftSaleOrder(
      distributorToken,
      lineSize.distributorId,
      lineSize.purchaseOrderLineSizeId,
    ).expect(201);

    const [cancelResult, submitResult] = await Promise.allSettled([
      cancelPO(adminToken, lineSize.purchaseOrderId),
      submitSaleOrder(distributorToken, draft.body.data.id, draft.body.data.version),
    ]);

    const cancelStatus = cancelResult.status === 'fulfilled' ? cancelResult.value.status : -1;
    const submitStatus = submitResult.status === 'fulfilled' ? submitResult.value.status : -1;

    // Whichever transaction wins the purchase-order-{id} advisory lock
    // commits first; the other then observes the now-consistent state and
    // fails its own check — so exactly one of the two succeeds, never both.
    const successes = [cancelStatus, submitStatus].filter((s) => s === 200).length;
    expect(successes).toBe(1);

    const po = await prisma.distributorPurchaseOrder.findUniqueOrThrow({ where: { id: lineSize.purchaseOrderId } });
    const so = await prisma.saleOrder.findUniqueOrThrow({ where: { id: draft.body.data.id } });
    // The forbidden combination must never occur.
    expect(po.status === 'CANCELLED' && so.status === 'SUBMITTED').toBe(false);
  });
});
