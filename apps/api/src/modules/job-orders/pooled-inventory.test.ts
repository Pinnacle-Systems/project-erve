import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestDistributor, createTestSeason, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
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
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributors: [
        {
          clientKey: 'dg1',
          distributorId: stock.distributorId,
          destinations: [{ clientKey: 'd1', addressLine1: 'Test Street', city: 'Chennai', state: 'TN', country: 'India' }],
        },
      ],
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity }],
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
        lines: [{ id: dispatchOrder.lines[0].id, destinationClientKey: destination.id, styleId: stock.styleId, sizeId: stock.sizeId, quantity: 10 }],
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
