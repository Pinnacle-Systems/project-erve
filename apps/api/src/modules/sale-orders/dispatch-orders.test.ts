import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestFactory, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function roleToken(roles: Array<'ADMIN' | 'MERCHANDISER' | 'FACTORY_USER' | 'QA_USER' | 'ACCOUNTANT' | 'DISTRIBUTOR' | 'SENIOR_MANAGEMENT'>) {
  const { token } = await createTestUserAndToken({ email: `u-${createId()}@test.local`, password: 'pass', roles });
  return token;
}

function destination(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientKey: 'd1',
    addressLine1: '123 Test Street',
    city: 'Chennai',
    state: 'Tamil Nadu',
    country: 'India',
    ...overrides,
  };
}

function createDispatchOrder(token: string, body: object, idempotencyKey = createId()) {
  return request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

describe('Dispatch Orders — creation is the sole allocation point', () => {
  it('creates a Dispatch Order and immediately reserves pooled stock', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(201);

    expect(res.body.data.saleOrderNumber).toMatch(/^EISO\//);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.isLocked).toBe(false);
    expect(res.body.data.totalQuantity).toBe(20);
    expect(res.body.data.lines[0]).toMatchObject({ quantity: 20, styleId: stock.styleId, sizeId: stock.sizeId });

    const allocations = await prisma.stockAllocation.findMany({ where: { qaReleaseLineId: stock.qaReleaseLineId } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 20, status: 'ACTIVE', allocationSource: 'MERCHANDISER_ALLOCATION' });
  });

  it('rolls back the entire order when pooled stock is insufficient (no partial creation)', async () => {
    const stock = await createReleasedQaStock({ quantity: 10 });
    const merchToken = await roleToken(['MERCHANDISER']);

    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(409);

    expect(await prisma.saleOrder.count()).toBe(0);
    expect(await prisma.stockAllocation.count()).toBe(0);
  });

  it('supports multiple destinations and multiple styles in one Dispatch Order', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ distributorId: stockA.distributorId, factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      distributorId: stockA.distributorId,
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      destinations: [destination({ clientKey: 'd1', city: 'Chennai' }), destination({ clientKey: 'd2', city: 'Coimbatore' })],
      lines: [
        { destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 15 },
        { destinationClientKey: 'd2', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 25 },
      ],
    }).expect(201);

    expect(res.body.data.destinationCount).toBe(2);
    expect(res.body.data.totalQuantity).toBe(40);
  });

  it('rejects a request supplying a line id at create time', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ id: 'not-allowed', destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(400);
  });

  it('never accepts purchaseOrderLineId/jobOrderId/qaReleaseLineId as client input (they are simply ignored/rejected)', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const res = await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      jobOrderId: 'ignored',
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20, qaReleaseLineId: 'ignored' }],
    }).expect(201);
    expect(JSON.stringify(res.body.data)).not.toContain(stock.qaReleaseLineId);
  });

  it('idempotency key replay returns the same Dispatch Order without double-reserving', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const body = {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    };
    const key = createId();
    const first = await createDispatchOrder(merchToken, body, key).expect(201);
    const second = await createDispatchOrder(merchToken, body, key).expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.saleOrder.count()).toBe(1);
  });
});

