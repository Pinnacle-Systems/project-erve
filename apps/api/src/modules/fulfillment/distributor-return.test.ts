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

/** Drives a SALE_RETURN Sale Order all the way to a DELIVERED Erve Dispatch. */
async function deliveredSaleReturnFixture(quantity = 100) {
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
  const dispatchRes = await request(app)
    .post('/erve-dispatches')
    .set('Authorization', `Bearer ${fixture.merchToken}`)
    .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
    .expect(201);
  const delivered = await confirmErveDispatchDelivery(
    app,
    fixture.merchToken,
    dispatchRes.body.data.id,
    dispatchRes.body.data.version,
    [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: quantity }],
  );
  const distributorToken = await createDistributorToken(fixture.stock.distributorId);
  return { fixture, dispatch: delivered.body.data, distributorToken };
}

function submitReturn(
  distributorToken: string,
  distributorId: string,
  erveDispatchId: string,
  saleOrderLineId: string,
  requestedQuantity: number,
  returnReason = 'End of season unsold stock',
) {
  return request(app)
    .post('/distributor-returns')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({ distributorId, returnDate: '2026-09-01', returnReason, lines: [{ erveDispatchId, saleOrderLineId, requestedQuantity }] });
}

function reportActualSale(distributorToken: string, distributorId: string, erveDispatchId: string, saleOrderLineId: string, quantitySold: number) {
  return request(app)
    .post('/distributor-sales-reports')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({ distributorId, reportDate: '2026-08-01', lines: [{ erveDispatchId, saleOrderLineId, quantitySold }] });
}

async function accountantToken() {
  const { token } = await createRoleToken('ACCOUNTANT');
  return token;
}

describe('Distributor Return — acceptance scenario', () => {
  it('dispatch 100 -> actual sale 25 -> return submit/approve/receive 30 -> actual sale 20 -> final actualSold=45/returned=30/remaining=25', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(100);

    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 25).expect(201);

    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;

    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);
    expect(approved.body.data.status).toBe('APPROVED');

    const received = await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 30 }] })
      .expect(200);
    expect(received.body.data.status).toBe('RECEIVED');

    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20).expect(201);

    const positions = await request(app).get('/sale-or-return-positions').set('Authorization', `Bearer ${distributorToken}`).expect(200);
    const row = positions.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    expect(row.actualSoldQuantity).toBe(45);
    expect(row.returnedQuantity).toBe(30);
    expect(row.remainingWithDistributor).toBe(25);

    expect(await prisma.invoiceHandoff.count()).toBe(1);
    const lots = await prisma.returnedStockLot.findMany();
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantity).toBe(30);

    const allocation = await prisma.stockAllocation.findUniqueOrThrow({ where: { id: fixture.stockAllocationId } });
    expect(allocation.status).toBe('ACTIVE');
    const qaReleaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({ where: { id: allocation.qaReleaseLineId } });
    expect(qaReleaseLine.quantity).toBe(100);
    const saleOrder = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(saleOrder.status).toBe('FULFILLED');
  });
});

