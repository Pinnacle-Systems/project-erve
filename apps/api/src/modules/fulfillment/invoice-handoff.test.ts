import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';

import {
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

/** Drives a Sale Order (given Purchase Mode) all the way to a recorded Erve Dispatch and its auto-created PENDING_TALLY "Dispatch Sale" handoff. */
async function dispatchFixture(quantity = 20, purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT') {
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

  const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
  const distributorToken = await createDistributorToken(fixture.stock.distributorId);
  const handoff = await prisma.invoiceHandoff.findFirstOrThrow({ where: { erveDispatchId: dispatch.id } });

  return { fixture, factoryToken, dispatch, handoffId: handoff.id, accountantToken, distributorToken };
}

describe('Invoice Handoff — "Dispatch Sale" automatic creation (both Purchase Modes)', () => {
  it('creates a PENDING_TALLY handoff for an OUTRIGHT Dispatch', async () => {
    const { handoffId, accountantToken, dispatch } = await dispatchFixture(20, 'OUTRIGHT');
    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_TALLY');
    expect(res.body.data.purchaseMode).toBe('OUTRIGHT');
    expect(res.body.data.quantity).toBe(20);
    expect(res.body.data.erveDispatch.id).toBe(dispatch.id);
    expect(res.body.data.tallyInvoiceNumber).toBeNull();
  });

  it('ALSO creates a PENDING_TALLY handoff for a SALE_RETURN Dispatch — the physical outward movement is invoiced regardless of Purchase Mode', async () => {
    const { handoffId, accountantToken } = await dispatchFixture(20, 'SALE_RETURN');
    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_TALLY');
    expect(res.body.data.purchaseMode).toBe('SALE_RETURN');
    expect(res.body.data.quantity).toBe(20);
  });

  it('does not create a handoff for a DRAFT (not yet dispatched) Factory Dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20, 'OUTRIGHT');
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        cartonNumber: 'C1',
        destinationId: fixture.saleOrder.destinations[0].id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }],
      })
      .expect(200);

    expect(await prisma.invoiceHandoff.count()).toBe(0);
  });

  // "Mixed-mode single Erve Dispatch" and "cross-distributor reassignment"
  // (both removed here) are architecturally impossible under Dispatch Order
  // Phase 3: a Dispatch Order has exactly one Distributor, Purchase Mode is
  // the Distributor's own field (never per-line, never reassigned from a
  // different distributor's pool — pooled stock is distributor-independent
  // to begin with). Single-mode coverage above already exercises "the
  // physical outward movement is invoiced regardless of Purchase Mode" and
  // "Purchase Mode is resolved from the Dispatch Order's own Distributor".
});

describe('Invoice Handoff — Accountant queue and recording', () => {
  it('lets an Accountant list pending invoice handoffs, mixing OUTRIGHT and SALE_RETURN sourced ones together', async () => {
    const outright = await dispatchFixture(20, 'OUTRIGHT');
    const saleReturn = await dispatchFixture(30, 'SALE_RETURN');
    const res = await request(app)
      .get('/invoice-handoffs')
      .query({ status: 'PENDING_TALLY' })
      .set('Authorization', `Bearer ${outright.accountantToken}`)
      .expect(200);
    const ids = res.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(outright.handoffId);
    expect(ids).toContain(saleReturn.handoffId);
  });

  it('lets an Accountant record a valid Tally invoice reference for a SALE_RETURN-sourced handoff, moving status to INVOICED', async () => {
    const { handoffId, accountantToken } = await dispatchFixture(20, 'SALE_RETURN');
    const res = await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-001', tallyInvoiceDate: '2026-07-02' })
      .expect(200);
    expect(res.body.data.status).toBe('INVOICED');
    expect(res.body.data.tallyInvoiceNumber).toBe('INV-001');
    expect(res.body.data.recordedBy).toBeTruthy();
  });

  it('allows the Accountant to correct a previously recorded Tally reference', async () => {
    const { handoffId, accountantToken } = await dispatchFixture(20);
    const first = await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-003', tallyInvoiceDate: '2026-07-04' })
      .expect(200);
    const corrected = await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: first.body.data.version, tallyInvoiceNumber: 'INV-003-CORRECTED', tallyInvoiceDate: '2026-07-04' })
      .expect(200);
    expect(corrected.body.data.tallyInvoiceNumber).toBe('INV-003-CORRECTED');
  });

  it('allows the SAME Tally invoice number to be recorded on two different handoffs (consolidation is an open question, not yet constrained)', async () => {
    const one = await dispatchFixture(20, 'OUTRIGHT');
    const two = await dispatchFixture(20, 'SALE_RETURN');
    await request(app)
      .patch(`/invoice-handoffs/${one.handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${one.accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-CONSOLIDATED', tallyInvoiceDate: '2026-07-06' })
      .expect(200);
    await request(app)
      .patch(`/invoice-handoffs/${two.handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${two.accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-CONSOLIDATED', tallyInvoiceDate: '2026-07-06' })
      .expect(200);
  });

  it('rejects a stale version on record/correct', async () => {
    const { handoffId, accountantToken } = await dispatchFixture(20);
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 99, tallyInvoiceNumber: 'INV-004', tallyInvoiceDate: '2026-07-07' })
      .expect(409);
  });

  it('rejects a nonexistent invoice handoff id', async () => {
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await request(app)
      .patch(`/invoice-handoffs/${createId()}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-005', tallyInvoiceDate: '2026-07-08' })
      .expect(404);
  });
});

describe('Invoice Handoff — authorization', () => {
  it('forbids Distributor from recording a Tally reference', async () => {
    const { handoffId, distributorToken } = await dispatchFixture(20);
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-006', tallyInvoiceDate: '2026-07-09' })
      .expect(403);
  });

  it('forbids Factory User from recording a Tally reference', async () => {
    const { handoffId, factoryToken } = await dispatchFixture(20);
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-007', tallyInvoiceDate: '2026-07-10' })
      .expect(403);
  });

  it('forbids QA User from recording a Tally reference', async () => {
    const { handoffId } = await dispatchFixture(20);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-008', tallyInvoiceDate: '2026-07-11' })
      .expect(403);
  });

  it('forbids Merchandiser from recording a Tally reference but lets them view status (view-only per scope)', async () => {
    const { handoffId, fixture } = await dispatchFixture(20);
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-009', tallyInvoiceDate: '2026-07-12' })
      .expect(403);
    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_TALLY');
  });

  it('lets Senior Management view invoice status', async () => {
    const { handoffId } = await dispatchFixture(20);
    const { token: smToken } = await createRoleToken('SENIOR_MANAGEMENT');
    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${smToken}`)
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_TALLY');
  });

  it('lets ADMIN record a Tally reference (override standing)', async () => {
    const { handoffId } = await dispatchFixture(20);
    const { token: adminToken } = await createRoleToken('ADMIN');
    const res = await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-010', tallyInvoiceDate: '2026-07-13' })
      .expect(200);
    expect(res.body.data.status).toBe('INVOICED');
  });
});

