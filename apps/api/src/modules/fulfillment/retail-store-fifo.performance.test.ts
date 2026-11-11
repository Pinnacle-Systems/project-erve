import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { createId } from '@erve/shared';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { createTestDistributor, createTestFactory, createTestRetailStore, resetDatabase } from '../../test/helpers.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import * as helpers from './fulfillment-test-helpers.js';
import {
  getStoreFifoAvailability,
  submitStoreFifoReturn,
  submitStoreFifoSalesReport,
} from './retail-store-fifo.service.js';

// ISS-089 review correction: the Store-level FIFO path must issue a CONSTANT number of SQL
// statements however many source positions (Dispatch x Sale Order line) a Store/Style/Size cell
// has. Same technique as the A5/A6 performance tests: a second Prisma client with query logging
// stands in for the public service's transactions, and the real SQL is counted.
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

const POSITION_COUNTS = [1, 25, 100];
const PER_POSITION_RECEIVED = 5;

it('issues the same number of SQL statements for 1, 25 and 100 source positions (preview, sale and return)', async () => {
  await resetDatabase();
  const app = createApp();
  const distributor = await createTestDistributor({ purchaseMode: 'SALE_RETURN' });
  const distributorToken = await helpers.createDistributorToken(distributor.id);
  const mapped = await prisma.userDistributor.findFirstOrThrow({ where: { distributorId: distributor.id } });
  const actor = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: mapped.userId }, select: currentUserSelect }));
  void distributorToken;

  const factory = await createTestFactory();
  const factoryToken = await helpers.createFactoryUserToken(factory.id);
  const seedStore = await createTestRetailStore(distributor.id);
  const f = await helpers.createApprovedSaleOrder(app, {
    distributorId: distributor.id,
    factoryId: factory.id,
    quantity: 20,
    retailStoreId: seedStore.id,
  });
  const packed = await helpers.packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, 20);
  const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  await prisma.erveDispatch.update({
    where: { id: dispatch.id },
    data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 86_400_000), deliveryConfirmationSource: 'USER_CONFIRMED' },
  });
  const baseLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: f.saleOrderLineId } });
  const baseDestination = await prisma.saleOrderDestination.findUniqueOrThrow({ where: { id: baseLine.destinationId } });

  // A cell with `count` verified source positions, every 4th one partly sold already.
  async function buildCell(count: number) {
    const store = await createTestRetailStore(distributor.id);
    const soldLineIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const destinationId = createId();
      await prisma.saleOrderDestination.create({
        data: { ...baseDestination, id: destinationId, retailStoreId: store.id, storeCode: store.code, label: store.name },
      });
      const lineId = createId();
      await prisma.saleOrderLine.create({ data: { ...baseLine, id: lineId, destinationId, quantity: 50 } });
      await prisma.erveDispatchDeliveryLine.create({
        data: { id: createId(), erveDispatchId: dispatch.id, saleOrderLineId: lineId, receivedQuantity: PER_POSITION_RECEIVED },
      });
      if (i % 4 === 0) soldLineIds.push(lineId);
    }
    if (soldLineIds.length > 0) {
      const reportId = createId();
      await prisma.distributorSalesReport.create({
        data: { id: reportId, distributorId: distributor.id, reportDate: new Date(), submittedById: mapped.userId },
      });
      await prisma.distributorSalesReportLine.createMany({
        data: soldLineIds.map((lineId) => ({ id: createId(), distributorSalesReportId: reportId, erveDispatchId: dispatch.id, saleOrderLineId: lineId, quantitySold: 1 })),
      });
    }
    return { storeKey: `S:${store.id}`, styleId: baseLine.styleId, sizeId: baseLine.sizeId, sold: soldLineIds.length };
  }

  const today = new Date().toISOString().slice(0, 10);
  vi.spyOn(prisma, '$transaction').mockImplementation(measured.$transaction.bind(measured));
  const samples: Array<{ positions: number; preview: number; sale: number; return: number }> = [];

  for (const positions of POSITION_COUNTS) {
    const cell = await buildCell(positions);
    const expectedAvailable = positions * PER_POSITION_RECEIVED - cell.sold;

    queries.length = 0;
    const preview = await getStoreFifoAvailability(actor, { ...cell, date: today });
    const previewCount = queries.length;
    expect(preview.availableForSale).toBe(expectedAvailable);
    expect(preview.availableForReturn).toBe(expectedAvailable);

    // Each request spans EVERY position, so any per-position statement would show up.
    queries.length = 0;
    const ret = await submitStoreFifoReturn(
      actor,
      { ...cell, quantity: expectedAvailable, returnDate: today, returnReason: 'perf', remarks: null },
      createId(),
    );
    const returnCount = queries.length;
    expect(ret.distributorReturn.lines).toHaveLength(positions);

    queries.length = 0;
    const sale = await submitStoreFifoSalesReport(actor, { ...cell, quantity: expectedAvailable, reportDate: today, remarks: null }, createId());
    const saleCount = queries.length;
    expect(sale.salesReport.lines).toHaveLength(positions);
    expect(sale.salesReport.lines.reduce((n, l) => n + l.quantitySold, 0)).toBe(expectedAvailable);

    samples.push({ positions, preview: previewCount, sale: saleCount, return: returnCount });
  }

  console.log(`FIFO_QUERY_COUNTS ${JSON.stringify(samples)}`);
  expect(samples.map((s) => s.positions)).toEqual(POSITION_COUNTS);
  expect(new Set(samples.map((s) => s.preview)).size).toBe(1);
  expect(new Set(samples.map((s) => s.sale)).size).toBe(1);
  expect(new Set(samples.map((s) => s.return)).size).toBe(1);
  // A bounded absolute ceiling too: a handful of statements, not hundreds.
  expect(samples[2]!.preview).toBeLessThanOrEqual(15);
  expect(samples[2]!.sale).toBeLessThanOrEqual(30);
  expect(samples[2]!.return).toBeLessThanOrEqual(30);
}, 180_000);
