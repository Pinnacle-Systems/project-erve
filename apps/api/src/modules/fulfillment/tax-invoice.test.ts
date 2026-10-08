import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestSellerRegistration, resetDatabase } from '../../test/helpers.js';
import {
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  ensureActiveDistributorPricing,
  packAndFinalize,
} from './fulfillment-test-helpers.js';
import { createOrGetTaxInvoiceDraft } from './tax-invoice.service.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

/** Finalizes (but does NOT dispatch) a single-carton Erve Packing List. */
async function createFinalizedEipl(quantity = 20, purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT') {
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatchA = await packAndFinalize(app, factoryTokenA, fixtureA.saleOrder.id, fixtureA.saleOrderLineId, fixtureA.saleOrder.destinations[0].id, 15);
    const dispatchB = await packAndFinalize(app, factoryTokenB, fixtureB.saleOrder.id, fixtureB.saleOrderLineId, fixtureB.saleOrder.destinations[0].id, 25);

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

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
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
    const line = await prisma.ervePackingListCommercialLine.findFirstOrThrow({ where: { ervePackingListId } });
    await prisma.ervePackingListCommercialLine.update({ where: { id: line.id }, data: { quantity: line.quantity + 5 } });

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
    await prisma.factoryPackingCarton.update({ where: { id: cartonId }, data: { retiredAt: new Date() } });

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
    const seller = await createTestSellerRegistration({ branchCode: 'ERVE-HO', legalName: 'ERVE India Private Limited' });
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
    await prisma.sellerRegistration.update({ where: { id: seller.id }, data: { legalName: 'Renamed Seller Pvt Ltd' } });
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
    const dispatchA = await packAndFinalize(app, factoryTokenA, fixtureA.saleOrder.id, fixtureA.saleOrderLineId, fixtureA.saleOrder.destinations[0].id, 15);
    const dispatchB = await packAndFinalize(app, factoryTokenB, fixtureB.saleOrder.id, fixtureB.saleOrderLineId, fixtureB.saleOrder.destinations[0].id, 25);

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

    const accountantToken = await createAccountantToken();
    const res = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId })
      .expect(201);

    expect(res.body.data.lines).toHaveLength(2);
    const quantities = res.body.data.lines.map((l: { quantity: number }) => l.quantity).sort((a: number, b: number) => a - b);
    expect(quantities).toEqual([15, 25]);
    const saleOrderLineIds = res.body.data.lines.map((l: { saleOrderLineId: string }) => l.saleOrderLineId);
    expect(new Set(saleOrderLineIds).size).toBe(2);
  });

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
    await prisma.priceList.updateMany({ where: { distributorId: fixture.stock.distributorId, status: 'ACTIVE' }, data: { percentageOfMrp: 1 } });

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
    expect(sequencesAfter.map((s) => ({ type: s.documentType, serial: s.lastAllocatedSerial }))).toEqual(
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

    for (const role of ['MERCHANDISER', 'FACTORY_USER', 'DISTRIBUTOR', 'QA_USER', 'SENIOR_MANAGEMENT'] as const) {
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);
    const accountantToken = await createAccountantToken();

    await request(app)
      .get(`/tax-invoices/by-erve-dispatch/${erveDispatch.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(404);
  });
});
