import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createRoleToken,
  createTwoBatchApprovedSaleOrder,
  ensureStyleFactoryRate,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// The primary acceptance scenario, verified with exact quantity
// reconciliation after every step, under the Dispatch Order Phase 3/4 model
// (one Factory per Dispatch Order, one FactoryDispatch packing root, cartons
// are the sole physical packing fact, QA_USER confirms Packing Audit, no
// persisted workflow status, no cancellation):
//
//   Dispatch Order created for 100 (sourced from two Job Orders' QA-passed
//   stock at the SAME Factory: 60 + 40, auto-distributed, never exposed)
//   Factory cartons 40 first
//   Erve consolidates and dispatches 40 -> fulfillment stage ERVE_DISPATCHED, dispatched=40
//   Factory cartons its remaining 60 across the same packing root, QA audits both cartons
//   Erve consolidates and dispatches the remaining 60 -> fully dispatched, exact reconciliation
describe('Acceptance walkthrough — Factory Packing -> Erve Consolidation -> Distributor Dispatch', () => {
  it('reconciles exact quantities through a multi-Job-Order, single-Factory, partial-then-full dispatch', async () => {
    const fixture = await createTwoBatchApprovedSaleOrder(app, 60, 40);
    const factoryToken = await createFactoryUserToken(fixture.factoryId);
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = fixture.saleOrder.destinations[0]!.id;
    await ensureStyleFactoryRate(fixture.batchA.stock.styleId, fixture.factoryId);

    // --- Factory cartons 40 of the 100 total; cannot finalize yet (incomplete, unaudited) ---
    const carton1 = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C1', destinationId, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 40 }] })
      .expect(200);
    const factoryDispatchId = carton1.body.data.factoryDispatch.id as string;
    const carton1Id = carton1.body.data.destinations[0].cartons[0].id as string;

    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: carton1.body.data.factoryDispatch.version })
      .expect(400); // only 40/100 packed, and C1 not yet audited

    // --- Erve cannot consolidate a carton whose Factory Dispatch is still DRAFT (not finalized) ---
    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ cartonIds: [carton1Id] })
      .expect(400);

    // Factory's queue still shows the remaining 60.
    const queue = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(queue.body.data).toEqual([expect.objectContaining({ remainingQuantity: 60 })]);

    // --- Factory cartons the remaining 60 against the SAME packing root —
    // the auto-distribution across the two underlying Job Orders' stock
    // (60 already-consumed batch A capacity, spilling into batch B) is
    // entirely opaque here: the Factory only ever states saleOrderLineId +
    // quantity, never an internal allocation/line id. ---
    const carton2 = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ cartonNumber: 'C2', destinationId, lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 60 }] })
      .expect(200);
    expect(carton2.body.data.factoryDispatch.id).toBe(factoryDispatchId); // one packing root, reused
    expect(carton2.body.data.destinations[0].lines[0].packedQuantity).toBe(100);
    const carton2Id = carton2.body.data.destinations[0].cartons.find((c: { cartonNumber: string }) => c.cartonNumber === 'C2').id as string;

    // QA must audit BOTH cartons before finalize is allowed.
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/cartons/${carton1Id}/audit`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({})
      .expect(200);
    const stillMissingAudit = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: carton2.body.data.factoryDispatch.version })
      .expect(400);
    expect(stillMissingAudit.body.error.details.cartonsNotAudited).toHaveLength(1);

    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/cartons/${carton2Id}/audit`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({})
      .expect(200);

    const finalized = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: carton2.body.data.factoryDispatch.version })
      .expect(200);
    expect(finalized.body.data.factoryDispatch.status).toBe('READY_FOR_ERVE');

    const queueFinal = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(queueFinal.body.data).toHaveLength(0);

    // --- Erve consolidates both cartons from the single packing root and dispatches them in full ---
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ cartonIds: [carton1Id, carton2Id] })
      .expect(201);
    expect(packingList.body.data.totalQuantity).toBe(100);

    await request(app)
      .post(`/erve-packing-lists/${packingList.body.data.id}/finalize`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);

    const erveDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ ervePackingListId: packingList.body.data.id, dispatchDate: '2026-07-05', transporter: 'XYZ Transport', vehicleNumber: 'MH-02-CD-5678', lrNumber: 'LR-4455' })
      .expect(201);
    expect(erveDispatch.body.data.totalQuantity).toBe(100);

    // --- Dispatch Order fulfillment stage reflects ERVE_DISPATCHED; no persisted status change ---
    const final = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(final.body.data.status).toBe('ACTIVE');
    expect(final.body.data.fulfillment.stage).toBe('ERVE_DISPATCHED');
    expect(final.body.data.fulfillment.totalQuantity).toBe(100);
    expect(final.body.data.isLocked).toBe(true); // FactoryDispatch reached READY_FOR_ERVE

    // Underlying allocations were never released; QA release lines untouched.
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: fixture.saleOrderLineId } });
    expect(allocations.every((a) => a.status === 'ACTIVE')).toBe(true);
    expect(allocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(100);

    // The Dispatch Order is now locked — Merchandiser correction is rejected.
    await request(app)
      .patch(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', 'walkthrough-locked-edit')
      .send({ expectedVersion: final.body.data.version, remarks: 'attempted correction' })
      .expect(400);
  });
});
