import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestDistributor, createTestRetailStore, createTestSeason, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { getPooledFactoryInventory } from './pooled-inventory.service.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function createDistributorUser(distributorId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `dist-${createId()}@test.local`,
    password: 'pass',
    roles: ['DISTRIBUTOR'],
  });
  await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  return token;
}

async function createMerchandiserToken() {
  const { token } = await createTestUserAndToken({
    email: `merch-${createId()}@test.local`,
    password: 'pass',
    roles: ['MERCHANDISER'],
  });
  return token;
}

// Dispatch Order Phase 3: creation is the sole allocation point — reserves
// `quantity` from `stock`'s own pooled Factory+Style+Size stock immediately
// (no separate submit/approve step exists any more).
async function createAndAllocate(
  stock: Awaited<ReturnType<typeof createReleasedQaStock>>,
  merchToken: string,
  quantity: number,
) {
  const retailStore = await createTestRetailStore(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributors: [
        {
          clientKey: 'dg1',
          distributorId: stock.distributorId,
          destinations: [{ clientKey: 'd1', retailStoreId: retailStore.id, addressLine1: 'Test Street', city: 'Chennai', state: 'TN', country: 'India' }],
        },
      ],
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, totalQuantity: quantity }],
    })
    .expect(201);
  const saleOrder = created.body.data;
  // Correction 8: flatten distributorGroups[].destinations into a plain
  // `destinations` array for this file's own call sites, matching the old
  // flat response shape they were written against.
  saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
  return saleOrder;
}

