import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { getFileStorage } from '../../storage/index.js';
import { createApp } from '../../app.js';
import { prisma, Prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { reconcileInvoiceImageArchives } from './tax-invoice-document.service.js';
import { createTestSellerRegistration, resetDatabase } from '../../test/helpers.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';
import {
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  ensureActiveDistributorPricing,
  packAndFinalize,
} from './fulfillment-test-helpers.js';
import {
  assertTaxInvoiceSequenceBaselined,
  createOrGetTaxInvoiceDraft,
} from './tax-invoice.service.js';

const app = createApp();
beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

/** Finalizes (but does NOT dispatch) a single-carton Erve Packing List. */
async function createFinalizedEipl(
  quantity = 20,
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT',
) {
  const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, purchaseMode);
  const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
  const dispatch = await packAndFinalize(
    app,
    factoryToken,
    fixture.saleOrder.id,
    fixture.saleOrderLineId,
    fixture.saleOrder.destinations[0].id,
    quantity,
  );

  const created = await request(app)
    .post('/erve-packing-lists')
    .set('Authorization', `Bearer ${fixture.merchToken}`)
    .send({ cartonIds: [dispatch.cartonId] })
    .expect(201);
  const ervePackingListId = created.body.data.id as string;
  await ensureActiveDistributorPricing(created.body.data.distributor.id as string);

  await request(app)
    .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
    .set('Authorization', `Bearer ${fixture.merchToken}`)
    .send({})
    .expect(200);

  return { fixture, ervePackingListId, cartonId: dispatch.cartonId };
}

async function createAccountantToken() {
  const { token } = await createRoleToken('ACCOUNTANT');
  return token;
}

describe('Tax Invoice — draft creation eligibility', () => {
  it('creates a draft from a FINALIZED (not yet dispatched) Erve Packing List', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.invoiceNumber).toBeNull();
    expect(res.body.data.ervePackingList.id).toBe(ervePackingListId);
    expect(res.body.data.erveDispatch).toBeNull();
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].quantity).toBe(20);
  });

  it('creates a draft from an EIPL that has already progressed to DISPATCHED', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      20,
    );
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: erveDispatch.ervePackingList.id })
      .expect(201);

    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.ervePackingList.status).toBe('DISPATCHED');
    expect(res.body.data.erveDispatch?.id).toBe(erveDispatch.id);
  });

  it('rejects an OPEN (not yet finalized) Erve Packing List', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      20,
    );
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const accountantToken = await createAccountantToken();

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: created.body.data.id })
      .expect(409);
  });

  it('returns 404 for a non-existent Erve Packing List', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const accountantToken = await createAccountantToken();

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: 'does-not-exist' })
      .expect(404);
  });

  it('rejects a historical EIPL with no commercial snapshot at all (pre-INV-004 gap)', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    // Simulate a pre-INV-004 legacy row — the live flow can never produce
    // this state itself.
    await prisma.ervePackingListCommercialLine.deleteMany({ where: { ervePackingListId } });
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(400);

    expect(res.body.error.details.reason).toBe('COMMERCIAL_SNAPSHOT_MISSING');
  });

  it('rejects an EIPL whose commercial snapshot is missing a line for one of its carton-derived SaleOrderLines', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const fixtureA = await createApprovedSaleOrder(app, { quantity: 15 });
    const distributorId = fixtureA.stock.distributorId;
    const fixtureB = await createApprovedSaleOrder(app, { distributorId, quantity: 25 });
    const factoryTokenA = await createFactoryUserToken(fixtureA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(fixtureB.stock.factoryId);
    const dispatchA = await packAndFinalize(
      app,
      factoryTokenA,
      fixtureA.saleOrder.id,
      fixtureA.saleOrderLineId,
      fixtureA.saleOrder.destinations[0].id,
      15,
    );
    const dispatchB = await packAndFinalize(
      app,
      factoryTokenB,
      fixtureB.saleOrder.id,
      fixtureB.saleOrderLineId,
      fixtureB.saleOrder.destinations[0].id,
      25,
    );

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;
    await ensureActiveDistributorPricing(distributorId);
    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({})
      .expect(200);

    const lines = await prisma.ervePackingListCommercialLine.findMany({
      where: { ervePackingListId },
    });
    expect(lines).toHaveLength(2);
    await prisma.ervePackingListCommercialLine.delete({ where: { id: lines[0]!.id } });

    const accountantToken = await createAccountantToken();
    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(400);

    expect(res.body.error.details.reason).toBe('COMMERCIAL_SNAPSHOT_INCOMPLETE');
  });

  it('rejects an EIPL whose frozen quantity no longer matches its carton composition', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const line = await prisma.ervePackingListCommercialLine.findFirstOrThrow({
      where: { ervePackingListId },
    });
    await prisma.ervePackingListCommercialLine.update({
      where: { id: line.id },
      data: { quantity: line.quantity + 5 },
    });

    const accountantToken = await createAccountantToken();
    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(400);

    expect(res.body.error.details.reason).toBe('COMMERCIAL_SNAPSHOT_QUANTITY_MISMATCH');
  });

  it('rejects an EIPL whose commercial snapshot references a line no longer in its live carton composition', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId, cartonId } = await createFinalizedEipl(20);
    // Simulate drift: the carton backing this line is no longer live, but
    // the frozen commercial line (correctly) still is.
    await prisma.factoryPackingCarton.update({
      where: { id: cartonId },
      data: { retiredAt: new Date() },
    });

    const accountantToken = await createAccountantToken();
    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(400);

    expect(res.body.error.details.reason).toBe('COMMERCIAL_SNAPSHOT_INCONSISTENT');
  });
});

