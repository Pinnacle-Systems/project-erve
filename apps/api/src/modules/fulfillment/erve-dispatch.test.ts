import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, resetDatabase } from '../../test/helpers.js';
import {
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  ensureStyleFactoryRate,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('Erve Packing List — carton eligibility (Phase 6)', () => {
  it('lists a READY_FOR_ERVE audited carton as eligible', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    const res = await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(dispatch.cartonId);
  });

  it('excludes a DRAFT (not yet finalized) carton', async () => {
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
    const cartonId = draft.body.data.destinations[0].cartons[0].id as string;

    const res = await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(res.body.data.map((c: { id: string }) => c.id)).not.toContain(cartonId);
  });

  it('excludes a carton already consolidated into another Erve Packing List', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    const res = await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(res.body.data.map((c: { id: string }) => c.id)).not.toContain(dispatch.cartonId);
  });

  it('excludes a carton that was retired before its Factory Dispatch finalized', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const first = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C1', destinationId: fixture.saleOrder.destinations[0].id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }] })
      .expect(200);
    const retiredCartonId = first.body.data.destinations[0].cartons[0].id as string;
    const factoryDispatchId = first.body.data.factoryDispatch.id as string;

    const { token: qaToken } = await createRoleToken('QA_USER');
    const audited = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/cartons/${retiredCartonId}/audit`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({})
      .expect(200);
    const retiredCartonVersion = audited.body.data.version as number;

    await request(app)
      .delete(`/factory-dispatches/${factoryDispatchId}/cartons/${retiredCartonId}`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: retiredCartonVersion })
      .expect(200);

    const second = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C2', destinationId: fixture.saleOrder.destinations[0].id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }] })
      .expect(200);
    const activeCartonId = second.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C2').id as string;
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/cartons/${activeCartonId}/audit`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({})
      .expect(200);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: second.body.data.factoryDispatch.version })
      .expect(200);

    const res = await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    const eligibleIds = res.body.data.map((c: { id: string }) => c.id);
    expect(eligibleIds).not.toContain(retiredCartonId);
    expect(eligibleIds).toContain(activeCartonId);
  });
});

