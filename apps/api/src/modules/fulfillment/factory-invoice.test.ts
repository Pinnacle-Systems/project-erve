import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  createTwoBatchApprovedSaleOrder,
  ensureStyleFactoryRate,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function destinationOf(saleOrder: { destinations: Array<{ id: string }> }): string {
  return saleOrder.destinations[0]!.id;
}

function createCarton(
  token: string,
  saleOrderId: string,
  body: { cartonNumber: string; destinationId: string; lines: Array<{ saleOrderLineId: string; quantity: number }> },
) {
  return request(app).post(`/sale-orders/${saleOrderId}/packing-list/cartons`).set('Authorization', `Bearer ${token}`).send(body);
}

function confirmCartonAudit(token: string, factoryDispatchId: string, cartonId: string) {
  return request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}/audit`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

function removeCarton(token: string, factoryDispatchId: string, cartonId: string, expectedVersion: number) {
  return request(app)
    .delete(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion });
}

function finalizeDispatch(token: string, factoryDispatchId: string, expectedVersion: number) {
  return request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion });
}

function getInvoice(token: string, id: string) {
  return request(app).get(`/factory-invoices/${id}`).set('Authorization', `Bearer ${token}`);
}

function listInvoices(token: string, params: Record<string, unknown> = {}) {
  return request(app).get('/factory-invoices').query(params).set('Authorization', `Bearer ${token}`);
}

function confirmInvoice(token: string, id: string) {
  return request(app).post(`/factory-invoices/${id}/confirm`).set('Authorization', `Bearer ${token}`).send({});
}

function patchFinancials(token: string, id: string, body: Record<string, unknown>) {
  return request(app).patch(`/factory-invoices/${id}/financials`).set('Authorization', `Bearer ${token}`).send(body);
}

function finalizeInvoice(token: string, id: string, expectedVersion: number) {
  return request(app).post(`/factory-invoices/${id}/finalize`).set('Authorization', `Bearer ${token}`).send({ expectedVersion });
}

/** Fixture: a Dispatch Order fully packed, audited and finalized — the generated Factory Invoice's baseline state. */
async function setupFinalizedInvoice(quantity = 10, rate = 150) {
  const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity);
  const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
  const destinationId = destinationOf(fixture.saleOrder);
  const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, destinationId, quantity, rate);
  const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { factoryDispatchId: dispatch.id } });
  return { fixture, factoryToken, destinationId, dispatch, invoiceId: invoice.id };
}

describe('Factory Invoice — generation from finalized Factory Packing List', () => {
  it('creates exactly one Factory Invoice with correct source references, quantity and rate snapshot', async () => {
    const { fixture, dispatch, invoiceId } = await setupFinalizedInvoice(10, 150);

    const count = await prisma.factoryInvoice.count({ where: { factoryDispatchId: dispatch.id } });
    expect(count).toBe(1);

    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const res = await getInvoice(accountantToken, invoiceId).expect(200);
    expect(res.body.data.status).toBe('GENERATED');
    expect(res.body.data.factory.id).toBe(fixture.stock.factoryId);
    expect(res.body.data.factoryDispatch.factoryDispatchNumber).toBe(dispatch.factoryDispatchNumber);
    expect(res.body.data.saleOrder.saleOrderNumber).toBe(fixture.saleOrder.saleOrderNumber);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].saleOrderLineId).toBe(fixture.saleOrderLineId);
    expect(res.body.data.lines[0].quantity).toBe(10);
    expect(res.body.data.lines[0].defaultRate).toBe(150);
    expect(res.body.data.lines[0].unitRate).toBe(150);
    expect(res.body.data.lines[0].lineAmount).toBe(1500);
    expect(res.body.data.subtotal).toBe(1500);
    expect(res.body.data.gstAmount).toBe(0);
    expect(res.body.data.total).toBe(1500);
  });

  it('surfaces the generated Factory Invoice id on the Factory Packing List projection', async () => {
    const { fixture, factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    const res = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}/packing-list`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(res.body.data.factoryDispatch.factoryInvoiceId).toBe(invoiceId);
  });

  it('excludes retired carton contents from the generated invoice quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);

    const first = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = first.body.data.factoryDispatch.id;
    const cartonA = first.body.data.destinations[0].cartons[0];
    await confirmCartonAudit(qaToken, factoryDispatchId, cartonA.id).expect(200);
    await removeCarton(factoryToken, factoryDispatchId, cartonA.id, cartonA.version).expect(200);

    const second = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const cartonB = second.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C2');
    await confirmCartonAudit(qaToken, factoryDispatchId, cartonB.id).expect(200);
    await finalizeDispatch(factoryToken, factoryDispatchId, second.body.data.factoryDispatch.version).expect(200);

    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { factoryDispatchId }, include: { lines: true } });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.quantity).toBe(10);
  });

  it('collapses a saleOrderLine backed by two StockAllocations into exactly one Factory Invoice line', async () => {
    const two = await createTwoBatchApprovedSaleOrder(app, 6, 4);
    const factoryToken = await createFactoryUserToken(two.factoryId);
    const destinationId = destinationOf(two.saleOrder);
    const dispatch = await packAndFinalize(app, factoryToken, two.saleOrder.id, two.saleOrderLineId, destinationId, 10);

    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { factoryDispatchId: dispatch.id }, include: { lines: true } });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.saleOrderLineId).toBe(two.saleOrderLineId);
    expect(invoice.lines[0]!.quantity).toBe(10);
  });

  it('fails finalize atomically with no active Style<->Factory rate, leaving the dispatch DRAFT and no invoice created', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;
    await confirmCartonAudit(qaToken, factoryDispatchId, cartonId).expect(200);

    // Deliberately no ensureStyleFactoryRate call.
    const res = await finalizeDispatch(factoryToken, factoryDispatchId, created.body.data.factoryDispatch.version).expect(400);
    expect(res.body.error.details.missingRates).toHaveLength(1);
    expect(res.body.error.details.missingRates[0].styleId).toBe(fixture.stock.styleId);

    const dispatchAfter = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: factoryDispatchId } });
    expect(dispatchAfter.status).toBe('DRAFT');
    expect(await prisma.factoryInvoice.count({ where: { factoryDispatchId } })).toBe(0);
  });

  it('the database rejects a second Factory Invoice for the same Factory Dispatch', async () => {
    const { dispatch } = await setupFinalizedInvoice(10);
    const existing = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    await expect(
      prisma.factoryInvoice.create({
        data: { id: createId(), factoryDispatchId: dispatch.id, factoryId: existing.factoryId, status: 'GENERATED' },
      }),
    ).rejects.toThrow();
  });

  it('two concurrent finalize attempts never create two Factory Invoices', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;
    await confirmCartonAudit(qaToken, factoryDispatchId, cartonId).expect(200);

    const version = created.body.data.factoryDispatch.version as number;
    const [r1, r2] = await Promise.all([
      finalizeDispatch(factoryToken, factoryDispatchId, version),
      finalizeDispatch(factoryToken, factoryDispatchId, version),
    ]);
    const succeeded = [r1, r2].filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(await prisma.factoryInvoice.count({ where: { factoryDispatchId } })).toBe(1);
  });

  it('Phase 4 boundary: an unaudited carton still blocks finalize independent of rate configuration, and no invoice is created', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = destinationOf(fixture.saleOrder);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId); // rate IS configured

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;

    // No audit confirmed — the pre-existing packing/audit blockers, not
    // Factory Invoice, must be what rejects this (see the `blockers` object
    // in finalizeFactoryDispatch — unchanged by this phase).
    const res = await finalizeDispatch(factoryToken, factoryDispatchId, created.body.data.factoryDispatch.version).expect(400);
    expect(res.body.error.details.cartonsNotAudited).toHaveLength(1);
    expect(res.body.error.details.missingRates).toBeUndefined();
    expect(await prisma.factoryInvoice.count({ where: { factoryDispatchId } })).toBe(0);
  });

  it('a GENERATED (unconfirmed) Factory Invoice never blocks normal Packing List or Packing Audit reads', async () => {
    const { fixture, factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await request(app).get(`/sale-orders/${fixture.saleOrder.id}/packing-list`).set('Authorization', `Bearer ${factoryToken}`).expect(200);
    await request(app).get('/packing-audit/queue').set('Authorization', `Bearer ${qaToken}`).expect(200);
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe('GENERATED');
  });

  it('lists Factory Invoices scoped to the caller\'s own Factory', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    const res = await listInvoices(factoryToken).expect(200);
    expect(res.body.data.items.map((i: { id: string }) => i.id)).toContain(invoiceId);
  });
});

