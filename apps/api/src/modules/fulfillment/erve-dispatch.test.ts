import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  createTwoFactoryApprovedSaleOrder,
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

describe('Erve Packing List — consolidation', () => {
  it('consolidates a finalized Factory Dispatch into an Erve Packing List', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);

    const res = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.ervePackingListNumber).toMatch(/^EIPL\//);
    expect(res.body.data.sources).toHaveLength(1);
    expect(res.body.data.totalQuantity).toBe(20);
  });

  it('rejects consolidating a DRAFT (not yet finalized) Factory Dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const draft = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.stockAllocationId, packedQuantity: 20 }] })
      .expect(201);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [draft.body.data.id] })
      .expect(400);
  });

  it('cannot consume the same Factory Dispatch twice', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(409);
  });

  it('consolidates finalized dispatches from two different Factories into the same Sale Order\'s packing flow', async () => {
    const fixture = await createTwoFactoryApprovedSaleOrder(app, 60, 40);
    const factoryAToken = await createFactoryUserToken(fixture.factoryA.id);
    const factoryBToken = await createFactoryUserToken(fixture.factoryB.id);
    const dispatchA = await packAndFinalize(factoryAToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.factoryA.stockAllocationId, 60);
    const dispatchB = await packAndFinalize(factoryBToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.factoryB.stockAllocationId, 40);

    const res = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatchA.id, dispatchB.id] })
      .expect(201);

    expect(res.body.data.sources.map((s: { factory: { id: string } }) => s.factory.id).sort()).toEqual(
      [fixture.factoryA.id, fixture.factoryB.id].sort(),
    );
    expect(res.body.data.totalQuantity).toBe(100);
  });

  it('forbids FACTORY_USER from viewing Erve Packing List detail (cross-Factory provenance)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    await request(app)
      .get(`/erve-packing-lists/${packingList.body.data.id}`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(403);
  });
});

describe('Erve Dispatch — physical dispatch and fulfillment', () => {
  it('records an Erve Dispatch from a valid Erve Packing List with required/optional fields', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    const res = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    expect(res.body.data.status).toBe('DISPATCHED');
    expect(res.body.data.erveDispatchNumber).toMatch(/^EIED\//);
    expect(res.body.data.transporter).toBeNull();
    expect(res.body.data.totalQuantity).toBe(20);
  });

  it('cannot dispatch the same Erve packed goods twice', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(409);
  });

  it('full dispatch of the only approved line automatically sets the Sale Order FULFILLED and populates fulfilledAt/fulfilledBy', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('FULFILLED');
    expect(order.fulfilledAt).not.toBeNull();
    expect(order.fulfilledById).not.toBeNull();
  });

  it('partial dispatch across two Factories/packing lists leaves the Sale Order APPROVED until the second dispatch, then FULFILLED', async () => {
    const fixture = await createTwoFactoryApprovedSaleOrder(app, 60, 40);
    const factoryAToken = await createFactoryUserToken(fixture.factoryA.id);
    const factoryBToken = await createFactoryUserToken(fixture.factoryB.id);

    const dispatchA = await packAndFinalize(factoryAToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.factoryA.stockAllocationId, 60);
    const packingListA = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatchA.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingListA.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    let order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('APPROVED');

    const detailAfterFirst = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    expect(detailAfterFirst.body.data.fulfillment.totalDispatchedQuantity).toBe(60);
    expect(detailAfterFirst.body.data.fulfillment.stage).toBe('PARTIALLY_DISPATCHED');

    const dispatchB = await packAndFinalize(factoryBToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.factoryB.stockAllocationId, 40);
    const packingListB = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatchB.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingListB.body.data.id, dispatchDate: '2026-07-02' })
      .expect(201);

    order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
    expect(order.status).toBe('FULFILLED');
  });

  it('updates LR/transport info via the fallback action without disturbing dispatched status/quantities', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);
    const erveDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const updated = await request(app)
      .patch(`/erve-dispatches/${erveDispatch.body.data.id}/lr`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: erveDispatch.body.data.version, lrNumber: 'LR-9981', transporter: 'ABC Logistics' })
      .expect(200);

    expect(updated.body.data.lrNumber).toBe('LR-9981');
    expect(updated.body.data.transporter).toBe('ABC Logistics');
    expect(updated.body.data.status).toBe('DISPATCHED');
    expect(updated.body.data.totalQuantity).toBe(20);
  });

  it('a Distributor can view its own Erve Dispatch but not another distributor\'s', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);
    const erveDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    await request(app)
      .get(`/erve-dispatches/${erveDispatch.body.data.id}`)
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .expect(200);

    const { token: otherDistributorToken } = await createRoleToken('DISTRIBUTOR');
    await request(app)
      .get(`/erve-dispatches/${erveDispatch.body.data.id}`)
      .set('Authorization', `Bearer ${otherDistributorToken}`)
      .expect(403);
  });

  it('forbids DISTRIBUTOR and ACCOUNTANT from consolidating or recording dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(403);

    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(403);
  });

  it('forbids FACTORY_USER from recording the final Distributor dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(403);
  });
});

describe('Inventory integrity through packing/consolidation/dispatch', () => {
  it('never releases StockAllocation through packing, consolidation, or dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const allocation = await prisma.stockAllocation.findUniqueOrThrow({ where: { id: fixture.stockAllocationId } });
    expect(allocation.status).toBe('ACTIVE');

    const releaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({ where: { id: fixture.stock.qaReleaseLineId } });
    expect(releaseLine.quantity).toBe(fixture.stock.quantity);
  });

  it('dispatched quantity never reappears in availability', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.stockAllocationId, 20);
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch.id] })
      .expect(201);
    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-01' })
      .expect(201);

    const eligible = await request(app)
      .get('/sale-orders/eligible-stock')
      .query({ distributorId: fixture.stock.distributorId })
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .expect(200);
    const line = eligible.body.data.find(
      (l: { purchaseOrderLineSizeId: string }) => l.purchaseOrderLineSizeId === fixture.stock.purchaseOrderLineSizeId,
    );
    expect(line.availableQuantity).toBe(0);
  });
});
