import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import { createFactoryUserToken, createRoleToken, createTwoFactoryApprovedSaleOrder } from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// The primary acceptance scenario from the fulfillment spec, verified with
// exact quantity reconciliation after every step:
//
//   Distributor requests 100 -> Merchandiser approves 100
//   Factory A allocation = 60, Factory B allocation = 40
//   Factory A packs 40 first, cartons generated
//   Erve consolidates and dispatches 40 -> SO remains APPROVED, dispatched=40, remaining=60
//   Factory A packs its remaining 20; Factory B packs its 40
//   Erve consolidates and dispatches the remaining 60 -> SO automatically FULFILLED
describe('Acceptance walkthrough — Factory Packing -> Erve Consolidation -> Distributor Dispatch', () => {
  it('reconciles exact quantities through a two-Factory partial-then-full fulfillment', async () => {
    const fixture = await createTwoFactoryApprovedSaleOrder(app, 60, 40);
    const factoryAToken = await createFactoryUserToken(fixture.factoryA.id);
    const factoryBToken = await createFactoryUserToken(fixture.factoryB.id);

    // --- Factory A packs 40 of its 60 allocated units, cartons it, finalizes ---
    const dispatchA1 = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.factoryA.stockAllocationId, packedQuantity: 40 }],
      })
      .expect(201);
    const dispatchA1LineId = dispatchA1.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${dispatchA1.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({ expectedVersion: dispatchA1.body.data.version, cartonNumber: 'A1-C1', lines: [{ factoryDispatchLineId: dispatchA1LineId, quantity: 40 }] })
      .expect(200);
    const finalizedA1 = await request(app)
      .post(`/factory-dispatches/${dispatchA1.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({ expectedVersion: dispatchA1.body.data.version + 1 })
      .expect(200);

    // Factory A's own queue now shows only its remaining 20 units.
    const queueA = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryAToken}`)
      .expect(200);
    expect(queueA.body.data).toEqual([expect.objectContaining({ remainingQuantity: 20 })]);

    // --- Erve consolidates Factory A's first batch and dispatches it ---
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const packingList1 = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [finalizedA1.body.data.id] })
      .expect(201);
    expect(packingList1.body.data.totalQuantity).toBe(40);

    await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ ervePackingListId: packingList1.body.data.id, dispatchDate: '2026-07-01', transporter: 'ABC Logistics', vehicleNumber: 'MH-01-AB-1234' })
      .expect(201);

    // Sale Order remains APPROVED, dispatched=40, remaining=60.
    const afterFirstDispatch = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(afterFirstDispatch.body.data.status).toBe('APPROVED');
    expect(afterFirstDispatch.body.data.fulfillment.totalDispatchedQuantity).toBe(40);
    expect(afterFirstDispatch.body.data.fulfillment.totalApprovedQuantity).toBe(100);
    expect(afterFirstDispatch.body.data.fulfillment.lines[0].remainingToDispatchQuantity).toBe(60);
    expect(afterFirstDispatch.body.data.fulfillment.stage).toBe('PARTIALLY_DISPATCHED');

    // --- Factory A packs its remaining 20 ---
    const dispatchA2 = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.factoryA.stockAllocationId, packedQuantity: 20 }],
      })
      .expect(201);
    const dispatchA2LineId = dispatchA2.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${dispatchA2.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({ expectedVersion: dispatchA2.body.data.version, cartonNumber: 'A2-C1', lines: [{ factoryDispatchLineId: dispatchA2LineId, quantity: 20 }] })
      .expect(200);
    const finalizedA2 = await request(app)
      .post(`/factory-dispatches/${dispatchA2.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryAToken}`)
      .send({ expectedVersion: dispatchA2.body.data.version + 1 })
      .expect(200);

    // Factory A is now fully packed — its queue is empty.
    const queueAFinal = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryAToken}`)
      .expect(200);
    expect(queueAFinal.body.data).toHaveLength(0);

    // --- Factory B packs its full 40 ---
    const dispatchB = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryBToken}`)
      .send({
        saleOrderId: fixture.saleOrder.id,
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, stockAllocationId: fixture.factoryB.stockAllocationId, packedQuantity: 40 }],
      })
      .expect(201);
    const dispatchBLineId = dispatchB.body.data.lines[0].id;
    await request(app)
      .post(`/factory-dispatches/${dispatchB.body.data.id}/cartons`)
      .set('Authorization', `Bearer ${factoryBToken}`)
      .send({ expectedVersion: dispatchB.body.data.version, cartonNumber: 'B-C1', lines: [{ factoryDispatchLineId: dispatchBLineId, quantity: 40 }] })
      .expect(200);
    const finalizedB = await request(app)
      .post(`/factory-dispatches/${dispatchB.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryBToken}`)
      .send({ expectedVersion: dispatchB.body.data.version + 1 })
      .expect(200);

    // --- Erve consolidates the remaining 60 (from both Factories) and dispatches it ---
    const packingList2 = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [finalizedA2.body.data.id, finalizedB.body.data.id] })
      .expect(201);
    expect(packingList2.body.data.totalQuantity).toBe(60);
    expect(packingList2.body.data.sources.map((s: { factory: { id: string } }) => s.factory.id).sort()).toEqual(
      [fixture.factoryA.id, fixture.factoryB.id].sort(),
    );

    const finalDispatch = await request(app)
      .post('/erve-dispatches')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ ervePackingListId: packingList2.body.data.id, dispatchDate: '2026-07-05', transporter: 'XYZ Transport', vehicleNumber: 'MH-02-CD-5678', lrNumber: 'LR-4455' })
      .expect(201);
    expect(finalDispatch.body.data.totalQuantity).toBe(60);

    // --- Sale Order automatically becomes FULFILLED, exact quantities reconcile ---
    const final = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(final.body.data.status).toBe('FULFILLED');
    expect(final.body.data.fulfilledAt).toEqual(expect.any(String));
    expect(final.body.data.fulfilledBy).not.toBeNull();
    expect(final.body.data.fulfillment.totalDispatchedQuantity).toBe(100);
    expect(final.body.data.fulfillment.totalApprovedQuantity).toBe(100);
    expect(final.body.data.fulfillment.lines[0].remainingToDispatchQuantity).toBe(0);
    expect(final.body.data.fulfillment.stage).toBe('DISPATCHED_IN_FULL');
    expect(final.body.data.fulfillment.isLegacyFulfilled).toBe(false);

    // Underlying allocations were never released; QA release lines untouched.
    const allocations = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: fixture.saleOrderLineId } });
    expect(allocations.every((a) => a.status === 'ACTIVE')).toBe(true);
    expect(allocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(100);

    // Cannot be cancelled once fully dispatched.
    await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/actions/cancel`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ expectedVersion: final.body.data.version })
      .expect(400);
  });
});