describe('Tax Invoice — seller registration resolution', () => {
  it('rejects draft creation when no Seller Registration is ACTIVE', async () => {
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(409);
  });

  it('rejects draft creation when more than one Seller Registration is ACTIVE', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    await createTestSellerRegistration({ branchCode: 'ERVE-SR', gstin: '29BBBBB0000B1Z5' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(409);
  });

  it('snapshots the full seller identity, address and bank details independently of later master edits', async () => {
    const seller = await createTestSellerRegistration({
      branchCode: 'ERVE-HO',
      legalName: 'ERVE India Private Limited',
    });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.seller.legalName).toBe('ERVE India Private Limited');
    expect(res.body.data.seller.bankAccountNumber).toBe('000111222333');
    expect(res.body.data.seller.bankIfsc).toBe('HDFC0001234');

    // Later master edit must never change the already-drafted invoice.
    await prisma.sellerRegistration.update({
      where: { id: seller.id },
      data: { legalName: 'Renamed Seller Pvt Ltd' },
    });
    const refetched = await request(app)
      .get(`/tax-invoices/${res.body.data.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(refetched.body.data.seller.legalName).toBe('ERVE India Private Limited');
  });
});

describe('Tax Invoice — quantity and provenance', () => {
  it('reconciles multiple SaleOrderLines from different Dispatch Orders/factories into one invoice', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const fixtureA = await createApprovedSaleOrder(app, { quantity: 15 });
    const distributorId = fixtureA.stock.distributorId;
    const fixtureB = await createApprovedSaleOrder(app, { distributorId, quantity: 25 });
    const factoryTokenA = await createFactoryUserToken(fixtureA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(fixtureB.stock.factoryId);
    const dispatchA = await packAndFinalize(
      app,
      factoryTokenA,
      fixtureA.saleOrder.id,
      fixtureA.saleOrderLineId,
      fixtureA.saleOrder.destinations[0].id,
      15,
    );
    const dispatchB = await packAndFinalize(
      app,
      factoryTokenB,
      fixtureB.saleOrder.id,
      fixtureB.saleOrderLineId,
      fixtureB.saleOrder.destinations[0].id,
      25,
    );

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;
    await ensureActiveDistributorPricing(distributorId);
    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({})
      .expect(200);

    await setDistributorAddress(distributorId, { state: 'Maharashtra', gstin: '27AAAAA0000A1Z5' });
    const accountantToken = await createAccountantToken();
    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.lines).toHaveLength(2);
    const quantities = res.body.data.lines
      .map((l: { quantity: number }) => l.quantity)
      .sort((a: number, b: number) => a - b);
    expect(quantities).toEqual([15, 25]);
    const saleOrderLineIds = res.body.data.lines.map(
      (l: { saleOrderLineId: string }) => l.saleOrderLineId,
    );
    expect(new Set(saleOrderLineIds).size).toBe(2);
    await activateGarmentGstRuleAndAssignHsn(fixtureA.stock.styleId);
    await activateGarmentGstRuleAndAssignHsn(fixtureB.stock.styleId);
    const issued = await request(app)
      .post(`/tax-invoices/${res.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    expect(
      new Set(
        issued.body.data.documentSnapshot.dispatchOrders.map((order: { id: string }) => order.id),
      ),
    ).toEqual(new Set([fixtureA.saleOrder.id, fixtureB.saleOrder.id]));
    expect(
      issued.body.data.documentSnapshot.dispatchOrders.every(
        (order: { cartonIds: string[] }) => order.cartonIds.length > 0,
      ),
    ).toBe(true);
  }, 30000);

  it('does not change already-drafted frozen MRP/pricing when the Style MRP or Distributor pricing changes afterwards', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId, fixture } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const frozenMrp = res.body.data.lines[0].styleMrp;
    const frozenPct = res.body.data.lines[0].distributorPricingPercentage;

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 999999 } });
    await prisma.priceList.updateMany({
      where: { distributorId: fixture.stock.distributorId, status: 'ACTIVE' },
      data: { percentageOfMrp: 1 },
    });

    const refetched = await request(app)
      .get(`/tax-invoices/${res.body.data.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(refetched.body.data.lines[0].styleMrp).toBe(frozenMrp);
    expect(refetched.body.data.lines[0].distributorPricingPercentage).toBe(frozenPct);
  });
});

describe('Tax Invoice — purchase mode', () => {
  it('snapshots OUTRIGHT purchase mode from the single Distributor', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20, 'OUTRIGHT');
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.purchaseMode).toBe('OUTRIGHT');
  });

  it('snapshots SALE_RETURN purchase mode from the single Distributor', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20, 'SALE_RETURN');
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.purchaseMode).toBe('SALE_RETURN');
  });
});

describe('Tax Invoice — lifecycle', () => {
  it('is created as DRAFT with no invoice number and does not advance any DocumentSequence', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const sequencesBefore = await prisma.documentSequence.findMany();
    const accountantToken = await createAccountantToken();

    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.invoiceNumber).toBeNull();
    const sequencesAfter = await prisma.documentSequence.findMany();
    expect(
      sequencesAfter.map((s) => ({ type: s.documentType, serial: s.lastAllocatedSerial })),
    ).toEqual(
      sequencesBefore.map((s) => ({ type: s.documentType, serial: s.lastAllocatedSerial })),
    );
  });

  it('repeated create requests resolve to the same single draft, never a duplicate', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    const first = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const second = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(200);

    expect(second.body.data.id).toBe(first.body.data.id);
    const rows = await prisma.taxInvoice.findMany({ where: { ervePackingListId } });
    expect(rows).toHaveLength(1);
  });
});

describe('Tax Invoice — concurrency', () => {
  it('two simultaneous create requests for the same EIPL never create two invoices', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const { userId } = await createRoleToken('ACCOUNTANT');

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    const currentUser = {
      id: actor.id,
      email: actor.email,
      mobile: actor.mobile,
      name: actor.name,
      status: actor.status,
      authVersion: actor.authVersion,
      roles: actor.userRoles.map((ur) => ur.role.name),
      distributorIds: [],
      factoryIds: [],
    };

    const [a, b] = await Promise.all([
      createOrGetTaxInvoiceDraft(currentUser, ervePackingListId),
      createOrGetTaxInvoiceDraft(currentUser, ervePackingListId),
    ]);

    expect(a.taxInvoice.id).toBe(b.taxInvoice.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const rows = await prisma.taxInvoice.findMany({ where: { ervePackingListId } });
    expect(rows).toHaveLength(1);
  });
});

describe('Tax Invoice — authorization', () => {
  it('allows ACCOUNTANT to create a draft', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
  });

  it('forbids ADMIN from creating a draft but allows ADMIN to read one', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();
    const created = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ervePackingListId })
      .expect(403);
    await request(app)
      .get(`/tax-invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('forbids every other role from creating or reading a Tax Invoice', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const { ervePackingListId } = await createFinalizedEipl(20);
    const accountantToken = await createAccountantToken();
    const created = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    for (const role of [
      'MERCHANDISER',
      'FACTORY_USER',
      'DISTRIBUTOR',
      'QA_USER',
      'SENIOR_MANAGEMENT',
    ] as const) {
      const { token } = await createRoleToken(role);
      await request(app)
        .post('/tax-invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ ervePackingListId })
        .expect(403);
      await request(app)
        .get(`/tax-invoices/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app).get('/tax-invoices').set('Authorization', `Bearer ${token}`).expect(403);
    }
  });
});

describe('Tax Invoice — ErveDispatch association', () => {
  it('resolves no ErveDispatch for a draft created before physical dispatch, then resolves it once dispatched', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      20,
    );
    const createdPackingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = createdPackingList.body.data.id as string;
    await ensureActiveDistributorPricing(createdPackingList.body.data.distributor.id as string);
    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({})
      .expect(200);

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    expect(draft.body.data.erveDispatch).toBeNull();

    const byEipl = await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(byEipl.body.data.id).toBe(draft.body.data.id);

    const erveDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId, dispatchDate: '2026-07-01' })
      .expect(201);

    const byDispatch = await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatch.body.data.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(byDispatch.body.data.id).toBe(draft.body.data.id);

    const refetched = await request(app)
      .get(`/tax-invoices/${draft.body.data.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(refetched.body.data.erveDispatch?.id).toBe(erveDispatch.body.data.id);
  });

  it('returns 404 for by-erve-dispatch when no draft has been created yet', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      20,
    );
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);
    const accountantToken = await createAccountantToken();

    await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatch.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// INV-006: calculation, GST resolution, Place of Supply, overrides and
// finalization. Shares createFinalizedEipl/createAccountantToken above.
// ---------------------------------------------------------------------------

/** HSN codes are a DB-checked exactly-8-digit string — createId() is alphanumeric and cannot be used here. */
function randomHsnCode(): string {
  return Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
}

/** Standard two-band garment GST rule (<=2500: 5%, >2500: 18%), ACTIVE since 2017, assigned to the given Style's HSN. */
async function activateGarmentGstRuleAndAssignHsn(styleId: string) {
  const gstRuleSetId = createId();
  const versionId = createId();
  const hsnId = createId();

  await prisma.gstRuleSet.create({
    data: { id: gstRuleSetId, code: `GST-${createId().slice(-8)}`, name: 'Test Garment Rule' },
  });
  await prisma.gstRuleSetVersion.create({
    data: {
      id: versionId,
      gstRuleSetId,
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2017-07-01T00:00:00.000Z'),
      effectiveTo: null,
    },
  });
  await prisma.gstValueBand.createMany({
    data: [
      {
        id: createId(),
        gstRuleSetVersionId: versionId,
        minValue: null,
        maxValue: 2500,
        gstPercent: 5,
      },
      {
        id: createId(),
        gstRuleSetVersionId: versionId,
        minValue: 2500,
        maxValue: null,
        gstPercent: 18,
      },
    ],
  });
  await prisma.hsn.create({ data: { id: hsnId, code: randomHsnCode(), gstRuleSetId } });
  await prisma.style.update({ where: { id: styleId }, data: { hsnId } });

  return { gstRuleSetId, versionId, hsnId };
}

async function setDistributorAddress(
  distributorId: string,
  overrides: { state?: string | null; gstin?: string },
) {
  await prisma.distributor.update({
    where: { id: distributorId },
    data: {
      addressLine1: '1 Test Road',
      city: 'Test City',
      country: 'India',
      postalCode: '600001',
      ...overrides,
    },
  });
}

/**
 * Idempotent per test: INV-005 requires exactly one ACTIVE Seller
 * Registration globally, so a test that calls createReadyDraftInvoice more
 * than once (e.g. two invoices in one FY) must reuse the same seller, not
 * create a second one.
 */
async function ensureTestSellerRegistration() {
  const existing = await prisma.sellerRegistration.findFirst({ where: { status: 'ACTIVE' } });
  if (existing) return existing;
  return createTestSellerRegistration({
    branchCode: `ERVE-HO-${createId().slice(-8)}`,
    gstin: '27AAAAA0000A1Z5',
  }); // state code 27 = Maharashtra
}

/** Full happy-path setup: finalized EIPL, Maharashtra seller + Maharashtra distributor (intrastate), active GST rule, DRAFT Tax Invoice. */
async function createReadyDraftInvoice(quantity = 20) {
  await ensureTestSellerRegistration();
  const { fixture, ervePackingListId } = await createFinalizedEipl(quantity);
  await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
  await setDistributorAddress(fixture.stock.distributorId, {
    state: 'Maharashtra',
    gstin: '27AAAAA0000A1Z5',
  });

  const accountantToken = await createAccountantToken();
  const draft = await request(app)
    .post('/tax-invoices')
    .set('Authorization', `Bearer ${accountantToken}`)
    .send({ ervePackingListId })
    .expect(201);

  return {
    fixture,
    ervePackingListId,
    accountantToken,
    taxInvoiceId: draft.body.data.id as string,
    lineId: draft.body.data.lines[0].id as string,
  };
}

describe('ISS-015 Draft invoice media scope', () => {
  it('exposes minimal Draft metadata and enforces roles, membership, primary state and cache authorization', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(2);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const { token: restrictedToken } = await createRoleToken('MERCHANDISER');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, 'primary.png')
      .expect(201);
    const imageId = uploaded.body.data.id as string;
    const path = `/tax-invoices/${taxInvoiceId}/styles/${fixture.stock.styleId}/images/${imageId}/content`;
    const review = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(review.body.data.lines[0].style.primaryImage).toEqual({
      id: imageId,
      mimeType: 'image/png',
      updatedAt: expect.any(String),
    });
    expect(review.body.data.lines[0].size.sortOrder).toEqual(expect.any(Number));
    for (const token of [accountantToken, adminToken]) {
      const read = await request(app).get(path).set('Authorization', `Bearer ${token}`).expect(200);
      expect(Buffer.from(read.body)).toEqual(png);
      await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('If-None-Match', read.headers.etag!)
        .expect(304);
      await request(app)
        .get(path)
        .set('Authorization', `Bearer ${restrictedToken}`)
        .set('If-None-Match', read.headers.etag!)
        .expect(403);
    }
    await request(app).get(path).expect(401);
    await request(app)
      .get(`/styles/${fixture.stock.styleId}/images/${imageId}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(403);
    await request(app)
      .get(`/tax-invoices/${createId()}/styles/${fixture.stock.styleId}/images/${imageId}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/styles/${createId()}/images/${imageId}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    const another = await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.concat([png, Buffer.from('second')]), 'second.png')
      .expect(201);
    await request(app)
      .get(path.replace(imageId, another.body.data.id))
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    await request(app)
      .patch(`/styles/${fixture.stock.styleId}/images/${another.body.data.id}/primary`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);
    await request(app)
      .get(path)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('If-None-Match', 'stale')
      .expect(404);
    const issued = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    expect(issued.body.data.documentSnapshot.lines[0].size.sortOrder).toEqual(expect.any(Number));
    expect(issued.body.data.lines[0].style.primaryImage ?? null).toBeNull();
    await request(app)
      .get(path.replace(imageId, another.body.data.id))
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
  });
  it('returns updated primary bytes on replacement and honest missing-file errors', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(1);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, 'primary.png')
      .expect(201);
    const path = `/tax-invoices/${taxInvoiceId}/styles/${fixture.stock.styleId}/images/${uploaded.body.data.id}/content`;
    const old = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const oldReview = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const replacement = Buffer.concat([png, Buffer.from('replacement')]);
    const updated = await request(app)
      .put(`/styles/${fixture.stock.styleId}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', replacement, 'replacement.png')
      .expect(200);
    const fresh = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('If-None-Match', old.headers.etag!)
      .expect(200);
    const refreshed = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(refreshed.body.data.lines[0].style.primaryImage.updatedAt).not.toBe(
      oldReview.body.data.lines[0].style.primaryImage.updatedAt,
    );
    expect(Buffer.from(fresh.body)).toEqual(replacement);
    const file = await prisma.file.findUniqueOrThrow({ where: { id: updated.body.data.fileId } });
    await getFileStorage().delete(file.storageKey);
    await request(app).get(path).set('Authorization', `Bearer ${accountantToken}`).expect(404);
  });
});

describe('Tax Invoice — finalization: normal rate, GST and precision', () => {
  it('computes and persists the exact calculated rate, taxable value and CGST/SGST split (intrastate)', async () => {
    const { taxInvoiceId, lineId } = await createReadyDraftInvoice(20);
    // Default test fixture Style MRP/distributor pricing; just assert the
    // finalize-time derived fields are internally consistent and exact —
    // the exact-arithmetic claims themselves are proven independently in
    // tax-invoice-calculation.test.ts against the spec's own fixture.
    const accountantToken = await createAccountantToken();
    const finalizeRes = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    expect(finalizeRes.body.data.status).toBe('FINALIZED');
    expect(finalizeRes.body.data.invoiceNumber).toMatch(/^EI\/\d{2}-\d{2}\/\d{4}$/);
    expect(finalizeRes.body.data.gstTreatment).toBe('INTRA');
    expect(finalizeRes.body.data.billTo.stateCode).toBe('27');

    const line = finalizeRes.body.data.lines.find(
      (candidate: { id: string }) => candidate.id === lineId,
    );
    const taxableValue = Number(line.taxableValue);
    const cgst = Number(line.cgstAmount);
    const sgst = Number(line.sgstAmount);
    expect(Number(line.igstAmount)).toBe(0);
    expect(cgst).toBeCloseTo(sgst, 10);
    expect(cgst + sgst).toBeCloseTo(taxableValue * (Number(line.gstPercent) / 100), 6);

    const grandTotal = Number(finalizeRes.body.data.grandTotal);
    const subtotal = Number(finalizeRes.body.data.subtotal);
    const totalGst = Number(finalizeRes.body.data.totalGst);
    expect(grandTotal).toBeCloseTo(subtotal + totalGst, 2);
    // grandTotal retains the existing two-decimal pre-payable-rounding value.
    expect(finalizeRes.body.data.grandTotal).toMatch(/^\d+\.\d{2}$/);
  });

  it('selects 5% below/at 2500 and 18% above 2500, based on the final (post-override) rate', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(1);

    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 2500, reason: 'Boundary test — exactly 2500' })
      .expect(200);

    const atBoundary = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(atBoundary.body.data.lines[0].gstPercent).toBe('5');
  });

  it('crosses the GST slab when an override pushes the rate above 2500', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(1);

    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 2600, reason: 'Override above the slab threshold' })
      .expect(200);

    const finalizeRes = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(finalizeRes.body.data.lines[0].gstPercent).toBe('18');
    expect(finalizeRes.body.data.lines[0].finalUnitRate).toBe('2600');
    expect(finalizeRes.body.data.lines[0].overrideUnitRate).toBe('2600');
  });
});

describe('Tax Invoice — Place of Supply', () => {
  it('classifies same Seller/Bill-To state as CGST+SGST, independent of a different Ship-To', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' }); // Maharashtra
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
    // Bill-To (Distributor) also Maharashtra; Ship-To (destination) was
    // fixed as Chennai/TN by the fixture helper — must not affect treatment.
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Maharashtra',
      gstin: '27AAAAA0000A1Z5',
    });

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    expect(draft.body.data.shipTo.state).not.toBe('Maharashtra');

    const finalizeRes = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(finalizeRes.body.data.gstTreatment).toBe('INTRA');
    expect(Number(finalizeRes.body.data.lines[0].igstAmount)).toBe(0);
    expect(Number(finalizeRes.body.data.lines[0].cgstAmount)).toBeGreaterThan(0);
  });

  it('classifies a different Seller/Bill-To state as IGST', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' }); // Maharashtra
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Karnataka',
      gstin: '29AAAAA0000A1Z5',
    });

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const finalizeRes = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(finalizeRes.body.data.gstTreatment).toBe('INTER');
    expect(finalizeRes.body.data.billTo.stateCode).toBe('29');
    expect(Number(finalizeRes.body.data.lines[0].cgstAmount)).toBe(0);
    expect(Number(finalizeRes.body.data.lines[0].sgstAmount)).toBe(0);
    expect(Number(finalizeRes.body.data.lines[0].igstAmount)).toBeGreaterThan(0);
  });

  it('fails closed when the Bill-To address state is not a recognized GST state/UT name', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Not A Real State',
      gstin: '27AAAAA0000A1Z5',
    });

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const res = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(400);
    expect(res.body.error.details.reason).toBe('BILL_TO_STATE_UNRESOLVED');
  });

  it('fails closed when the Bill-To address state does not match the Bill-To GSTIN state prefix', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
    // Address says Karnataka (29) but the GSTIN prefix says Maharashtra (27) — a genuine data inconsistency.
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Karnataka',
      gstin: '27AAAAA0000A1Z5',
    });

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const res = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(400);
    expect(res.body.error.details.reason).toBe('BILL_TO_STATE_GSTIN_MISMATCH');
  });
});

describe('Tax Invoice — GST/HSN configuration fail-closed', () => {
  it('fails closed when the line Style has no assigned HSN', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Maharashtra',
      gstin: '27AAAAA0000A1Z5',
    });
    // Deliberately no activateGarmentGstRuleAndAssignHsn call — Style.hsnId stays null.

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const res = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(400);
    expect(res.body.error.details.reason).toBe('HSN_NOT_ASSIGNED');
  });

  it('fails closed when the HSN has no ACTIVE GST rule version effective on the finalization date', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Maharashtra',
      gstin: '27AAAAA0000A1Z5',
    });
    // HSN exists but is assigned to NO GST Rule Set at all.
    const hsnId = createId();
    await prisma.hsn.create({ data: { id: hsnId, code: randomHsnCode() } });
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { hsnId } });

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const res = await request(app)
      .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(400);
    expect(res.body.error.details.reason).toBe('HSN_HAS_NO_GST_RULE_SET');
  });
});

// ISS-016: getTaxInvoiceReview must not let a numbering-readiness failure
// (production-only, see assertTaxInvoiceSequenceBaselined above) hide a
// financial calculation that actually succeeded. env.NODE_ENV is a plain
// parsed object (config/env.ts), so it's mutated directly for the duration
// of each test here and restored in `finally` — no process-level mocking.
describe('Tax Invoice — ISS-016: review preview independent of numbering readiness', () => {
  it('returns calculated GST/totals as a BLOCKED preview when only the production EI sequence is unbaselined', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);

    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .get(`/tax-invoices/${taxInvoiceId}/review`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(res.body.data.review.state).toBe('BLOCKED');
      expect(res.body.data.review.isPreview).toBe(true);
      expect(res.body.data.review.blockers).toHaveLength(1);
      expect(res.body.data.review.blockers[0].code).toBe('TAX_INVOICE_SEQUENCE_NOT_BASELINED');

      // The calculation itself succeeded — GST/totals must not be discarded.
      expect(res.body.data.lines[0].gstPercent).not.toBeNull();
      expect(res.body.data.lines[0].taxableValue).not.toBeNull();
      expect(res.body.data.hsnSummary).not.toBeNull();
      expect(res.body.data.hsnSummary.length).toBeGreaterThan(0);
      expect(res.body.data.subtotal).not.toBeNull();
      expect(res.body.data.grandTotal).not.toBeNull();
      expect(res.body.data.payableTotal).not.toBeNull();

      // Finalization itself remains blocked under the identical condition.
      await request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(409);

      // The review never allocated a serial or persisted a snapshot.
      const persisted = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: taxInvoiceId } });
      expect(persisted.status).toBe('DRAFT');
      expect(persisted.invoiceNumber).toBeNull();
      expect(await prisma.documentSequence.count({ where: { documentType: 'TAX_INVOICE' } })).toBe(
        0,
      );
    } finally {
      env.NODE_ENV = original;
    }
  });

  it('still reports BLOCKED with no preview when the financial calculation genuinely fails, even in production', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    const { fixture, ervePackingListId } = await createFinalizedEipl(5);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Maharashtra',
      gstin: '27AAAAA0000A1Z5',
    });
    // Deliberately no HSN assignment — Style.hsnId stays null.

    const accountantToken = await createAccountantToken();
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .get(`/tax-invoices/${draft.body.data.id}/review`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(res.body.data.review.state).toBe('BLOCKED');
      expect(res.body.data.review.blockers).toHaveLength(1);
      expect(res.body.data.review.blockers[0].code).toBe('HSN_NOT_ASSIGNED');
      expect(res.body.data.lines[0].gstPercent).toBeNull();
      expect(res.body.data.lines[0].taxableValue).toBeNull();
      expect(res.body.data.hsnSummary).toBeNull();
      expect(res.body.data.subtotal).toBeNull();
    } finally {
      env.NODE_ENV = original;
    }
  });

  it('returns READY with the full preview once numbering is also baselined', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);

    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const financialYear = await ensureFinancialYear(prisma, toBusinessCalendarDate(new Date()));
      await prisma.documentSequence.create({
        data: {
          id: createId(),
          documentType: 'TAX_INVOICE',
          financialYearId: financialYear.id,
          lastAllocatedSerial: 0,
        },
      });

      const res = await request(app)
        .get(`/tax-invoices/${taxInvoiceId}/review`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(res.body.data.review.state).toBe('READY');
      expect(res.body.data.review.blockers).toHaveLength(0);
      expect(res.body.data.lines[0].gstPercent).not.toBeNull();
    } finally {
      env.NODE_ENV = original;
    }
  });
});

describe('Tax Invoice — Accountant rate override', () => {
  it('allows an ACCOUNTANT to override a DRAFT line with a mandatory reason, recording actor/timestamp', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);

    const res = await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      // Normal 2dp currency entry — the column is Decimal(20,6) for the
      // SYSTEM's own calculated rate, but a human-entered override is
      // capped at 2dp (see tax-invoice.validation.ts).
      .send({ overrideUnitRate: 199.99, reason: 'Negotiated rate for this dispatch' })
      .expect(200);

    const line = res.body.data.lines.find((candidate: { id: string }) => candidate.id === lineId);
    expect(line.overrideUnitRate).toBe('199.99');
    expect(line.overrideReason).toBe('Negotiated rate for this dispatch');
    expect(line.overriddenBy).toBeTruthy();
    expect(line.overriddenAt).toBeTruthy();
    expect(line.calculatedUnitRate).toBeTruthy(); // original calculated rate preserved alongside the override
  });

  it('rejects an override with a blank reason', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 150, reason: '  ' })
      .expect(400);
  });

  it('rejects a non-positive override rate', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 0, reason: 'invalid' })
      .expect(400);
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: -5, reason: 'invalid' })
      .expect(400);
  });

  it('rejects an override rate with more than 2 decimal places rather than silently rounding it', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);
    // Three decimal places — beyond normal currency entry — must be
    // rejected outright, not silently rounded or truncated to 2dp.
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 150.123, reason: 'too precise' })
      .expect(400);
    // The old 6dp ceiling (matching the stored column's scale) is no longer
    // accepted as direct human input either — only the system's own
    // calculated rate uses that precision, never a typed override.
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 150.123456, reason: 'too precise' })
      .expect(400);
  });

  it('forbids a non-ACCOUNTANT role from overriding, including ADMIN', async () => {
    const { taxInvoiceId, lineId } = await createReadyDraftInvoice(10);
    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ overrideUnitRate: 150, reason: 'admin attempt' })
      .expect(403);

    const factoryToken = await createFactoryUserToken(
      (await createSingleFactoryApprovedSaleOrder(app, 1)).stock.factoryId,
    );
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ overrideUnitRate: 150, reason: 'factory attempt' })
      .expect(403);
  });

  it('rejects an override after the invoice has been finalized', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 150, reason: 'too late' })
      .expect(409);
  });
});

describe('Tax Invoice — production EI sequence auto-seed guard (INV-012 §8.1)', () => {
  // Pure-logic coverage: env.NODE_ENV is parsed once at process startup
  // (config/env.ts) and this whole suite runs under NODE_ENV=test, so a
  // genuine end-to-end "blocked under a real production process" test
  // would need a separate process invocation, which this suite does not
  // attempt — this exercises the exact exported guard function
  // finalizeTaxInvoice calls, with the same two inputs it passes.
  it('blocks a brand-new (un-baselined) sequence only in production', () => {
    expect(() => assertTaxInvoiceSequenceBaselined('production', false, '2026-27')).toThrow(
      /baselined/i,
    );
    try {
      assertTaxInvoiceSequenceBaselined('production', false, '2026-27');
      expect.unreachable();
    } catch (error) {
      expect((error as { details?: { reason?: string } }).details?.reason).toBe(
        'TAX_INVOICE_SEQUENCE_NOT_BASELINED',
      );
    }
  });

  it('allows production finalization once the sequence has been baselined', () => {
    expect(() => assertTaxInvoiceSequenceBaselined('production', true, '2026-27')).not.toThrow();
  });

  it('never blocks non-production environments, baselined or not', () => {
    expect(() => assertTaxInvoiceSequenceBaselined('test', false, '2026-27')).not.toThrow();
    expect(() => assertTaxInvoiceSequenceBaselined('development', false, '2026-27')).not.toThrow();
  });
});

describe('Tax Invoice — Accountant workflow reads (INV-007)', () => {
  it('records a missing source image honestly without attaching another Style image', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(1);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, { filename: 'missing.png', contentType: 'image/png' })
      .expect(201);
    const file = await prisma.file.findUniqueOrThrow({ where: { id: uploaded.body.data.fileId } });
    await getFileStorage().delete(file.storageKey);
    const issued = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    expect(issued.body.data.documentSnapshot.lines[0]).toMatchObject({
      style: { id: fixture.stock.styleId },
      image: null,
      imageAvailability: 'SOURCE_UNAVAILABLE',
    });
  });
  it('rolls back finalization after presentation changes during archival and safely retries', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(1);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, { filename: 'garment.png', contentType: 'image/png' })
      .expect(201);
    const storage = getFileStorage();
    const originalPut = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementationOnce(async (key, data) => {
      await originalPut(key, data);
      await prisma.style.update({
        where: { id: fixture.stock.styleId },
        data: { colour: 'Changed during archive' },
      });
    });
    const failed = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(409);
    expect(failed.body.error.details.reason).toBe('INVOICE_DOCUMENT_CHANGED_RETRY');
    expect(
      await prisma.taxInvoice.findUniqueOrThrow({ where: { id: taxInvoiceId } }),
    ).toMatchObject({ status: 'DRAFT', invoiceNumber: null, documentSnapshot: null });
    expect(await prisma.documentSequence.count({ where: { documentType: 'TAX_INVOICE' } })).toBe(0);
    const retry = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    expect(retry.body.data.documentSnapshot.lines[0].style.colour).toBe('Changed during archive');
    expect(
      await prisma.file.count({
        where: { storageKey: { startsWith: `invoice-images/${taxInvoiceId}/` } },
      }),
    ).toBe(1);
  });
  it('archives original bytes, restricts invoice image membership, and recovers a failed upload safely', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(2);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, { filename: 'garment.png', contentType: 'image/png' })
      .expect(201);
    const storage = getFileStorage();
    const originalPut = storage.put.bind(storage);
    const put = vi.spyOn(storage, 'put').mockImplementationOnce(async (key, data) => {
      await originalPut(key, data.subarray(0, 12));
      throw new Error('Simulated partial write');
    });
    const failed = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(409);
    expect(failed.body.error.details.reason).toBe('INVOICE_IMAGE_ARCHIVE_FAILED');
    expect(await prisma.taxInvoice.findUnique({ where: { id: taxInvoiceId } })).toMatchObject({
      status: 'DRAFT',
      invoiceNumber: null,
      documentSnapshot: null,
    });
    put.mockRestore();
    expect((await reconcileInvoiceImageArchives(taxInvoiceId, false)).removableIds).toEqual([]);
    const finalize = () =>
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({});
    const [a, b] = await Promise.all([finalize(), finalize()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.documentSnapshot).toEqual(b.body.data.documentSnapshot);
    const image = a.body.data.documentSnapshot.lines[0].image;
    expect(image.id).not.toBe(uploaded.body.data.fileId);
    expect(
      await prisma.file.count({
        where: { storageKey: { startsWith: `invoice-images/${taxInvoiceId}/` } },
      }),
    ).toBe(1);
    const path = `/tax-invoices/${taxInvoiceId}/images/${image.id}/content`;
    for (const token of [adminToken, accountantToken]) {
      const read = await request(app).get(path).set('Authorization', `Bearer ${token}`).expect(200);
      expect(Buffer.from(read.body)).toEqual(png);
      expect(read.headers['cache-control']).toContain('private');
    }
    await request(app).get(path).expect(401);
    for (const role of [
      'MERCHANDISER',
      'SENIOR_MANAGEMENT',
      'QA_USER',
      'FACTORY_USER',
      'DISTRIBUTOR',
    ] as const) {
      const { token } = await createRoleToken(role);
      await request(app).get(path).set('Authorization', `Bearer ${token}`).expect(403);
    }
    await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/images/${uploaded.body.data.fileId}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    await request(app)
      .get(`/tax-invoices/${createId()}/images/${image.id}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    const replacement = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(32, 0x22),
    ]);
    await request(app)
      .put(`/styles/${fixture.stock.styleId}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', replacement, { filename: 'changed.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await request(app)
      .delete(`/styles/${fixture.stock.styleId}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const unchanged = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(Buffer.from(unchanged.body)).toEqual(png);
    const other = await createReadyDraftInvoice(1);
    await request(app)
      .post(`/tax-invoices/${other.taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${other.accountantToken}`)
      .send({})
      .expect(200);
    await request(app)
      .get(`/tax-invoices/${other.taxInvoiceId}/images/${image.id}/content`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
    const orphanId = createId();
    const orphanKey = `invoice-images/${taxInvoiceId}/${orphanId}.png`;
    await storage.put(orphanKey, png);
    await prisma.file.create({
      data: {
        id: orphanId,
        fileName: 'orphan.png',
        storageKey: orphanKey,
        mimeType: 'image/png',
        sizeBytes: png.length,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    });
    expect((await reconcileInvoiceImageArchives(taxInvoiceId)).removableIds).toEqual([orphanId]);
    expect(await storage.exists(orphanKey)).toBe(true);
    await reconcileInvoiceImageArchives(taxInvoiceId, false);
    expect(await storage.exists(orphanKey)).toBe(false);
    await request(app).get(path).set('Authorization', `Bearer ${accountantToken}`).expect(200);
  }, 45000);
  it('freezes versioned issued Style/colour/size and genuine source-order references', async () => {
    const { taxInvoiceId, fixture, accountantToken, ervePackingListId } =
      await createReadyDraftInvoice(3);
    const dispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({
        ervePackingListId,
        dispatchDate: '2026-07-01',
        lrNumber: 'LR/TEST/003',
        transporter: 'Verified Carrier',
      })
      .expect(201);
    await prisma.style.update({
      where: { id: fixture.stock.styleId },
      data: { colour: 'Navy', description: 'Issued garment' },
    });
    const issued = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    const snapshot = issued.body.data.documentSnapshot;
    expect(snapshot.transport).toMatchObject({
      erveDispatchId: dispatch.body.data.id,
      lrNumber: 'LR/TEST/003',
      transporter: 'Verified Carrier',
    });
    expect(snapshot).toMatchObject({
      schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
      dispatchOrders: [{ id: fixture.saleOrder.id, number: fixture.saleOrder.saleOrderNumber }],
    });
    expect(snapshot.lines[0]).toMatchObject({
      quantity: 3,
      style: { id: fixture.stock.styleId, colour: 'Navy', description: 'Issued garment' },
      image: null,
    });
    const original = issued.body.data.lines[0].style;
    const originalSize = issued.body.data.lines[0].size;
    await prisma.style.update({
      where: { id: fixture.stock.styleId },
      data: { styleNumber: `EDIT-${createId()}`, styleName: 'Edited Style', colour: 'Red' },
    });
    await prisma.size.update({
      where: { id: fixture.stock.sizeId },
      data: { label: 'Edited size label' },
    });
    await prisma.erveDispatch.update({
      where: { id: dispatch.body.data.id },
      data: { lrNumber: 'LR/EDITED' },
    });
    const again = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(200);
    expect(again.body.data.documentSnapshot).toEqual(snapshot);
    expect(again.body.data.lines[0].style).toEqual(original);
    expect(again.body.data.lines[0].size).toEqual(originalSize);
  });
  it('reviews a draft using authoritative calculations without financial or numbering writes', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(1);
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 10.95, reason: 'Review fixture' })
      .expect(200);
    const before = await prisma.taxInvoice.findUniqueOrThrow({
      where: { id: taxInvoiceId },
      include: { lines: true },
    });
    const auditCount = await prisma.auditLog.count();
    const sequences = await prisma.documentSequence.findMany();
    const reviewed = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(reviewed.body.data).toMatchObject({
      status: 'DRAFT',
      invoiceNumber: null,
      grandTotal: '11.50',
      payableTotal: '11.00',
      roundOffAdjustment: '-0.50',
      review: { state: 'READY', isPreview: true, blockers: [] },
    });
    expect(reviewed.body.data.lines[0]).toMatchObject({
      quantity: 1,
      finalUnitRate: '10.95',
      cgstAmount: '0.27375',
      sgstAmount: '0.27375',
    });
    expect(
      await prisma.taxInvoice.findUniqueOrThrow({
        where: { id: taxInvoiceId },
        include: { lines: true },
      }),
    ).toEqual(before);
    expect(await prisma.auditLog.count()).toBe(auditCount);
    expect(await prisma.documentSequence.findMany()).toEqual(sequences);
    const finalized = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(finalized.body.data.grandTotal).toBe(reviewed.body.data.grandTotal);
    expect(finalized.body.data.payableTotal).toBe(reviewed.body.data.payableTotal);
    expect(finalized.body.data.hsnSummary).toEqual(reviewed.body.data.hsnSummary);
  });

  it('returns actionable blocked review without fabricating tax or payable totals', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(1);
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { hsnId: null } });
    const reviewed = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(reviewed.body.data.review).toMatchObject({ state: 'BLOCKED', isPreview: true });
    expect(reviewed.body.data.review.blockers[0].code).toBe('HSN_NOT_ASSIGNED');
    expect(reviewed.body.data.grandTotal).toBeNull();
    expect(reviewed.body.data.payableTotal).toBeNull();
  });

  it('serves persisted finalized review even if current HSN/GST prerequisites change', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(1);
    const finalized = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { hsnId: null } });
    const reviewed = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(reviewed.body.data.review).toMatchObject({
      state: 'FINALIZED',
      isPreview: false,
      blockers: [],
    });
    expect(reviewed.body.data.payableTotal).toBe(finalized.body.data.payableTotal);
    expect(reviewed.body.data.hsnSummary).toEqual(finalized.body.data.hsnSummary);
  });

  it('exposes only the requested invoice and line audit events to authorized readers', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(1);
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 10.95, reason: 'Accountant review correction' })
      .expect(200);
    await prisma.auditLog.create({
      data: {
        id: createId(),
        action: 'TAX_INVOICE_FINALIZED',
        entityType: 'TaxInvoice',
        entityId: 'unrelated-invoice',
        metadata: { invoiceNumber: 'DO-NOT-EXPOSE' },
      },
    });
    const history = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/audit`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(history.body.data.map((event: { action: string }) => event.action)).toEqual([
      'TAX_INVOICE_DRAFT_CREATED',
      'TAX_INVOICE_LINE_RATE_OVERRIDDEN',
    ]);
    expect(history.body.data[1].metadata.reason).toBe('Accountant review correction');
    expect(history.body.data[1].actor).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
    });
    expect(JSON.stringify(history.body.data)).not.toContain('DO-NOT-EXPOSE');
    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .get(`/tax-invoices/${taxInvoiceId}/audit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    for (const suffix of ['audit', 'review'])
      await request(app)
        .get(`/tax-invoices/${taxInvoiceId}/${suffix}`)
        .set('Authorization', `Bearer ${merchToken}`)
        .expect(403);
  });

  it('applies invoice identifier search before cursor pagination', async () => {
    const a = await createReadyDraftInvoice(1);
    const finalized = await request(app)
      .post(`/tax-invoices/${a.taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${a.accountantToken}`)
      .expect(200);
    await createReadyDraftInvoice(1);
    const found = await request(app)
      .get('/tax-invoices')
      .query({ search: finalized.body.data.invoiceNumber, limit: 1 })
      .set('Authorization', `Bearer ${a.accountantToken}`)
      .expect(200);
    expect(found.body.data.items.map((row: { id: string }) => row.id)).toEqual([a.taxInvoiceId]);
    const missing = await request(app)
      .get('/tax-invoices')
      .query({ search: 'NO-MATCH-INVOICE', limit: 1 })
      .set('Authorization', `Bearer ${a.accountantToken}`)
      .expect(200);
    expect(missing.body.data.items).toEqual([]);
    expect(missing.body.data.pageInfo.hasMore).toBe(false);
  }, 30000); // Two complete operational fixtures, rather than one invoice.

  it('displays the finalized frozen HSN code after an HSN master edit', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(1);
    const finalized = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const frozen = finalized.body.data.lines[0].hsn.code;
    const line = await prisma.taxInvoiceLine.findFirstOrThrow({ where: { taxInvoiceId } });
    await prisma.hsn.update({ where: { id: line.hsnId! }, data: { code: randomHsnCode() } });
    const read = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(read.body.data.lines[0].hsn.code).toBe(frozen);
    expect(read.body.data.hsnSummary[0].hsnCode).toBe(frozen);
  });

  it('offers limited finalized EIPL source context only to Accountants and removes drafted sources', async () => {
    await ensureTestSellerRegistration();
    const { ervePackingListId } = await createFinalizedEipl(1);
    const accountantToken = await createAccountantToken();
    const available = await request(app)
      .get('/tax-invoices/sources')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(available.body.data.items).toContainEqual(
      expect.objectContaining({
        id: ervePackingListId,
        status: 'FINALIZED',
        commercialSnapshotAvailable: true,
      }),
    );
    expect(JSON.stringify(available.body.data)).not.toMatch(
      /factoryId|factoryDispatch|bankAccountNumber/,
    );
    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .get('/tax-invoices/sources')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    expect(draft.body.data.invoiceNumber).toBeNull();
    const after = await request(app)
      .get('/tax-invoices/sources')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(after.body.data.items.some((row: { id: string }) => row.id === ervePackingListId)).toBe(
      false,
    );
  });
});

