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
  ensureStyleFactoryRate,
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

// Phase 4: cartons are the sole physical packing fact — carton creation is
// keyed by the Dispatch Order (saleOrderId), not a FactoryDispatch id, since
// the packing root may not exist yet (see the Phase 4 plan §2/§5).
function createCarton(
  token: string,
  saleOrderId: string,
  body: { cartonNumber: string; destinationId: string; packageDetails?: string | null; weight?: number | null; lines: Array<{ saleOrderLineId: string; quantity: number }> },
) {
  return request(app).post(`/sale-orders/${saleOrderId}/packing-list/cartons`).set('Authorization', `Bearer ${token}`).send(body);
}

function updateCarton(token: string, factoryDispatchId: string, cartonId: string, body: object) {
  return request(app)
    .patch(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function removeCarton(token: string, factoryDispatchId: string, cartonId: string, expectedVersion: number) {
  return request(app)
    .delete(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion });
}

function confirmAudit(token: string, factoryDispatchId: string, cartonId: string, remarks?: string) {
  return request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}/audit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ remarks: remarks ?? null });
}

function packingList(token: string, saleOrderId: string) {
  return request(app).get(`/sale-orders/${saleOrderId}/packing-list`).set('Authorization', `Bearer ${token}`);
}

function destinationOf(saleOrder: { destinations: Array<{ id: string }> }): string {
  return saleOrder.destinations[0]!.id;
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

  it('forbids ACCOUNTANT from carton creation', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await createCarton(accountantToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 5 }],
    }).expect(403);
  });

  it('forbids QA_USER from packing (view/audit only)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await createCarton(qaToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 5 }],
    }).expect(403);
  });

  it('does not grant MERCHANDISER Factory packing mutation rights (view/follow-up only)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    await createCarton(fixture.merchToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 5 }],
    }).expect(403);
  });
});