describe('Dispatch Orders — authorization', () => {
  it('forbids DISTRIBUTOR from creating, viewing, or listing Dispatch Orders', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await roleToken(['DISTRIBUTOR']);
    await createDispatchOrder(distributorToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(403);
    await request(app).get('/sale-orders').set('Authorization', `Bearer ${distributorToken}`).expect(403);
  });

  it('forbids QA_USER from any Dispatch Order access', async () => {
    const qaToken = await roleToken(['QA_USER']);
    await request(app).get('/sale-orders').set('Authorization', `Bearer ${qaToken}`).expect(403);
  });

  it('lets SENIOR_MANAGEMENT and ACCOUNTANT view read-only, but not mutate', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const created = await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);

    const smToken = await roleToken(['SENIOR_MANAGEMENT']);
    await request(app).get(`/sale-orders/${created.body.data.id}`).set('Authorization', `Bearer ${smToken}`).expect(200);
    await createDispatchOrder(smToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 1 }],
    }).expect(403);

    const accountantToken = await roleToken(['ACCOUNTANT']);
    await request(app).get(`/sale-orders/${created.body.data.id}`).set('Authorization', `Bearer ${accountantToken}`).expect(200);
  });

  it('scopes FACTORY_USER to its own mapped Factory for list/detail, and excludes it from audit', async () => {
    const factoryA = await createTestFactory();
    const factoryB = await createTestFactory();
    const stockA = await createReleasedQaStock({ factoryId: factoryA.id, quantity: 20 });
    const stockB = await createReleasedQaStock({ factoryId: factoryB.id, quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const orderA = await createDispatchOrder(merchToken, {
      distributorId: stockA.distributorId,
      factoryId: factoryA.id,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 5 }],
    }).expect(201);
    const orderB = await createDispatchOrder(merchToken, {
      distributorId: stockB.distributorId,
      factoryId: factoryB.id,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 5 }],
    }).expect(201);

    const { userId, token: factoryAToken } = await createTestUserAndToken({
      email: `factory-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({ data: { id: createId(), userId, factoryId: factoryA.id } });

    const list = await request(app).get('/sale-orders').set('Authorization', `Bearer ${factoryAToken}`).expect(200);
    const ids = new Set((list.body.data.items as Array<{ id: string }>).map((i) => i.id));
    expect(ids.has(orderA.body.data.id)).toBe(true);
    expect(ids.has(orderB.body.data.id)).toBe(false);

    await request(app).get(`/sale-orders/${orderA.body.data.id}`).set('Authorization', `Bearer ${factoryAToken}`).expect(200);
    await request(app).get(`/sale-orders/${orderB.body.data.id}`).set('Authorization', `Bearer ${factoryAToken}`).expect(403);
    await request(app).get(`/sale-orders/${orderA.body.data.id}/audit`).set('Authorization', `Bearer ${factoryAToken}`).expect(403);
  });
});

describe('Dispatch Orders — audit trail', () => {
  it('records DISPATCH_ORDER_CREATED with no fake workflow events', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const created = await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);

    const audit = await request(app)
      .get(`/sale-orders/${created.body.data.id}/audit`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(['DISPATCH_ORDER_CREATED']);
  });
});

describe('Dispatch Orders — validation', () => {
  it('rejects a distributor/factory that is not ACTIVE', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    await prisma.factory.update({ where: { id: stock.factoryId }, data: { status: 'INACTIVE' } });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects an orphan destination with no lines', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination({ clientKey: 'd1' }), destination({ clientKey: 'd2', city: 'Madurai' })],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects a duplicate destination/style/size line', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [
        { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 },
        { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 3 },
      ],
    }).expect(400);
  });

  it('does not require an active StyleSize mapping — physical stock remains dispatchable after deactivation', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    await prisma.style.update({ where: { id: stock.styleId }, data: { status: 'INACTIVE' } });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);
  });
});

describe('Dispatch Orders — concurrency (no overallocation, no deadlock)', () => {
  it('two concurrent creates against the same pool with combined demand exceeding availability: exactly one succeeds, no overallocation', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const body = (qty: number) => ({
      distributorId: stock.distributorId,
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: qty }],
    });

    // 70 + 60 = 130 > 100 available — both cannot succeed.
    const [a, b] = await Promise.all([
      createDispatchOrder(merchToken, body(70)),
      createDispatchOrder(merchToken, body(60)),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe(409);

    // The one that succeeded got its FULL requested quantity, not a
    // partial amount — creation is all-or-nothing.
    const totalActive = await prisma.stockAllocation.aggregate({
      where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    const succeededQty = succeeded[0]!.body.data.lines[0].quantity;
    expect(totalActive._sum.quantity).toBe(succeededQty);
    expect([60, 70]).toContain(succeededQty);
    expect(totalActive._sum.quantity!).toBeLessThanOrEqual(100);
  });

  it('two concurrent creates touching two overlapping pool keys in opposite order do not deadlock and both eventually settle', async () => {
    const styleA = await createReleasedQaStock({ quantity: 50 });
    const styleB = await createReleasedQaStock({
      distributorId: styleA.distributorId,
      factoryId: styleA.factoryId,
      quantity: 50,
    });
    const merchToken = await roleToken(['MERCHANDISER']);

    // Order X requests Style A then Style B; Order Y requests Style B then
    // Style A — opposite input order, same two pool keys. The sorted
    // pool-key lock acquisition must serialize these deterministically
    // rather than deadlocking.
    const orderX = {
      distributorId: styleA.distributorId,
      factoryId: styleA.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [
        { destinationClientKey: 'd1', styleId: styleA.styleId, sizeId: styleA.sizeId, quantity: 10 },
        { destinationClientKey: 'd1', styleId: styleB.styleId, sizeId: styleB.sizeId, quantity: 10 },
      ],
    };
    const orderY = {
      distributorId: styleA.distributorId,
      factoryId: styleA.factoryId,
      soDate: '2026-06-30',
      destinations: [destination()],
      lines: [
        { destinationClientKey: 'd1', styleId: styleB.styleId, sizeId: styleB.sizeId, quantity: 15 },
        { destinationClientKey: 'd1', styleId: styleA.styleId, sizeId: styleA.sizeId, quantity: 15 },
      ],
    };

    const results = await Promise.all([createDispatchOrder(merchToken, orderX), createDispatchOrder(merchToken, orderY)]);
    // Plenty of stock for both (50 each pool key, total demand 25 each) —
    // the point of this test is that both requests SETTLE (no hang/deadlock
    // timeout), not that either is rejected.
    expect(results.every((r) => r.status === 201)).toBe(true);
  });
});

