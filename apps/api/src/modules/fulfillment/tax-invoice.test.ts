import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
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
import {
  assertTaxInvoiceSequenceBaselined,
  createOrGetTaxInvoiceDraft,
} from './tax-invoice.service.js';

const app = createApp();
beforeEach(resetDatabase);
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
      data: { payableTotal: null, roundOffAdjustment: null, roundingPolicy: null },
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