describe('Factory Dispatch — carton-first packing creation and ceilings', () => {
  it('lets a FACTORY_USER pack allocated quantity for its own Factory via a carton', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const res = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 30 }],
    }).expect(200);

    expect(res.body.data.factoryDispatch.status).toBe('DRAFT');
    expect(res.body.data.factory.id).toBe(fixture.stock.factoryId);
    expect(res.body.data.factoryDispatch.factoryDispatchNumber).toMatch(/^EIFD\//);
    const line = res.body.data.destinations[0].lines[0];
    expect(line.packedQuantity).toBe(30);
  });

  it('reuses the SAME packing root across progressive carton creation (one Dispatch Order -> one FactoryDispatch)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = destinationOf(fixture.saleOrder);

    const first = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }],
    }).expect(200);
    const second = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 30 }],
    }).expect(200);

    expect(first.body.data.factoryDispatch.id).toBe(second.body.data.factoryDispatch.id);
    expect(second.body.data.destinations[0].lines[0].packedQuantity).toBe(50);

    const queue = await packingQueue(factoryToken).expect(200);
    expect(queue.body.data).toHaveLength(0); // fully packed (20 + 30 == 50)

    const dispatchCount = await prisma.factoryDispatch.count({ where: { saleOrderId: fixture.saleOrder.id } });
    expect(dispatchCount).toBe(1);
  });

  it('cannot pack beyond the Dispatch Order line quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = destinationOf(fixture.saleOrder);

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 40 }],
    }).expect(200);

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }],
    }).expect(409);
  });

  it('cannot pack another Factory\'s Dispatch Order, and does not create its FactoryDispatch root as a side effect', async () => {
    const orderA = await createSingleFactoryApprovedSaleOrder(app, 60);
    const orderB = await createSingleFactoryApprovedSaleOrder(app, 40);
    const factoryATokenForCrossCheck = await createFactoryUserToken(orderA.stock.factoryId);

    await createCarton(factoryATokenForCrossCheck, orderB.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(orderB.saleOrder),
      lines: [{ saleOrderLineId: orderB.saleOrderLineId, quantity: 10 }],
    }).expect(403);

    const dispatchCount = await prisma.factoryDispatch.count({ where: { saleOrderId: orderB.saleOrder.id } });
    expect(dispatchCount).toBe(0);
  });

  it('auto-distributes packed quantity across multiple Job Orders\' stock at the same Factory without exposing the split', async () => {
    const fixture = await createTwoBatchApprovedSaleOrder(app, 60, 40);
    const factoryToken = await createFactoryUserToken(fixture.factoryId);

    const res = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 100 }],
    }).expect(200);

    expect(res.body.data.factory.id).toBe(fixture.factoryId);
    expect(res.body.data.destinations[0].lines[0].packedQuantity).toBe(100);
    // Auto-distributed across two internal StockAllocations without the
    // Factory ever selecting either — the carton itself is one row, never
    // split, and no QaReleaseLine/Job Order identifier is exposed anywhere.
    expect(res.body.data.destinations[0].cartons).toHaveLength(1);
    const attributed = await prisma.factoryDispatchLine.aggregate({
      where: { saleOrderLineId: fixture.saleOrderLineId },
      _sum: { packedQuantity: true },
    });
    expect(attributed._sum.packedQuantity).toBe(100);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchA.stock.qaReleaseLineId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchB.stock.qaReleaseLineId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchA.stock.jobOrderId);
    expect(JSON.stringify(res.body.data)).not.toContain(fixture.batchB.stock.jobOrderId);
  });

  it('a finalized Factory Dispatch becomes immutable (packing/deletion rejected)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(200);

    const finalized = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.factoryDispatch.version })
      .expect(200);
    expect(finalized.body.data.factoryDispatch.status).toBe('READY_FOR_ERVE');

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 1 }],
    }).expect(400);

    await request(app)
      .delete(`/factory-dispatches/${factoryDispatchId}`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: finalized.body.data.factoryDispatch.version })
      .expect(400);
  });

  it('cannot finalize until every Dispatch Order line is packed exactly (no partial-fulfilment finalize)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 7 }],
    }).expect(200);

    const res = await request(app)
      .post(`/factory-dispatches/${created.body.data.factoryDispatch.id}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.factoryDispatch.version })
      .expect(400);
    expect(res.body.error.details.underPackedLines).toHaveLength(1);
    expect(res.body.error.details.cartonsNotAudited).toHaveLength(1);
  });
});

describe('Factory Packing Cartons', () => {
  it('stores carton number/details/weight and includes them on the packing list', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const res = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'CTN-001',
      destinationId: destinationOf(fixture.saleOrder),
      packageDetails: '1 poly bag per unit',
      weight: 12.5,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);

    const carton = res.body.data.destinations[0].cartons[0];
    expect(carton.cartonNumber).toBe('CTN-001');
    expect(carton.packageDetails).toBe('1 poly bag per unit');
    expect(carton.weight).toBe('12.5');
    expect(carton.lines).toEqual([
      expect.objectContaining({ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }),
    ]);
    expect(carton.auditState).toBe('NOT_INSPECTED');
  });

  it('rejects a carton spanning two destinations', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        distributors: [
          {
            clientKey: 'dg1',
            distributorId: stock.distributorId,
            destinations: [
              { clientKey: 'd1', addressLine1: 'Addr 1', city: 'Chennai', state: 'TN', country: 'India' },
              { clientKey: 'd2', addressLine1: 'Addr 2', city: 'Mumbai', state: 'MH', country: 'India' },
            ],
          },
        ],
        factoryId: stock.factoryId,
        soDate: '2026-06-30',
        lines: [
          { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 },
          { destinationClientKey: 'd2', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 30 },
        ],
      })
      .expect(201);
    const factoryToken = await createFactoryUserToken(stock.factoryId);
    const destinations = created.body.data.distributorGroups.flatMap((g: { destinations: Array<{ id: string }> }) => g.destinations);
    const lineD1 = created.body.data.lines.find((l: { destinationId: string }) => l.destinationId === destinations[0].id);
    const lineD2 = created.body.data.lines.find((l: { destinationId: string }) => l.destinationId === destinations[1].id);

    await createCarton(factoryToken, created.body.data.id, {
      cartonNumber: 'C1',
      destinationId: destinations[0].id,
      lines: [
        { saleOrderLineId: lineD1.id, quantity: 5 },
        { saleOrderLineId: lineD2.id, quantity: 5 },
      ],
    }).expect(400);
  });

  it('carton line quantities reconcile with the Dispatch Order line quantity (cannot exceed)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 11 }],
    }).expect(409);
  });

  it('cannot assign the same quantity to cartons twice', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = destinationOf(fixture.saleOrder);

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 7 }],
    }).expect(200);

    // Only 3 units remain uncartoned (10 - 7); requesting 5 more must fail.
    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 5 }],
    }).expect(409);
  });

  it('empty carton cannot be created', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [],
    }).expect(400);
  });

  it('never-audited carton hard-deletes cleanly and reconciles packed totals down', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];

    await removeCarton(factoryToken, factoryDispatchId, carton.id, carton.version).expect(200);

    const remaining = await prisma.factoryPackingCarton.findUnique({ where: { id: carton.id } });
    expect(remaining).toBeNull();
    const attributed = await prisma.factoryDispatchLine.aggregate({
      where: { saleOrderLineId: fixture.saleOrderLineId },
      _sum: { packedQuantity: true },
    });
    expect(attributed._sum.packedQuantity ?? 0).toBe(0);
  });

  it('a no-op carton update does not bump version or invalidate a current audit', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      packageDetails: 'orig',
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];
    await confirmAudit(qaToken, factoryDispatchId, carton.id).expect(200);

    const noop = await updateCarton(factoryToken, factoryDispatchId, carton.id, {
      expectedVersion: carton.version,
      destinationId,
      packageDetails: 'orig',
      weight: null,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);

    const cartonAfter = noop.body.data.destinations[0].cartons[0];
    expect(cartonAfter.version).toBe(carton.version);
    expect(cartonAfter.auditState).toBe('INSPECTED');

    const auditRows = await prisma.factoryPackingCartonAudit.count({ where: { cartonId: carton.id } });
    expect(auditRows).toBe(1);
  });

  it('changing carton contents invalidates its current audit (Needs Reinspection)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 5 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];
    await confirmAudit(qaToken, factoryDispatchId, carton.id).expect(200);

    const updated = await updateCarton(factoryToken, factoryDispatchId, carton.id, {
      expectedVersion: carton.version,
      destinationId,
      weight: null,
      packageDetails: null,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 6 }],
    }).expect(200);

    const cartonAfter = updated.body.data.destinations[0].cartons[0];
    expect(cartonAfter.version).toBe(carton.version + 1);
    expect(cartonAfter.auditState).toBe('NEEDS_REINSPECTION');

    await confirmAudit(qaToken, factoryDispatchId, carton.id).expect(200);
    const reAudited = await packingList(factoryToken, fixture.saleOrder.id).expect(200);
    const finalCarton = reAudited.body.data.destinations[0].cartons.find((c: { id: string }) => c.id === carton.id);
    expect(finalCarton.auditState).toBe('INSPECTED');
  });
});

describe('Packing Audit', () => {
  it('QA_USER confirms an eligible carton and records actor/timestamp/version', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];

    const res = await confirmAudit(qaToken, factoryDispatchId, carton.id, 'looks good').expect(200);
    const cartonAfter = res.body.data;
    expect(cartonAfter.auditState).toBe('INSPECTED');
    expect(cartonAfter.auditHistory).toHaveLength(1);
    expect(cartonAfter.auditHistory[0].remarks).toBe('looks good');
  });

  it('confirming an already-current carton twice is idempotent (no duplicate audit row)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;

    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(200);
    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(200);

    const count = await prisma.factoryPackingCartonAudit.count({ where: { cartonId } });
    expect(count).toBe(1);
  });

  it('FACTORY_USER cannot confirm a Packing Audit', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;

    await confirmAudit(factoryToken, factoryDispatchId, cartonId).expect(403);
  });

  it('ADMIN can view but not confirm a Packing Audit', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: adminToken } = await createRoleToken('ADMIN');

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;

    await request(app).get('/packing-audit/queue').set('Authorization', `Bearer ${adminToken}`).expect(200);
    await confirmAudit(adminToken, factoryDispatchId, cartonId).expect(403);
  });

  it('an empty carton cannot be inspected', async () => {
    // A carton can never actually be created empty (lines.min(1)), so this
    // proves the eligibility check is real by exercising a retired carton
    // instead — retired cartons are excluded from audit eligibility too.
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const cartonId = created.body.data.destinations[0].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(200);
    await removeCarton(factoryToken, factoryDispatchId, cartonId, created.body.data.destinations[0].cartons[0].version).expect(200);

    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(400);
  });
});

describe('Retired cartons', () => {
  it('a carton that was ever audited is retired (not hard-deleted) and excluded from packed totals/finalize/print', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];
    await confirmAudit(qaToken, factoryDispatchId, carton.id).expect(200);

    const removed = await removeCarton(factoryToken, factoryDispatchId, carton.id, carton.version).expect(200);

    expect(removed.body.data.destinations[0].cartons).toHaveLength(0);
    expect(removed.body.data.retiredCartons).toHaveLength(1);
    expect(removed.body.data.destinations[0].lines[0].packedQuantity).toBe(0);

    const stillExists = await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: carton.id } });
    expect(stillExists.retiredAt).not.toBeNull();
    const auditRows = await prisma.factoryPackingCartonAudit.count({ where: { cartonId: carton.id } });
    expect(auditRows).toBe(1); // audit history preserved

    // Finalize should now see this as fully under-packed (retired carton
    // contributes nothing), not as fully packed.
    const finalize = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: removed.body.data.factoryDispatch.version })
      .expect(400);
    expect(finalize.body.error.details.underPackedLines).toHaveLength(1);
  });
});

function patchDispatchOrder(token: string, id: string, body: object) {
  return request(app)
    .patch(`/sale-orders/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send(body);
}