describe('Factory Invoice — FACTORY_USER confirmation', () => {
  it('own-factory FACTORY_USER confirms successfully and records actor/timestamp', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    const res = await confirmInvoice(factoryToken, invoiceId).expect(200);
    expect(res.body.data.status).toBe('FACTORY_CONFIRMED');
    expect(res.body.data.factoryConfirmedBy).toBeTruthy();
    expect(res.body.data.factoryConfirmedAt).toBeTruthy();
  });

  it('rejects a cross-factory FACTORY_USER confirming another Factory\'s invoice', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    const other = await createSingleFactoryApprovedSaleOrder(app, 5);
    const otherFactoryToken = await createFactoryUserToken(other.stock.factoryId);
    await confirmInvoice(otherFactoryToken, invoiceId).expect(403);
  });

  it('duplicate confirmation is safely idempotent: no re-audit, actor/timestamp/version unchanged, no physical change', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    const first = await confirmInvoice(factoryToken, invoiceId).expect(200);
    const auditCountBefore = await prisma.auditLog.count({
      where: { entityType: 'FactoryInvoice', entityId: invoiceId, action: 'FACTORY_INVOICE_FACTORY_CONFIRMED' },
    });

    const second = await confirmInvoice(factoryToken, invoiceId).expect(200);

    const auditCountAfter = await prisma.auditLog.count({
      where: { entityType: 'FactoryInvoice', entityId: invoiceId, action: 'FACTORY_INVOICE_FACTORY_CONFIRMED' },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
    expect(second.body.data.factoryConfirmedAt).toBe(first.body.data.factoryConfirmedAt);
    expect(second.body.data.version).toBe(first.body.data.version);
    expect(second.body.data.lines).toEqual(first.body.data.lines);
  });
});