describe('Erve Packing List — carton consolidation (Phase 6)', () => {
  it('creates an Erve Packing List from one carton', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    const res = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.ervePackingListNumber).toMatch(/^EIPL\//);
    expect(res.body.data.cartonCount).toBe(1);
    expect(res.body.data.totalQuantity).toBe(20);
    expect(res.body.data.distributor.id).toBe(fixture.stock.distributorId);
  });

  it('consolidates cartons from two different Dispatch Orders and two different Factories at the same destination/Distributor', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, { distributorId: orderA.stock.distributorId, quantity: 15 });
    expect(orderB.stock.factoryId).not.toBe(orderA.stock.factoryId);

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryTokenB, orderB.saleOrder.id, orderB.saleOrderLineId, orderB.saleOrder.destinations[0].id, 15);

    const res = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${orderA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);

    expect(res.body.data.cartonCount).toBe(2);
    expect(res.body.data.totalQuantity).toBe(25);
    expect(res.body.data.sourceFactories).toHaveLength(2);
    expect(res.body.data.sourceDispatchOrders).toHaveLength(2);
  });

  it('derives style/size totals from selected carton contents, not the whole Factory Dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    const detail = await request(app)
      .get(`/erve-packing-lists/${created.body.data.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(detail.body.data.styleSizeSummary).toHaveLength(1);
    expect(detail.body.data.styleSizeSummary[0].quantity).toBe(20);
    expect(detail.body.data.cartons).toHaveLength(1);
    expect(detail.body.data.cartons[0].totalQuantity).toBe(20);
  });

  it('rejects mixed-destination carton selection', async () => {
    // Build ONE Dispatch Order with TWO genuinely different destinations —
    // one carton per destination — using createReleasedQaStock directly
    // (not createApprovedSaleOrder, which would itself consume the stock
    // into a separate Sale Order).
    const stock = await createReleasedQaStock({ quantity: 40 });
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const factoryToken = await createFactoryUserToken(stock.factoryId);
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', 'mixed-destination-fixture')
      .send({
        distributors: [
          {
            clientKey: 'dg1',
            distributorId: stock.distributorId,
            destinations: [
              { clientKey: 'd1', addressLine1: 'Test Address', city: 'Chennai', state: 'TN', country: 'India' },
              { clientKey: 'd2', addressLine1: 'Other Address', city: 'Mumbai', state: 'MH', country: 'India' },
            ],
          },
        ],
        factoryId: stock.factoryId,
        soDate: '2026-06-30',
        lines: [
          { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 },
          { destinationClientKey: 'd2', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 },
        ],
      })
      .expect(201);
    const saleOrder = created.body.data;
    const destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
    const lineA = saleOrder.lines.find((l: { destinationId: string }) => l.destinationId === destinations[0].id);
    const lineB = saleOrder.lines.find((l: { destinationId: string }) => l.destinationId === destinations[1].id);

    const first = await request(app)
      .post(`/sale-orders/${saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C1', destinationId: destinations[0].id, lines: [{ saleOrderLineId: lineA.id, quantity: 20 }] })
      .expect(200);
    const cartonAId = first.body.data.destinations.find((d: { id: string }) => d.id === destinations[0].id).cartons[0].id as string;
    const factoryDispatchId = first.body.data.factoryDispatch.id as string;
    const second = await request(app)
      .post(`/sale-orders/${saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C2', destinationId: destinations[1].id, lines: [{ saleOrderLineId: lineB.id, quantity: 20 }] })
      .expect(200);
    const cartonBId = second.body.data.destinations.find((d: { id: string }) => d.id === destinations[1].id).cartons[0].id as string;

    await ensureStyleFactoryRate(stock.styleId, stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonAId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);
    await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonBId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: second.body.data.factoryDispatch.version })
      .expect(200);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ cartonIds: [cartonAId, cartonBId] })
      .expect(400);
  });

  it('rejects combining cartons for an identical address but different Distributors', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, { quantity: 10 }); // default destination is identical text, but a fresh (different) Distributor
    expect(orderB.stock.distributorId).not.toBe(orderA.stock.distributorId);

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryTokenB, orderB.saleOrder.id, orderB.saleOrderLineId, orderB.saleOrder.destinations[0].id, 10);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${orderA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(409);
  });

  it('rejects a carton already assigned to another Erve Packing List', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(409);
  });

  it('exactly one of two concurrent creations claiming the same carton succeeds', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    const [r1, r2] = await Promise.all([
      request(app).post('/erve-packing-lists').set('Authorization', `Bearer ${fixture.merchToken}`).send({ cartonIds: [dispatch.cartonId] }),
      request(app).post('/erve-packing-lists').set('Authorization', `Bearer ${fixture.merchToken}`).send({ cartonIds: [dispatch.cartonId] }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const memberships = await prisma.factoryPackingCarton.findMany({ where: { id: dispatch.cartonId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.ervePackingListId).not.toBeNull();
  });

  it('forbids DISTRIBUTOR, ACCOUNTANT and FACTORY_USER from creating an Erve Packing List', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(403);

    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(403);

    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(403);
  });
});

describe('Erve Packing List — lifecycle (Phase 6)', () => {
  it('allows adding and removing cartons while OPEN', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const first = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C1', destinationId: fixture.saleOrder.destinations[0].id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }] })
      .expect(200);
    const cartonAId = first.body.data.destinations[0].cartons[0].id as string;
    const factoryDispatchId = first.body.data.factoryDispatch.id as string;
    const second = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C2', destinationId: fixture.saleOrder.destinations[0].id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }] })
      .expect(200);
    const cartonBId = second.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C2').id as string;

    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonAId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);
    await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonBId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: second.body.data.factoryDispatch.version })
      .expect(200);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [cartonAId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    const added = await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/cartons`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [cartonBId] })
      .expect(200);
    expect(added.body.data.cartonCount).toBe(2);

    const removed = await request(app)
      .delete(`/erve-packing-lists/${ervePackingListId}/cartons/${cartonBId}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);
    expect(removed.body.data.cartonCount).toBe(1);

    const cartonAfterRemoval = await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: cartonBId } });
    expect(cartonAfterRemoval.ervePackingListId).toBeNull();
  });

  it('requires at least one carton to finalize', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    await request(app)
      .delete(`/erve-packing-lists/${ervePackingListId}/cartons/${dispatch.cartonId}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(400);
  });

  it('freezes carton membership after finalize — add and remove are both rejected', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    await request(app)
      .delete(`/erve-packing-lists/${ervePackingListId}/cartons/${dispatch.cartonId}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(409);

    const fixture2 = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken2 = await createFactoryUserToken(fixture2.stock.factoryId);
    const dispatch2 = await packAndFinalize(app, factoryToken2, fixture2.saleOrder.id, fixture2.saleOrderLineId, fixture2.saleOrder.destinations[0].id, 10);
    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/cartons`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch2.cartonId] })
      .expect(409);
  });

  it('requires FINALIZED before an Erve Dispatch can be recorded', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: created.body.data.id, dispatchDate: '2026-07-01' })
      .expect(409);
  });

  it('cannot dispatch the same Erve Packing List twice, and rejects carton removal once DISPATCHED', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ ervePackingListId: erveDispatch.ervePackingList.id, dispatchDate: '2026-07-01' })
      .expect(409);

    await request(app)
      .delete(`/erve-packing-lists/${erveDispatch.ervePackingList.id}/cartons/${dispatch.cartonId}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(409);
  });
});

describe('Erve Dispatch — physical dispatch and fulfillment', () => {
  it('records an Erve Dispatch from a finalized Erve Packing List with required/optional fields', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

    const res = await request(app)
      .get(`/erve-dispatches/${erveDispatch.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(res.body.data.status).toBe('DISPATCHED');
    expect(res.body.data.erveDispatchNumber).toMatch(/^EIED\//);
    expect(res.body.data.transporter).toBeNull();
    expect(res.body.data.totalQuantity).toBe(20);
  });

  it("full dispatch of the only line moves the Dispatch Order's fulfillment stage to ERVE_DISPATCHED (no persisted status change)", async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

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
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

    const updated = await request(app)
      .patch(`/erve-dispatches/${erveDispatch.id}/lr`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ expectedVersion: erveDispatch.version, lrNumber: 'LR-9981', transporter: 'ABC Logistics' })
      .expect(200);

    expect(updated.body.data.lrNumber).toBe('LR-9981');
    expect(updated.body.data.transporter).toBe('ABC Logistics');
    expect(updated.body.data.status).toBe('DISPATCHED');
    expect(updated.body.data.totalQuantity).toBe(20);
  });

  it("a Distributor can view its own Erve Dispatch but not another distributor's", async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

    await request(app)
      .get(`/erve-dispatches/${erveDispatch.id}`)
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .expect(200);

    const { token: otherDistributorToken } = await createRoleToken('DISTRIBUTOR');
    await request(app)
      .get(`/erve-dispatches/${erveDispatch.id}`)
      .set('Authorization', `Bearer ${otherDistributorToken}`)
      .expect(403);
  });

  it('forbids FACTORY_USER from recording the final Distributor dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    await request(app)
      .post(`/erve-packing-lists/${created.body.data.id}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ ervePackingListId: created.body.data.id, dispatchDate: '2026-07-01' })
      .expect(403);
  });
});

describe('Inventory integrity through packing/consolidation/dispatch', () => {
  it('never releases StockAllocation through packing, consolidation, or dispatch', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

    const allocation = await prisma.stockAllocation.findUniqueOrThrow({ where: { id: fixture.stockAllocationId } });
    expect(allocation.status).toBe('ACTIVE');

    const releaseLine = await prisma.qaReleaseLine.findUniqueOrThrow({ where: { id: fixture.stock.qaReleaseLineId } });
    expect(releaseLine.quantity).toBe(fixture.stock.quantity);
  });

  it('dispatched quantity never reappears in availability', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);

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
