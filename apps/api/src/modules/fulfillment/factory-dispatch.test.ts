import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  createTwoBatchApprovedSaleOrder,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function packingQueue(token: string, factoryId?: string) {
  return request(app)
    .get('/factory-dispatches/packing-queue')
    .query(factoryId ? { factoryId } : {})
    .set('Authorization', `Bearer ${token}`);
}

function createDispatch(token: string, body: object) {
  return request(app).post('/factory-dispatches').set('Authorization', `Bearer ${token}`).send(body);
}

describe('Factory Packing Queue — Stage 1 scoping/authorization', () => {
  it('shows a FACTORY_USER only Dispatch Order lines at its own mapped Factory', async () => {
    const orderA = await createSingleFactoryApprovedSaleOrder(app, 60);
    await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryAToken = await createFactoryUserToken(orderA.stock.factoryId);

    const res = await packingQueue(factoryAToken).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].saleOrderLineId).toBe(orderA.saleOrderLineId);
    expect(res.body.data[0].allocatedQuantity).toBe(60);
    expect(res.body.data[0].remainingQuantity).toBe(60);
  });

  it('does not show a FACTORY_USER another Factory\'s Dispatch Order line', async () => {
    const orderA = await createSingleFactoryApprovedSaleOrder(app, 60);
    const orderB = await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryBToken = await createFactoryUserToken(orderB.stock.factoryId);

    const res = await packingQueue(factoryBToken).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].saleOrderLineId).toBe(orderB.saleOrderLineId);
    expect(res.body.data[0].allocatedQuantity).toBe(40);
    expect(
      res.body.data.some((row: { saleOrderLineId: string }) => row.saleOrderLineId === orderA.saleOrderLineId),
    ).toBe(false);
  });

  it('forbids DISTRIBUTOR from accessing the packing queue', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app);
    await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${fixture.distributorToken}`)
      .expect(403);
  });

  it('forbids ACCOUNTANT from Factory Dispatch mutation', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await createDispatch(accountantToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 5 }],
    }).expect(403);
  });

  it('forbids QA_USER from packing', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await createDispatch(qaToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 5 }],
    }).expect(403);
  });

  it('does not grant MERCHANDISER Factory packing mutation rights (view/follow-up only)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    await createDispatch(fixture.merchToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 5 }],
    }).expect(403);
  });
});

describe('Factory Dispatch — packing creation and ceilings', () => {
  it('lets a FACTORY_USER pack allocated quantity for its own Factory', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const res = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 30 }],
    }).expect(201);

    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.factory.id).toBe(fixture.stock.factoryId);
    expect(res.body.data.totalPackedQuantity).toBe(30);
    expect(res.body.data.factoryDispatchNumber).toMatch(/^EIFD\//);
  });

  it('reuses the SAME packing root across progressive packing calls (one Dispatch Order -> one FactoryDispatch)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const first = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 20 }],
    }).expect(201);
    const second = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 30 }],
    }).expect(201);

    expect(first.body.data.id).toBe(second.body.data.id);
    expect(second.body.data.totalPackedQuantity).toBe(50);

    const queue = await packingQueue(factoryToken).expect(200);
    expect(queue.body.data).toHaveLength(0); // fully packed (20 + 30 == 50)

    const dispatchCount = await prisma.factoryDispatch.count({ where: { saleOrderId: fixture.saleOrder.id } });
    expect(dispatchCount).toBe(1);
  });

  it('cannot pack beyond the Dispatch Order line quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 40 }],
    }).expect(201);

    await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 20 }],
    }).expect(409);
  });

  it('cannot pack another Factory\'s Dispatch Order', async () => {
    const orderA = await createSingleFactoryApprovedSaleOrder(app, 60);
    const orderB = await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryATokenForCrossCheck = await createFactoryUserToken(orderA.stock.factoryId);

    await createDispatch(factoryATokenForCrossCheck, {
      saleOrderId: orderB.saleOrder.id,
      lines: [{ saleOrderLineId: orderB.saleOrderLineId, packedQuantity: 10 }],
    }).expect(403);
  });

  it('auto-distributes packed quantity across multiple Job Orders\' stock at the same Factory without exposing the split', async () => {
    const fixture = await createTwoBatchApprovedSaleOrder(app, 60, 40);
    const factoryToken = await createFactoryUserToken(fixture.factoryId);

    const res = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 100 }],
    }).expect(201);

    expect(res.body.data.factory.id).toBe(fixture.factoryId);
    expect(res.body.data.totalPackedQuantity).toBe(100);
    // Auto-distributed across two internal allocations without the Factory
    // ever selecting either — both lines exist under one packing root, but
    // no QaReleaseLine/Job Order identifier is exposed anywhere.
    expect(res.body.data.lines).toHaveLength(2);
    expect(
      res.body.data.lines.reduce((sum: number, l: { packedQuantity: number }) => sum + l.packedQuantity, 0),
    ).toBe(100);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchA.stock.qaReleaseLineId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchB.stock.qaReleaseLineId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchA.stock.jobOrderId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchB.stock.jobOrderId);
  });

  it('a finalized Factory Dispatch becomes immutable (packing/deletion rejected)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 10 }],
    }).expect(201);
    const dispatchId = created.body.data.id;
    const lineId = created.body.data.lines[0].id;

    await request(app)
      .post(`/factory-dispatches/${dispatchId}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 10 }] })
      .expect(200);

    const finalized = await request(app)
      .post(`/factory-dispatches/${dispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(200);
    expect(finalized.body.data.status).toBe('READY_FOR_ERVE');

    await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 1 }],
    }).expect(400);

    await request(app)
      .delete(`/factory-dispatches/${dispatchId}`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: finalized.body.data.version })
      .expect(400);
  });

  it('cannot finalize until carton contents reconcile exactly with packed quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 10 }],
    }).expect(201);
    const dispatchId = created.body.data.id;
    const lineId = created.body.data.lines[0].id;

    await request(app)
      .post(`/factory-dispatches/${dispatchId}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 6 }] })
      .expect(200);

    await request(app)
      .post(`/factory-dispatches/${dispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(400);
  });

  it('cannot finalize until every Dispatch Order line is packed exactly (no partial-fulfilment finalize)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 7 }],
    }).expect(201);
    const lineId = created.body.data.lines[0].id;

    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 7 }] })
      .expect(200);

    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version + 1 })
      .expect(400);
  });
});

describe('Factory Packing Cartons', () => {
  it('stores carton number/details/weight and includes them on the dispatch detail', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 10 }],
    }).expect(201);
    const lineId = created.body.data.lines[0].id;

    const res = await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        expectedVersion: created.body.data.version,
        cartonNumber: 'CTN-001',
        packageDetails: '1 poly bag per unit',
        weight: 12.5,
        lines: [{ factoryDispatchLineId: lineId, quantity: 10 }],
      })
      .expect(200);

    const carton = res.body.data.cartons[0];
    expect(carton.cartonNumber).toBe('CTN-001');
    expect(carton.packageDetails).toBe('1 poly bag per unit');
    expect(carton.weight).toBe('12.5');
    expect(carton.lines).toEqual([expect.objectContaining({ factoryDispatchLineId: lineId, quantity: 10 })]);
  });

  it('carton line quantities reconcile with Factory Dispatch packed quantities (cannot exceed)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 10 }],
    }).expect(201);
    const lineId = created.body.data.lines[0].id;

    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 11 }] })
      .expect(409);
  });

  it('cannot assign the same packed quantity to cartons twice', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const created = await createDispatch(factoryToken, {
      saleOrderId: fixture.saleOrder.id,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 10 }],
    }).expect(201);
    const lineId = created.body.data.lines[0].id;

    const withC1 = await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 7 }] })
      .expect(200);

    // Only 3 units remain uncartoned (10 - 7); requesting 5 more must fail.
    await request(app)
      .post(`/factory-dispatches/${created.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: withC1.body.data.version, cartonNumber: 'C2', lines: [{ factoryDispatchLineId: lineId, quantity: 5 }] })
      .expect(409);
  });
});
