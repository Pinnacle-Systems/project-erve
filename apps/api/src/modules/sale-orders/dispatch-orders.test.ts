import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestDistributor, createTestFactory, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

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

// One Distributor group per Distributor per Dispatch Order (Correction 8) —
// the request-body builder every test uses in place of the old flat
// {distributorId, destinations} shape.
function distributorGroup(
  distributorId: string,
  destinations: object[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return { clientKey: `dg-${distributorId}`, distributorId, destinations, ...overrides };
}

function createDispatchOrder(token: string, body: object, idempotencyKey = createId()) {
  return request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

function patchDispatchOrder(token: string, id: string, body: object, idempotencyKey = createId()) {
  return request(app)
    .patch(`/sale-orders/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

describe('Dispatch Orders — creation is the sole allocation point', () => {
  it('creates a Dispatch Order and immediately reserves pooled stock', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(201);

    expect(res.body.data.saleOrderNumber).toMatch(/^EISO\//);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.isLocked).toBe(false);
    expect(res.body.data.totalQuantity).toBe(20);
    expect(res.body.data.distributors).toHaveLength(1);
    expect(res.body.data.distributors[0]).toMatchObject({ id: stock.distributorId });
    expect(res.body.data.lines[0]).toMatchObject({ quantity: 20, styleId: stock.styleId, sizeId: stock.sizeId });

    const allocations = await prisma.stockAllocation.findMany({ where: { qaReleaseLineId: stock.qaReleaseLineId } });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 20, status: 'ACTIVE', allocationSource: 'MERCHANDISER_ALLOCATION' });
  });

  it('rolls back the entire order when pooled stock is insufficient (no partial creation)', async () => {
    const stock = await createReleasedQaStock({ quantity: 10 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(409);

    expect(await prisma.saleOrder.count()).toBe(0);
    expect(await prisma.stockAllocation.count()).toBe(0);

    // Phase 3 smoke-check regression: the conflict message must be
    // human-readable (Style Number / Size label), never the raw internal
    // styleId/sizeId ULIDs — those are DB-only traceability, not meant to
    // surface in a user-facing error.
    const style = await prisma.style.findUniqueOrThrow({ where: { id: stock.styleId } });
    const size = await prisma.size.findUniqueOrThrow({ where: { id: stock.sizeId } });
    expect(res.body.error.message).toContain(style.styleNumber);
    expect(res.body.error.message).toContain(size.label);
    expect(res.body.error.message).not.toContain(stock.styleId);
    expect(res.body.error.message).not.toContain(stock.sizeId);
    expect(res.body.error.message).toMatch(/short by 10 unit\(s\)/);
  });

  it('supports multiple destinations and multiple styles in one Dispatch Order', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ distributorId: stockA.distributorId, factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stockA.distributorId, [
          destination({ clientKey: 'd1', city: 'Chennai' }),
          destination({ clientKey: 'd2', city: 'Coimbatore' }),
        ]),
      ],
      lines: [
        { destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 15 },
        { destinationClientKey: 'd2', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 25 },
      ],
    }).expect(201);

    expect(res.body.data.destinationCount).toBe(2);
    expect(res.body.data.totalQuantity).toBe(40);
  });

  it('supports multiple Distributors, one destination each', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stockA.distributorId, [destination({ clientKey: 'a1', city: 'Chennai' })]),
        distributorGroup(stockB.distributorId, [destination({ clientKey: 'b1', city: 'Coimbatore' })]),
      ],
      lines: [
        { destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 12 },
        { destinationClientKey: 'b1', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 18 },
      ],
    }).expect(201);

    expect(res.body.data.distributors).toHaveLength(2);
    expect(res.body.data.distributorGroups).toHaveLength(2);
    expect(res.body.data.totalQuantity).toBe(30);
    const distributorIds = res.body.data.distributors.map((d: { id: string }) => d.id).sort();
    expect(distributorIds).toEqual([stockA.distributorId, stockB.distributorId].sort());
  });

  it('supports multiple Distributors, each with multiple destinations', async () => {
    const stockA = await createReleasedQaStock({ quantity: 100 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 100 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stockA.distributorId, [
          destination({ clientKey: 'a1', city: 'Chennai' }),
          destination({ clientKey: 'a2', city: 'Madurai' }),
        ]),
        distributorGroup(stockB.distributorId, [
          destination({ clientKey: 'b1', city: 'Coimbatore' }),
          destination({ clientKey: 'b2', city: 'Salem' }),
        ]),
      ],
      lines: [
        { destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 },
        { destinationClientKey: 'a2', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 },
        { destinationClientKey: 'b1', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 10 },
        { destinationClientKey: 'b2', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 10 },
      ],
    }).expect(201);

    expect(res.body.data.destinationCount).toBe(4);
    expect(res.body.data.distributorGroups).toHaveLength(2);
    for (const group of res.body.data.distributorGroups) {
      expect(group.destinations).toHaveLength(2);
    }
  });

  it('a mixed OUTRIGHT/SALE_RETURN Dispatch Order persists each Distributor group\'s own Purchase Mode snapshot', async () => {
    const outright = await createReleasedQaStock({ purchaseMode: 'OUTRIGHT', quantity: 50 });
    const saleReturn = await createReleasedQaStock({ factoryId: outright.factoryId, purchaseMode: 'SALE_RETURN', quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: outright.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(outright.distributorId, [destination({ clientKey: 'o1' })]),
        distributorGroup(saleReturn.distributorId, [destination({ clientKey: 's1', city: 'Coimbatore' })]),
      ],
      lines: [
        { destinationClientKey: 'o1', styleId: outright.styleId, sizeId: outright.sizeId, quantity: 10 },
        { destinationClientKey: 's1', styleId: saleReturn.styleId, sizeId: saleReturn.sizeId, quantity: 10 },
      ],
    }).expect(201);

    const groups = res.body.data.distributorGroups as Array<{ distributor: { id: string }; purchaseMode: string }>;
    const outrightGroup = groups.find((g) => g.distributor.id === outright.distributorId);
    const saleReturnGroup = groups.find((g) => g.distributor.id === saleReturn.distributorId);
    expect(outrightGroup?.purchaseMode).toBe('OUTRIGHT');
    expect(saleReturnGroup?.purchaseMode).toBe('SALE_RETURN');
  });

  it('rejects a duplicate Distributor across two groups in the same request', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stock.distributorId, [destination({ clientKey: 'd1' })]),
        distributorGroup(stock.distributorId, [destination({ clientKey: 'd2', city: 'Madurai' })]),
      ],
      lines: [
        { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 },
        { destinationClientKey: 'd2', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 },
      ],
    }).expect(400);
  });

  it('rejects an empty distributors array', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects a duplicate destination clientKey reused across two different Distributor groups', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stockA.distributorId, [destination({ clientKey: 'dup' })]),
        distributorGroup(stockB.distributorId, [destination({ clientKey: 'dup', city: 'Madurai' })]),
      ],
      lines: [{ destinationClientKey: 'dup', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects a request supplying a line id at create time', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ id: 'not-allowed', destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(400);
  });

  it('never accepts purchaseOrderLineId/jobOrderId/qaReleaseLineId as client input (they are simply ignored/rejected)', async () => {
    const stock = await createReleasedQaStock({ quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      jobOrderId: 'ignored',
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20, qaReleaseLineId: 'ignored' }],
    }).expect(201);
    expect(JSON.stringify(res.body.data)).not.toContain(stock.qaReleaseLineId);
  });

  it('idempotency key replay returns the same Dispatch Order without double-reserving', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const body = {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    };
    const key = createId();
    const first = await createDispatchOrder(merchToken, body, key).expect(201);
    const second = await createDispatchOrder(merchToken, body, key).expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.saleOrder.count()).toBe(1);
  });

  it('a newly created Distributor group gets a normal application-generated id, not a migration-style UUID', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);
    const groupId = res.body.data.distributorGroups[0].id as string;
    // ULIDs are 26 Crockford-base32 chars; UUIDs contain hyphens and are 36
    // chars — a cheap, precise-enough discriminator for this regression.
    expect(groupId).toHaveLength(26);
    expect(groupId).not.toContain('-');
  });
});

describe('Dispatch Orders — authorization', () => {
  it('forbids DISTRIBUTOR from creating, viewing, or listing Dispatch Orders', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const distributorToken = await roleToken(['DISTRIBUTOR']);
    await createDispatchOrder(distributorToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
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
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);

    const smToken = await roleToken(['SENIOR_MANAGEMENT']);
    await request(app).get(`/sale-orders/${created.body.data.id}`).set('Authorization', `Bearer ${smToken}`).expect(200);
    await createDispatchOrder(smToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
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
      factoryId: factoryA.id,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stockA.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 5 }],
    }).expect(201);
    const orderB = await createDispatchOrder(merchToken, {
      factoryId: factoryB.id,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stockB.distributorId, [destination()])],
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
  it('records DISPATCH_ORDER_CREATED with no fake workflow events, structured with per-Distributor metadata', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const created = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);

    const audit = await request(app)
      .get(`/sale-orders/${created.body.data.id}/audit`)
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(['DISPATCH_ORDER_CREATED']);
    const raw = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'SaleOrder', action: 'DISPATCH_ORDER_CREATED' } });
    const metadata = raw.metadata as { distributors: Array<{ distributorId: string; purchaseMode: string }> };
    expect(metadata.distributors).toHaveLength(1);
    expect(metadata.distributors[0]).toMatchObject({ distributorId: stock.distributorId });
  });
});

describe('Dispatch Orders — validation', () => {
  it('rejects a distributor/factory that is not ACTIVE', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    await prisma.factory.update({ where: { id: stock.factoryId }, data: { status: 'INACTIVE' } });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects an orphan destination with no lines', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stock.distributorId, [destination({ clientKey: 'd1' }), destination({ clientKey: 'd2', city: 'Madurai' })]),
      ],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });

  it('rejects a duplicate destination/style/size line', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
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
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);
  });

  it('rejects a GSTIN with an invalid format, and accepts a blank one', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination({ gstin: 'not-a-gstin' })])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);

    await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination({ gstin: '' })])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);
  });

  it('accepts and persists a valid GSTIN on a destination', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination({ gstin: '27AAAAA0000A1Z5' })])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(201);
    expect(res.body.data.distributorGroups[0].destinations[0].gstin).toBe('27AAAAA0000A1Z5');
  });
});

describe('Dispatch Orders — concurrency (no overallocation, no deadlock)', () => {
  it('two concurrent creates against the same pool with combined demand exceeding availability: exactly one succeeds, no overallocation', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const body = (qty: number) => ({
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
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
      factoryId: styleA.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(styleA.distributorId, [destination()])],
      lines: [
        { destinationClientKey: 'd1', styleId: styleA.styleId, sizeId: styleA.sizeId, quantity: 10 },
        { destinationClientKey: 'd1', styleId: styleB.styleId, sizeId: styleB.sizeId, quantity: 10 },
      ],
    };
    const orderY = {
      factoryId: styleA.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(styleA.distributorId, [destination()])],
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

  it('pooled demand aggregates across Distributors: combined demand exceeding availability is rejected even when each Distributor alone is within bounds', async () => {
    // A single Factory+Style+Size pool of 100, and a second, unrelated
    // Distributor with no stock of its own — both draw from the same pool
    // in one Dispatch Order. Distributor A requests 60, Distributor B
    // requests 50; combined 110 > 100 available must fail, even though
    // each Distributor's own request is individually well within bounds.
    const stock = await createReleasedQaStock({ quantity: 100 });
    const otherDistributor = await createTestDistributor();
    const merchToken = await roleToken(['MERCHANDISER']);

    const res = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stock.distributorId, [destination({ clientKey: 'a1' })]),
        distributorGroup(otherDistributor.id, [destination({ clientKey: 'b1', city: 'Madurai' })]),
      ],
      lines: [
        { destinationClientKey: 'a1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 60 },
        { destinationClientKey: 'b1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 50 },
      ],
    }).expect(409);
    expect(res.body.error.message).toMatch(/short by 10 unit\(s\)/);
  });
});

describe('Dispatch Orders — editing Distributor groups (Correction 8)', () => {
  it('adds a Distributor group to an existing order, reserving stock only for the new group', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const created = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stockA.distributorId, [destination({ clientKey: 'a1' })])],
      lines: [{ destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 }],
    }).expect(201);
    const orderId = created.body.data.id as string;
    const existingGroupId = created.body.data.distributorGroups[0].id as string;
    const existingDestId = created.body.data.distributorGroups[0].destinations[0].id as string;

    const patched = await patchDispatchOrder(merchToken, orderId, {
      expectedVersion: created.body.data.version,
      distributors: [
        { clientKey: 'existing', id: existingGroupId, distributorId: stockA.distributorId, destinations: [{ ...destination({ clientKey: 'a1' }), id: existingDestId }] },
        distributorGroup(stockB.distributorId, [destination({ clientKey: 'b1', city: 'Madurai' })]),
      ],
      lines: [
        { id: created.body.data.lines[0].id, destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 },
        { destinationClientKey: 'b1', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 15 },
      ],
    }).expect(200);

    expect(patched.body.data.distributorGroups).toHaveLength(2);
    expect(patched.body.data.totalQuantity).toBe(25);
    const bAllocations = await prisma.stockAllocation.findMany({
      where: { saleOrderLine: { destination: { saleOrderDistributor: { distributorId: stockB.distributorId } } }, status: 'ACTIVE' },
    });
    expect(bAllocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(15);
  });

  it('removes a Distributor group with unpacked stock, releasing its allocations and deleting the group', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const created = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(stockA.distributorId, [destination({ clientKey: 'a1' })]),
        distributorGroup(stockB.distributorId, [destination({ clientKey: 'b1', city: 'Madurai' })]),
      ],
      lines: [
        { destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 },
        { destinationClientKey: 'b1', styleId: stockB.styleId, sizeId: stockB.sizeId, quantity: 15 },
      ],
    }).expect(201);
    const orderId = created.body.data.id as string;
    const groupA = created.body.data.distributorGroups.find((g: { distributor: { id: string } }) => g.distributor.id === stockA.distributorId);

    const patched = await patchDispatchOrder(merchToken, orderId, {
      expectedVersion: created.body.data.version,
      distributors: [
        { clientKey: 'a', id: groupA.id, distributorId: stockA.distributorId, destinations: [{ ...destination({ clientKey: 'a1' }), id: groupA.destinations[0].id }] },
      ],
      lines: [{ id: groupA.lines[0].id, destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 }],
    }).expect(200);

    expect(patched.body.data.distributorGroups).toHaveLength(1);
    expect(await prisma.saleOrderDistributor.count({ where: { saleOrderId: orderId, distributorId: stockB.distributorId } })).toBe(0);
    const released = await prisma.stockAllocation.findMany({ where: { qaReleaseLineId: stockB.qaReleaseLineId } });
    expect(released.every((a) => a.status === 'RELEASED')).toBe(true);
  });

  it('rejects changing an existing Distributor group\'s distributorId', async () => {
    const stockA = await createReleasedQaStock({ quantity: 50 });
    const stockB = await createReleasedQaStock({ factoryId: stockA.factoryId, quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const created = await createDispatchOrder(merchToken, {
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stockA.distributorId, [destination({ clientKey: 'a1' })])],
      lines: [{ destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 }],
    }).expect(201);
    const orderId = created.body.data.id as string;
    const groupId = created.body.data.distributorGroups[0].id as string;
    const destId = created.body.data.distributorGroups[0].destinations[0].id as string;

    await patchDispatchOrder(merchToken, orderId, {
      expectedVersion: created.body.data.version,
      distributors: [
        { clientKey: 'a', id: groupId, distributorId: stockB.distributorId, destinations: [{ ...destination({ clientKey: 'a1' }), id: destId }] },
      ],
      lines: [{ id: created.body.data.lines[0].id, destinationClientKey: 'a1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 10 }],
    }).expect(400);
  });

  it('moves an unpacked destination from an OUTRIGHT Distributor to a SALE_RETURN Distributor in one request — same line ids, StockAllocation untouched, audit records both Purchase Modes', async () => {
    const outright = await createReleasedQaStock({ purchaseMode: 'OUTRIGHT', quantity: 50 });
    const saleReturn = await createReleasedQaStock({ factoryId: outright.factoryId, purchaseMode: 'SALE_RETURN', quantity: 50 });
    const merchToken = await roleToken(['MERCHANDISER']);

    const created = await createDispatchOrder(merchToken, {
      factoryId: outright.factoryId,
      soDate: '2026-06-30',
      distributors: [
        distributorGroup(outright.distributorId, [destination({ clientKey: 'a1' })]),
        distributorGroup(saleReturn.distributorId, [destination({ clientKey: 'b1', city: 'Madurai' })]),
      ],
      lines: [
        { destinationClientKey: 'a1', styleId: outright.styleId, sizeId: outright.sizeId, quantity: 10 },
        { destinationClientKey: 'b1', styleId: saleReturn.styleId, sizeId: saleReturn.sizeId, quantity: 5 },
      ],
    }).expect(201);
    const orderId = created.body.data.id as string;
    const outrightGroup = created.body.data.distributorGroups.find((g: { distributor: { id: string } }) => g.distributor.id === outright.distributorId);
    const saleReturnGroup = created.body.data.distributorGroups.find((g: { distributor: { id: string } }) => g.distributor.id === saleReturn.distributorId);
    const movingDestId = outrightGroup.destinations[0].id as string;
    const lineId = outrightGroup.lines[0].id as string;
    const saleReturnLineId = saleReturnGroup.lines[0].id as string;

    const allocationsBefore = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: lineId } });

    const patched = await patchDispatchOrder(merchToken, orderId, {
      expectedVersion: created.body.data.version,
      // The outright group is deliberately OMITTED — it becomes empty once
      // its only destination moves out, and an empty group is invalid
      // (every group needs >=1 destination); dropping a group from the
      // request is how a now-empty group gets deleted (see
      // reconcileDistributorGroups' groupDeleteCandidateIds).
      distributors: [
        {
          clientKey: 'salereturn',
          id: saleReturnGroup.id,
          distributorId: saleReturn.distributorId,
          destinations: [
            { ...destination({ clientKey: 'b1', city: 'Madurai' }), id: saleReturnGroup.destinations[0].id },
            { ...destination({ clientKey: 'a1' }), id: movingDestId },
          ],
        },
      ],
      lines: [
        { id: lineId, destinationClientKey: 'a1', styleId: outright.styleId, sizeId: outright.sizeId, quantity: 10 },
        { id: saleReturnLineId, destinationClientKey: 'b1', styleId: saleReturn.styleId, sizeId: saleReturn.sizeId, quantity: 5 },
      ],
    }).expect(200);

    const movedGroup = patched.body.data.distributorGroups.find((g: { distributor: { id: string } }) => g.distributor.id === saleReturn.distributorId);
    expect(movedGroup.destinations.map((d: { id: string }) => d.id)).toContain(movingDestId);
    const movedLine = patched.body.data.lines.find((l: { id: string }) => l.id === lineId);
    expect(movedLine.destinationId).toBe(movingDestId);

    // Purchase Mode for this line now resolves to SALE_RETURN — verified via
    // the group it now belongs to (destination-derived lineage).
    expect(movedGroup.purchaseMode).toBe('SALE_RETURN');

    // StockAllocation rows are completely untouched by the move — pooled
    // reservation never depended on Distributor.
    const allocationsAfter = await prisma.stockAllocation.findMany({ where: { saleOrderLineId: lineId } });
    expect(allocationsAfter.map((a) => ({ id: a.id, quantity: a.quantity, status: a.status }))).toEqual(
      allocationsBefore.map((a) => ({ id: a.id, quantity: a.quantity, status: a.status })),
    );

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'SaleOrder', entityId: orderId, action: 'DISPATCH_ORDER_UPDATED' },
    });
    const metadata = auditRow.metadata as {
      destinationsMoved: Array<{ destinationId: string; fromPurchaseMode: string; toPurchaseMode: string }>;
    };
    const moveEntry = metadata.destinationsMoved.find((m) => m.destinationId === movingDestId);
    expect(moveEntry).toMatchObject({ fromPurchaseMode: 'OUTRIGHT', toPurchaseMode: 'SALE_RETURN' });
  });

  it('locked Dispatch Order (post Factory Dispatch) rejects any edit, including Distributor changes', async () => {
    const stock = await createReleasedQaStock({ quantity: 20 });
    const merchToken = await roleToken(['MERCHANDISER']);
    const created = await createDispatchOrder(merchToken, {
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 }],
    }).expect(201);
    const orderId = created.body.data.id as string;

    // Simulate Factory Dispatch reaching READY_FOR_ERVE directly, mirroring
    // the existing lock-test convention elsewhere in this suite.
    const financialYear = await prisma.financialYear.findFirstOrThrow();
    await prisma.factoryDispatch.create({
      data: {
        id: createId(),
        factoryDispatchNumber: `EIFD/LOCK/${createId()}`,
        factoryId: stock.factoryId,
        saleOrderId: orderId,
        status: 'READY_FOR_ERVE',
        preparedById: (await prisma.user.findFirstOrThrow()).id,
        financialYearId: financialYear.id,
        factoryDispatchSerial: 999999,
      },
    });

    await patchDispatchOrder(merchToken, orderId, {
      expectedVersion: created.body.data.version,
      distributors: [distributorGroup(stock.distributorId, [destination()])],
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 5 }],
    }).expect(400);
  });
});

describe('GET /sale-orders/factory-options & /sale-orders/distributor-options (UXAUTH-015 filter lookups)', () => {
  it.each([
    ['ADMIN', 200],
    ['MERCHANDISER', 200],
    ['SENIOR_MANAGEMENT', 200],
    ['ACCOUNTANT', 200],
    ['FACTORY_USER', 403],
    ['QA_USER', 403],
    ['DISTRIBUTOR', 403],
  ] as const)('applies the Dispatch Order filter authorization matrix for %s -> %s', async (role, expectedStatus) => {
    const token = await roleToken([role]);

    const factoryOptions = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const distributorOptions = await request(app)
      .get('/sale-orders/distributor-options')
      .set('Authorization', `Bearer ${token}`);

    expect(factoryOptions.status).toBe(expectedStatus);
    expect(distributorOptions.status).toBe(expectedStatus);
  });

  it('lets ACCOUNTANT fetch factory and distributor options while still denying both broad masters', async () => {
    await createTestFactory({ code: 'FAC-DOPT', name: 'Dispatch Option Factory' });
    await createTestDistributor({ code: 'DIST-DOPT', name: 'Dispatch Option Distributor' });
    const token = await roleToken(['ACCOUNTANT']);

    const factoryOptions = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const distributorOptions = await request(app)
      .get('/sale-orders/distributor-options')
      .set('Authorization', `Bearer ${token}`);
    const directFactories = await request(app).get('/factories').set('Authorization', `Bearer ${token}`);
    const directDistributors = await request(app).get('/distributors').set('Authorization', `Bearer ${token}`);

    expect(factoryOptions.status).toBe(200);
    expect(distributorOptions.status).toBe(200);
    expect(factoryOptions.body.data.length).toBeGreaterThan(0);
    expect(distributorOptions.body.data.length).toBeGreaterThan(0);
    expect(directFactories.status).toBe(403);
    expect(directDistributors.status).toBe(403);
  });

  it('lets SENIOR_MANAGEMENT fetch factory options through the transaction-specific endpoint (broad master already denies it)', async () => {
    await createTestFactory({ code: 'FAC-SM', name: 'Senior Management Factory' });
    const token = await roleToken(['SENIOR_MANAGEMENT']);

    const factoryOptions = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const directFactories = await request(app).get('/factories').set('Authorization', `Bearer ${token}`);

    expect(factoryOptions.status).toBe(200);
    expect(factoryOptions.body.data.length).toBeGreaterThan(0);
    expect(directFactories.status).toBe(403);
  });

  it('returns only { id, code, name, status } for each — no Factory/Distributor master contact/address/audit fields', async () => {
    await createTestFactory({ code: 'FAC-DMIN', name: 'Minimal Dispatch Factory' });
    await createTestDistributor({ code: 'DIST-DMIN', name: 'Minimal Dispatch Distributor' });
    const token = await roleToken(['ADMIN']);

    const factoryOptions = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const distributorOptions = await request(app)
      .get('/sale-orders/distributor-options')
      .set('Authorization', `Bearer ${token}`);

    expect(Object.keys(factoryOptions.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'status'].sort());
    expect(Object.keys(distributorOptions.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'status'].sort());
  });

  it('includes inactive factories/distributors unless a status filter is passed (historical read access, not a union of visible-record values)', async () => {
    const inactiveFactory = await createTestFactory({ code: 'FAC-DINA', name: 'Inactive Dispatch Factory' });
    await prisma.factory.update({ where: { id: inactiveFactory.id }, data: { status: 'INACTIVE' } });
    const inactiveDistributor = await createTestDistributor({
      code: 'DIST-DINA',
      name: 'Inactive Dispatch Distributor',
      status: 'INACTIVE',
    });
    const token = await roleToken(['ADMIN']);

    const allFactories = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const activeFactories = await request(app)
      .get('/sale-orders/factory-options')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`);
    const allDistributors = await request(app)
      .get('/sale-orders/distributor-options')
      .set('Authorization', `Bearer ${token}`);
    const activeDistributors = await request(app)
      .get('/sale-orders/distributor-options')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(allFactories.body.data.map((f: { id: string }) => f.id)).toContain(inactiveFactory.id);
    expect(activeFactories.body.data.map((f: { id: string }) => f.id)).not.toContain(inactiveFactory.id);
    expect(allDistributors.body.data.map((d: { id: string }) => d.id)).toContain(inactiveDistributor.id);
    expect(activeDistributors.body.data.map((d: { id: string }) => d.id)).not.toContain(inactiveDistributor.id);
  });

  it("is not swallowed by the '/:id' route", async () => {
    const token = await roleToken(['ADMIN']);

    const factoryOptions = await request(app).get('/sale-orders/factory-options').set('Authorization', `Bearer ${token}`);
    const distributorOptions = await request(app)
      .get('/sale-orders/distributor-options')
      .set('Authorization', `Bearer ${token}`);

    expect(factoryOptions.status).toBe(200);
    expect(Array.isArray(factoryOptions.body.data)).toBe(true);
    expect(distributorOptions.status).toBe(200);
    expect(Array.isArray(distributorOptions.body.data)).toBe(true);
  });
});