describe('pooled Factory + Style + Size inventory (Phase 2.1)', () => {
  it('pools QA-passed stock from two Job Orders at the same Factory + Style + Size', async () => {
    const styleId = createId();
    await prisma.style.create({
      data: {
        id: styleId,
        styleNumber: `POOL-${createId()}`,
        styleName: 'Pooled Style',
        finalMrp: 100,
        seasonId: (await createTestSeason()).id,
      },
    });
    const factoryId = createId();
    await prisma.factory.create({
      data: { id: factoryId, code: `POOL-${createId()}`, name: 'Pooled Factory', status: 'ACTIVE' },
    });
    const sizeId = createId();
    await prisma.size.create({
      data: { id: sizeId, code: `POOL-SZ-${createId()}`, label: 'Pooled Size', sizeType: 'ALPHA', sortOrder: 1 },
    });

    // JO-001: Factory F1, Style A, 100 released.
    await createReleasedQaStock({ factoryId, styleId, sizeId, quantity: 100 });
    // JO-002: Factory F1, Style A (different Distributor/Job Order), 50 released.
    await createReleasedQaStock({ factoryId, styleId, sizeId, quantity: 50 });

    const rows = await getPooledFactoryInventory(prisma, { factoryId, styleId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      factoryId,
      styleId,
      sizeId,
      releasedQuantity: 150,
      committedQuantity: 0,
      availableQuantity: 150,
    });
  });

  it('never pools across a different Factory', async () => {
    const styleId = createId();
    await prisma.style.create({
      data: {
        id: styleId,
        styleNumber: `POOL-${createId()}`,
        styleName: 'Pooled Style',
        finalMrp: 100,
        seasonId: (await createTestSeason()).id,
      },
    });
    const sizeId = createId();
    await prisma.size.create({
      data: { id: sizeId, code: `POOL-SZ-${createId()}`, label: 'Pooled Size', sizeType: 'ALPHA', sortOrder: 1 },
    });

    const stockA = await createReleasedQaStock({ styleId, sizeId, quantity: 100 });
    const stockB = await createReleasedQaStock({ styleId, sizeId, quantity: 25 });
    expect(stockA.factoryId).not.toBe(stockB.factoryId);

    const rows = await getPooledFactoryInventory(prisma, { styleId, sizeId });
    expect(rows).toHaveLength(2);
    const byFactory = new Map(rows.map((row) => [row.factoryId, row]));
    expect(byFactory.get(stockA.factoryId)?.availableQuantity).toBe(100);
    expect(byFactory.get(stockB.factoryId)?.availableQuantity).toBe(25);
  });

  it('never pools across a different Style', async () => {
    const factoryId = createId();
    await prisma.factory.create({
      data: { id: factoryId, code: `POOL-${createId()}`, name: 'Shared Factory', status: 'ACTIVE' },
    });

    const styleAStock = await createReleasedQaStock({ factoryId, quantity: 100 });
    const styleBStock = await createReleasedQaStock({ factoryId, quantity: 30 });
    expect(styleAStock.styleId).not.toBe(styleBStock.styleId);

    const rows = await getPooledFactoryInventory(prisma, { factoryId });
    const byStyle = new Map(rows.map((row) => [row.styleId, row]));
    expect(byStyle.get(styleAStock.styleId)?.availableQuantity).toBe(100);
    expect(byStyle.get(styleBStock.styleId)?.availableQuantity).toBe(30);
  });

  it('subtracts every ACTIVE StockAllocation once — never multiplies released quantity by allocation count', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();

    // Two separate Dispatch Orders (20 + 10) against the SAME release line —
    // a naive join between QaReleaseLine and StockAllocation would multiply
    // the release line's own quantity once per matching allocation row
    // (100 * 2 = 200, then minus 30 = 170). The correct answer is 70.
    await createAndAllocate(stock, merchToken, 20);
    await createAndAllocate(stock, merchToken, 10);

    const allocationCount = await prisma.stockAllocation.count({
      where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'ACTIVE' },
    });
    expect(allocationCount).toBe(2);

    const rows = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ releasedQuantity: 100, committedQuantity: 30, availableQuantity: 70 });
  });

  it('does not count a RELEASED (edited-down) allocation against pooled availability', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();

    const dispatchOrder = await createAndAllocate(stock, merchToken, 40);
    let rows = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
    });
    expect(rows[0]).toMatchObject({ committedQuantity: 40, availableQuantity: 60 });

    // Dispatch Orders cannot be cancelled — editing the quantity down is the
    // only way stock returns to the pool (no persisted CANCELLED status, no
    // separate reject/cancel action exists any more). Reducing to a smaller
    // positive quantity exercises the "excess allocation released back to
    // the pool" mechanism.
    const destination = dispatchOrder.destinations[0];
    const groupId = dispatchOrder.distributorGroups[0].id as string;
    await request(app)
      .patch(`/sale-orders/${dispatchOrder.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: dispatchOrder.version,
        distributors: [
          {
            clientKey: 'dg1',
            id: groupId,
            distributorId: stock.distributorId,
            destinations: [{ clientKey: destination.id, id: destination.id, ...destination }],
          },
        ],
        lines: [{ destinationClientKey: destination.id, styleId: stock.styleId, totalQuantity: 10 }],
      })
      .expect(200);

    expect(
      await prisma.stockAllocation.count({ where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'ACTIVE' } }),
    ).toBe(1);
    expect(
      await prisma.stockAllocation.count({ where: { qaReleaseLineId: stock.qaReleaseLineId, status: 'RELEASED' } }),
    ).toBe(0); // partial release decrements quantity in place rather than flipping status

    rows = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
    });
    expect(rows[0]).toMatchObject({ releasedQuantity: 100, committedQuantity: 10, availableQuantity: 90 });
  });
});

// BUG-007: editing a Dispatch Order releases-and-re-reserves its own
// allocation in one transaction (reserveAcrossPools already adds this back
// server-side for the mutation itself — see sale-orders.service.ts). These
// cover the separate read-only pooled-inventory display the edit FORM
// queries, which previously had no way to add the order's own commitment
// back and so understated availableQuantity by exactly that amount.
//
// The first three tests below call getPooledFactoryInventory directly — the
// pure aggregation function, a trusted-input internal helper (its
// factoryId/styleId/sizeId params were never existence-checked either).
// The security-correction tests further down go through the actual route,
// which is where excludeSaleOrderId's authorization/eligibility gate
// (assertExcludableDispatchOrder) lives.
describe('BUG-007 — excludeSaleOrderId adds back only that order\'s own ACTIVE allocation', () => {
  it('adds back the specified order\'s own commitment but keeps other orders\' committed subtracted', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();

    const ownOrder = await createAndAllocate(stock, merchToken, 40);
    const otherOrder = await createAndAllocate(stock, merchToken, 10);

    const withoutExclude = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
    });
    expect(withoutExclude[0]).toMatchObject({ committedQuantity: 50, availableQuantity: 50 });

    const excludingOwn = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
      excludeSaleOrderId: ownOrder.id,
    });
    expect(excludingOwn[0]).toMatchObject({ committedQuantity: 50, availableQuantity: 90 });

    const excludingOther = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
      excludeSaleOrderId: otherOrder.id,
    });
    expect(excludingOther[0]).toMatchObject({ committedQuantity: 50, availableQuantity: 60 });
  });

  it('is a no-op when excludeSaleOrderId has no ACTIVE allocation against this pool', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();
    await createAndAllocate(stock, merchToken, 30);

    const rows = await getPooledFactoryInventory(prisma, {
      factoryId: stock.factoryId,
      styleId: stock.styleId,
      sizeId: stock.sizeId,
      excludeSaleOrderId: createId(),
    });
    expect(rows[0]).toMatchObject({ committedQuantity: 30, availableQuantity: 70 });
  });

  it('GET /job-orders/pooled-inventory honors excludeSaleOrderId as a query param', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();
    const order = await createAndAllocate(stock, merchToken, 25);

    const res = await request(app)
      .get('/job-orders/pooled-inventory')
      .query({
        factoryId: stock.factoryId,
        styleId: stock.styleId,
        sizeId: stock.sizeId,
        excludeSaleOrderId: order.id,
      })
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(200);
    const row = (res.body.data as Array<{ sizeId: string }>).find((r) => r.sizeId === stock.sizeId);
    expect(row).toMatchObject({ committedQuantity: 25, availableQuantity: 100 });
  });
});

// BUG-007 security correction: excludeSaleOrderId must never let a caller
// inflate availableQuantity by naming an arbitrary/unauthorized/ineligible
// Dispatch Order. Every rejection path below must error, never silently
// fall back to treating excludeSaleOrderId as absent.
describe('BUG-007 security correction — excludeSaleOrderId authorization and eligibility', () => {
  async function seniorManagementToken() {
    const { token } = await createTestUserAndToken({
      email: `senior-mgmt-${createId()}@test.local`,
      password: 'pass',
      roles: ['SENIOR_MANAGEMENT'],
    });
    return token;
  }

  it('rejects excludeSaleOrderId from a view-only role (SENIOR_MANAGEMENT) with 403, never inflating availability', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();
    const order = await createAndAllocate(stock, merchToken, 25);
    const seniorToken = await seniorManagementToken();

    const res = await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: stock.factoryId, styleId: stock.styleId, sizeId: stock.sizeId, excludeSaleOrderId: order.id })
      .set('Authorization', `Bearer ${seniorToken}`)
      .expect(403);
    expect(res.body.error?.code ?? res.body.code).toBeTruthy();
  });

  it('preserves normal pooled-inventory reads for a view-only role when excludeSaleOrderId is omitted', async () => {
    const seniorToken = await seniorManagementToken();
    await request(app)
      .get('/job-orders/pooled-inventory')
      .set('Authorization', `Bearer ${seniorToken}`)
      .expect(200);
  });

  it('rejects an excludeSaleOrderId that does not belong to the requested factory with 400', async () => {
    const stockA = await createReleasedQaStock({ quantity: 100 });
    const stockB = await createReleasedQaStock({ quantity: 100 });
    expect(stockA.factoryId).not.toBe(stockB.factoryId);
    const merchToken = await createMerchandiserToken();
    const orderAtFactoryA = await createAndAllocate(stockA, merchToken, 20);

    await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: stockB.factoryId, excludeSaleOrderId: orderAtFactoryA.id })
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(400);

    // The Factory A pool itself must still read correctly and unaffected.
    const rows = await getPooledFactoryInventory(prisma, { factoryId: stockA.factoryId, styleId: stockA.styleId, sizeId: stockA.sizeId });
    expect(rows[0]).toMatchObject({ committedQuantity: 20, availableQuantity: 80 });
  });

  it('rejects a nonexistent excludeSaleOrderId with 400', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();

    await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: stock.factoryId, excludeSaleOrderId: createId() })
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(400);
  });

  it('rejects an excludeSaleOrderId for an order no longer eligible for editing (Factory Dispatch already READY_FOR_ERVE) with 400', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();
    const order = await createAndAllocate(stock, merchToken, 20);

    // Mirrors dispatch-orders.test.ts's own "locked Dispatch Order" convention.
    const financialYear = await prisma.financialYear.findFirstOrThrow();
    await prisma.factoryDispatch.create({
      data: {
        id: createId(),
        factoryDispatchNumber: `EIFD/LOCK/${createId()}`,
        factoryId: stock.factoryId,
        saleOrderId: order.id,
        status: 'READY_FOR_ERVE',
        preparedById: (await prisma.user.findFirstOrThrow()).id,
        financialYearId: financialYear.id,
        factoryDispatchSerial: 999998,
      },
    });

    await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: stock.factoryId, excludeSaleOrderId: order.id })
      .set('Authorization', `Bearer ${merchToken}`)
      .expect(400);
  });

  it('allows an authorized edit (ADMIN) to exclude a real, own-factory, still-editable Dispatch Order', async () => {
    const stock = await createReleasedQaStock({ quantity: 100 });
    const merchToken = await createMerchandiserToken();
    const { token: adminToken } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const order = await createAndAllocate(stock, merchToken, 30);

    const res = await request(app)
      .get('/job-orders/pooled-inventory')
      .query({ factoryId: stock.factoryId, styleId: stock.styleId, sizeId: stock.sizeId, excludeSaleOrderId: order.id })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data[0]).toMatchObject({ committedQuantity: 30, availableQuantity: 100 });
  });
});

describe('GET /job-orders/pooled-inventory (route + authorization)', () => {
  it('is reachable as a literal route — never swallowed by GET /job-orders/:id', async () => {
    const { token } = await createTestUserAndToken({
      email: `admin-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const res = await request(app)
      .get('/job-orders/pooled-inventory')
      .set('Authorization', `Bearer ${token}`);
    // A 404 here would mean Express matched `/:id` with id="pooled-inventory"
    // and looked up a non-existent Job Order instead of this literal route.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    'allows %s to view pooled inventory',
    async (role) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}-${createId()}@test.local`,
        password: 'pass',
        roles: [role],
      });
      await request(app)
        .get('/job-orders/pooled-inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    },
  );

  it.each(['FACTORY_USER', 'QA_USER', 'ACCOUNTANT'] as const)(
    'forbids %s from viewing pooled inventory',
    async (role) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}-${createId()}@test.local`,
        password: 'pass',
        roles: [role],
      });
      await request(app)
        .get('/job-orders/pooled-inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    },
  );

  it('forbids a DISTRIBUTOR from viewing pooled inventory', async () => {
    const distributor = await createTestDistributor();
    const token = await createDistributorUser(distributor.id);
    await request(app)
      .get('/job-orders/pooled-inventory')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