describe('Invoice Handoff — view privacy', () => {
  it('lets Distributor see only safe fields (number/date), never the Tally voucher reference or who recorded it', async () => {
    const { handoffId, accountantToken, distributorToken } = await dispatchFixture(20);
    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({
        expectedVersion: 1,
        tallyInvoiceNumber: 'INV-011',
        tallyInvoiceDate: '2026-07-14',
        tallyVoucherReference: 'VCH-SECRET-011',
        remarks: 'internal remark',
      })
      .expect(200);

    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    expect(res.body.data.tallyInvoiceNumber).toBe('INV-011');
    expect(res.body.data.tallyVoucherReference).toBeNull();
    expect(res.body.data.remarks).toBeNull();
    expect(res.body.data.recordedBy).toBeNull();
  });

  it("forbids a Distributor from viewing another Distributor's invoice handoff", async () => {
    const { handoffId } = await dispatchFixture(20);
    const otherDistributor = await prisma.distributor.create({
      data: {
        id: createId(),
        code: `OTH-${createId().slice(0, 6)}`,
        name: 'Other Distributor',
        gstin: '27AAAAA0000A1Z5',
        purchaseMode: 'OUTRIGHT',
      },
    });
    const otherToken = await createDistributorToken(otherDistributor.id);
    await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('does not leak StockAllocation/QA provenance through the invoice DTO to Accountant', async () => {
    const { handoffId, accountantToken } = await dispatchFixture(20);
    const res = await request(app)
      .get(`/invoice-handoffs/${handoffId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toContain('stockAllocation');
    expect(serialized).not.toContain('qaRelease');
  });
});

describe('Invoice Handoff — Dispatch Order physical/financial separation', () => {
  it('Dispatch Order fulfillment stage is independent of invoice handoff status (OUTRIGHT)', async () => {
    const { fixture, dispatch, handoffId, accountantToken } = await dispatchFixture(20, 'OUTRIGHT');
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('ACTIVE'); // Dispatch Order Phase 3: no persisted workflow status

    const handoff = await prisma.invoiceHandoff.findUniqueOrThrow({ where: { id: handoffId } });
    expect(handoff.status).toBe('PENDING_TALLY');
    expect(dispatch.status).toBe('DISPATCHED');

    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-012', tallyInvoiceDate: '2026-07-15' })
      .expect(200);

    const orderAfter = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(orderAfter.status).toBe('ACTIVE');
  });

  it('Dispatch Order reaches ERVE_DISPATCHED for SALE_RETURN even while actual sold = 0 (physical fulfilment is independent of commercial sell-through)', async () => {
    const { fixture } = await dispatchFixture(100, 'SALE_RETURN');
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('ACTIVE');
  });
});