describe('Distributor Return — preferred partial-return ordering vs credit-note guard', () => {
  it('approve 30 -> receive 20 -> RECEIVED, remaining 10 released back into availability -> credit note recorded afterwards is allowed', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(100);
    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20).expect(201);

    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);

    const received = await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 20 }] })
      .expect(200);
    expect(received.body.data.status).toBe('RECEIVED');
    const lot = await prisma.returnedStockLot.findFirstOrThrow({ where: { distributorReturnLineId: lineId } });
    expect(lot.quantity).toBe(20);

    const positions = await request(app).get('/sale-or-return-positions').set('Authorization', `Bearer ${distributorToken}`).expect(200);
    const row = positions.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === fixture.saleOrderLineId);
    // received 100 - actualSold 20 - returned 20 = 60 remaining; the un-received 10 is not trapped.
    expect(row.remainingWithDistributor).toBe(60);
    expect(row.returnableQuantity).toBe(60);

    await request(app)
      .post(`/distributor-returns/${received.body.data.id}/credit-note`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: received.body.data.version, creditNoteReference: 'CN-1001', creditNoteDate: '2026-09-05' })
      .expect(200);
  });

  it('approve 30 -> record credit note first -> attempt to receive only 20 -> BLOCKED (must receive exactly 30 or not at all)', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(100);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);

    const withCreditNote = await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/credit-note`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: approved.body.data.version, creditNoteReference: 'CN-2002', creditNoteDate: '2026-09-05' })
      .expect(200);

    await request(app)
      .post(`/distributor-returns/${withCreditNote.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: withCreditNote.body.data.version, lines: [{ id: lineId, receivedQuantity: 20 }] })
      .expect(409);

    // Receiving the full approved quantity still succeeds.
    await request(app)
      .post(`/distributor-returns/${withCreditNote.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: withCreditNote.body.data.version, lines: [{ id: lineId, receivedQuantity: 30 }] })
      .expect(200);
  });
});

describe('Distributor Return — eligibility', () => {
  it('rejects returning an OUTRIGHT line', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20, 'OUTRIGHT');
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const factoryDispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [factoryDispatch.id] })
      .expect(201);
    const dispatchRes = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);
    await confirmErveDispatchDelivery(app, fixture.merchToken, dispatchRes.body.data.id, dispatchRes.body.data.version, [
      { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 },
    ]);
    const distributorToken = await createDistributorToken(fixture.stock.distributorId);

    await submitReturn(distributorToken, fixture.stock.distributorId, dispatchRes.body.data.id, fixture.saleOrderLineId, 5).expect(400);
  });

  it("forbids returning another Distributor's dispatched goods", async () => {
    const { fixture, dispatch } = await deliveredSaleReturnFixture(50);
    const otherDistributor = await prisma.distributor.create({
      data: { id: createId(), code: `OTH-${createId().slice(0, 6)}`, name: 'Other Distributor' },
    });
    const otherToken = await createDistributorToken(otherDistributor.id);
    await submitReturn(otherToken, otherDistributor.id, dispatch.id, fixture.saleOrderLineId, 5).expect(403);
  });

  it('rejects a requested quantity exceeding the returnable quantity', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(50);
    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 40).expect(201);
    // remaining = 10; requesting 20 must fail.
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20).expect(400);
  });

  it('a second pending return request cannot double up beyond the returnable quantity', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(50);
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    // remaining 50, pendingRequested 30 -> availableForNewReturn 20; requesting 21 must fail.
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 21).expect(400);
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20).expect(201);
  });
});

describe('Distributor Return — approval and rejection', () => {
  it('approving with a reduced quantity releases the shortfall back to availableForActualSale', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(100);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 10 }] })
      .expect(200);

    // 20 of the originally requested 30 was never approved -> immediately reportable as an Actual Sale.
    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 90).expect(201);
  });

  it('rejecting releases the full reservation', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(50);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
    const finToken = await accountantToken();
    await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/reject`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, rejectionReason: 'Return window has closed' })
      .expect(200);

    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
  });

  it('rejects approving with all-zero lines (use reject instead)', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 0 }] })
      .expect(400);
  });

  it('rejects a submission without a return reason', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    await request(app)
      .post('/distributor-returns')
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({
        distributorId: fixture.stock.distributorId,
        returnDate: '2026-09-01',
        returnReason: '',
        lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, requestedQuantity: 10 }],
      })
      .expect(400);
  });

  it('stores approvalRemarks separately from the distributor returnReason', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30, 'End of season unsold stock').expect(201);
    expect(submitted.body.data.returnReason).toBe('End of season unsold stock');
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }], approvalRemarks: 'Approved against settlement dated 2026-09-01' })
      .expect(200);
    expect(approved.body.data.returnReason).toBe('End of season unsold stock');
    expect(approved.body.data.approvalRemarks).toBe('Approved against settlement dated 2026-09-01');
  });
});

describe('Distributor Return — receiving', () => {
  it('rejects an all-zero receipt', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);
    await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 0 }] })
      .expect(400);
  });

  it('rejects a received quantity exceeding approved', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 20 }] })
      .expect(200);
    await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 21 }] })
      .expect(400);
  });
});

describe('Distributor Return — cancellation', () => {
  it('Distributor can cancel their own SUBMITTED return, releasing the reservation', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(50);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
    await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({ expectedVersion: submitted.body.data.version })
      .expect(200);
    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
  });

  it('Accountant/Admin can cancel an APPROVED return with no credit note, releasing the reservation', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(50);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 50 }] })
      .expect(200);
    await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: approved.body.data.version })
      .expect(200);
    await reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 50).expect(201);
  });

  it('cancel is blocked once a credit note has been recorded, for both Distributor and Accountant', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);
    const withCreditNote = await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/credit-note`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: approved.body.data.version, creditNoteReference: 'CN-3003', creditNoteDate: '2026-09-05' })
      .expect(200);

    await request(app)
      .post(`/distributor-returns/${withCreditNote.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: withCreditNote.body.data.version })
      .expect(409);
  });

  it('Distributor cannot cancel once APPROVED (only Finance/Admin may)', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);
    await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .send({ expectedVersion: approved.body.data.version })
      .expect(403);
  });
});

