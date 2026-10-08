import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  ensureActiveDistributorPricing,
  ensureStyleFactoryRate,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// INV-004 — EIPL Commercial Snapshot: freezes Style MRP and resolved
// Distributor pricing % on the finalized erve_packing_list_commercial_lines
// rows the moment an Erve Packing List transitions OPEN -> FINALIZED (see
// erve-dispatch.service.ts's finalizeErvePackingList/buildCommercialSnapshotLines).
describe('Erve Packing List — commercial snapshot (INV-004)', () => {
  it('persists Style MRP, resolved Distributor %, and the finalized carton quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 500 } });
    const priceList = await ensureActiveDistributorPricing(fixture.stock.distributorId, 60);

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

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.saleOrderLineId).toBe(fixture.saleOrderLineId);
    expect(line.styleId).toBe(fixture.stock.styleId);
    expect(line.quantity).toBe(20);
    expect(line.styleMrp.toNumber()).toBe(500);
    expect(line.distributorPricingPercentage.toNumber()).toBe(60);
    expect(line.priceListId).toBe(priceList.id);
  });

  it('is immune to later Style MRP and Distributor pricing changes', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 500 } });
    const originalPriceList = await ensureActiveDistributorPricing(fixture.stock.distributorId, 60);

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

    // Change both masters after finalization.
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 999 } });
    await prisma.priceList.update({ where: { id: originalPriceList.id }, data: { effectiveTo: new Date('2026-01-01') } });
    await prisma.priceList.create({
      data: {
        id: createId(),
        code: `PL-LATER-${createId()}`,
        name: 'Later price list',
        distributorId: fixture.stock.distributorId,
        percentageOfMrp: 80,
        effectiveFrom: new Date('2026-01-02'),
        status: 'ACTIVE',
      },
    });

    const line = await prisma.ervePackingListCommercialLine.findFirstOrThrow({ where: { ervePackingListId } });
    expect(line.styleMrp.toNumber()).toBe(500);
    expect(line.distributorPricingPercentage.toNumber()).toBe(60);
    expect(line.priceListId).toBe(originalPriceList.id);
  });

  it('resolves the % applicable at the finalization instant among multiple effective-dated price lists', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 200 } });

    // Historical (expired), current, and future price lists for the same Distributor.
    await prisma.priceList.create({
      data: {
        id: createId(),
        code: `PL-HIST-${createId()}`,
        name: 'Historical',
        distributorId: fixture.stock.distributorId,
        percentageOfMrp: 30,
        effectiveFrom: new Date('2025-01-01'),
        effectiveTo: new Date('2025-12-31'),
        status: 'ACTIVE',
      },
    });
    await prisma.priceList.create({
      data: {
        id: createId(),
        code: `PL-CUR-${createId()}`,
        name: 'Current',
        distributorId: fixture.stock.distributorId,
        percentageOfMrp: 55,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-12-31'),
        status: 'ACTIVE',
      },
    });
    await prisma.priceList.create({
      data: {
        id: createId(),
        code: `PL-FUT-${createId()}`,
        name: 'Future',
        distributorId: fixture.stock.distributorId,
        percentageOfMrp: 70,
        effectiveFrom: new Date('2027-01-01'),
        status: 'ACTIVE',
      },
    });

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
    try {
      await request(app)
        .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
        .set('Authorization', `Bearer ${fixture.merchToken}`)
        .expect(200);
    } finally {
      vi.useRealTimers();
    }

    const line = await prisma.ervePackingListCommercialLine.findFirstOrThrow({ where: { ervePackingListId } });
    expect(line.distributorPricingPercentage.toNumber()).toBe(55);
  });

  it('sums quantity across multiple cartons packing the same SaleOrderLine without losing or double-counting', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = fixture.saleOrder.destinations[0].id;

    const first = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        cartonNumber: 'C1',
        destinationId,
        netWeight: 5,
        grossWeight: 6,
        dimensions: '40 x 30 x 20 cm',
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 25 }],
      })
      .expect(200);
    const factoryDispatchId = first.body.data.factoryDispatch.id as string;
    const cartonAId = first.body.data.destinations[0].cartons[0].id as string;

    const second = await request(app)
      .post(`/sale-orders/${fixture.saleOrder.id}/packing-list/cartons`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({
        cartonNumber: 'C2',
        destinationId,
        netWeight: 3,
        grossWeight: 4,
        dimensions: '30 x 20 x 15 cm',
        lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 15 }],
      })
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

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 300 } });
    await ensureActiveDistributorPricing(fixture.stock.distributorId, 40);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [cartonAId, cartonBId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(40);
  });

  it('gives each Style its own correct MRP/pricing snapshot when an Erve Packing List spans multiple styles', async () => {
    const fixtureA = await createApprovedSaleOrder(app, { quantity: 10 });
    const fixtureB = await createApprovedSaleOrder(app, {
      distributorId: fixtureA.stock.distributorId,
      factoryId: fixtureA.stock.factoryId,
      quantity: 15,
    });
    const factoryToken = await createFactoryUserToken(fixtureA.stock.factoryId);

    const dispatchA = await packAndFinalize(app, factoryToken, fixtureA.saleOrder.id, fixtureA.saleOrderLineId, fixtureA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryToken, fixtureB.saleOrder.id, fixtureB.saleOrderLineId, fixtureB.saleOrder.destinations[0].id, 15);

    await prisma.style.update({ where: { id: fixtureA.stock.styleId }, data: { finalMrp: 200 } });
    await prisma.style.update({ where: { id: fixtureB.stock.styleId }, data: { finalMrp: 350 } });
    await ensureActiveDistributorPricing(fixtureA.stock.distributorId, 45);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .expect(200);

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    expect(lines).toHaveLength(2);
    const lineA = lines.find((l) => l.styleId === fixtureA.stock.styleId)!;
    const lineB = lines.find((l) => l.styleId === fixtureB.stock.styleId)!;
    expect(lineA.quantity).toBe(10);
    expect(lineA.styleMrp.toNumber()).toBe(200);
    expect(lineA.distributorPricingPercentage.toNumber()).toBe(45);
    expect(lineB.quantity).toBe(15);
    expect(lineB.styleMrp.toNumber()).toBe(350);
    expect(lineB.distributorPricingPercentage.toNumber()).toBe(45);
  });

  it('fails finalization cleanly (EIPL stays OPEN, no partial snapshot) when no Distributor pricing applies', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    // Deliberately no PriceList created for this Distributor.

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(400);

    const packingList = await prisma.ervePackingList.findUniqueOrThrow({ where: { id: ervePackingListId } });
    expect(packingList.status).toBe('OPEN');
    expect(packingList.finalizedAt).toBeNull();
    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    expect(lines).toHaveLength(0);
  });

  it('rolls back the EIPL status flip AND every commercial line if snapshot persistence fails partway', async () => {
    const fixtureA = await createApprovedSaleOrder(app, { quantity: 10 });
    const fixtureB = await createApprovedSaleOrder(app, {
      distributorId: fixtureA.stock.distributorId,
      factoryId: fixtureA.stock.factoryId,
      quantity: 15,
    });
    const factoryToken = await createFactoryUserToken(fixtureA.stock.factoryId);

    const dispatchA = await packAndFinalize(app, factoryToken, fixtureA.saleOrder.id, fixtureA.saleOrderLineId, fixtureA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryToken, fixtureB.saleOrder.id, fixtureB.saleOrderLineId, fixtureB.saleOrder.destinations[0].id, 15);

    await ensureActiveDistributorPricing(fixtureA.stock.distributorId, 45);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixtureA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);
    const ervePackingListId = created.body.data.id as string;

    // Pre-seed a conflicting row for ONE of the two lines so the eventual
    // createMany inside finalize's transaction hits the
    // @@unique([ervePackingListId, saleOrderLineId]) constraint AFTER the
    // EIPL status has already been flipped to FINALIZED within that same
    // transaction — proving the whole thing rolls back, not just the failing line.
    const priceList = await prisma.priceList.findFirstOrThrow({ where: { distributorId: fixtureA.stock.distributorId, status: 'ACTIVE' } });
    await prisma.ervePackingListCommercialLine.create({
      data: {
        id: createId(),
        ervePackingListId,
        saleOrderLineId: fixtureB.saleOrderLineId,
        styleId: fixtureB.stock.styleId,
        quantity: 999,
        styleMrp: 1,
        distributorPricingPercentage: 1,
        priceListId: priceList.id,
      },
    });

    const res = await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixtureA.merchToken}`);
    expect(res.status).toBeGreaterThanOrEqual(500);

    const packingList = await prisma.ervePackingList.findUniqueOrThrow({ where: { id: ervePackingListId } });
    expect(packingList.status).toBe('OPEN');

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    // Only the pre-seeded row survives — the transaction never added the
    // valid line for the OTHER SaleOrderLine, and never re-touched this one.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(999);
  });

  it('does not re-resolve or rewrite the snapshot on a retried finalize against an already-FINALIZED EIPL', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);

    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 500 } });
    await ensureActiveDistributorPricing(fixture.stock.distributorId, 60);

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

    // Change masters, then retry finalize against the now-FINALIZED EIPL.
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { finalMrp: 999 } });

    await request(app)
      .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(409);

    const lines = await prisma.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.styleMrp.toNumber()).toBe(500);
  });
});
