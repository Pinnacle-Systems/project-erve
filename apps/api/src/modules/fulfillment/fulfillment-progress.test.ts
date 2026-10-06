import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  confirmErveDispatchDelivery as confirmDelivery,
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  ensureStyleFactoryRate,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

// FUL-P1-01: computeDispatchOrderFulfillment used to derive ERVE_DISPATCHED/
// DELIVERED from `erveDispatch.findFirst({ saleOrderId })`, which Phase 6
// carton consolidation can leave null (a dispatch spanning several Dispatch
// Orders) or non-exhaustive (one Dispatch Order split across several Erve
// Dispatches). These tests drive the real packing/consolidation/dispatch/
// delivery HTTP flow and assert the derived stage on GET /sale-orders/:id.

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function getFulfillment(merchToken: string, saleOrderId: string) {
  const res = await request(app)
    .get(`/sale-orders/${saleOrderId}`)
    .set('Authorization', `Bearer ${merchToken}`)
    .expect(200);
  return res.body.data.fulfillment as { stage: string; totalQuantity: number; totalFactoryPackedQuantity: number };
}

/** Packs TWO cartons (quantityA + quantityB) for the same line/destination onto one Factory Dispatch and finalizes it once — needed for split/partial-coverage scenarios that packAndFinalize's single-carton flow can't exercise. */
async function packTwoCartonsAndFinalize(
  app: Express,
  factoryToken: string,
  saleOrderId: string,
  saleOrderLineId: string,
  destinationId: string,
  styleId: string,
  factoryId: string,
  quantityA: number,
  quantityB: number,
) {
  // DEMO-018: finalize blocks on missing carton packing metadata — every
  // carton here needs netWeight/grossWeight/dimensions, not just audited
  // and fully-packed (see factory-dispatch.service.ts's
  // cartonsMissingPackingMetadata blocker).
  const first = await request(app)
    .post(`/sale-orders/${saleOrderId}/packing-list/cartons`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({
      cartonNumber: 'C1',
      destinationId,
      netWeight: 5,
      grossWeight: 6,
      dimensions: '40 x 30 x 20 cm',
      lines: [{ saleOrderLineId, quantity: quantityA }],
    })
    .expect(200);
  const factoryDispatchId = first.body.data.factoryDispatch.id as string;
  const cartonAId = first.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C1').id as string;

  const second = await request(app)
    .post(`/sale-orders/${saleOrderId}/packing-list/cartons`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({
      cartonNumber: 'C2',
      destinationId,
      netWeight: 5,
      grossWeight: 6,
      dimensions: '40 x 30 x 20 cm',
      lines: [{ saleOrderLineId, quantity: quantityB }],
    })
    .expect(200);
  const cartonBId = second.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C2').id as string;

  const { token: qaToken } = await createRoleToken('QA_USER');
  await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonAId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);
  await request(app).post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonBId}/audit`).set('Authorization', `Bearer ${qaToken}`).send({}).expect(200);

  await ensureStyleFactoryRate(styleId, factoryId);
  await request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ expectedVersion: second.body.data.factoryDispatch.version })
    .expect(200);

  return { factoryDispatchId, cartonAId, cartonBId };
}

async function deliverFully(merchToken: string, erveDispatch: { id: string; version: number }, saleOrderLineIds: string[]) {
  const lines = await Promise.all(
    saleOrderLineIds.map(async (saleOrderLineId) => {
      const line = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: saleOrderLineId } });
      return { saleOrderLineId, receivedQuantity: line.quantity };
    }),
  );
  await confirmDelivery(app, merchToken, erveDispatch.id, erveDispatch.version, lines);
}

describe('computeDispatchOrderFulfillment (FUL-P1-01)', () => {
  it('A: simple single-DO/single-dispatch path still derives ERVE_DISPATCHED then DELIVERED', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('FACTORY_DISPATCHED');

    const erveDispatch = await consolidateAndDispatch(app, fixture.merchToken, [dispatch.cartonId]);
    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');

    await deliverFully(fixture.merchToken, erveDispatch, [fixture.saleOrderLineId]);
    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('DELIVERED');
  });

  it('B: two Dispatch Orders consolidated into one Erve Dispatch (saleOrderId null) both derive ERVE_DISPATCHED', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, { distributorId: orderA.stock.distributorId, quantity: 15 });

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryTokenB, orderB.saleOrder.id, orderB.saleOrderLineId, orderB.saleOrder.destinations[0].id, 15);

    const erveDispatch = await consolidateAndDispatch(app, orderA.merchToken, [dispatchA.cartonId, dispatchB.cartonId]);
    expect(await prisma.erveDispatch.findUniqueOrThrow({ where: { id: erveDispatch.id } }).then((d) => d.saleOrderId)).toBeNull();

    expect((await getFulfillment(orderA.merchToken, orderA.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');
    expect((await getFulfillment(orderB.merchToken, orderB.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');
  });

  it('C: the same consolidated (null saleOrderId) dispatch delivered derives DELIVERED for both contributing Dispatch Orders', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, { distributorId: orderA.stock.distributorId, quantity: 15 });

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryTokenB, orderB.saleOrder.id, orderB.saleOrderLineId, orderB.saleOrder.destinations[0].id, 15);

    const erveDispatch = await consolidateAndDispatch(app, orderA.merchToken, [dispatchA.cartonId, dispatchB.cartonId]);
    await deliverFully(orderA.merchToken, erveDispatch, [orderA.saleOrderLineId, orderB.saleOrderLineId]);

    expect((await getFulfillment(orderA.merchToken, orderA.saleOrder.id)).stage).toBe('DELIVERED');
    expect((await getFulfillment(orderB.merchToken, orderB.saleOrder.id)).stage).toBe('DELIVERED');
  });

  it('D: one Dispatch Order split across two Erve Dispatches, both dispatched, derives ERVE_DISPATCHED overall', async () => {
    const fixture = await createApprovedSaleOrder(app, { quantity: 30 });
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { cartonAId, cartonBId } = await packTwoCartonsAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      fixture.stock.styleId,
      fixture.stock.factoryId,
      15,
      15,
    );

    await consolidateAndDispatch(app, fixture.merchToken, [cartonAId], '2026-07-01');
    await consolidateAndDispatch(app, fixture.merchToken, [cartonBId], '2026-07-02');

    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');
  });

  it('E: partial final-dispatch coverage must not overstate ERVE_DISPATCHED', async () => {
    const fixture = await createApprovedSaleOrder(app, { quantity: 30 });
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { cartonAId } = await packTwoCartonsAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      fixture.stock.styleId,
      fixture.stock.factoryId,
      15,
      15,
    );

    // Only cartonA is Erve-dispatched; cartonB stays at the Factory.
    await consolidateAndDispatch(app, fixture.merchToken, [cartonAId]);

    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('FACTORY_DISPATCHED');
  });

  it('F: partial delivery coverage must not overstate DELIVERED', async () => {
    const fixture = await createApprovedSaleOrder(app, { quantity: 30 });
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { cartonAId, cartonBId } = await packTwoCartonsAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      fixture.stock.styleId,
      fixture.stock.factoryId,
      15,
      15,
    );

    const edA = await consolidateAndDispatch(app, fixture.merchToken, [cartonAId], '2026-07-01');
    await consolidateAndDispatch(app, fixture.merchToken, [cartonBId], '2026-07-02'); // left DISPATCHED, not delivered

    const lineQty = await prisma.factoryPackingCartonLine.findFirstOrThrow({ where: { cartonId: cartonAId } });
    await confirmDelivery(app, fixture.merchToken, edA.id, edA.version, [
      { saleOrderLineId: lineQty.saleOrderLineId, receivedQuantity: lineQty.quantity },
    ]);

    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');
  });

  it('G: cross-DO isolation — an undispatched extra carton on DO-B must not affect DO-A, and must not overstate DO-B', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, { distributorId: orderA.stock.distributorId, quantity: 25 });

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const { cartonAId: cartonB1Id, cartonBId: cartonB2Id } = await packTwoCartonsAndFinalize(
      app,
      factoryTokenB,
      orderB.saleOrder.id,
      orderB.saleOrderLineId,
      orderB.saleOrder.destinations[0].id,
      orderB.stock.styleId,
      orderB.stock.factoryId,
      15,
      10,
    );

    // Only DO-A's carton + DO-B's first carton (15) go out together; DO-B's
    // second carton (10) is deliberately left un-consolidated at the Factory.
    await consolidateAndDispatch(app, orderA.merchToken, [dispatchA.cartonId, cartonB1Id]);
    void cartonB2Id;

    expect((await getFulfillment(orderA.merchToken, orderA.saleOrder.id)).stage).toBe('ERVE_DISPATCHED');
    expect((await getFulfillment(orderB.merchToken, orderB.saleOrder.id)).stage).toBe('FACTORY_DISPATCHED');
  });

  it('H: a Dispatch Order with no Erve consolidation yet continues to report its existing pre-Erve stage', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    expect((await getFulfillment(fixture.merchToken, fixture.saleOrder.id)).stage).toBe('FACTORY_DISPATCHED');
  });
});
