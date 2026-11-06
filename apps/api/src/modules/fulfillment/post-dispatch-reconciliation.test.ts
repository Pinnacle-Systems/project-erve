import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId, canViewReconciliation, canReviewReconciliation } from '@erve/shared';
import type { ReconciliationDetail, Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  getReconciliation,
  recordReconciliationReview,
} from './post-dispatch-reconciliation.service.js';
import { toCurrentUser, currentUserSelect } from '../../auth/current-user.js';
import {
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture() {
  const f = await createSingleFactoryApprovedSaleOrder(app, 100, 'SALE_RETURN');
  const factory = await createFactoryUserToken(f.stock.factoryId);
  const packed = await packAndFinalize(
    app,
    factory,
    f.saleOrder.id,
    f.saleOrderLineId,
    f.saleOrder.destinations[0].id,
    100,
  );
  const dispatch = await consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  const line = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: f.saleOrderLineId } });
  return { ...f, dispatch, cartonId: packed.cartonId, styleId: line.styleId, sizeId: line.sizeId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function detail(f: Fixture, token = f.merchToken): Promise<ReconciliationDetail> {
  const response = await request(app)
    .get(`/erve-dispatches/${f.dispatch.id}/reconciliation`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return response.body.data;
}
async function attest(f: Fixture, receivedQuantity: number, expectedVersion = f.dispatch.version) {
  await request(app)
    .post(`/erve-dispatches/${f.dispatch.id}/distributor-receipt`)
    .set('Authorization', `Bearer ${f.distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion,
      acknowledged: true,
      remarks: 'Receipt evidence',
      groups: [{ styleId: f.styleId, sizeId: f.sizeId, receivedQuantity }],
    })
    .expect(201);
}
function review(
  f: Fixture,
  d: ReconciliationDetail,
  token = f.merchToken,
  action = 'FOLLOW_UP',
  remarks = 'Investigate physical shortage',
) {
  return request(app)
    .post(`/erve-dispatches/${f.dispatch.id}/reconciliation/reviews`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      action,
      remarks,
      snapshotToken: d.summary.snapshotToken,
      previousReviewId: d.summary.latestReviewId,
    });
}
async function queue(token: string, query: Record<string, string | number> = {}) {
  const response = await request(app)
    .get('/post-dispatch-reconciliation')
    .query(query)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return response.body.data;
}

describe('A5 post-dispatch reconciliation', () => {
  it('keeps missing receipt and ledger distinct from zero; QR pending proves no shortage', async () => {
    const f = await fixture();
    const d = await detail(f);
    expect(d.summary).toMatchObject({
      dispatchedQuantity: 100,
      cartonCount: 1,
      qrConfirmed: 0,
      qrPending: 1,
      receivedQuantity: null,
      ledgerQuantity: null,
      shortageQuantity: null,
      awaitingReceipt: true,
      hasShortage: false,
      nothingReceived: false,
      receiptDiffers: false,
      pendingReview: true,
    });
    expect(d.lines[0]).toMatchObject({
      receivedQuantity: null,
      ledgerQuantity: null,
      difference: null,
    });
  });

  it.each([100, 70, 0])(
    'classifies final receipt %i independently of QR evidence',
    async (received) => {
      const f = await fixture();
      await attest(f, received);
      const d = await detail(f);
      expect(d.summary).toMatchObject({
        receivedQuantity: received,
        ledgerQuantity: received === 0 ? null : received,
        shortageQuantity: 100 - received,
        awaitingReceipt: false,
        receiptMatchesLedger: received > 0,
        receiptDiffers: false,
        hasShortage: received < 100,
        nothingReceived: received === 0,
        qrPending: 1,
      });
      expect((await queue(f.merchToken, { allZero: 'true' })).total).toBe(received === 0 ? 1 : 0);
      expect((await queue(f.merchToken, { shortage: 'true' })).total).toBe(received < 100 ? 1 : 0);
      if (!received)
        expect(
          (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: f.dispatch.id } })).status,
        ).toBe('DISPATCHED');
    },
  );

  it('matches distributor receipt to earlier Admin ledger', async () => {
    const f = await fixture();
    const confirmed = await confirmErveDispatchDelivery(
      app,
      f.merchToken,
      f.dispatch.id,
      f.dispatch.version,
      [{ saleOrderLineId: f.saleOrderLineId, receivedQuantity: 80 }],
      '20 short',
    );
    await attest(f, 80, confirmed.body.data.version);
    expect((await detail(f)).summary).toMatchObject({
      ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
      receiptMatchesLedger: true,
      receiptDiffers: false,
      hasShortage: true,
      ledgerSource: 'USER_CONFIRMED',
    });
  });

  it('QR-confirmed cartons do not establish receipt, and new QR evidence makes a review pending', async () => {
    const f = await fixture();
    const before = await detail(f);
    await review(f, before).expect(201);
    const token = await prisma.cartonDeliveryToken.create({
      data: {
        id: createId(),
        cartonId: f.cartonId,
        tokenDigest: createId(),
        encryptedToken: 'fixture-only',
        keyVersion: 'fixture',
        labelReference: createId(),
        issuedById: (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: f.dispatch.id } }))
          .dispatchedById,
        validForDays: 180,
      },
    });
    await prisma.cartonDeliveryConfirmation.create({
      data: {
        id: createId(),
        cartonId: f.cartonId,
        dispatchId: f.dispatch.id,
        tokenId: token.id,
        recipientName: 'Door recipient',
        deliveredAt: new Date(),
        timezone: 'UTC',
        offsetMinutes: 0,
        idempotencyKey: createId(),
        payloadDigest: createId(),
      },
    });
    const d = await detail(f);
    expect(d.summary).toMatchObject({
      qrConfirmed: 1,
      qrPending: 0,
      awaitingReceipt: true,
      receivedQuantity: null,
      hasShortage: false,
      pendingReview: true,
    });
    expect(d.summary.snapshotToken).not.toBe(before.summary.snapshotToken);
    await review(f, before).expect(409);
  });

  it('preserves legacy assumptions, actual sales and return reservations through review', async () => {
    const f = await fixture();
    await prisma.erveDispatchDeliveryLine.create({
      data: {
        id: createId(),
        erveDispatchId: f.dispatch.id,
        saleOrderLineId: f.saleOrderLineId,
        receivedQuantity: 100,
      },
    });
    await prisma.erveDispatch.update({
      where: { id: f.dispatch.id },
      data: { status: 'DELIVERED', deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' },
    });
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${f.distributorToken}`)
      .send({
        distributorId: f.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [
          { erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, quantitySold: 10 },
        ],
      })
      .expect(201);
    await request(app)
      .post('/distributor-returns')
      .set('Authorization', `Bearer ${f.distributorToken}`)
      .send({
        distributorId: f.stock.distributorId,
        returnDate: '2026-08-02',
        returnReason: 'Unsold',
        lines: [
          {
            erveDispatchId: f.dispatch.id,
            saleOrderLineId: f.saleOrderLineId,
            requestedQuantity: 5,
          },
        ],
      })
      .expect(201);
    await attest(f, 50);
    const before = await protectedState(f);
    const d = await detail(f);
    expect(d.summary).toMatchObject({
      receiptDiffers: true,
      downstreamActivity: true,
      ledgerSource: 'LEGACY_ASSUMED_FULL_RECEIPT',
      followUpRequired: true,
    });
    expect(d.lines[0]).toMatchObject({
      actualSoldQuantity: 10,
      pendingRequestedQuantity: 5,
      availableForActualSale: 90,
      availableForNewReturn: 85,
      difference: -50,
    });
    await review(f, d).expect(201);
    expect(await protectedState(f)).toEqual(before);
    const reviewed = await detail(f);
    expect(reviewed.summary).toMatchObject({
      receiptDiffers: true,
      latestReviewAction: 'FOLLOW_UP',
      pendingReview: false,
    });
    expect(reviewed.reviews[0]!.snapshot).toMatchObject({
      summary: { ledgerQuantity: 100, receivedQuantity: 50 },
      lines: [{ difference: -50 }],
    });
    const pending = await prisma.distributorReturn.findFirstOrThrow({ include: { lines: true } });
    const finance = await createRoleToken('ACCOUNTANT');
    const approved = await request(app)
      .post(`/distributor-returns/${pending.id}/approve`)
      .set('Authorization', `Bearer ${finance.token}`)
      .send({
        expectedVersion: pending.version,
        lines: [{ id: pending.lines[0]!.id, approvedQuantity: 5 }],
      })
      .expect(200);
    expect((await detail(f)).summary.pendingReview).toBe(true);
    await review(f, reviewed).expect(409);
    await request(app)
      .post(`/distributor-returns/${pending.id}/receive`)
      .set('Authorization', `Bearer ${f.merchToken}`)
      .send({
        expectedVersion: approved.body.data.version,
        lines: [{ id: pending.lines[0]!.id, receivedQuantity: 5 }],
      })
      .expect(200);
    const returned = await detail(f);
    expect(returned.lines[0]).toMatchObject({
      returnedQuantity: 5,
      pendingRequestedQuantity: 0,
      availableForNewReturn: 85,
    });
    const returnedState = await protectedState(f);
    await review(f, returned).expect(201);
    expect(await protectedState(f)).toEqual(returnedState);
  });

  it('compares mixed OUTRIGHT / SALE_RETURN source lines before Style × Size grouping', async () => {
    const f = await fixture();
    await prisma.distributor.update({
      where: { id: f.stock.distributorId },
      data: { purchaseMode: 'OUTRIGHT' },
    });
    const second = await createSingleFactoryApprovedSaleOrder(app, 40, 'OUTRIGHT', {
      factoryId: f.stock.factoryId,
      distributorId: f.stock.distributorId,
      styleId: f.styleId,
      sizeId: f.sizeId,
    });
    await prisma.factoryPackingCartonLine.create({
      data: {
        id: createId(),
        cartonId: f.cartonId,
        saleOrderLineId: second.saleOrderLineId,
        quantity: 40,
      },
    });
    const confirmed = await confirmErveDispatchDelivery(
      app,
      f.merchToken,
      f.dispatch.id,
      f.dispatch.version,
      [
        { saleOrderLineId: f.saleOrderLineId, receivedQuantity: 80 },
        { saleOrderLineId: second.saleOrderLineId, receivedQuantity: 30 },
      ],
      'Short',
    );
    await request(app)
      .post(`/erve-dispatches/${f.dispatch.id}/distributor-receipt`)
      .set('Authorization', `Bearer ${f.distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: confirmed.body.data.version,
        acknowledged: true,
        remarks: 'Different source allocation',
        groups: [
          {
            styleId: f.styleId,
            sizeId: f.sizeId,
            receivedQuantity: 110,
            allocations: [
              { saleOrderLineId: f.saleOrderLineId, receivedQuantity: 90 },
              { saleOrderLineId: second.saleOrderLineId, receivedQuantity: 20 },
            ],
          },
        ],
      })
      .expect(201);
    const d = await detail(f);
    expect(d.summary).toMatchObject({
      receivedQuantity: 110,
      ledgerQuantity: 110,
      receiptMatchesLedger: false,
      receiptDiffers: true,
    });
    expect(d.lines.map((l) => l.purchaseMode).sort()).toEqual(['OUTRIGHT', 'SALE_RETURN']);
    expect(d.lines.map((l) => l.difference).sort((a, b) => a! - b!)).toEqual([-10, 10]);
    expect((await queue(f.merchToken, { discrepancy: 'true' })).total).toBe(1);
  });

  it('paginates and filters before counting, including an empty out-of-range page', async () => {
    const f = await fixture();
    const other = await fixture();
    await attest(f, 0);
    expect(await queue(f.merchToken, { pageSize: 1 })).toMatchObject({ total: 2, page: 1 });
    expect((await queue(f.merchToken, { page: 2, pageSize: 1 })).items).toHaveLength(1);
    expect(await queue(f.merchToken, { page: 3, pageSize: 1 })).toMatchObject({
      total: 2,
      items: [],
    });
    expect(
      (await queue(f.merchToken, { distributorId: other.stock.distributorId })).items.map(
        (s: { id: string }) => s.id,
      ),
    ).toEqual([other.dispatch.id]);
    expect((await queue(f.merchToken, { awaitingReceipt: 'true' })).total).toBe(1);
    expect(
      (await queue(f.merchToken, { dispatchReference: f.dispatch.erveDispatchNumber })).total,
    ).toBe(1);
    await request(app)
      .get('/post-dispatch-reconciliation?pageSize=1000')
      .set('Authorization', `Bearer ${f.merchToken}`)
      .expect(400);
  });

  it('requires remarks, rejects stale/concurrent reviews, retains history and blocks database edits', async () => {
    const f = await fixture();
    const d = await detail(f);
    await review(f, d, f.merchToken, 'ACKNOWLEDGE', '  ').expect(400);
    const concurrent = await Promise.all([review(f, d), review(f, d)]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
    await review(f, d).expect(409);
    let current = await detail(f);
    await review(f, current, f.merchToken, 'ACKNOWLEDGE', 'Contacted distributor').expect(201);
    current = await detail(f);
    expect(current.reviews).toHaveLength(2);
    await expect(
      prisma.erveDispatchReconciliationReview.update({
        where: { id: current.reviews[0]!.id },
        data: { remarks: 'Overwrite' },
      }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.erveDispatchReconciliationReview.delete({ where: { id: current.reviews[0]!.id } }),
    ).rejects.toThrow('append-only');
    await attest(f, 100);
    expect((await detail(f)).summary.pendingReview).toBe(true);
    await review(f, current).expect(409);
    expect((await queue(f.merchToken, { pendingReview: 'true' })).total).toBe(1);
  });

  it.each([
    'ADMIN',
    'MERCHANDISER',
    'ACCOUNTANT',
    'SENIOR_MANAGEMENT',
    'DISTRIBUTOR',
    'FACTORY_USER',
    'TRANSPORTER',
    'QA_USER',
  ] as Role[])('enforces %s access at API and service', async (role) => {
    const f = await fixture();
    const { token, userId } = await createRoleToken(role);
    const user = toCurrentUser(
      await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: currentUserSelect }),
    );
    const canView = canViewReconciliation(user);
    await request(app)
      .get('/post-dispatch-reconciliation')
      .set('Authorization', `Bearer ${token}`)
      .expect(canView ? 200 : 403);
    await request(app)
      .get(`/erve-dispatches/${f.dispatch.id}/reconciliation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(canView ? 200 : 403);
    const d = await detail(f);
    for (const action of ['ACKNOWLEDGE', 'FOLLOW_UP', 'FINANCE_REVIEW'] as const) {
      const current = canView ? await detail(f) : d;
      await review(f, current, token, action).expect(
        canReviewReconciliation(user, action) ? 201 : 403,
      );
    }
    if (!canView) {
      await expect(getReconciliation(user, f.dispatch.id)).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(
        recordReconciliationReview(user, f.dispatch.id, {
          action: 'FOLLOW_UP',
          remarks: 'test',
          snapshotToken: d.summary.snapshotToken,
          previousReviewId: null,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('denies own and other distributor access to internal notes while retaining A4 views', async () => {
    const f = await fixture();
    await review(f, await detail(f)).expect(201);
    const other = await fixture();
    const outsider = await createDistributorToken(other.stock.distributorId);
    for (const token of [f.distributorToken, outsider]) {
      await request(app)
        .get(`/erve-dispatches/${f.dispatch.id}/reconciliation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
    const response = await request(app)
      .get(`/erve-dispatches/${f.dispatch.id}`)
      .set('Authorization', `Bearer ${f.distributorToken}`)
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('Investigate physical shortage');
  });
});

async function protectedState(f: Fixture) {
  return {
    dispatch: await prisma.erveDispatch.findUnique({ where: { id: f.dispatch.id } }),
    ledger: await prisma.erveDispatchDeliveryLine.findMany({ orderBy: { id: 'asc' } }),
    receipt: await prisma.erveDispatchDistributorReceipt.findMany(),
    receiptLines: await prisma.erveDispatchDistributorReceiptLine.findMany({
      orderBy: { id: 'asc' },
    }),
    cartons: await prisma.factoryPackingCarton.findMany({ orderBy: { id: 'asc' } }),
    qr: await prisma.cartonDeliveryConfirmation.findMany(),
    sales: await prisma.distributorSalesReportLine.findMany(),
    returns: await prisma.distributorReturnLine.findMany(),
    allocations: await prisma.stockAllocation.findMany({ orderBy: { id: 'asc' } }),
    lots: await prisma.returnedStockLot.findMany(),
    invoices: await prisma.taxInvoice.findMany(),
  };
}
