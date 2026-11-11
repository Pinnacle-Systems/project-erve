import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { createId } from '@erve/shared';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db/prisma.js';
import { createTestRetailStore, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { createApp } from '../../app.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { listRetailStoreInventory, listRetailStoreInventorySources } from './retail-store-inventory.service.js';
import * as helpers from './fulfillment-test-helpers.js';

// Same technique as the A5 performance test: count the real SQL the public
// service emits (a second client with query logging) at growing data sizes and
// assert the count is flat. A per-store / per-style / per-source follow-up
// query would make it grow.
const measured = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: [{ emit: 'event', level: 'query' }],
});
const queries: Prisma.QueryEvent[] = [];
measured.$on('query', (event) => queries.push(event));

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await measured.$disconnect();
  await prisma.$disconnect();
});

it('keeps SQL volume flat from 1 Store / 1 cell to 15 Stores / 127 Style x Size cells, with correct totals', async () => {
  await resetDatabase();
  const app = createApp();
  const f = await helpers.createApprovedSaleOrder(app, { quantity: 100, purchaseMode: 'SALE_RETURN' });
  const factory = await helpers.createFactoryUserToken(f.stock.factoryId);
  const packed = await helpers.packAndFinalize(app, factory, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, 100);
  const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  const record = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  const baseLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: f.saleOrderLineId } });
  const baseDestination = await prisma.saleOrderDestination.findUniqueOrThrow({ where: { id: baseLine.destinationId } });
  const baseStyle = await prisma.style.findUniqueOrThrow({ where: { id: baseLine.styleId } });
  const baseSize = await prisma.size.findUniqueOrThrow({ where: { id: baseLine.sizeId } });
  const admin = await helpers.createRoleToken('ADMIN');
  const actor = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: currentUserSelect }));
  // IMG-25: the Accountant and the owning Distributor now load Style primary images too; their SQL volume must equal the Admin's.
  const accountantUser = await helpers.createRoleToken('ACCOUNTANT');
  const accountant = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: accountantUser.userId }, select: currentUserSelect }));
  const distributorUser = await createTestUserAndToken({ email: `perf-dist-${createId()}@test.local`, password: 'pass', roles: ['DISTRIBUTOR'] });
  await prisma.userDistributor.create({ data: { id: createId(), userId: distributorUser.userId, distributorId: record.distributorId } });
  const distributor = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: distributorUser.userId }, select: currentUserSelect }));
  await prisma.saleOrderLine.update({ where: { id: baseLine.id }, data: { quantity: 1000 } });

  const sizes = [baseSize.id];
  for (let i = 1; i < 5; i += 1) {
    const id = createId();
    await prisma.size.create({ data: { ...baseSize, id, code: `PERF-S${i}-${createId().slice(-4)}`, label: `S${i}`, sortOrder: i + 10 } });
    sizes.push(id);
  }
  const styles = [baseStyle.id];
  for (let i = 1; i < 10; i += 1) {
    const id = createId();
    await prisma.style.create({ data: { ...baseStyle, id, styleNumber: `PERF-${i}-${createId().slice(-4)}` } });
    styles.push(id);
  }
  // Every Style carries a primary image so the image projection is part of what is counted.
  for (const styleId of styles) {
    const file = await prisma.file.create({
      data: { id: createId(), fileName: 'p.png', mimeType: 'image/png', sizeBytes: 10, storageKey: `perf/${createId()}`, checksumSha256: createId() },
    });
    await prisma.styleImage.create({ data: { id: createId(), styleId, fileId: file.id, isPrimary: true } });
  }

  // Grows by whole Stores: each extra Store gets its own destination and 9 Style x Size lines.
  const samples: Array<{ stores: number; cells: number; queries: number }> = [];
  vi.spyOn(prisma, '$transaction').mockImplementation(measured.$transaction.bind(measured));
  let stores = 1;
  let cells = 1;
  let shipped = 100;
  for (const target of [1, 5, 15]) {
    while (stores < target) {
      const store = await createTestRetailStore(record.distributorId);
      const destinationId = createId();
      await prisma.saleOrderDestination.create({
        data: { ...baseDestination, id: destinationId, retailStoreId: store.id, storeCode: store.code, label: store.name },
      });
      for (let i = 0; i < 9; i += 1) {
        const lineId = createId();
        await prisma.saleOrderLine.create({
          data: { ...baseLine, id: lineId, destinationId, styleId: styles[i]!, sizeId: sizes[i % 5]!, quantity: 50 },
        });
        await prisma.factoryPackingCartonLine.create({
          data: { id: createId(), cartonId: packed.cartonId, saleOrderLineId: lineId, quantity: 7 },
        });
        await prisma.erveDispatchDeliveryLine.create({
          data: { id: createId(), erveDispatchId: dispatch.id, saleOrderLineId: lineId, receivedQuantity: 5 },
        });
        cells += 1;
        shipped += 7;
      }
      stores += 1;
    }
    queries.length = 0;
    const result = await listRetailStoreInventory(actor, { distributorId: record.distributorId, limit: 50 });
    const listCount = queries.length;
    expect(result.items).toHaveLength(stores);
    expect(result.summary.storeCount).toBe(stores);
    expect(result.summary.totalsByMode.SALE_RETURN!.shippedQuantity).toBe(shipped);
    expect(
      result.items.reduce((sum, s) => sum + s.styles.reduce((n, c) => n + Object.keys(c.cells).length, 0), 0),
    ).toBe(cells);
    const first = result.items[0]!;
    expect(result.items.every((store) => store.styles.every((card) => card.primaryImage !== null))).toBe(true);
    for (const viewer of [accountant, distributor]) {
      queries.length = 0;
      const viewed = await listRetailStoreInventory(viewer, { distributorId: record.distributorId, limit: 50 });
      expect(queries.length).toBe(listCount);
      expect(viewed.items.every((store) => store.styles.every((card) => card.primaryImage !== null))).toBe(true);
    }
    queries.length = 0;
    await listRetailStoreInventorySources(actor, {
      distributorId: record.distributorId,
      storeKey: first.storeKey,
      styleId: first.styles[0]!.styleId,
      purchaseMode: first.styles[0]!.purchaseMode,
      limit: 25,
    });
    samples.push({ stores, cells, queries: listCount + queries.length });
  }

  expect(samples.map((s) => s.stores)).toEqual([1, 5, 15]);
  expect(new Set(samples.map((s) => s.queries)).size).toBe(1);
  expect(samples[0]!.queries).toBeLessThanOrEqual(20);
});