describe('Factory Invoice — ACCOUNTANT financial edits', () => {
  it('rejects a financial edit before Factory confirmation', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await patchFinancials(accountantToken, invoiceId, { expectedVersion: invoice.version, gstAmount: 50 }).expect(400);
  });

  it('lets ACCOUNTANT override a line unit rate post-confirmation, recalculating amounts, without touching defaultRate or the master rate', async () => {
    const { factoryToken, invoiceId, fixture } = await setupFinalizedInvoice(7, 123.45);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const before = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;
    const lineId = before.lines[0].id;

    const res = await patchFinancials(accountantToken, invoiceId, {
      expectedVersion: before.version,
      lines: [{ id: lineId, unitRate: 200 }],
    }).expect(200);

    expect(res.body.data.lines[0].unitRate).toBe(200);
    expect(res.body.data.lines[0].defaultRate).toBe(123.45);
    expect(res.body.data.lines[0].lineAmount).toBe(1400); // 7 * 200
    expect(res.body.data.subtotal).toBe(1400);
    expect(res.body.data.total).toBe(1400);
    expect(res.body.data.version).toBe(before.version + 1);

    const mapping = await prisma.styleFactoryMapping.findUniqueOrThrow({
      where: { styleId_factoryId: { styleId: fixture.stock.styleId, factoryId: fixture.stock.factoryId } },
    });
    expect(mapping.exFactoryPrice.toNumber()).toBe(123.45);
  });

  it('rejects an injected physical field via the strict financials schema', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await patchFinancials(accountantToken, invoiceId, { expectedVersion: invoice.version, quantity: 999 }).expect(400);
    await patchFinancials(accountantToken, invoiceId, { expectedVersion: invoice.version, styleId: 'x' }).expect(400);
  });

  it('a no-op financial PATCH leaves version and audit untouched', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;
    const auditCountBefore = await prisma.auditLog.count({
      where: { entityType: 'FactoryInvoice', entityId: invoiceId, action: 'FACTORY_INVOICE_FINANCIAL_UPDATED' },
    });

    const res = await patchFinancials(accountantToken, invoiceId, {
      expectedVersion: current.version,
      lines: [{ id: current.lines[0].id, unitRate: current.lines[0].unitRate }],
      gstAmount: current.gstAmount,
      remarks: current.remarks,
    }).expect(200);

    expect(res.body.data.version).toBe(current.version);
    const auditCountAfter = await prisma.auditLog.count({
      where: { entityType: 'FactoryInvoice', entityId: invoiceId, action: 'FACTORY_INVOICE_FINANCIAL_UPDATED' },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('a real financial edit bumps version and audits old/new values', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;

    await patchFinancials(accountantToken, invoiceId, { expectedVersion: current.version, gstAmount: 75 }).expect(200);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'FactoryInvoice', entityId: invoiceId, action: 'FACTORY_INVOICE_FINANCIAL_UPDATED' },
    });
    expect(entry.metadata).toMatchObject({ gstAmount: { old: 0, new: 75 } });
  });

  it('rejects a stale expectedVersion', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await patchFinancials(accountantToken, invoiceId, { expectedVersion: 999, gstAmount: 10 }).expect(409);
  });

  it('rejects a financial edit on a finalized invoice', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;
    const finalized = await finalizeInvoice(accountantToken, invoiceId, current.version).expect(200);
    await patchFinancials(accountantToken, invoiceId, { expectedVersion: finalized.body.data.version, gstAmount: 99 }).expect(400);
  });
});

