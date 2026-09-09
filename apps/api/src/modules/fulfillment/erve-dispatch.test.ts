import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('Erve Packing List — consolidation', () => {
  it('consolidates a finalized Factory Dispatch into an Erve Packing List', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

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
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        cartonNumber: 'C1',
        destinationId: fixture.saleOrder.destinations[0].id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }],
      })
      .expect(200);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [draft.body.data.factoryDispatch.id] })
      .expect(400);
  });

  it('cannot consume the same Factory Dispatch twice', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

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

  it('forbids FACTORY_USER from viewing Erve Packing List detail (cross-Factory provenance)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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

  it('full dispatch of the only line moves the Dispatch Order\'s fulfillment stage to ERVE_DISPATCHED (no persisted status change)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    expect(order.status).toBe('ACTIVE'); // Dispatch Order Phase 3: no persisted workflow status change

    const detail = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    expect(detail.body.data.fulfillment.stage).toBe('ERVE_DISPATCHED');
    expect(detail.body.data.fulfillment.totalQuantity).toBe(20);
  });

  it('updates LR/transport info via the fallback action without disturbing dispatched status/quantities', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
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

    const pooled = await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: fixture.stock.factoryId, styleId: fixture.stock.styleId, sizeId: fixture.stock.sizeId })
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    const line = pooled.body.data.find(
      (l: { styleId: string; sizeId: string }) => l.styleId === fixture.stock.styleId && l.sizeId === fixture.stock.sizeId,
    );
    expect(line.availableQuantity).toBe(0);
  });
});
