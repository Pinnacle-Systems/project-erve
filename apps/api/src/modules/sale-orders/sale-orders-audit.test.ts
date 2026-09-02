import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestDistributor,
  createTestFactory,
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
  return { userId, token };
}

async function createRoleToken(role: Role) {
  return createTestUserAndToken({
    email: `${role.toLowerCase()}-${createId()}@test.local`,
    password: 'pass',
    roles: [role],
  });
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

function getAudit(token: string, id: string) {
  return request(app).get(`/sale-orders/${id}/audit`).set('Authorization', `Bearer ${token}`);
}

async function createSubmittedSaleOrder(requestedQuantity: number, releasedQuantity = requestedQuantity) {
  const stock = await createReleasedQaStock({ quantity: releasedQuantity });
  const distributor = await createDistributorUser(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${distributor.token}`)
    .send({
      distributorId: stock.distributorId,
      soDate: '2026-06-30',
      lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity }],
    })
    .expect(201);
  const submitted = await submitSaleOrder(distributor.token, created.body.data.id, created.body.data.version).expect(
    200,
  );
  return { stock, distributor, saleOrder: submitted.body.data };
}

describe('Sale Order audit trail — read path', () => {
  it('returns records for the full create -> submit -> approve lifecycle with correct actor/action/detail', async () => {
    const { distributor, saleOrder } = await createSubmittedSaleOrder(70, 110);
    const merch = await createRoleToken('MERCHANDISER');
    const line = saleOrder.lines[0];

    const approved = await approveSaleOrder(merch.token, saleOrder.id, {
      expectedVersion: saleOrder.version,
      reason: 'Partial stock available',
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 40 }],
    }).expect(200);

    const res = await getAudit(merch.token, approved.body.data.id).expect(200);
    const entries = res.body.data as Array<{
      id: string;
      action: string;
      title: string;
      detail: string | null;
      actor: { id: string; name: string } | null;
      createdAt: string;
    }>;

    const created = entries.find((e) => e.action === 'SALE_ORDER_CREATED');
    expect(created?.actor?.id).toBe(distributor.userId);
    expect(created?.title).toBe('Sale Order Created');

    const submitted = entries.find((e) => e.action === 'SALE_ORDER_SUBMITTED');
    expect(submitted?.actor?.id).toBe(distributor.userId);
    expect(submitted?.detail).toBe('70 unit(s) reserved from available stock');

    const lineApproved = entries.find((e) => e.action === 'SALE_ORDER_LINE_APPROVED');
    expect(lineApproved?.actor?.id).toBe(merch.userId);
    expect(lineApproved?.detail).toContain('Requested 70 → Approved 40');

    const approvedEntry = entries.find((e) => e.action === 'SALE_ORDER_APPROVED');
    expect(approvedEntry?.actor?.id).toBe(merch.userId);
    expect(approvedEntry?.detail).toBe('Reason: Partial stock available');
    expect(approvedEntry?.title).toBe('Approved');
  });

  it('is ordered by time ascending with no duplicate ids, and includes no entries from another sale order', async () => {
    const { saleOrder: otherOrder } = await createSubmittedSaleOrder(10);
    const { saleOrder } = await createSubmittedSaleOrder(20);
    const merch = await createRoleToken('MERCHANDISER');
    const line = saleOrder.lines[0];
    const approved = await approveSaleOrder(merch.token, saleOrder.id, {
      expectedVersion: saleOrder.version,
      lines: [{ saleOrderLineId: line.id, approvedQuantity: 20 }],
    }).expect(200);

    const res = await getAudit(merch.token, approved.body.data.id).expect(200);
    const entries = res.body.data as Array<{ id: string; createdAt: string }>;

    expect(entries.length).toBeGreaterThanOrEqual(4);
    const timestamps = entries.map((e) => new Date(e.createdAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);

    const otherOrderIds = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: otherOrder.id }, { entityId: { in: otherOrder.lines.map((l: { id: string }) => l.id) } }] },
      select: { id: true },
    });
    const otherIdSet = new Set(otherOrderIds.map((r) => r.id));
    expect(entries.some((e) => otherIdSet.has(e.id))).toBe(false);
  });

  it('returns a valid empty array for a sale order with no audit history', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    await prisma.auditLog.deleteMany({ where: { entityId: saleOrder.id } });
    const admin = await createRoleToken('ADMIN');

    const res = await getAudit(admin.token, saleOrder.id).expect(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('Sale Order audit trail — authorization', () => {
  it('allows ADMIN, MERCHANDISER, SENIOR_MANAGEMENT, and ACCOUNTANT (read-only)', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    for (const role of ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] satisfies Role[]) {
      const { token } = await createRoleToken(role);
      await getAudit(token, saleOrder.id).expect(200);
    }
  });

  it('allows the owning DISTRIBUTOR', async () => {
    const { distributor, saleOrder } = await createSubmittedSaleOrder(10);
    await getAudit(distributor.token, saleOrder.id).expect(200);
  });

  it('denies an unrelated DISTRIBUTOR', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    const otherDistributor = await createTestDistributor();
    const otherUser = await createDistributorUser(otherDistributor.id);
    await getAudit(otherUser.token, saleOrder.id).expect(403);
  });

  it('lets ACCOUNTANT see any distributor’s sale order audit history, not only their own', async () => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    const { token } = await createRoleToken('ACCOUNTANT');
    await getAudit(token, saleOrder.id).expect(200);
  });

  it.each(['QA_USER', 'FACTORY_USER'] satisfies Role[])('denies %s', async (role) => {
    const { saleOrder } = await createSubmittedSaleOrder(10);
    const { token } = await createRoleToken(role);
    const res = await getAudit(token, saleOrder.id);
    expect([401, 403]).toContain(res.status);
  });
});

describe('Sale Order audit trail — cross-distributor privacy (mandatory)', () => {
  it('reveals full reassignment provenance to MERCHANDISER/ADMIN but sanitizes it for the owning DISTRIBUTOR', async () => {
    const owningDistributor = await createTestDistributor({ name: 'Owning Distributor Co' });
    const sourceDistributor = await createTestDistributor({ name: 'Secret Source Distributor Ltd' });
    const sourceFactory = await createTestFactory({ name: 'Secret Source Factory' });

    const stock = await createReleasedQaStock({ quantity: 20, distributorId: owningDistributor.id });
    const distributor = await createDistributorUser(owningDistributor.id);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributor.token}`)
      .send({
        distributorId: owningDistributor.id,
        soDate: '2026-06-30',
        lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 20 }],
      })
      .expect(201);
    const submitted = await submitSaleOrder(distributor.token, created.body.data.id, created.body.data.version).expect(
      200,
    );

    const sourceStock = await createReleasedQaStock({
      quantity: 15,
      distributorId: sourceDistributor.id,
      factoryId: sourceFactory.id,
    });
    const merch = await createRoleToken('MERCHANDISER');
    const line = submitted.body.data.lines[0];

    const approved = await approveSaleOrder(merch.token, submitted.body.data.id, {
      expectedVersion: submitted.body.data.version,
      lines: [
        {
          saleOrderLineId: line.id,
          approvedQuantity: 35,
          sourcing: [
            {
              qaReleaseLineId: sourceStock.qaReleaseLineId,
              quantity: 15,
              reason: 'Urgent rebalancing across distributors',
            },
          ],
        },
      ],
    }).expect(200);

    const asMerchandiser = await getAudit(merch.token, approved.body.data.id).expect(200);
    const merchandiserPayload = JSON.stringify(asMerchandiser.body);
    expect(merchandiserPayload).toContain('Secret Source Distributor Ltd');
    expect(merchandiserPayload).toContain(sourceStock.poNumber);

    const asDistributor = await getAudit(distributor.token, approved.body.data.id).expect(200);
    const distributorPayload = JSON.stringify(asDistributor.body);
    expect(distributorPayload).not.toContain('Secret Source Distributor');
    expect(distributorPayload).not.toContain(sourceStock.poNumber);
    expect(distributorPayload).not.toContain('Secret Source Factory');
    expect(distributorPayload).not.toContain(sourceStock.qaReleaseLineId);
    expect(distributorPayload).not.toContain(sourceStock.jobOrderId);
    expect(distributorPayload).toContain('additional stock allocated by Merchandiser');

    // ACCOUNTANT is a read-only financial-review role, not a privileged
    // reviewer — it must see the same sanitized detail as the owning
    // DISTRIBUTOR, never another distributor's identity/PO/factory, even
    // though it (unlike DISTRIBUTOR) can view every sale order.
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const asAccountant = await getAudit(accountantToken, approved.body.data.id).expect(200);
    const accountantPayload = JSON.stringify(asAccountant.body);
    expect(accountantPayload).not.toContain('Secret Source Distributor');
    expect(accountantPayload).not.toContain(sourceStock.poNumber);
    expect(accountantPayload).not.toContain('Secret Source Factory');
    expect(accountantPayload).not.toContain(sourceStock.qaReleaseLineId);
    expect(accountantPayload).not.toContain(sourceStock.jobOrderId);
    expect(accountantPayload).toContain('additional stock allocated by Merchandiser');
  });
});
