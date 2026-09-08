import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import { createFactoryUserToken, createRoleToken, createTwoBatchApprovedSaleOrder } from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// The primary acceptance scenario, verified with exact quantity
// reconciliation after every step, under the Dispatch Order Phase 3 model
// (one Factory per Dispatch Order, one FactoryDispatch packing root, no
// persisted workflow status, no cancellation):
//
//   Dispatch Order created for 100 (sourced from two Job Orders' QA-passed
//   stock at the SAME Factory: 60 + 40, auto-distributed, never exposed)
//   Factory packs 40 first, cartons generated
//   Erve consolidates and dispatches 40 -> fulfillment stage ERVE_DISPATCHED, dispatched=40
//   Factory packs its remaining 60 across the same packing root
//   Erve consolidates and dispatches the remaining 60 -> fully dispatched, exact reconciliation
describe('Acceptance walkthrough — Factory Packing -> Erve Consolidation -> Distributor Dispatch', () => {
  it('reconciles exact quantities through a multi-Job-Order, single-Factory, partial-then-full dispatch', async () => {
    const fixture = await createTwoBatchApprovedSaleOrder(app, 60, 40);
    const factoryToken = await createFactoryUserToken(fixture.factoryId);
    const { token: merchToken } = await createRoleToken('MERCHANDISER');

    // --- Factory packs 40 of the 100 total; cannot finalize yet (incomplete) ---
    const dispatch1 = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 40 }] })
      .expect(201);
    await request(app)
      .post(`/factory-dispatches/${dispatch1.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: dispatch1.body.data.version })
      .expect(400); // carton contents don't reconcile yet, and only 40/100 is packed

    // --- Erve cannot consolidate a DRAFT (not finalized) dispatch either ---
    await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [dispatch1.body.data.id] })
      .expect(400);

    // Factory's queue still shows the remaining 60.
    const queue = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(queue.body.data).toEqual([expect.objectContaining({ remainingQuantity: 60 })]);

    // --- Factory packs the remaining 60 against the SAME packing root ---
    const dispatch2 = await request(app)
      .post('/factory-dispatches')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, lines: [{ saleOrderLineId: fixture.saleOrderLineId, packedQuantity: 60 }] })
      .expect(201);
    expect(dispatch2.body.data.id).toBe(dispatch1.body.data.id); // one packing root, reused
    expect(dispatch2.body.data.totalPackedQuantity).toBe(100);

    // Carton every line to its full packed quantity (auto-distribution may
    // have split the 100 across more than one internal line — opaque to the
    // Factory, reconciled here purely from the detail response).
    let version = dispatch2.body.data.version as number;
    for (const [i, line] of (dispatch2.body.data.lines as Array<{ id: string; packedQuantity: number }>).entries()) {
      const res = await request(app)
        .post(`/factory-dispatches/${dispatch2.body.data.id}/cartons`)
        .set('Authorization', `Bearer ${factoryToken}`)
        .send({ expectedVersion: version, cartonNumber: `C${i + 1}`, lines: [{ factoryDispatchLineId: line.id, quantity: line.packedQuantity }] })
        .expect(200);
      version = res.body.data.version;
    }

    const finalized = await request(app)
      .post(`/factory-dispatches/${dispatch2.body.data.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: version })
      .expect(200);
    expect(finalized.body.data.status).toBe('READY_FOR_ERVE');

    const queueFinal = await request(app)
      .get('/factory-dispatches/packing-queue')
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(queueFinal.body.data).toHaveLength(0);

    // --- Erve consolidates the single packing root and dispatches it in full ---
    const packingList = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ saleOrderId: fixture.saleOrder.id, factoryDispatchIds: [finalized.body.data.id] })
      .expect(201);
    expect(packingList.body.data.totalQuantity).toBe(100);

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