function editBody(
  saleOrder: { version: number; distributorGroups: Array<{ id: string; distributor: { id: string }; destinations: Array<Record<string, unknown>> }> },
  lines: object[],
  version?: number,
) {
  const group = saleOrder.distributorGroups[0]!;
  const destination = group.destinations[0]!;
  return {
    expectedVersion: version ?? saleOrder.version,
    distributors: [
      {
        clientKey: 'dg1',
        id: group.id,
        distributorId: group.distributor.id,
        destinations: [{ clientKey: destination.id as string, id: destination.id, ...destination }],
      },
    ],
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
    const { token: qaToken } = await createRoleToken('QA_USER');
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);

    const packed = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId: destinationOf(fixture.saleOrder),
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 50 }],
    }).expect(200);
    const factoryDispatchId = packed.body.data.factoryDispatch.id;
    const cartonId = packed.body.data.destinations[0].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonId).expect(200);

    const soDetail = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    // Concurrently: (a) increase the Dispatch Order line from 50 to 70
    // (there's pool headroom), and (b) finalize the FactoryDispatch, which
    // is currently exactly fully packed and audited (50/50) and would
    // validly finalize if nothing else changed first.
    const editPromise = patchDispatchOrder(
      fixture.merchToken,
      fixture.saleOrder.id,
      editBody(soDetail.body.data, [
        { id: soDetail.body.data.lines[0].id, destinationClientKey: soDetail.body.data.distributorGroups[0].destinations[0].id, styleId: fixture.stock.styleId, sizeId: fixture.stock.sizeId, quantity: 70 },
      ]),
    );
    const finalizePromise = request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: packed.body.data.factoryDispatch.version });

    const [editRes, finalizeRes] = await Promise.all([editPromise, finalizePromise]);

    const editSucceeded = editRes.status === 200;
    const finalizeSucceeded = finalizeRes.status === 200;
    // Exactly one of the two succeeds — never both, never neither.
    expect(editSucceeded).not.toBe(finalizeSucceeded);

    const dispatchAfter = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: factoryDispatchId } });
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

  it('edit vs DRAFT carton creation: both serialize through the shared lock; committed state always satisfies packed <= Dispatch Order quantity', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 50);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const destinationId = destinationOf(fixture.saleOrder);

    await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 20 }],
    }).expect(200);

    const soDetail = await request(app)
      .get(`/sale-orders/${fixture.saleOrder.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    // Concurrently: (a) reduce the Dispatch Order line from 50 to 30
    // (still above the 20 already packed, so valid in isolation), and (b)
    // pack 15 more via a second carton (20 -> 35, still within the CURRENT
    // 50 ceiling, valid in isolation). Whichever commits first determines
    // whether the other's ceiling check sees 30 or 50 as the ceiling, and
    // whether it sees 20 or 35 as the already-packed floor.
    const editPromise = patchDispatchOrder(
      fixture.merchToken,
      fixture.saleOrder.id,
      editBody(soDetail.body.data, [
        { id: soDetail.body.data.lines[0].id, destinationClientKey: soDetail.body.data.distributorGroups[0].destinations[0].id, styleId: fixture.stock.styleId, sizeId: fixture.stock.sizeId, quantity: 30 },
      ]),
    );
    const packMorePromise = createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 15 }],
    });

    const [editRes, packRes] = await Promise.all([editPromise, packMorePromise]);

    const lineAfter = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: fixture.saleOrderLineId } });
    const totalPacked = await prisma.factoryPackingCartonLine.aggregate({
      where: { saleOrderLineId: fixture.saleOrderLineId },
      _sum: { quantity: true },
    });
    const packedQty = totalPacked._sum.quantity ?? 0;

    // The one universal invariant this test exists to prove: no matter
    // which side won the race, the committed state never lets physical
    // packed quantity exceed the Dispatch Order's own line quantity.
    expect(packedQty).toBeLessThanOrEqual(lineAfter.quantity);

    // Exactly one of the two operations succeeds in this specific scenario
    // (30 < 35 and 30 < 50 mean the loser's ceiling/floor check always
    // fails against the winner's committed state).
    const editSucceeded = editRes.status === 200;
    const packSucceeded = packRes.status === 200;
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

  it('carton mutation vs finalize: never both succeed; committed state stays internally consistent', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 30);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destinationId = destinationOf(fixture.saleOrder);
    await ensureStyleFactoryRate(fixture.stock.styleId, fixture.stock.factoryId);

    const created = await createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C1',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 30 }],
    }).expect(200);
    const factoryDispatchId = created.body.data.factoryDispatch.id;
    const carton = created.body.data.destinations[0].cartons[0];
    await confirmAudit(qaToken, factoryDispatchId, carton.id).expect(200);

    const secondCartonPromise = createCarton(factoryToken, fixture.saleOrder.id, {
      cartonNumber: 'C2',
      destinationId,
      lines: [{ saleOrderLineId: fixture.saleOrderLineId, quantity: 1 }],
    });
    const finalizePromise = request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.factoryDispatch.version });

    const [cartonRes, finalizeRes] = await Promise.all([secondCartonPromise, finalizePromise]);

    // C2 would push packed to 31 > 30 required, so it must fail regardless
    // of ordering; finalize sees exactly 30/30 audited either way.
    expect(cartonRes.status).toBe(409);
    expect(finalizeRes.status).toBe(200);
    const dispatchAfter = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: factoryDispatchId } });
    expect(dispatchAfter.status).toBe('READY_FOR_ERVE');
  });
});

describe('Dispatch Order edit — carton invalidation and mismatch (Phase 4)', () => {
  async function twoDestinationFixture(qtyA: number, qtyB: number) {
    const stock = await createReleasedQaStock({ quantity: qtyA + qtyB });
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        distributors: [
          {
            clientKey: 'dg1',
            distributorId: stock.distributorId,
            destinations: [
              { clientKey: 'd1', addressLine1: 'Addr 1', city: 'Chennai', state: 'TN', country: 'India' },
              { clientKey: 'd2', addressLine1: 'Addr 2', city: 'Mumbai', state: 'MH', country: 'India' },
            ],
          },
        ],
        factoryId: stock.factoryId,
        soDate: '2026-06-30',
        lines: [
          { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: qtyA },
          { destinationClientKey: 'd2', styleId: stock.styleId, sizeId: stock.sizeId, quantity: qtyB },
        ],
      })
      .expect(201);
    const factoryToken = await createFactoryUserToken(stock.factoryId);
    const saleOrder = created.body.data;
    saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
    return { saleOrder, merchToken, factoryToken, stock };
  }

  it('a destination ADDRESS edit invalidates only that destination\'s non-retired cartons, not an unrelated destination\'s', async () => {
    const { saleOrder, merchToken, factoryToken } = await twoDestinationFixture(10, 10);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destA = saleOrder.destinations[0];
    const destB = saleOrder.destinations[1];
    const lineA = saleOrder.lines.find((l: { destinationId: string }) => l.destinationId === destA.id);
    const lineB = saleOrder.lines.find((l: { destinationId: string }) => l.destinationId === destB.id);

    const cartonA = await createCarton(factoryToken, saleOrder.id, {
      cartonNumber: 'CA',
      destinationId: destA.id,
      lines: [{ saleOrderLineId: lineA.id, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = cartonA.body.data.factoryDispatch.id;
    const cartonAId = cartonA.body.data.destinations[0].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonAId).expect(200);

    const cartonB = await createCarton(factoryToken, saleOrder.id, {
      cartonNumber: 'CB',
      destinationId: destB.id,
      lines: [{ saleOrderLineId: lineB.id, quantity: 10 }],
    }).expect(200);
    const cartonBId = cartonB.body.data.destinations[1].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonBId).expect(200);

    // Edit only destination A's address; destination B is round-tripped unchanged.
    const groupId = saleOrder.distributorGroups[0].id as string;
    const distributorId = saleOrder.distributorGroups[0].distributor.id as string;
    await patchDispatchOrder(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      distributors: [
        {
          clientKey: 'dg1',
          id: groupId,
          distributorId,
          destinations: [
            { clientKey: destA.id, id: destA.id, ...destA, addressLine1: 'New Address Line' },
            { clientKey: destB.id, id: destB.id, ...destB },
          ],
        },
      ],
      lines: [
        { id: lineA.id, destinationClientKey: destA.id, styleId: lineA.styleId, sizeId: lineA.sizeId, quantity: lineA.quantity },
        { id: lineB.id, destinationClientKey: destB.id, styleId: lineB.styleId, sizeId: lineB.sizeId, quantity: lineB.quantity },
      ],
    }).expect(200);

    const list = await packingList(factoryToken, saleOrder.id).expect(200);
    const destAAfter = list.body.data.destinations.find((d: { id: string }) => d.id === destA.id);
    const destBAfter = list.body.data.destinations.find((d: { id: string }) => d.id === destB.id);
    expect(destAAfter.cartons[0].auditState).toBe('NEEDS_REINSPECTION');
    expect(destBAfter.cartons[0].auditState).toBe('INSPECTED');
  });

  it('moving a stable line to another destination flags its carton as a destination mismatch, does not auto-move it, and blocks finalize', async () => {
    // Bespoke fixture (not twoDestinationFixture): each destination gets its
    // OWN "keeper" line of a distinct Style/Size that never moves, so the
    // move below targets a key nothing else currently occupies — this
    // avoids the separate, pre-existing "two lines swap destinations with
    // identical Style/Size" transient-unique-constraint hazard in
    // applyLinePlan's naive update ordering (a Phase 3 concern, not this
    // test's), while still exercising the exact Phase 4 carton-mismatch
    // behavior this test is for.
    const stockA = await createReleasedQaStock({ quantity: 10 });
    const stockKeeperA = await createReleasedQaStock({
      quantity: 1,
      distributorId: stockA.distributorId,
      factoryId: stockA.factoryId,
    });
    const stockKeeperB = await createReleasedQaStock({
      quantity: 1,
      distributorId: stockA.distributorId,
      factoryId: stockA.factoryId,
    });
    const { token: merchToken } = await createRoleToken('MERCHANDISER');
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        distributors: [
          {
            clientKey: 'dg1',
            distributorId: stockA.distributorId,
            destinations: [
              { clientKey: 'd1', addressLine1: 'Addr 1', city: 'Chennai', state: 'TN', country: 'India' },
              { clientKey: 'd2', addressLine1: 'Addr 2', city: 'Mumbai', state: 'MH', country: 'India' },
            ],
          },
        ],
        factoryId: stockA.factoryId,
        soDate: '2026-06-30',
        lines: [
          { destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 },
          { destinationClientKey: 'd1', styleId: stockKeeperA.styleId, sizeId: stockKeeperA.sizeId, quantity: 1 },
          { destinationClientKey: 'd2', styleId: stockKeeperB.styleId, sizeId: stockKeeperB.sizeId, quantity: 1 },
        ],
      })
      .expect(201);
    const saleOrder = created.body.data;
    saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
    const factoryToken = await createFactoryUserToken(stockA.factoryId);
    const { token: qaToken } = await createRoleToken('QA_USER');
    const destA = saleOrder.destinations[0];
    const destB = saleOrder.destinations[1];
    const lineA = saleOrder.lines.find((l: { styleId: string }) => l.styleId === stockA.styleId);
    const lineKeeperA = saleOrder.lines.find((l: { styleId: string }) => l.styleId === stockKeeperA.styleId);
    const lineKeeperB = saleOrder.lines.find((l: { styleId: string }) => l.styleId === stockKeeperB.styleId);

    const cartonA = await createCarton(factoryToken, saleOrder.id, {
      cartonNumber: 'CA',
      destinationId: destA.id,
      lines: [{ saleOrderLineId: lineA.id, quantity: 10 }],
    }).expect(200);
    const factoryDispatchId = cartonA.body.data.factoryDispatch.id;
    const cartonAId = cartonA.body.data.destinations[0].cartons[0].id;
    await confirmAudit(qaToken, factoryDispatchId, cartonAId).expect(200);

    // Move lineA from destination A to B; both keeper lines stay put. The
    // Dispatch Order edit itself must remain allowed even though nothing
    // physically packed has changed; only the carton's derived mismatch
    // state changes — cartonA (still assigned to destination A) now
    // disagrees with its content line's new destination.
    await patchDispatchOrder(merchToken, saleOrder.id, {
      expectedVersion: saleOrder.version,
      distributors: [
        {
          clientKey: 'dg1',
          id: saleOrder.distributorGroups[0].id,
          distributorId: saleOrder.distributorGroups[0].distributor.id,
          destinations: [
            { clientKey: destA.id, id: destA.id, ...destA },
            { clientKey: destB.id, id: destB.id, ...destB },
          ],
        },
      ],
      lines: [
        { id: lineA.id, destinationClientKey: destB.id, styleId: lineA.styleId, sizeId: lineA.sizeId, quantity: lineA.quantity },
        {
          id: lineKeeperA.id,
          destinationClientKey: destA.id,
          styleId: lineKeeperA.styleId,
          sizeId: lineKeeperA.sizeId,
          quantity: lineKeeperA.quantity,
        },
        {
          id: lineKeeperB.id,
          destinationClientKey: destB.id,
          styleId: lineKeeperB.styleId,
          sizeId: lineKeeperB.sizeId,
          quantity: lineKeeperB.quantity,
        },
      ],
    }).expect(200);

    const list = await packingList(factoryToken, saleOrder.id).expect(200);
    const cartonAAfter = list.body.data.destinations.find((d: { id: string }) => d.id === destA.id).cartons[0];
    expect(cartonAAfter.destinationId).toBe(destA.id); // never auto-moved
    expect(cartonAAfter.destinationMismatch).toBe(true);
    expect(cartonAAfter.auditState).toBe('NEEDS_REINSPECTION');

    const finalizeAttempt = await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: cartonA.body.data.factoryDispatch.version })
      .expect(400);
    expect(finalizeAttempt.body.error.details.destinationMismatchCartons).toHaveLength(1);
  });
});

describe('Packing List — IDOR (Phase 4 pre-FactoryDispatch read)', () => {
  it('rejects a FACTORY_USER reading another Factory\'s Dispatch Order packing-list before any FactoryDispatch root exists', async () => {
    const orderA = await createSingleFactoryApprovedSaleOrder(app, 20);
    const orderB = await createSingleFactoryApprovedSaleOrder(app, 20);
    const factoryBToken = await createFactoryUserToken(orderB.stock.factoryId);

    await packingList(factoryBToken, orderA.saleOrder.id).expect(403);

    const dispatchCount = await prisma.factoryDispatch.count({ where: { saleOrderId: orderA.saleOrder.id } });
    expect(dispatchCount).toBe(0);
  });

  it('QA_USER cannot use the Dispatch-Order-keyed packing-list endpoint (must use /packing-audit/... instead)', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const { token: qaToken } = await createRoleToken('QA_USER');
    await packingList(qaToken, fixture.saleOrder.id).expect(403);
  });
});
