import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
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

/** Drives a SALE_RETURN Sale Order all the way to a recorded Erve Dispatch — this already creates one PENDING_TALLY "Dispatch Sale" invoice handoff. */
async function saleReturnDispatchFixture(quantity = 100) {
  const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, 'SALE_RETURN');
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
  const delivered = await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.body.data.id, dispatch.body.data.version, [
    { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: quantity },
  ]);

  const distributorToken = await createDistributorToken(fixture.stock.distributorId);
  const dispatchSaleHandoff = await prisma.invoiceHandoff.findFirstOrThrow({ where: { erveDispatchId: dispatch.body.data.id } });
  return { fixture, distributorToken, dispatch: delivered.body.data, dispatchSaleHandoff };
}

describe('Distributor Sales Reporting (Actual Sale) — Sale-or-Return position', () => {
  it('shows dispatched=100/actualSold=0/remaining=100 immediately after dispatch, and the Dispatch already has ONE PENDING_TALLY invoice handoff for the full 100 (Dispatch Sale)', async () => {
    const { fixture, distributorToken, dispatchSaleHandoff } = await saleReturnDispatchFixture(100);
    const res = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    expect(row).toBeTruthy();
    expect(row.dispatchedQuantity).toBe(100);
    expect(row.actualSoldQuantity).toBe(0);
    expect(row.remainingWithDistributor).toBe(100);

    expect(dispatchSaleHandoff.quantity).toBe(100);
    expect(dispatchSaleHandoff.status).toBe('PENDING_TALLY');
    expect(await prisma.invoiceHandoff.count()).toBe(1);
  });

  it('after an Actual Sale report of 25, position shows actualSold=25/remaining=75, and creates NO new invoice handoff — the original Dispatch Sale handoff is untouched', async () => {
    const { fixture, dispatch, distributorToken, dispatchSaleHandoff } = await saleReturnDispatchFixture(100);
    const submitted = await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 25 }],
      })
      .expect(201);
    expect(submitted.body.data.lines).toHaveLength(1);
    expect(submitted.body.data.lines[0].quantitySold).toBe(25);

    const res = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    expect(row.actualSoldQuantity).toBe(25);
    expect(row.remainingWithDistributor).toBe(75);

    // Required invariant: no second InvoiceHandoff was created by the Actual Sale report.
    expect(await prisma.invoiceHandoff.count()).toBe(1);
    const handoffAfter = await prisma.invoiceHandoff.findUniqueOrThrow({ where: { id: dispatchSaleHandoff.id } });
    expect(handoffAfter.quantity).toBe(100);
    expect(handoffAfter.status).toBe('PENDING_TALLY');
  });

  it('Tally reference recorded against the Dispatch Sale handoff is unaffected by, and unaffected-by-order-of, a later Actual Sale report', async () => {
    const { fixture, dispatch, distributorToken, dispatchSaleHandoff } = await saleReturnDispatchFixture(100);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await request(app)
      .patch(`/invoice-handoffs/${dispatchSaleHandoff.id}/tally-reference`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ expectedVersion: 1, tallyInvoiceNumber: 'INV-SR-DISPATCH', tallyInvoiceDate: '2026-07-02' })
      .expect(200);

    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 25 }],
      })
      .expect(201);

    // Actual Sale reporting after invoicing does not disturb the already-recorded Tally reference or create a second handoff.
    expect(await prisma.invoiceHandoff.count()).toBe(1);
    const handoffAfter = await prisma.invoiceHandoff.findUniqueOrThrow({ where: { id: dispatchSaleHandoff.id } });
    expect(handoffAfter.status).toBe('INVOICED');
    expect(handoffAfter.tallyInvoiceNumber).toBe('INV-SR-DISPATCH');
  });

  it('repeated partial Actual Sale reports accumulate correctly (20 then 15 -> total 35)', async () => {
    const { fixture, dispatch, distributorToken } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 20 }],
      })
      .expect(201);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-10',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 15 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    expect(row.actualSoldQuantity).toBe(35);
    expect(row.remainingWithDistributor).toBe(65);
    // Still exactly one handoff — the original Dispatch Sale — regardless of how many Actual Sale reports were filed.
    expect(await prisma.invoiceHandoff.count()).toBe(1);
  });

  it('a second report of 30 (after 25 already reported) never re-invoices any quantity — no handoff is ever created by reporting', async () => {
    const { fixture, dispatch, distributorToken, dispatchSaleHandoff } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 25 }],
      })
      .expect(201);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-10',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 30 }],
      })
      .expect(201);

    const handoffs = await prisma.invoiceHandoff.findMany();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.id).toBe(dispatchSaleHandoff.id);
    expect(handoffs[0]!.quantity).toBe(100);

    const res = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${distributorToken}`)
      .expect(200);
    const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    expect(row.actualSoldQuantity).toBe(55);
    expect(row.remainingWithDistributor).toBe(45);
  });

  it('rejects a cumulative Actual Sale report that would exceed the dispatched Sale-or-Return quantity', async () => {
    const { fixture, dispatch, distributorToken } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 90 }],
      })
      .expect(201);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-15',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 20 }],
      })
      .expect(400);
  });

  it('rejects reporting sales against an OUTRIGHT line', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20, 'OUTRIGHT');
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const factoryDispatch = await packAndFinalize(
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.stockAllocationId,
      20,
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
    await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.body.data.id, dispatch.body.data.version, [
      { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 },
    ]);
    const distributorToken = await createDistributorToken(fixture.stock.distributorId);

    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.body.data.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(400);
  });

  it('rejects reporting a nonzero quantity', async () => {
    const { fixture, dispatch, distributorToken } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 0 }],
      })
      .expect(400);
  });
});

describe('Distributor Sales Reporting — Sale Order FULFILLED independence', () => {
  it('reporting an Actual Sale does not change SaleOrder.status (already FULFILLED from full physical dispatch)', async () => {
    const { fixture, dispatch, distributorToken } = await saleReturnDispatchFixture(100);
    const before = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(before.status).toBe('FULFILLED');

    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 25 }],
      })
      .expect(201);

    const after = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(after.status).toBe('FULFILLED');
  });
});

describe('Distributor Sales Reporting — authorization', () => {
  it("forbids a Distributor from reporting sales against another Distributor's dispatch", async () => {
    const { fixture, dispatch } = await saleReturnDispatchFixture(100);
    const otherDistributor = await prisma.distributor.create({
      data: { id: createId(), code: `OTH-${createId().slice(0, 6)}`, name: 'Other Distributor' },
    });
    const otherToken = await createDistributorToken(otherDistributor.id);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        distributorId: otherDistributor.id,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(403);
  });

  it('forbids a Distributor from submitting a report claiming to be a different distributorId in the body', async () => {
    const { dispatch, fixture, distributorToken } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: createId(),
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(403);
  });

  it('forbids Merchandiser from submitting a Distributor Sales Report', async () => {
    const { fixture, dispatch } = await saleReturnDispatchFixture(100);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(403);
  });

  it('forbids Accountant from submitting a Distributor Sales Report (Accountant only records Tally references)', async () => {
    const { fixture, dispatch } = await saleReturnDispatchFixture(100);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(403);
  });

  it('lets Merchandiser and Senior Management view Sale-or-Return positions and Distributor Sales Reports', async () => {
    const { fixture, dispatch } = await saleReturnDispatchFixture(100);
    const distributorToken2 = await createDistributorToken(fixture.stock.distributorId);
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${distributorToken2}`)
      .send({
        distributorId: fixture.stock.distributorId,
        reportDate: '2026-08-01',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 5 }],
      })
      .expect(201);

    const { token: smToken } = await createRoleToken('SENIOR_MANAGEMENT');
    const positions = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${smToken}`)
      .expect(200);
    expect(positions.body.data.items.length).toBeGreaterThan(0);

    const reports = await request(app)
      .get('/distributor-sales-reports')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    expect(reports.body.data.items.length).toBeGreaterThan(0);
  });
});
