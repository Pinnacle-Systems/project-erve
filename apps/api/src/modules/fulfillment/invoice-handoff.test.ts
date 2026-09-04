import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase, createReleasedQaStock, createPurchaseOrderLineSize } from '../../test/helpers.js';
import {
  confirmErveDispatchDelivery,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function packAndFinalize(
  factoryToken: string,
  saleOrderId: string,
  saleOrderLineId: string,
  stockAllocationId: string,
  quantity: number,
) {
  const created = await request(app)
    .post('/factory-dispatches')
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ saleOrderId, lines: [{ saleOrderLineId, stockAllocationId, packedQuantity: quantity }] })
    .expect(201);
  const lineId = created.body.data.lines[0].id;
  await request(app)
    .post(`/factory-dispatches/${created.body.data.id}/cartons`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity }] })
    .expect(200);
  const finalized = await request(app)
    .post(`/factory-dispatches/${created.body.data.id}/actions/finalize`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ expectedVersion: created.body.data.version + 1 })
    .expect(200);
  return finalized.body.data;
}

/** Drives a Sale Order (given Purchase Mode) all the way to a recorded Erve Dispatch and its auto-created PENDING_TALLY "Dispatch Sale" handoff. */
async function dispatchFixture(quantity = 20, purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT') {
  const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, purchaseMode);
  const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
  const factoryDispatch = await packAndFinalize(
    factoryToken,
    fixture.saleOrder.id,
    fixture.saleOrderLineId,
    fixture.stockAllocationId,
    quantity,
  );
  const packingList = await request(app)
    .post('/erve-packing-lists')
    .set('Authorization', `Bearer ${fixture.merchToken}`)
    .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [factoryDispatch.id] })
    .expect(201);
  const dispatch = await request(app)
    .post('/erve-dispatches')
    .set('Authorization', `Bearer ${fixture.merchToken}`)
    .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
    .expect(201);

  const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
  const distributorToken = await createDistributorToken(fixture.stock.distributorId);
  const handoff = await prisma.invoiceHandoff.findFirstOrThrow({ where: { erveDispatchId: dispatch.body.data.id } });

  return { fixture, factoryToken, dispatch: dispatch.body.data, handoffId: handoff.id, accountantToken, distributorToken };
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
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 20 }],
      })
      .expect(201);

    expect(await prisma.invoiceHandoff.count()).toBe(0);
  });

  it('a mixed-mode Erve Dispatch (one OUTRIGHT line, one SALE_RETURN line from a different commercial PO) invoices BOTH quantities independently', async () => {
    const outrightStock = await createReleasedQaStock({ quantity: 50, purchaseMode: 'OUTRIGHT' });
    const saleReturnStock = await createReleasedQaStock({
      distributorId: outrightStock.distributorId,
      factoryId: outrightStock.factoryId,
      quantity: 80,
      purchaseMode: 'SALE_RETURN',
    });
    const distributorToken = await createDistributorToken(outrightStock.distributorId);

    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: outrightStock.distributorId,
        soDate: '2026-06-30',
        lines: [
          { purchaseOrderLineSizeId: outrightStock.purchaseOrderLineSizeId, requestedQuantity: 50 },
          { purchaseOrderLineSizeId: saleReturnStock.purchaseOrderLineSizeId, requestedQuantity: 80 },
        ],
      })
      .expect(201);
    const submitted = await request(app)
      .post(`/sale-orders/${created.body.data.id}/actions/submit`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const lineA = submitted.body.data.lines.find((l: { requestedQuantity: number }) => l.requestedQuantity === 50);
    const lineB = submitted.body.data.lines.find((l: { requestedQuantity: number }) => l.requestedQuantity === 80);

    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const approved = await request(app)
      .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: submitted.body.data.version,
        lines: [
          { saleOrderLineId: lineA.id, approvedQuantity: 50 },
          { saleOrderLineId: lineB.id, approvedQuantity: 80 },
        ],
      })
      .expect(200);

    const allocationA = approved.body.data.lines.find((l: { id: string }) => l.id === lineA.id).allocations[0];
    const allocationB = approved.body.data.lines.find((l: { id: string }) => l.id === lineB.id).allocations[0];

    const factoryToken = await createFactoryUserToken(outrightStock.factoryId);
    const factoryDispatch = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: approved.body.data.id,
        lines: [
          { saleOrderLineId: lineA.id, stockAllocationId: allocationA.id, packedQuantity: 50 },
          { saleOrderLineId: lineB.id, stockAllocationId: allocationB.id, packedQuantity: 80 },
        ],
      })
      .expect(201);
    const factoryDispatchLineA = factoryDispatch.body.data.lines.find((l: { saleOrderLineId: string }) => l.saleOrderLineId === lineA.id);
    const factoryDispatchLineB = factoryDispatch.body.data.lines.find((l: { saleOrderLineId: string }) => l.saleOrderLineId === lineB.id);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatch.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        expectedVersion: factoryDispatch.body.data.version,
        cartonNumber: 'C1',
        lines: [
          { factoryDispatchLineId: factoryDispatchLineA.id, quantity: 50 },
          { factoryDispatchLineId: factoryDispatchLineB.id, quantity: 80 },
        ],
      })
      .expect(200);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatch.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: factoryDispatch.body.data.version + 1 })
      .expect(200);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: approved.body.data.id, factoryDispatchIds: [factoryDispatch.body.data.id] })
      .expect(201);
    const dispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);
    await confirmErveDispatchDelivery(app, merchToken, dispatch.body.data.id, dispatch.body.data.version, [
      { saleOrderLineId: lineA.id, receivedQuantity: 50 },
      { saleOrderLineId: lineB.id, receivedQuantity: 80 },
    ]);

    // Both lines get an invoice handoff — total invoiced movement is 130.
    const handoffs = await prisma.invoiceHandoff.findMany({ where: { erveDispatchId: dispatch.body.data.id } });
    expect(handoffs).toHaveLength(2);
    const byLine = new Map(handoffs.map((h) => [h.saleOrderLineId, h]));
    expect(byLine.get(lineA.id)!.quantity).toBe(50);
    expect(byLine.get(lineB.id)!.quantity).toBe(80);
    expect(handoffs.every((h) => h.status === 'PENDING_TALLY')).toBe(true);
    const totalInvoiced = handoffs.reduce((sum, h) => sum + h.quantity, 0);
    expect(totalInvoiced).toBe(130);

    // The Dispatch detail view surfaces the invoice status for both lines,
    // plus the SALE_RETURN-only commercial (Actual Sale) position layered on top.
    const detail = await request(app)
      .get(`/erve-dispatches/${dispatch.body.data.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(detail.body.data.invoiceHandoffs).toHaveLength(2);
    const outrightHandoffView = detail.body.data.invoiceHandoffs.find((h: { saleOrderLineId: string }) => h.saleOrderLineId === lineA.id);
    const saleReturnHandoffView = detail.body.data.invoiceHandoffs.find((h: { saleOrderLineId: string }) => h.saleOrderLineId === lineB.id);
    expect(outrightHandoffView.purchaseMode).toBe('OUTRIGHT');
    expect(outrightHandoffView.quantity).toBe(50);
    expect(saleReturnHandoffView.purchaseMode).toBe('SALE_RETURN');
    expect(saleReturnHandoffView.quantity).toBe(80);

    expect(detail.body.data.saleOrReturnLines).toHaveLength(1);
    expect(detail.body.data.saleOrReturnLines[0].dispatchedQuantity).toBe(80);
    expect(detail.body.data.saleOrReturnLines[0].receivedQuantity).toBe(80);
    expect(detail.body.data.saleOrReturnLines[0].actualSoldQuantity).toBe(0);
    expect(detail.body.data.saleOrReturnLines[0].remainingWithDistributor).toBe(80);
  });

  it("Purchase Mode is resolved from the receiving SaleOrderLine's own commercial PO, not the physical StockAllocation source PO — cross-distributor reassignment never changes it", async () => {
    // Distributor A's own commercial line is SALE_RETURN, but its approved
    // quantity is entirely sourced (MERCHANDISER_REASSIGNMENT) from
    // Distributor B's OUTRIGHT-tagged released stock.
    const lineA = await createPurchaseOrderLineSize({ purchaseMode: 'SALE_RETURN', orderedQuantity: 40 });
    const stockB = await createReleasedQaStock({ styleId: lineA.styleId, sizeId: lineA.sizeId, quantity: 40, purchaseMode: 'OUTRIGHT' });
    const distributorAToken = await createDistributorToken(lineA.distributorId);

    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${distributorAToken}`)
      .send({ distributorId: lineA.distributorId, soDate: '2026-06-30', lines: [{ purchaseOrderLineSizeId: lineA.purchaseOrderLineSizeId, requestedQuantity: 40 }] })
      .expect(201);
    const submitted = await request(app)
      .post(`/sale-orders/${created.body.data.id}/actions/submit`)
      .set('Authorization', `Bearer ${distributorAToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: created.body.data.version })
      .expect(200);
    const line = submitted.body.data.lines[0];

    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const approved = await request(app)
      .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: submitted.body.data.version,
        lines: [
          {
            saleOrderLineId: line.id,
            approvedQuantity: 40,
            sourcing: [{ qaReleaseLineId: stockB.qaReleaseLineId, quantity: 40, reason: 'cross-distributor test reassignment' }],
          },
        ],
      })
      .expect(200);
    const allocation = approved.body.data.lines[0].allocations[0];
    expect(allocation.allocationSource).toBe('MERCHANDISER_REASSIGNMENT');

    const factoryToken = await createFactoryUserToken(stockB.factoryId);
    const factoryDispatch = await packAndFinalize(factoryToken, approved.body.data.id, line.id, allocation.id, 40);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: approved.body.data.id, factoryDispatchIds: [factoryDispatch.id] })
      .expect(201);
    const dispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const handoff = await prisma.invoiceHandoff.findFirstOrThrow({ where: { erveDispatchId: dispatch.body.data.id } });
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    const res = await request(app)
      .get(`/invoice-handoffs/${handoff.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    // Receiving line's OWN commercial PO (A's, SALE_RETURN) wins — the
    // physical source PO's OUTRIGHT mode is irrelevant to this determination.
    expect(res.body.data.purchaseMode).toBe('SALE_RETURN');
    expect(res.body.data.distributor.id).toBe(lineA.distributorId);
  });
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

describe('Invoice Handoff — Sale Order physical/financial separation', () => {
  it('Sale Order becomes FULFILLED independent of invoice handoff status (OUTRIGHT)', async () => {
    const { fixture, dispatch, handoffId, accountantToken } = await dispatchFixture(20, 'OUTRIGHT');
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('FULFILLED');

    const handoff = await prisma.invoiceHandoff.findUniqueOrThrow({ where: { id: handoffId } });
    expect(handoff.status).toBe('PENDING_TALLY');
    expect(dispatch.status).toBe('DISPATCHED');

    await request(app)
      .patch(`/invoice-handoffs/${handoffId}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-012', tallyInvoiceDate: '2026-07-15' })
      .expect(200);

    const orderAfter = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(orderAfter.status).toBe('FULFILLED');
  });

  it('Sale Order becomes FULFILLED for SALE_RETURN even while actual sold = 0 (physical fulfilment is independent of commercial sell-through)', async () => {
    const { fixture } = await dispatchFixture(100, 'SALE_RETURN');
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('FULFILLED');
  });
});