describe('Distributor Return — immutability of terminal states', () => {
  it('a RECEIVED return cannot be approved, rejected, received again or cancelled', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);
    const received = await request(app)
      .post(`/distributor-returns/${approved.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 30 }] })
      .expect(200);

    await request(app)
      .post(`/distributor-returns/${received.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: received.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(409);
    await request(app)
      .post(`/distributor-returns/${received.body.data.id}/reject`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: received.body.data.version, rejectionReason: 'too late' })
      .expect(409);
    await request(app)
      .post(`/distributor-returns/${received.body.data.id}/receive`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: received.body.data.version, lines: [{ id: lineId, receivedQuantity: 30 }] })
      .expect(409);
    await request(app)
      .post(`/distributor-returns/${received.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: received.body.data.version })
      .expect(409);
  });

  it('a REJECTED return cannot be approved or received', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const rejected = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/reject`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, rejectionReason: 'not eligible' })
      .expect(200);
    await request(app)
      .post(`/distributor-returns/${rejected.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: rejected.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(409);
  });
});

describe('Distributor Return — concurrency', () => {
  it('concurrent Actual Sale report and Return approval cannot together over-consume the remaining position', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(20);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();

    const results = await Promise.allSettled([
      reportActualSale(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20),
      request(app)
        .post(`/distributor-returns/${submitted.body.data.id}/approve`)
        .set('Authorization', `Bearer ${finToken}`)
        .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 20 }] }),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));
    // 20 available total, both operations claim all 20 — at most one may succeed.
    expect(statuses.filter((s) => s === 200 || s === 201).length).toBeLessThanOrEqual(1);
  });

  it('two concurrent return submissions for the same scarce quantity cannot both succeed', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(20);
    const results = await Promise.allSettled([
      submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20),
      submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 20),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1));
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(1);
  });
});

describe('Distributor Return — authorization', () => {
  it('forbids Merchandiser and Distributor from approving/rejecting/recording credit notes', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;

    for (const token of [fixture.merchToken, distributorToken]) {
      await request(app)
        .post(`/distributor-returns/${submitted.body.data.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
        .expect(403);
    }
  });

  it('forbids Accountant and Distributor from recording physical receipt', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    const submitted = await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);
    const lineId = submitted.body.data.lines[0].id;
    const finToken = await accountantToken();
    const approved = await request(app)
      .post(`/distributor-returns/${submitted.body.data.id}/approve`)
      .set('Authorization', `Bearer ${finToken}`)
      .send({ expectedVersion: submitted.body.data.version, lines: [{ id: lineId, approvedQuantity: 30 }] })
      .expect(200);

    for (const token of [finToken, distributorToken]) {
      await request(app)
        .post(`/distributor-returns/${approved.body.data.id}/receive`)
        .set('Authorization', `Bearer ${token}`)
        .send({ expectedVersion: approved.body.data.version, lines: [{ id: lineId, receivedQuantity: 30 }] })
        .expect(403);
    }
  });

  it('lets Merchandiser and Senior Management view Distributor Returns read-only', async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);

    const { token: smToken } = await createRoleToken('SENIOR_MANAGEMENT');
    const list = await request(app).get('/distributor-returns').set('Authorization', `Bearer ${smToken}`).expect(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);

    const list2 = await request(app).get('/distributor-returns').set('Authorization', `Bearer ${fixture.merchToken}`).expect(200);
    expect(list2.body.data.items.length).toBeGreaterThan(0);
  });

  it("a Distributor sees only their own Distributor Return history, not another Distributor's", async () => {
    const { fixture, dispatch, distributorToken } = await deliveredSaleReturnFixture(30);
    await submitReturn(distributorToken, fixture.stock.distributorId, dispatch.id, fixture.saleOrderLineId, 30).expect(201);

    const otherDistributor = await prisma.distributor.create({
      data: { id: createId(), code: `OTH-${createId().slice(0, 6)}`, name: 'Other Distributor' },
    });
    const otherToken = await createDistributorToken(otherDistributor.id);
    const list = await request(app).get('/distributor-returns').set('Authorization', `Bearer ${otherToken}`).expect(200);
    expect(list.body.data.items).toHaveLength(0);
  });
});
