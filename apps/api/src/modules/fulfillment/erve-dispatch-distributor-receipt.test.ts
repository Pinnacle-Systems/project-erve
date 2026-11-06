import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
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

type Group = {
  styleId: string;
  sizeId: string;
  receivedQuantity: number;
  allocations?: Array<{ saleOrderLineId: string; receivedQuantity: number }>;
};

async function dispatchedFixture(quantity = 100, purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'SALE_RETURN') {
  const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, purchaseMode);
  const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
  const factoryDispatch = await packAndFinalize(
    app,
    factoryToken,
    fixture.saleOrder.id,
    fixture.saleOrderLineId,
    fixture.saleOrder.destinations[0].id,
    quantity,
  );
  const dispatch = await consolidateAndDispatch(app, fixture.merchToken, [factoryDispatch.cartonId]);
  const line = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: fixture.saleOrderLineId } });
  return { fixture, dispatch, cartonId: factoryDispatch.cartonId, styleId: line.styleId, sizeId: line.sizeId };
}

const detail = (token: string, id: string) =>
  request(app).get(`/erve-dispatches/${id}`).set('Authorization', `Bearer ${token}`);

const submit = (token: string, id: string, body: Record<string, unknown>, key: string | null = createId()) => {
  const req = request(app).post(`/erve-dispatches/${id}/distributor-receipt`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

const payload = (expectedVersion: number, groups: Group[], extra: Record<string, unknown> = {}) => ({
  expectedVersion,
  acknowledged: true,
  groups,
  ...extra,
});

const receiptRows = () => prisma.erveDispatchDistributorReceipt.count();

/**
 * Two Sale Order lines for the SAME Style x Size in one Erve Dispatch (the
 * Phase 6 cross-Dispatch-Order consolidation shape), deliberately mixing
 * SALE_RETURN (line A) and OUTRIGHT (line B).
 */
async function multiSourceFixture(aQuantity = 60, bQuantity = 40) {
  const base = await dispatchedFixture(aQuantity, 'SALE_RETURN');
  await prisma.distributor.update({ where: { id: base.fixture.stock.distributorId }, data: { purchaseMode: 'OUTRIGHT' } });
  const second = await createSingleFactoryApprovedSaleOrder(app, bQuantity, 'OUTRIGHT', {
    factoryId: base.fixture.stock.factoryId,
    distributorId: base.fixture.stock.distributorId,
    styleId: base.styleId,
    sizeId: base.sizeId,
  });
  await prisma.factoryPackingCartonLine.create({
    data: { id: createId(), cartonId: base.cartonId, saleOrderLineId: second.saleOrderLineId, quantity: bQuantity },
  });
  return { ...base, lineA: base.fixture.saleOrderLineId, lineB: second.saleOrderLineId, aQuantity, bQuantity };
}

describe('Distributor actual receipt (A4)', () => {
  describe('no earlier ledger', () => {
    it('applies a full receipt: ledger written, DELIVERED, DISTRIBUTOR_CONFIRMED, version bumped', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(100);
      const res = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 100 }])).expect(201);

      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.deliveryConfirmationSource).toBe('DISTRIBUTOR_CONFIRMED');
      expect(res.body.data.version).toBe(dispatch.version + 1);
      expect(res.body.data.deliveryLines).toEqual([{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 100 }]);
      expect(res.body.data.distributorReceipt).toMatchObject({
        ledgerDisposition: 'APPLIED',
        totalDispatchedQuantity: 100,
        totalReceivedQuantity: 100,
        totalShortageQuantity: 0,
        downstreamBasis: 'DISTRIBUTOR_RECEIPT',
        hasLedgerDiscrepancy: false,
        prior: { status: 'DISPATCHED', deliveryConfirmationSource: null },
      });
      expect(res.body.data.distributorReceipt.receivedBy.id).toBe(res.body.data.deliveredBy.id);
      expect(res.body.data.canSubmitDistributorReceipt).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'ERVE_DISPATCH_DISTRIBUTOR_RECEIPT_SUBMITTED', entityId: dispatch.id } })).toBe(1);
    });

    it('applies a short receipt only with remarks, and the newly applied SALE_RETURN ceiling is the received quantity', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(100);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 90 }]);
      await submit(fixture.distributorToken, dispatch.id, body).expect(400);
      expect(await receiptRows()).toBe(0);

      const res = await submit(fixture.distributorToken, dispatch.id, { ...body, remarks: '  10 cartons damaged  ' }).expect(201);
      expect(res.body.data.distributorReceipt).toMatchObject({ remarks: '10 cartons damaged', totalShortageQuantity: 10, ledgerDisposition: 'APPLIED' });
      expect(res.body.data.distributorReceipt.lines[0]).toMatchObject({ dispatchedQuantity: 100, receivedQuantity: 90, shortageQuantity: 10, previousLedgerQuantity: null, currentLedgerQuantity: 90 });
      expect(res.body.data.deliveryRemarks).toBe('10 cartons damaged');

      const sale = (quantitySold: number) =>
        request(app).post('/distributor-sales-reports').set('Authorization', `Bearer ${fixture.distributorToken}`).send({
          distributorId: fixture.stock.distributorId,
          reportDate: '2026-08-01',
          lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold }],
        });
      await sale(91).expect(400);
      await sale(90).expect(201);
    });

    it('caps new Distributor Returns at the newly applied received quantity', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(100);
      await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 90 }], { remarks: '10 missing' })).expect(201);
      const returnRequest = (requestedQuantity: number) =>
        request(app).post('/distributor-returns').set('Authorization', `Bearer ${fixture.distributorToken}`).send({
          distributorId: fixture.stock.distributorId,
          returnDate: '2026-09-01',
          returnReason: 'Unsold',
          lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, requestedQuantity }],
        });
      await returnRequest(91).expect(400);
      await returnRequest(90).expect(201);
    });

    it('stores an all-zero receipt as final evidence without ledger quantity or DELIVERED', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(100);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 0 }]);
      await submit(fixture.distributorToken, dispatch.id, body).expect(400);
      const res = await submit(fixture.distributorToken, dispatch.id, { ...body, remarks: 'Nothing arrived' }).expect(201);

      expect(res.body.data.status).toBe('DISPATCHED');
      expect(res.body.data.deliveryConfirmationSource).toBeNull();
      expect(res.body.data.deliveredAt).toBeNull();
      expect(res.body.data.version).toBe(dispatch.version + 1);
      expect(res.body.data.deliveryLines).toEqual([]);
      expect(res.body.data.distributorReceipt).toMatchObject({ ledgerDisposition: 'NOT_APPLIED_ZERO', totalReceivedQuantity: 0, downstreamBasis: 'NONE', hasLedgerDiscrepancy: false });
      expect(await prisma.erveDispatchDeliveryLine.count({ where: { erveDispatchId: dispatch.id } })).toBe(0);

      // No downstream quantity exists, and it is final: no second receipt either.
      await request(app).post('/distributor-sales-reports').set('Authorization', `Bearer ${fixture.distributorToken}`).send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 1 }],
      }).expect(400);
      await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version + 1, [{ styleId, sizeId, receivedQuantity: 100 }])).expect(409);
    });

    it('does not require QR carton evidence or a DELIVERED status, and leaves LR concurrency semantics intact', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      expect(await prisma.cartonDeliveryConfirmation.count()).toBe(0);
      await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }])).expect(201);

      const stale = await request(app).patch(`/erve-dispatches/${dispatch.id}/lr`).set('Authorization', `Bearer ${fixture.merchToken}`)
        .send({ expectedVersion: dispatch.version, lrNumber: 'LR-1' });
      expect(stale.status).toBe(409);
      await request(app).patch(`/erve-dispatches/${dispatch.id}/lr`).set('Authorization', `Bearer ${fixture.merchToken}`)
        .send({ expectedVersion: dispatch.version + 1, lrNumber: 'LR-1' }).expect(200);
    });
  });

  describe('Admin / Merchandiser fallback after a distributor receipt', () => {
    it('is rejected after an applied receipt', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(20);
      const done = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 20 }])).expect(201);
      const res = await request(app).patch(`/erve-dispatches/${dispatch.id}/delivery`).set('Authorization', `Bearer ${fixture.merchToken}`)
        .send({ expectedVersion: done.body.data.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/final receipt/);
    });

    it('is rejected after an all-zero receipt, so no contradictory ledger can be created', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(20);
      const done = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 0 }], { remarks: 'None' })).expect(201);
      const { token: adminToken } = await createRoleToken('ADMIN');
      for (const token of [fixture.merchToken, adminToken]) {
        const res = await request(app).patch(`/erve-dispatches/${dispatch.id}/delivery`).set('Authorization', `Bearer ${token}`)
          .send({ expectedVersion: done.body.data.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 }] });
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/final receipt/);
      }
      expect(await prisma.erveDispatchDeliveryLine.count({ where: { erveDispatchId: dispatch.id } })).toBe(0);
      expect((await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).status).toBe('DISPATCHED');
    });

    it('still works normally when no distributor receipt exists', async () => {
      const { fixture, dispatch } = await dispatchedFixture(20);
      const res = await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.id, dispatch.version, [
        { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 },
      ]);
      expect(res.body.data.deliveryConfirmationSource).toBe('USER_CONFIRMED');
      expect(res.body.data.distributorReceipt).toBeNull();
    });
  });

  describe('earlier Admin / legacy ledger', () => {
    it('stores evidence only after an Admin confirmation: ledger, source and status are preserved and the discrepancy is shown', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(100);
      const admin = await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.id, dispatch.version, [
        { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 95 },
      ], '5 short at the door');

      const res = await submit(fixture.distributorToken, dispatch.id, payload(admin.body.data.version, [{ styleId, sizeId, receivedQuantity: 80 }], { remarks: '20 missing' })).expect(201);
      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.deliveryConfirmationSource).toBe('USER_CONFIRMED');
      expect(res.body.data.deliveryRemarks).toBe('5 short at the door');
      expect(res.body.data.deliveredBy.id).toBe(admin.body.data.deliveredBy.id);
      expect(res.body.data.deliveryLines).toEqual([{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 95 }]);
      expect(res.body.data.version).toBe(admin.body.data.version + 1);
      expect(res.body.data.distributorReceipt).toMatchObject({
        ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
        downstreamBasis: 'EXISTING_LEDGER',
        hasLedgerDiscrepancy: true,
        totalReceivedQuantity: 80,
        prior: { status: 'DELIVERED', deliveryConfirmationSource: 'USER_CONFIRMED', deliveryRemarks: '5 short at the door' },
      });
      expect(res.body.data.distributorReceipt.lines[0]).toMatchObject({ receivedQuantity: 80, previousLedgerQuantity: 95, currentLedgerQuantity: 95 });
    });

    it('preserves a legacy-assumed ledger and its existing Actual Sales; downstream keeps using the earlier ledger', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(50);
      await prisma.erveDispatchDeliveryLine.create({
        data: { id: createId(), erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 50 },
      });
      await prisma.erveDispatch.update({ where: { id: dispatch.id }, data: { status: 'DELIVERED', deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' } });
      const sale = (quantitySold: number) =>
        request(app).post('/distributor-sales-reports').set('Authorization', `Bearer ${fixture.distributorToken}`).send({
          distributorId: fixture.stock.distributorId,
          reportDate: '2026-08-01',
          lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold }],
        });
      await sale(10).expect(201);

      // The distributor now says only 5 arrived — fewer than the 10 already sold.
      const res = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 5 }], { remarks: 'Only 5 arrived' })).expect(201);
      expect(res.body.data.distributorReceipt).toMatchObject({
        ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
        hasLedgerDiscrepancy: true,
        prior: { deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT', deliveredBy: null, deliveredAt: null },
      });
      expect(res.body.data.deliveryConfirmationSource).toBe('LEGACY_ASSUMED_FULL_RECEIPT');
      expect(await prisma.erveDispatchDeliveryLine.findMany({ where: { erveDispatchId: dispatch.id } }).then((r) => r.map((x) => x.receivedQuantity))).toEqual([50]);
      expect(await prisma.distributorSalesReportLine.count({ where: { erveDispatchId: dispatch.id } })).toBe(1);

      // Existing reservations are unaffected: the earlier ledger (50 - 10 sold) still governs.
      await sale(41).expect(400);
      await sale(40).expect(201);
    });
  });

  describe('multiple Sale Order lines for one Style x Size', () => {
    it('allocates a full receipt automatically per source line and shows source references and purchase modes', async () => {
      const f = await multiSourceFixture();
      const res = await submit(f.fixture.distributorToken, f.dispatch.id, payload(f.dispatch.version, [{ styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: 100 }])).expect(201);
      expect(res.body.data.deliveryLines).toEqual(
        expect.arrayContaining([
          { saleOrderLineId: f.lineA, receivedQuantity: 60 },
          { saleOrderLineId: f.lineB, receivedQuantity: 40 },
        ]),
      );
      const lines = res.body.data.distributorReceipt.lines as Array<{ saleOrderLineId: string; purchaseMode: string; saleOrderNumber: string }>;
      expect(lines.find((l) => l.saleOrderLineId === f.lineA)!.purchaseMode).toBe('SALE_RETURN');
      expect(lines.find((l) => l.saleOrderLineId === f.lineB)!.purchaseMode).toBe('OUTRIGHT');
      expect(lines.every((l) => l.saleOrderNumber)).toBe(true);
      const ql = res.body.data.quantityLines as Array<{ saleOrderLineId: string; purchaseMode?: string; saleOrderNumber?: string }>;
      expect(ql.find((l) => l.saleOrderLineId === f.lineA)).toMatchObject({ purchaseMode: 'SALE_RETURN' });
      expect(ql).toHaveLength(2);
    });

    it('allocates a zero receipt automatically', async () => {
      const f = await multiSourceFixture();
      const res = await submit(f.fixture.distributorToken, f.dispatch.id, payload(f.dispatch.version, [{ styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: 0 }], { remarks: 'Nothing' })).expect(201);
      expect(res.body.data.distributorReceipt.lines.map((l: { receivedQuantity: number }) => l.receivedQuantity)).toEqual([0, 0]);
    });

    it('refuses an ambiguous partial receipt without explicit allocation, and invalid allocations', async () => {
      const f = await multiSourceFixture();
      const group = { styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: 90 };
      const send = (g: Group) => submit(f.fixture.distributorToken, f.dispatch.id, payload(f.dispatch.version, [g], { remarks: 'Short' }));
      expect((await send(group)).body.error.message).toMatch(/must be allocated/);
      await send({ ...group, allocations: [{ saleOrderLineId: f.lineA, receivedQuantity: 50 }, { saleOrderLineId: f.lineB, receivedQuantity: 30 }] }).expect(400);
      await send({ ...group, allocations: [{ saleOrderLineId: f.lineA, receivedQuantity: 61 }, { saleOrderLineId: f.lineB, receivedQuantity: 29 }] }).expect(400);
      await send({ ...group, allocations: [{ saleOrderLineId: f.lineA, receivedQuantity: 90 }] }).expect(400);
      expect(await receiptRows()).toBe(0);
    });

    it('records an exact explicit allocation across mixed purchase modes and applies it to the ledger', async () => {
      const f = await multiSourceFixture();
      const res = await submit(f.fixture.distributorToken, f.dispatch.id, payload(f.dispatch.version, [{
        styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: 90,
        allocations: [{ saleOrderLineId: f.lineA, receivedQuantity: 50 }, { saleOrderLineId: f.lineB, receivedQuantity: 40 }],
      }], { remarks: '10 SALE_RETURN pieces missing' })).expect(201);
      const ledger = Object.fromEntries((await prisma.erveDispatchDeliveryLine.findMany({ where: { erveDispatchId: f.dispatch.id } })).map((r) => [r.saleOrderLineId, r.receivedQuantity]));
      expect(ledger).toEqual({ [f.lineA]: 50, [f.lineB]: 40 });
      expect(res.body.data.distributorReceipt).toMatchObject({ totalReceivedQuantity: 90, totalShortageQuantity: 10 });

      // The SALE_RETURN line's ceiling is its own allocated 50, not the 60 dispatched.
      const sale = (q: number) => request(app).post('/distributor-sales-reports').set('Authorization', `Bearer ${f.fixture.distributorToken}`).send({
        distributorId: f.fixture.stock.distributorId, reportDate: '2026-08-01',
        lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.lineA, quantitySold: q }],
      });
      await sale(51).expect(400);
      await sale(50).expect(201);
    });
  });

  describe('authorization and ownership', () => {
    it('forbids every non-distributor role, other distributors and unauthenticated callers', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }]);
      const { distributorId: otherId } = await (async () => {
        const other = await createSingleFactoryApprovedSaleOrder(app, 5, 'OUTRIGHT');
        return { distributorId: other.stock.distributorId };
      })();
      const otherToken = await createDistributorToken(otherId);

      for (const role of ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT', 'SENIOR_MANAGEMENT', 'TRANSPORTER'] as const) {
        const { token } = await createRoleToken(role);
        await submit(token, dispatch.id, body).expect(403);
      }
      await submit(otherToken, dispatch.id, body).expect(403);
      await request(app).post(`/erve-dispatches/${dispatch.id}/distributor-receipt`).send(body).expect(401);
      expect(await receiptRows()).toBe(0);
      expect((await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).status).toBe('DISPATCHED');

      // Another distributor cannot read it either, and staff see eligibility = false.
      await detail(otherToken, dispatch.id).expect(403);
      expect((await detail(fixture.merchToken, dispatch.id).expect(200)).body.data.canSubmitDistributorReceipt).toBe(false);
      expect((await detail(fixture.distributorToken, dispatch.id).expect(200)).body.data.canSubmitDistributorReceipt).toBe(true);
    });

    it('rejects a distributor account with no mapped distributor', async () => {
      const { dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const { createTestUserAndToken } = await import('../../test/helpers.js');
      const { token } = await createTestUserAndToken({ email: `unmapped-${createId()}@test.local`, password: 'pass', roles: ['DISTRIBUTOR'] });
      await submit(token, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }])).expect(403);
    });
  });

  describe('validation', () => {
    it('rejects missing acknowledgement, missing Idempotency-Key and malformed payloads without side effects', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const t = fixture.distributorToken;
      const v = dispatch.version;
      const ok: Group = { styleId, sizeId, receivedQuantity: 10 };
      await submit(t, dispatch.id, { expectedVersion: v, groups: [ok] }).expect(400);
      await submit(t, dispatch.id, { ...payload(v, [ok]), acknowledged: false }).expect(400);
      await submit(t, dispatch.id, payload(v, [ok]), null).expect(400);
      await submit(t, dispatch.id, payload(v, [])).expect(400);
      await submit(t, dispatch.id, payload(v, [{ ...ok, receivedQuantity: 11 }])).expect(400);
      await submit(t, dispatch.id, payload(v, [{ ...ok, receivedQuantity: -1 }], { remarks: 'x' })).expect(400);
      await submit(t, dispatch.id, payload(v, [{ ...ok, receivedQuantity: 1.5 }], { remarks: 'x' })).expect(400);
      await submit(t, dispatch.id, payload(v, [{ ...ok, styleId: 'nope' }])).expect(400);
      await submit(t, dispatch.id, payload(v, [ok, ok])).expect(400);
      await submit(t, dispatch.id, { ...payload(v, [ok]), extra: 1 }).expect(400);
      expect(await receiptRows()).toBe(0);
      expect((await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).version).toBe(v);
    });
  });

  describe('duplicate, stale, concurrent and idempotent submission', () => {
    it('replays the same Idempotency-Key and payload (even with the pre-submission version) and rejects any other repeat', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }]);
      const key = createId();
      const first = await submit(fixture.distributorToken, dispatch.id, body, key).expect(201);
      const replay = await submit(fixture.distributorToken, dispatch.id, body, key).expect(200);
      expect(replay.body.data.distributorReceipt.id).toBe(first.body.data.distributorReceipt.id);
      expect(replay.body.data.version).toBe(first.body.data.version);
      expect(await receiptRows()).toBe(1);

      const changed = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 9 }], { remarks: 'x' }), key).expect(409);
      expect(changed.body.error.message).toMatch(/Idempotency-Key/);
      await submit(fixture.distributorToken, dispatch.id, body, createId()).expect(409);
      expect(await receiptRows()).toBe(1);
    });

    it('rejects a stale expectedVersion without writing, and the retry with the fresh version succeeds', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      await request(app).patch(`/erve-dispatches/${dispatch.id}/lr`).set('Authorization', `Bearer ${fixture.merchToken}`)
        .send({ expectedVersion: dispatch.version, lrNumber: 'LR-9' }).expect(200);
      const stale = await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }])).expect(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');
      expect(await receiptRows()).toBe(0);
      expect(await prisma.erveDispatchDeliveryLine.count()).toBe(0);
      await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version + 1, [{ styleId, sizeId, receivedQuantity: 10 }])).expect(201);
    });

    it('lets exactly one of two concurrent submissions win', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }]);
      const results = await Promise.all([
        submit(fixture.distributorToken, dispatch.id, body),
        submit(fixture.distributorToken, dispatch.id, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await receiptRows()).toBe(1);
      expect(await prisma.erveDispatchDeliveryLine.count({ where: { erveDispatchId: dispatch.id } })).toBe(1);
    });

    it('treats concurrent retries of the same key as one acceptance plus one replay', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const body = payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }]);
      const key = createId();
      const results = await Promise.all([
        submit(fixture.distributorToken, dispatch.id, body, key),
        submit(fixture.distributorToken, dispatch.id, body, key),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(await receiptRows()).toBe(1);
    });

    it('serializes against a concurrent Admin fallback: exactly one authority creates the ledger', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      const [receipt, fallback] = await Promise.all([
        submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }])),
        request(app).patch(`/erve-dispatches/${dispatch.id}/delivery`).set('Authorization', `Bearer ${fixture.merchToken}`)
          .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 10 }] }),
      ]);
      expect([receipt.status, fallback.status].filter((s) => s === 200 || s === 201)).toHaveLength(1);
      expect(await prisma.erveDispatchDeliveryLine.count({ where: { erveDispatchId: dispatch.id } })).toBe(1);
    });
  });

  describe('evidence immutability', () => {
    it('blocks updates and deletes of receipt evidence at the database', async () => {
      const { fixture, dispatch, styleId, sizeId } = await dispatchedFixture(10);
      await submit(fixture.distributorToken, dispatch.id, payload(dispatch.version, [{ styleId, sizeId, receivedQuantity: 10 }])).expect(201);
      await expect(prisma.erveDispatchDistributorReceipt.updateMany({ data: { remarks: 'edited' } })).rejects.toThrow(/immutable/);
      await expect(prisma.erveDispatchDistributorReceiptLine.updateMany({ data: { receivedQuantity: 0 } })).rejects.toThrow(/immutable/);
      await expect(prisma.erveDispatchDistributorReceipt.deleteMany()).rejects.toThrow(/immutable/);
      expect(await receiptRows()).toBe(1);
    });
  });
});