describe('Tax Invoice — final payable round-off snapshots', () => {
  it.each([
    [10.01, '10.51', '11.00', '0.49'],
    [10.95, '11.50', '11.00', '-0.50'],
    [20, '21.00', '21.00', '0.00'],
    [10, '10.50', '11.00', '0.50'],
  ])(
    'freezes payable rounding for rate %s from exact taxable value plus GST',
    async (rate, grand, payable, adjustment) => {
      const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(1);
      const draft = await request(app)
        .get(`/tax-invoices/${taxInvoiceId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
      expect(draft.body.data.payableTotal).toBeNull();
      expect(draft.body.data.roundOffAdjustment).toBeNull();
      expect(draft.body.data.roundingPolicy).toBeNull();

      await request(app)
        .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ overrideUnitRate: rate, reason: 'Payable round-off fixture' })
        .expect(200);
      const finalized = await request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
      expect(finalized.body.data).toMatchObject({
        grandTotal: grand,
        payableTotal: payable,
        roundOffAdjustment: adjustment,
        roundingPolicy: 'NEAREST_RUPEE_HALF_UP_V1',
      });
      if (rate === 10.95) {
        expect(finalized.body.data.lines[0]).toMatchObject({
          taxableValue: '10.95',
          cgstAmount: '0.27375',
          sgstAmount: '0.27375',
          igstAmount: '0',
        });
        expect(finalized.body.data.hsnSummary[0]).toMatchObject({
          taxableValue: '10.95',
          cgstAmount: '0.27375',
          sgstAmount: '0.27375',
        });
      }

      const stored = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: taxInvoiceId } });
      expect(stored.payableTotal?.toFixed(2)).toBe(payable);
      expect(stored.roundOffAdjustment?.toFixed(2)).toBe(adjustment);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: taxInvoiceId, action: 'TAX_INVOICE_FINALIZED' },
      });
      expect(audit.metadata).toMatchObject({
        payableTotal: payable,
        roundOffAdjustment: adjustment,
        roundingPolicy: 'NEAREST_RUPEE_HALF_UP_V1',
      });
      const read = await request(app)
        .get(`/tax-invoices/${taxInvoiceId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
      expect(read.body.data).toEqual(finalized.body.data);
    },
  );

  it('preserves legacy finalized invoices with unavailable rounding snapshots across reads and concurrent retries', async () => {
    const { taxInvoiceId, ervePackingListId, accountantToken } = await createReadyDraftInvoice(1);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    // Simulate a pre-PR0 finalized document: additive nullable columns are
    // unavailable, and its original finalization audit has no payable fields.
    await prisma.taxInvoice.update({
      where: { id: taxInvoiceId },
      data: {
        payableTotal: null,
        roundOffAdjustment: null,
        roundingPolicy: null,
        documentSnapshot: Prisma.DbNull,
      },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: taxInvoiceId, action: 'TAX_INVOICE_FINALIZED' },
    });
    const originalMetadata = Object.fromEntries(
      Object.entries(audit.metadata as Record<string, string | number>).filter(
        ([key]) => !['payableTotal', 'roundOffAdjustment', 'roundingPolicy'].includes(key),
      ),
    );
    await prisma.auditLog.update({ where: { id: audit.id }, data: { metadata: originalMetadata } });
    const before = await prisma.taxInvoice.findUniqueOrThrow({
      where: { id: taxInvoiceId },
      include: { lines: true },
    });
    const sequencesBefore = await prisma.documentSequence.findMany();
    const auditsBefore = await prisma.auditLog.findMany({ where: { entityId: taxInvoiceId } });

    const reads = await Promise.all([
      request(app)
        .get(`/tax-invoices/${taxInvoiceId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200),
      request(app)
        .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200),
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200),
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200),
    ]);
    for (const response of reads) {
      expect(response.body.data).toMatchObject({
        payableTotal: null,
        roundOffAdjustment: null,
        roundingPolicy: null,
      });
      expect(response.body.data.grandTotal).toBe(before.grandTotal?.toFixed(2));
      expect(response.body.data.invoiceNumber).toBe(before.invoiceNumber);
    }
    const list = await request(app)
      .get('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(
      list.body.data.items.find((item: { id: string }) => item.id === taxInvoiceId),
    ).toMatchObject({ payableTotal: null, roundOffAdjustment: null, roundingPolicy: null });
    expect(
      await prisma.taxInvoice.findUniqueOrThrow({
        where: { id: taxInvoiceId },
        include: { lines: true },
      }),
    ).toEqual(before);
    expect(await prisma.documentSequence.findMany()).toEqual(sequencesBefore);
    expect(await prisma.auditLog.findMany({ where: { entityId: taxInvoiceId } })).toEqual(
      auditsBefore,
    );
  });
});

describe('Tax Invoice — finalization lifecycle, idempotency and concurrency', () => {
  it('forbids a non-ACCOUNTANT role from finalizing, including ADMIN', async () => {
    const { taxInvoiceId } = await createReadyDraftInvoice(10);
    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('repeated finalize requests return the same EI number and totals, with exactly one audit event', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);

    const first = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const second = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    expect(second.body.data.invoiceNumber).toBe(first.body.data.invoiceNumber);
    expect(second.body.data.grandTotal).toBe(first.body.data.grandTotal);
    expect(first.body.data.roundingPolicy).toBe('NEAREST_RUPEE_HALF_UP_V1');
    expect(second.body.data.payableTotal).toBe(first.body.data.payableTotal);
    expect(second.body.data.roundOffAdjustment).toBe(first.body.data.roundOffAdjustment);
    expect(second.body.data.roundingPolicy).toBe(first.body.data.roundingPolicy);
    expect(second.body.data.finalizedAt).toBe(first.body.data.finalizedAt);

    const auditCount = await prisma.auditLog.count({
      where: { entityType: 'TaxInvoice', entityId: taxInvoiceId, action: 'TAX_INVOICE_FINALIZED' },
    });
    expect(auditCount).toBe(1);
  });

  it('two concurrent finalize requests for the same invoice produce exactly one EI number', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`),
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.invoiceNumber).toBe(b.body.data.invoiceNumber);
    expect(a.body.data.roundingPolicy).toBe('NEAREST_RUPEE_HALF_UP_V1');
    expect(a.body.data.payableTotal).toBe(b.body.data.payableTotal);
    expect(a.body.data.roundOffAdjustment).toBe(b.body.data.roundOffAdjustment);
    expect(a.body.data.roundingPolicy).toBe(b.body.data.roundingPolicy);

    const auditCount = await prisma.auditLog.count({
      where: { entityType: 'TaxInvoice', entityId: taxInvoiceId, action: 'TAX_INVOICE_FINALIZED' },
    });
    expect(auditCount).toBe(1);
  });

  it('two different invoices finalized concurrently in the same financial year get distinct, non-colliding serials', async () => {
    const draftA = await createReadyDraftInvoice(5);
    const draftB = await createReadyDraftInvoice(5);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/tax-invoices/${draftA.taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${draftA.accountantToken}`),
      request(app)
        .post(`/tax-invoices/${draftB.taxInvoiceId}/actions/finalize`)
        .set('Authorization', `Bearer ${draftB.accountantToken}`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.invoiceNumber).not.toBe(b.body.data.invoiceNumber);
  });

  it('a finalized invoice is unaffected by later changes to Style MRP, Distributor pricing or GST rules', async () => {
    const { taxInvoiceId, lineId, fixture, accountantToken } = await createReadyDraftInvoice(10);
    const before = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 999999 } });
    await prisma.distributor.update({
      where: { id: fixture.stock.distributorId },
      data: { state: 'Karnataka' },
    });

    const after = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const beforeLine = before.body.data.lines.find(
      (candidate: { id: string }) => candidate.id === lineId,
    );
    const afterLine = after.body.data.lines.find(
      (candidate: { id: string }) => candidate.id === lineId,
    );
    expect(afterLine.taxableValue).toBe(beforeLine.taxableValue);
    expect(afterLine.cgstAmount).toBe(beforeLine.cgstAmount);
    expect(after.body.data.grandTotal).toBe(before.body.data.grandTotal);
    expect(after.body.data.billTo.stateCode).toBe(before.body.data.billTo.stateCode);
  });

  it('rejects finalizing an already-DRAFT invoice with no lines defensively (unreachable via the live API, exercised directly)', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);
    await prisma.taxInvoiceLine.deleteMany({ where: { taxInvoiceId } });

    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(409);
  });
});

describe('INV-009A Tax Invoice Cancellation and Replacement', () => {
  it('allows only ACCOUNTANT to cancel a finalized invoice; rejects ADMIN, MERCHANDISER, and FACTORY_USER with 403', async () => {
    const { taxInvoiceId, accountantToken, fixture } = await createReadyDraftInvoice(10);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const { token: adminToken } = await createRoleToken('ADMIN');
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    // ADMIN cannot cancel
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Admin attempt' })
      .expect(403);

    // MERCHANDISER cannot cancel
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ reason: 'Merchandiser attempt' })
      .expect(403);

    // FACTORY_USER cannot cancel
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ reason: 'Factory user attempt' })
      .expect(403);

    // ACCOUNTANT succeeds
    const cancelRes = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Commercial pricing error corrected by buyer agreement' })
      .expect(200);

    expect(cancelRes.body.data.status).toBe('CANCELLED');
    expect(cancelRes.body.data.cancellationReason).toBe(
      'Commercial pricing error corrected by buyer agreement',
    );
    expect(cancelRes.body.data.cancelledAt).not.toBeNull();
  }, 30000);

  it('rejects cancellation without a reason, or with empty/whitespace-only reason with 400', async () => {
    const { taxInvoiceId, accountantToken } = await createReadyDraftInvoice(10);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    // Missing reason in body
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({})
      .expect(400);

    // Empty reason
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: '' })
      .expect(400);

    // Whitespace reason
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: '   ' })
      .expect(400);

    // Overly long reason (> 1000 characters)
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'a'.repeat(1001) })
      .expect(400);
  });

  it('guards invoice lifecycle: rejects cancelling DRAFT (409), idempotent cancellation, rejects finalizing or overriding CANCELLED (409)', async () => {
    const { taxInvoiceId, lineId, accountantToken } = await createReadyDraftInvoice(10);

    // Cannot cancel DRAFT
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Attempt to cancel draft' })
      .expect(409);

    // Finalize
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    // Cancel
    const firstCancel = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'First cancellation' })
      .expect(200);

    // Idempotent cancel with identical reason -> 200
    const secondCancel = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'First cancellation' })
      .expect(200);

    expect(secondCancel.body.data.cancelledAt).toBe(firstCancel.body.data.cancelledAt);
    expect(secondCancel.body.data.cancellationReason).toBe(
      firstCancel.body.data.cancellationReason,
    );

    // Cancel retry with conflicting reason -> 409
    const conflictingCancel = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Conflicting cancellation reason' })
      .expect(409);
    expect(conflictingCancel.body.error.details.reason).toBe('CANCELLATION_REASON_CONFLICT');

    const cancelAuditCount = await prisma.auditLog.count({
      where: { entityType: 'TaxInvoice', entityId: taxInvoiceId, action: 'TAX_INVOICE_CANCELLED' },
    });
    expect(cancelAuditCount).toBe(1);

    // Cannot finalize a cancelled invoice
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(409);

    // Cannot override lines on a cancelled invoice
    await request(app)
      .patch(`/tax-invoices/${taxInvoiceId}/lines/${lineId}/override`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ overrideUnitRate: 99, reason: 'Post-cancel override attempt' })
      .expect(409);
  });

  it('supports full replacement workflow: EIPL reappears in sources, replacement draft reuses commercial lines, gets new non-colliding EI number, preserves cancelled invoice', async () => {
    const {
      taxInvoiceId: originalId,
      ervePackingListId,
      accountantToken,
    } = await createReadyDraftInvoice(10);

    // Finalize original
    const originalFinalized = await request(app)
      .post(`/tax-invoices/${originalId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const originalInvoiceNumber = originalFinalized.body.data.invoiceNumber;
    expect(originalInvoiceNumber).toMatch(/^EI\/\d{2}-\d{2}\/\d{4}$/);

    // While finalized, EIPL does not appear in draft sources
    const sourcesBefore = await request(app)
      .get('/tax-invoices/sources')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(
      sourcesBefore.body.data.items.some((s: { id: string }) => s.id === ervePackingListId),
    ).toBe(false);

    // Cancel original
    await request(app)
      .post(`/tax-invoices/${originalId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Wrong GST treatment' })
      .expect(200);

    // EIPL reappears in sources
    const sourcesAfter = await request(app)
      .get('/tax-invoices/sources')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(
      sourcesAfter.body.data.items.some((s: { id: string }) => s.id === ervePackingListId),
    ).toBe(true);

    // Create replacement draft
    const replacementDraft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId, replacesInvoiceId: originalId })
      .expect(201);

    const replacementId = replacementDraft.body.data.id;
    expect(replacementId).not.toBe(originalId);
    expect(replacementDraft.body.data.status).toBe('DRAFT');
    expect(replacementDraft.body.data.replacesInvoiceId).toBe(originalId);
    expect(replacementDraft.body.data.replacesInvoiceNumber).toBe(originalInvoiceNumber);
    expect(replacementDraft.body.data.lines).toHaveLength(1);

    // Finalize replacement
    const replacementFinalized = await request(app)
      .post(`/tax-invoices/${replacementId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const replacementInvoiceNumber = replacementFinalized.body.data.invoiceNumber;
    expect(replacementInvoiceNumber).toMatch(/^EI\/\d{2}-\d{2}\/\d{4}$/);
    expect(replacementInvoiceNumber).not.toBe(originalInvoiceNumber);

    // Verify original invoice is completely preserved
    const fetchedOriginal = await request(app)
      .get(`/tax-invoices/${originalId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    expect(fetchedOriginal.body.data.status).toBe('CANCELLED');
    expect(fetchedOriginal.body.data.invoiceNumber).toBe(originalInvoiceNumber);
    expect(fetchedOriginal.body.data.cancellationReason).toBe('Wrong GST treatment');
    expect(fetchedOriginal.body.data.replacedByInvoiceId).toBe(replacementId);
    expect(fetchedOriginal.body.data.replacedByInvoiceNumber).toBe(replacementInvoiceNumber);
    expect(fetchedOriginal.body.data.grandTotal).toBe(originalFinalized.body.data.grandTotal);
    expect(fetchedOriginal.body.data.payableTotal).toBe(originalFinalized.body.data.payableTotal);
    expect(fetchedOriginal.body.data.documentSnapshot).not.toBeNull();
    expect(fetchedOriginal.body.data.hsnSummary).not.toBeNull();

    // Verify review endpoint returns state: CANCELLED
    const originalReview = await request(app)
      .get(`/tax-invoices/${originalId}/review`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(originalReview.body.data.review.state).toBe('CANCELLED');

    // Verify by-erve-packing-list lookup returns the active replacement invoice
    const lookupByEipl = await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupByEipl.body.data.id).toBe(replacementId);
    expect(lookupByEipl.body.data.status).toBe('FINALIZED');

    // Verify list filtering by status=CANCELLED returns the original invoice
    const listCancelled = await request(app)
      .get('/tax-invoices?status=CANCELLED')
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(listCancelled.body.data.items.some((i: { id: string }) => i.id === originalId)).toBe(
      true,
    );
  }, 30000);

  it('supports repeated cancellation and replacement cycles on the same EIPL while enforcing active invoice uniqueness', async () => {
    const {
      taxInvoiceId: inv1Id,
      ervePackingListId,
      accountantToken,
    } = await createReadyDraftInvoice(10);

    // Finalize Inv 1 -> Cancel Inv 1
    const f1 = await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Cancellation round 1' })
      .expect(200);

    // Draft Inv 2 -> Finalize Inv 2 -> Cancel Inv 2
    const d2 = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const inv2Id = d2.body.data.id;
    const f2 = await request(app)
      .post(`/tax-invoices/${inv2Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    await request(app)
      .post(`/tax-invoices/${inv2Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Cancellation round 2' })
      .expect(200);

    // Draft Inv 3 -> Finalize Inv 3
    const d3 = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const inv3Id = d3.body.data.id;
    const f3 = await request(app)
      .post(`/tax-invoices/${inv3Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    // Three distinct EI numbers generated
    const numbers = [
      f1.body.data.invoiceNumber,
      f2.body.data.invoiceNumber,
      f3.body.data.invoiceNumber,
    ];
    expect(new Set(numbers).size).toBe(3);

    // DB check: 2 CANCELLED, 1 FINALIZED
    const allInvoices = await prisma.taxInvoice.findMany({
      where: { ervePackingListId },
      select: { id: true, status: true, invoiceNumber: true },
    });
    expect(allInvoices).toHaveLength(3);
    expect(allInvoices.filter((i) => i.status === 'CANCELLED')).toHaveLength(2);
    expect(allInvoices.filter((i) => i.status === 'FINALIZED')).toHaveLength(1);

    // While Inv 3 is active, calling create returns the existing active invoice (idempotent, never a duplicate)
    const activeRes = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(200);
    expect(activeRes.body.data.id).toBe(inv3Id);

    // Direct database insert of a second active invoice violates the PostgreSQL partial unique index
    const finalizedRecord = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: inv3Id } });
    await expect(
      prisma.taxInvoice.create({
        data: {
          id: createId(),
          status: 'DRAFT',
          ervePackingListId,
          distributorId: finalizedRecord.distributorId,
          sellerRegistrationId: finalizedRecord.sellerRegistrationId,
          purchaseMode: finalizedRecord.purchaseMode,
          sellerLegalName: finalizedRecord.sellerLegalName,
          sellerGstin: finalizedRecord.sellerGstin,
          sellerEinvoiceApplicable: false,
          sellerAddressLine1: finalizedRecord.sellerAddressLine1,
          sellerCity: finalizedRecord.sellerCity,
          sellerState: finalizedRecord.sellerState,
          sellerStateCode: finalizedRecord.sellerStateCode,
          sellerPostalCode: finalizedRecord.sellerPostalCode,
          sellerCountry: finalizedRecord.sellerCountry,
          sellerBankName: finalizedRecord.sellerBankName,
          sellerBankAccountName: finalizedRecord.sellerBankAccountName,
          sellerBankAccountNumber: finalizedRecord.sellerBankAccountNumber,
          sellerBankIfsc: finalizedRecord.sellerBankIfsc,
          sellerBankBranchName: finalizedRecord.sellerBankBranchName,
          billToName: finalizedRecord.billToName,
          billToAddressLine1: finalizedRecord.billToAddressLine1,
          billToCity: finalizedRecord.billToCity,
          billToState: finalizedRecord.billToState,
          billToStateCode: finalizedRecord.billToStateCode,
          billToPostalCode: finalizedRecord.billToPostalCode,
          billToCountry: finalizedRecord.billToCountry,
          billToGstin: finalizedRecord.billToGstin,
          gstTreatment: finalizedRecord.gstTreatment,
          createdById: finalizedRecord.createdById,
        },
      }),
    ).rejects.toThrow();
  }, 45000);

  it('ensures invoice cancellation causes no mutations to EIPL, Erve Dispatch, cartons, or stock', async () => {
    const {
      taxInvoiceId,
      ervePackingListId,
      accountantToken,
      fixture,
    } = await createReadyDraftInvoice(10);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const eiplBefore = await prisma.ervePackingList.findUniqueOrThrow({
      where: { id: ervePackingListId },
      include: { cartons: true, commercialLines: true },
    });
    const allocationsBefore = await prisma.stockAllocation.findMany({
      where: { saleOrderLineId: fixture.saleOrderLineId },
    });

    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Auditing side effects' })
      .expect(200);

    const eiplAfter = await prisma.ervePackingList.findUniqueOrThrow({
      where: { id: ervePackingListId },
      include: { cartons: true, commercialLines: true },
    });
    const allocationsAfter = await prisma.stockAllocation.findMany({
      where: { saleOrderLineId: fixture.saleOrderLineId },
    });

    expect(eiplAfter.status).toBe(eiplBefore.status);
    expect(eiplAfter.cartons).toEqual(eiplBefore.cartons);
    expect(eiplAfter.commercialLines).toEqual(eiplBefore.commercialLines);
    expect(allocationsAfter).toEqual(allocationsBefore);
  });

  it('enforces line-level composite uniqueness within an invoice and permits commercial line reuse across replacement invoices', async () => {
    const {
      taxInvoiceId: inv1Id,
      lineId,
      ervePackingListId,
      accountantToken,
    } = await createReadyDraftInvoice(10);

    const origLine = await prisma.taxInvoiceLine.findUniqueOrThrow({ where: { id: lineId } });

    // Inserting duplicate line with the same (taxInvoiceId, ervePackingListCommercialLineId) violates composite unique constraint
    await expect(
      prisma.taxInvoiceLine.create({
        data: {
          id: createId(),
          taxInvoiceId: inv1Id,
          ervePackingListCommercialLineId: origLine.ervePackingListCommercialLineId,
          saleOrderLineId: origLine.saleOrderLineId,
          styleId: origLine.styleId,
          quantity: 5,
          styleMrp: origLine.styleMrp,
          distributorPricingPercentage: origLine.distributorPricingPercentage,
          priceListId: origLine.priceListId,
        },
      }),
    ).rejects.toThrow();

    // Finalize Inv 1 and Cancel Inv 1
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Testing line reuse in replacement' })
      .expect(200);

    // Create replacement draft (Inv 2)
    const draft2 = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId, replacesInvoiceId: inv1Id })
      .expect(201);

    const inv2Id = draft2.body.data.id;
    const inv2Lines = await prisma.taxInvoiceLine.findMany({ where: { taxInvoiceId: inv2Id } });
    expect(inv2Lines).toHaveLength(1);
    expect(inv2Lines[0]!.ervePackingListCommercialLineId).toBe(
      origLine.ervePackingListCommercialLineId,
    );

    // Both lines coexist in DB pointing to the same commercial line across separate invoices
    const allMatchingLines = await prisma.taxInvoiceLine.findMany({
      where: { ervePackingListCommercialLineId: origLine.ervePackingListCommercialLineId },
    });
    expect(allMatchingLines).toHaveLength(2);
  }, 30000);

  it('deterministically resolves the active invoice in by-EIPL and by-Dispatch endpoints through cancellation and replacement', async () => {
    await ensureTestSellerRegistration();
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      10,
    );
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = packingList.body.data.id;
    await ensureActiveDistributorPricing(packingList.body.data.distributor.id);
    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({})
      .expect(200);
    const erveDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId, dispatchDate: '2026-07-01' })
      .expect(201);
    const erveDispatchId = erveDispatch.body.data.id;

    await activateGarmentGstRuleAndAssignHsn(fixture.stock.styleId);
    await setDistributorAddress(fixture.stock.distributorId, {
      state: 'Maharashtra',
      gstin: '27AAAAA0000A1Z5',
    });

    const accountantToken = await createAccountantToken();

    // 1. Create and finalize original invoice
    const draft1 = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const inv1Id = draft1.body.data.id;
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const lookupEipl1 = await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupEipl1.body.data.id).toBe(inv1Id);
    expect(lookupEipl1.body.data.status).toBe('FINALIZED');

    const lookupDispatch1 = await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatchId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupDispatch1.body.data.id).toBe(inv1Id);
    expect(lookupDispatch1.body.data.status).toBe('FINALIZED');

    // 2. Cancel invoice 1 (no replacement exists yet) -> lookups return 404 Not Found
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Commercial dispute' })
      .expect(200);

    await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);

    await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatchId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);

    // 3. Draft replacement invoice 2 -> lookup returns the active DRAFT
    const draft2 = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);
    const inv2Id = draft2.body.data.id;

    const lookupEiplDraft2 = await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupEiplDraft2.body.data.id).toBe(inv2Id);
    expect(lookupEiplDraft2.body.data.status).toBe('DRAFT');

    const lookupDispatchDraft2 = await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatchId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupDispatchDraft2.body.data.id).toBe(inv2Id);
    expect(lookupDispatchDraft2.body.data.status).toBe('DRAFT');

    // 4. Finalize replacement invoice 2 -> lookup returns the active FINALIZED
    await request(app)
      .post(`/tax-invoices/${inv2Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const lookupEiplFinal2 = await request(app)
      .get(`/tax-invoices/by-erve-packing-list/${ervePackingListId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupEiplFinal2.body.data.id).toBe(inv2Id);
    expect(lookupEiplFinal2.body.data.status).toBe('FINALIZED');

    const lookupDispatchFinal2 = await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatchId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(lookupDispatchFinal2.body.data.id).toBe(inv2Id);
    expect(lookupDispatchFinal2.body.data.status).toBe('FINALIZED');
  }, 45000);

  it('guarantees concurrency safety for simultaneous cancellation and replacement draft creation', async () => {
    const { taxInvoiceId, ervePackingListId, accountantToken } =
      await createReadyDraftInvoice(10);
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    // Two concurrent cancellation calls on the same invoice with identical reason
    const [c1, c2] = await Promise.all([
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ reason: 'Concurrent cancellation' }),
      request(app)
        .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ reason: 'Concurrent cancellation' }),
    ]);
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c1.body.data.status).toBe('CANCELLED');
    expect(c2.body.data.status).toBe('CANCELLED');

    const cancelAudits = await prisma.auditLog.count({
      where: { entityType: 'TaxInvoice', entityId: taxInvoiceId, action: 'TAX_INVOICE_CANCELLED' },
    });
    expect(cancelAudits).toBe(1);

    // Two concurrent replacement draft requests for the EIPL
    const [d1, d2] = await Promise.all([
      request(app)
        .post('/tax-invoices')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ ervePackingListId }),
      request(app)
        .post('/tax-invoices')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ ervePackingListId }),
    ]);
    expect([200, 201]).toContain(d1.status);
    expect([200, 201]).toContain(d2.status);
    expect(d1.body.data.id).toBe(d2.body.data.id);

    const activeInvoices = await prisma.taxInvoice.findMany({
      where: { ervePackingListId, status: { not: 'CANCELLED' } },
    });
    expect(activeInvoices).toHaveLength(1);
    expect(activeInvoices[0]!.id).toBe(d1.body.data.id);
  }, 30000);

  it('validates replacement provenance references and rejects invalid or cross-EIPL replacement links', async () => {
    const {
      taxInvoiceId: inv1Id,
      ervePackingListId: eipl1Id,
      accountantToken,
    } = await createReadyDraftInvoice(10);
    const { taxInvoiceId: inv2Id } = await createReadyDraftInvoice(10);

    // Finalize inv 1 and cancel inv 1 so that eipl1Id has no active invoice
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    await request(app)
      .post(`/tax-invoices/${inv1Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Setup for provenance testing' })
      .expect(200);

    // Non-existent replacesInvoiceId -> 404
    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: eipl1Id, replacesInvoiceId: 'non-existent-id' })
      .expect(404);

    // Finalize inv 2 (belongs to different EIPL) and try to reference it from eipl 1 -> 400
    await request(app)
      .post(`/tax-invoices/${inv2Id}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: eipl1Id, replacesInvoiceId: inv2Id })
      .expect(400);

    // Cancel inv 2, but it still belongs to different EIPL -> 400
    await request(app)
      .post(`/tax-invoices/${inv2Id}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Cancelling inv2' })
      .expect(200);

    await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: eipl1Id, replacesInvoiceId: inv2Id })
      .expect(400);

    // Valid replacesInvoiceId pointing to cancelled inv 1 on same EIPL -> 201
    const replacementDraft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: eipl1Id, replacesInvoiceId: inv1Id })
      .expect(201);

    expect(replacementDraft.body.data.replacesInvoiceId).toBe(inv1Id);
  }, 45000);

  it('preserves archived image access and frozen details on a cancelled invoice', async () => {
    const { taxInvoiceId, fixture, accountantToken } = await createReadyDraftInvoice(2);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=',
      'base64',
    );
    const { token: adminToken } = await createRoleToken('ADMIN');
    await request(app)
      .post(`/styles/${fixture.stock.styleId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', png, { filename: 'test.png', contentType: 'image/png' })
      .expect(201);

    const finalized = await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/finalize`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    const imageFileId = finalized.body.data.documentSnapshot.lines[0].image.id;
    expect(imageFileId).toBeDefined();

    // Image content readable on finalized invoice
    const imagePath = `/tax-invoices/${taxInvoiceId}/images/${imageFileId}/content`;
    const readFinalized = await request(app)
      .get(imagePath)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(Buffer.from(readFinalized.body)).toEqual(png);

    // Cancel invoice
    await request(app)
      .post(`/tax-invoices/${taxInvoiceId}/actions/cancel`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'Image archival preservation test' })
      .expect(200);

    // Image content MUST remain readable on cancelled invoice
    const readCancelled = await request(app)
      .get(imagePath)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(Buffer.from(readCancelled.body)).toEqual(png);

    // Detail view retains snapshot, totals, and lines
    const detail = await request(app)
      .get(`/tax-invoices/${taxInvoiceId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(detail.body.data.status).toBe('CANCELLED');
    expect(detail.body.data.documentSnapshot).toEqual(finalized.body.data.documentSnapshot);
    expect(detail.body.data.grandTotal).toBe(finalized.body.data.grandTotal);
  }, 45000);
});



