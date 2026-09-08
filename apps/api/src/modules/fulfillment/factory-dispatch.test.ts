import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, resetDatabase } from '../../test/helpers.js';
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

function patchDispatchOrder(token: string, id: string, body: object) {
  return request(app)
    .patch(`/sale-orders/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send(body);
}

function editBody(saleOrder: { version: number; destinations: Array<Record<string, unknown>> }, lines: object[], version?: number) {
  const destination = saleOrder.destinations[0]!;
  return {
    expectedVersion: version ?? saleOrder.version,
    destinations: [{ clientKey: destination.id as string, id: destination.id, ...destination }],
    lines,
  };
}

// These races protect the exact business rule the Phase 3 review rounds
// spent the most effort defining: "editable while packing, immutable only
// at Factory Dispatch." Both fire two real concurrent transactions against
// the same Postgres database (not mocked locks) and assert the mutually-
// exclusive outcome the shared sale-order-{id} advisory lock guarantees.
describe('Dispatch Order edit vs Factory Dispatch packing/finalize — concurrency races', () => {
  it('edit vs READY_FOR_ERVE: whichever gets the lock first wins; the loser is rejected; never both succeed', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50); // fully consumes a 50-unit pool
    // Extra pooled stock at the SAME Factory+Style+Size, released later —
    // gives headroom for the concurrent increase-to-70 edit below without
    // it failing on stock availability instead of exercising the race.
    await createReleasedQaStock({
      factoryId: fixture.stock.factoryId,
      styleId: fixture.stock.styleId,
      sizeId: fixture.stock.sizeId,
      quantity: 30,
    });
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const packed = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 50 }] })
      .expect(201);
    const lineId = packed.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${packed.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: packed.body.data.version, cartonNumber: 'C1', lines: [{ factoryDispatchLineId: lineId, quantity: 50 }] })
      .expect(200);

    const soDetail = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    // Concurrently: (a) increase the Dispatch Order line from 50 to 70
    // (there's pool headroom), and (b) finalize the FactoryDispatch, which
    // is currently exactly fully packed (50/50) and would validly finalize
    // if nothing else changed first.
    const editPromise = patchDispatchOrder(
      fixture.merchToken,
      fixture.saleOrder.id,
      editBody(soDetail.body.data, [
        { id: soDetail.body.data.lines[0].id, destinationClientKey: soDetail.body.data.destinations[0].id, styleId: fixture.stock.styleId, sizeId: fixture.stock.sizeId, quantity: 70 },
      ]),
    );
    const finalizePromise = request(app)
      .post(`/factory-dispatches/${packed.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: packed.body.data.version + 1 });

    const [editRes, finalizeRes] = await Promise.all([editPromise, finalizePromise]);

    const editSucceeded = editRes.status === 200;
    const finalizeSucceeded = finalizeRes.status === 200;
    // Exactly one of the two succeeds — never both, never neither.
    expect(editSucceeded).not.toBe(finalizeSucceeded);

    const dispatchAfter = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: packed.body.data.id } });
    const lineAfter = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: fixture.saleOrderLineId } });

    if (finalizeSucceeded) {
      // Finalize won the lock first: the order is now locked, so the
      // concurrent edit — even though it started before finalize
      // committed — must have been rejected once it re-checked the lock
      // inside its own critical section.
      expect(dispatchAfter.status).toBe('READY_FOR_ERVE');
      expect(lineAfter.quantity).toBe(50); // edit did not apply
      expect(editRes.status).toBe(400);
    } else {
      // Edit won the lock first: quantity is now 70, but only 50 is
      // physically packed — finalize must re-read that fresh state and
      // reject on the completion invariant (no partial-fulfilment
      // finalize), not finalize against stale packed/quantity figures.
      expect(dispatchAfter.status).toBe('DRAFT');
      expect(lineAfter.quantity).toBe(70);
      expect(finalizeRes.status).toBe(400);
    }

    // Invariant that must hold in the final committed state regardless of
    // which side won: a READY_FOR_ERVE dispatch always exactly matches its
    // Dispatch Order line quantities.
    if (dispatchAfter.status === 'READY_FOR_ERVE') {
      expect(dispatchAfter.factoryDispatchNumber).toBeTruthy();
      expect(lineAfter.quantity).toBe(50);
    }
  });

  it('edit vs DRAFT packing mutation: both serialize through the shared lock; committed state always satisfies packed <= Dispatch Order quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 20 }] })
      .expect(201);

    const soDetail = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    // Concurrently: (a) reduce the Dispatch Order line from 50 to 30
    // (still above the 20 already packed, so valid in isolation), and (b)
    // pack 15 more (20 -> 35, still within the CURRENT 50 ceiling, valid in
    // isolation). Whichever commits first determines whether the other's
    // ceiling check sees 30 or 50 as the ceiling, and whether it sees 20 or
    // 35 as the already-packed floor.
    const editPromise = patchDispatchOrder(
      fixture.merchToken,
      fixture.saleOrder.id,
      editBody(soDetail.body.data, [
        { id: soDetail.body.data.lines[0].id, destinationClientKey: soDetail.body.data.destinations[0].id, styleId: fixture.stock.styleId, sizeId: fixture.stock.sizeId, quantity: 30 },
      ]),
    );
    const packMorePromise = request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 15 }] });

    const [editRes, packRes] = await Promise.all([editPromise, packMorePromise]);

    const lineAfter = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: fixture.saleOrderLineId } });
    const totalPacked = await prisma.factoryDispatchLine.aggregate({
      where: { saleOrderLineId: fixture.saleOrderLineId },
      _sum: { packedQuantity: true },
    });
    const packedQty = totalPacked._sum.packedQuantity ?? 0;

    // The one universal invariant this test exists to prove: no matter
    // which side won the race, the committed state never lets packed
    // quantity exceed the Dispatch Order's own line quantity.
    expect(packedQty).toBeLessThanOrEqual(lineAfter.quantity);

    // Exactly one of the two operations succeeds in this specific scenario
    // (30 < 35 and 30 < 50 mean the loser's ceiling/floor check always
    // fails against the winner's committed state).
    const editSucceeded = editRes.status === 200;
    const packSucceeded = packRes.status === 201;
    expect(editSucceeded).not.toBe(packSucceeded);

    if (editSucceeded) {
      expect(lineAfter.quantity).toBe(30);
      expect(packedQty).toBe(20); // the +15 pack was rejected (20+15=35 > 30)
      expect(packRes.status).toBe(409);
    } else {
      expect(lineAfter.quantity).toBe(50); // the reduce-to-30 edit was rejected
      expect(packedQty).toBe(35); // 20 + 15 committed first
      expect(editRes.status).toBe(400);
    }
  });
});
