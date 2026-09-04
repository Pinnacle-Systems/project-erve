import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createSingleFactoryApprovedSaleOrder,
} from '../fulfillment/fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function cancel(token: string, id: string, expectedVersion: number) {
  return request(app)
    .post(`/sale-orders/${id}/actions/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion });
}

describe('Sale Order cancellation — physical fulfillment guards', () => {
  it('still allows cancellation of an APPROVED order with no downstream packing activity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);

    const res = await cancel(fixture.merchToken, fixture.saleOrder.id, fixture.saleOrder.version).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('abandons an editable DRAFT Factory Dispatch on cancellation, and it is not recoverable afterwards', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const draft = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 10 }],
      })
      .expect(201);

    await cancel(fixture.merchToken, fixture.saleOrder.id, fixture.saleOrder.version).expect(200);

    const stillExists = await prisma.factoryDispatch.findUnique({ where: { id: draft.body.data.id } });
    expect(stillExists).toBeNull();
  });

  it('blocks cancellation once a Factory Dispatch has been finalized (READY_FOR_ERVE)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 20 }],
      })
      .expect(201);
    const lineId = created.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 20 }] })
      .expect(200);
    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(200);

    await cancel(fixture.merchToken, fixture.saleOrder.id, fixture.saleOrder.version).expect(400);

    const dispatchStillExists = await prisma.factoryDispatch.findUnique({ where: { id: created.body.data.id } });
    expect(dispatchStillExists).not.toBeNull();
  });

  it('blocks cancellation once any quantity has been physically dispatched to the distributor', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 20 }],
      })
      .expect(201);
    const lineId = created.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 20 }] })
      .expect(200);
    const finalized = await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(200);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [finalized.body.data.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const orderAfterDispatch = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    // Fully dispatched here, so status is already FULFILLED (independently
    // non-cancellable) — the important assertion is that the same guard also
    // fires for a PARTIAL dispatch leaving the order APPROVED, so re-derive
    // that scenario explicitly below rather than relying on this one alone.
    expect(orderAfterDispatch.status).toBe('FULFILLED');
    await cancel(fixture.merchToken, fixture.saleOrder.id, orderAfterDispatch.version).expect(400);
  });

  it('blocks cancellation of a partially-dispatched (still APPROVED) sale order', async () => {
    // 30 approved, only 10 will be dispatched — order stays APPROVED with
    // dispatched < approved, which is exactly the case the READY_FOR_ERVE /
    // ErveDispatch-existence checks must catch independent of full/partial.
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 30);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 10 }],
      })
      .expect(201);
    const lineId = created.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 10 }] })
      .expect(200);
    const finalized = await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(200);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [finalized.body.data.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('APPROVED');
    await cancel(fixture.merchToken, fixture.saleOrder.id, order.version).expect(400);
  });
});
