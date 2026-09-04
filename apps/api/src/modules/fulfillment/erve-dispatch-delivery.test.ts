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

/** Builds a Sale Order dispatched (but not yet delivery-confirmed) for `quantity`. */
async function dispatchedFixture(quantity = 100, purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'SALE_RETURN') {
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
  return { fixture, dispatch: dispatch.body.data };
}

describe('Erve Dispatch delivery confirmation', () => {
  it('confirms full receipt: status DELIVERED, deliveryConfirmationSource USER_CONFIRMED, deliveredBy set', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    const res = await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.id, dispatch.version, [
      { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 100 },
    ]);
    expect(res.body.data.status).toBe('DELIVERED');
    expect(res.body.data.deliveryConfirmationSource).toBe('USER_CONFIRMED');
    expect(res.body.data.deliveredBy).toBeTruthy();
    expect(res.body.data.deliveredAt).toBeTruthy();
  });

  it('accepts a partial (short) receipt with remarks and leaves the shortage derivable (dispatched 100, received 95)', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    const res = await confirmErveDispatchDelivery(
      app,
      fixture.merchToken,
      dispatch.id,
      dispatch.version,
      [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 95 }],
      '5 pieces short on delivery',
    );
    expect(res.body.data.status).toBe('DELIVERED');
    expect(res.body.data.deliveryRemarks).toBe('5 pieces short on delivery');
    const line = res.body.data.saleOrReturnLines[0];
    expect(line.dispatchedQuantity).toBe(100);
    expect(line.receivedQuantity).toBe(95);
  });

  it('rejects a short receipt with no remarks', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 95 }] })
      .expect(400);
  });

  it('rejects a zero-total receipt (dispatch stays DISPATCHED)', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 0 }] })
      .expect(400);
    const after = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(after.status).toBe('DISPATCHED');
  });

  it('rejects a received quantity exceeding the dispatched quantity for that line', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 101 }] })
      .expect(400);
  });

  it('cannot confirm delivery twice', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    const first = await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.id, dispatch.version, [
      { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 100 },
    ]);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: first.body.data.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 100 }] })
      .expect(409);
  });

  it('rejects a line set that does not exactly match the dispatched lines', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: createId(), receivedQuantity: 100 }] })
      .expect(400);
  });

  it('rejects a stale expectedVersion', async () => {
    const { fixture, dispatch } = await dispatchedFixture(100);
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/delivery`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: dispatch.version + 1, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 100 }] })
      .expect(409);
  });

  describe('authorization', () => {
    it('allows MERCHANDISER and ADMIN to confirm delivery', async () => {
      const { fixture, dispatch } = await dispatchedFixture(20);
      await confirmErveDispatchDelivery(app, fixture.merchToken, dispatch.id, dispatch.version, [
        { saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 },
      ]);

      const { fixture: fixture2, dispatch: dispatch2 } = await dispatchedFixture(20);
      const { token: adminToken } = await createRoleToken('ADMIN');
      await confirmErveDispatchDelivery(app, adminToken, dispatch2.id, dispatch2.version, [
        { saleOrderLineId: fixture2.saleOrderLineId, receivedQuantity: 20 },
      ]);
    });

    it('forbids FACTORY_USER, DISTRIBUTOR and ACCOUNTANT from confirming delivery', async () => {
      const { fixture, dispatch } = await dispatchedFixture(20);
      const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
      const distributorToken = await createDistributorToken(fixture.stock.distributorId);
      const { token: accountantToken } = await createRoleToken('ACCOUNTANT');

      for (const token of [factoryToken, distributorToken, accountantToken]) {
        await request(app)
          .patch(`/erve-dispatches/${dispatch.id}/delivery`)
          .set('Authorization', `Bearer ${token}`)
          .send({ expectedVersion: dispatch.version, lines: [{ saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 20 }] })
          .expect(403);
      }
    });
  });

  describe('legacy-backfilled dispatches', () => {
    it('a directly-inserted legacy-style row (deliveryConfirmationSource LEGACY_ASSUMED_FULL_RECEIPT, no deliveredBy/At) is usable downstream by Actual Sale reporting', async () => {
      const { fixture, dispatch } = await dispatchedFixture(50);
      // Simulate what the backfill migration does for a pre-existing dispatch,
      // rather than re-running the migration itself.
      await prisma.erveDispatchDeliveryLine.create({
        data: { id: createId(), erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, receivedQuantity: 50 },
      });
      await prisma.erveDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'DELIVERED', deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' },
      });

      const res = await request(app)
        .get(`/erve-dispatches/${dispatch.id}`)
        .set('Authorization', `Bearer ${fixture.merchToken}`)
        .expect(200);
      expect(res.body.data.deliveryConfirmationSource).toBe('LEGACY_ASSUMED_FULL_RECEIPT');
      expect(res.body.data.deliveredBy).toBeNull();
      expect(res.body.data.deliveredAt).toBeNull();

      const distributorToken = await createDistributorToken(fixture.stock.distributorId);
      await request(app)
        .post('/distributor-sales-reports')
        .set('Authorization', `Bearer ${distributorToken}`)
        .send({
          distributorId: fixture.stock.distributorId,
          reportDate: '2026-08-01',
          lines: [{ erveDispatchId: dispatch.id, saleOrderLineId: fixture.saleOrderLineId, quantitySold: 10 }],
        })
        .expect(201);
    });
  });
});