describe('Factory Invoice — totals calculation', () => {
  it('calculates lineAmount/subtotal/total using exact Decimal arithmetic', async () => {
    const { invoiceId } = await setupFinalizedInvoice(7, 123.45);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const res = await getInvoice(accountantToken, invoiceId).expect(200);
    expect(res.body.data.lines[0].lineAmount).toBe(864.15);
    expect(res.body.data.subtotal).toBe(864.15);
    expect(res.body.data.total).toBe(864.15);
  });

  it('adds GST to subtotal for total, with no deduction field reachable', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10, 100);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;

    const res = await patchFinancials(accountantToken, invoiceId, { expectedVersion: current.version, gstAmount: 180 }).expect(200);
    expect(res.body.data.subtotal).toBe(1000);
    expect(res.body.data.gstAmount).toBe(180);
    expect(res.body.data.total).toBe(1180);

    await patchFinancials(accountantToken, invoiceId, { expectedVersion: res.body.data.version, deductionAmount: 50 }).expect(400);
  });
});

describe('Factory Invoice — ACCOUNTANT finalization', () => {
  it('only ACCOUNTANT can finalize; FACTORY_USER is rejected', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await finalizeInvoice(factoryToken, invoiceId, invoice.version).expect(403);
  });

  it('requires Factory confirmation first', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await finalizeInvoice(accountantToken, invoiceId, invoice.version).expect(400);
  });

  it('persists final actor/timestamp/values and makes the invoice fully immutable', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10, 50);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;

    const res = await finalizeInvoice(accountantToken, invoiceId, current.version).expect(200);
    expect(res.body.data.status).toBe('FINALIZED');
    expect(res.body.data.finalizedBy).toBeTruthy();
    expect(res.body.data.finalizedAt).toBeTruthy();
    expect(res.body.data.subtotal).toBe(500);
    expect(res.body.data.total).toBe(500);

    await patchFinancials(accountantToken, invoiceId, { expectedVersion: res.body.data.version, gstAmount: 1 }).expect(400);
    await finalizeInvoice(accountantToken, invoiceId, res.body.data.version).expect(400);
    // Factory re-confirming a finalized invoice is still a harmless idempotent no-op, never an error.
    await confirmInvoice(factoryToken, invoiceId).expect(200);
  });

  it('a concurrent financial-edit-vs-finalize race is serialized safely: the loser is rejected as stale', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const current = (await getInvoice(accountantToken, invoiceId).expect(200)).body.data;

    const [patchRes, finalizeRes] = await Promise.all([
      patchFinancials(accountantToken, invoiceId, { expectedVersion: current.version, gstAmount: 10 }),
      finalizeInvoice(accountantToken, invoiceId, current.version),
    ]);
    const succeeded = [patchRes, finalizeRes].filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);
    const loser = patchRes.status === 200 ? finalizeRes : patchRes;
    expect(loser.status).toBe(409);

    const after = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.status).toBe(finalizeRes.status === 200 ? 'FINALIZED' : 'FACTORY_CONFIRMED');
  });
});

describe('Factory Invoice — RBAC/IDOR', () => {
  it('requires authentication on every route', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    await request(app).get(`/factory-invoices/${invoiceId}`).expect(401);
    await request(app).get('/factory-invoices').expect(401);
    await request(app).post(`/factory-invoices/${invoiceId}/confirm`).send({}).expect(401);
    await request(app).patch(`/factory-invoices/${invoiceId}/financials`).send({ expectedVersion: 1 }).expect(401);
    await request(app).post(`/factory-invoices/${invoiceId}/finalize`).send({ expectedVersion: 1 }).expect(401);
  });

  it('rejects QA_USER, MERCHANDISER and DISTRIBUTOR from every Factory Invoice route', async () => {
    const { fixture, invoiceId } = await setupFinalizedInvoice(10);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const distToken = await createDistributorToken(fixture.stock.distributorId);

    for (const token of [qaToken, merchToken, distToken]) {
      await getInvoice(token, invoiceId).expect(403);
      await confirmInvoice(token, invoiceId).expect(403);
      await patchFinancials(token, invoiceId, { expectedVersion: 1 }).expect(403);
      await finalizeInvoice(token, invoiceId, 1).expect(403);
    }
  });

  it('rejects a cross-factory FACTORY_USER reading another Factory\'s invoice', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    const other = await createSingleFactoryApprovedSaleOrder(app, 5);
    const otherFactoryToken = await createFactoryUserToken(other.stock.factoryId);
    await getInvoice(otherFactoryToken, invoiceId).expect(403);
  });

  it('rejects FACTORY_USER from financial edits and finalize', async () => {
    const { factoryToken, invoiceId } = await setupFinalizedInvoice(10);
    await confirmInvoice(factoryToken, invoiceId).expect(200);
    const invoice = await prisma.factoryInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await patchFinancials(factoryToken, invoiceId, { expectedVersion: invoice.version, gstAmount: 5 }).expect(403);
    await finalizeInvoice(factoryToken, invoiceId, invoice.version).expect(403);
  });

  it('rejects ACCOUNTANT from Factory confirmation', async () => {
    const { invoiceId } = await setupFinalizedInvoice(10);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await confirmInvoice(accountantToken, invoiceId).expect(403);
  });
});
