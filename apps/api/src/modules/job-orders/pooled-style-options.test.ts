import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { getPooledFactoryInventory } from './pooled-inventory.service.js';
import { getPooledInventoryStyleOptions } from './pooled-style-options.service.js';
import {
  createReleasedQaStock,
  createTestRetailStore,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
const endpoint = '/job-orders/pooled-inventory/style-options';
let stock: Awaited<ReturnType<typeof createReleasedQaStock>>;
let token: string;
let orderId: string;
let lateId: string;
let otherFactoryId: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  for (const role of [
    'ADMIN',
    'MERCHANDISER',
    'SENIOR_MANAGEMENT',
    'QA_USER',
    'FACTORY_USER',
    'DISTRIBUTOR',
  ] as const) {
    tokens[role] = (
      await createTestUserAndToken({
        email: `${role}@lookup.test`,
        password: 'pass',
        roles: [role],
      })
    ).token;
  }
  token = tokens.ADMIN!;
  stock = await createReleasedQaStock({ quantity: 20 });
  await prisma.style.update({
    where: { id: stock.styleId },
    data: { styleNumber: 'A-CONSUMED', styleName: 'Repeated Name' },
  });
  const retailStore = await createTestRetailStore(stock.distributorId);
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send({
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [
        {
          clientKey: 'g',
          distributorId: stock.distributorId,
          destinations: [
            {
              clientKey: 'd',
              retailStoreId: retailStore.id,
              addressLine1: 'Test',
              city: 'Chennai',
              state: 'TN',
              country: 'India',
            },
          ],
        },
      ],
      lines: [{ destinationClientKey: 'd', styleId: stock.styleId, totalQuantity: 20 }],
    })
    .expect(201);
  orderId = created.body.data.id;
  const style = await prisma.style.findUniqueOrThrow({ where: { id: stock.styleId } });
  const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });
  const destination = await prisma.saleOrderDestination.findFirstOrThrow({
    where: { saleOrderId: orderId },
  });
  // More exhausted candidates than the maximum page. They precede the live
  // candidates; limiting raw releases/Size rows loses the live matches.
  for (let i = 0; i < 105; i++) {
    const empty = await createReleasedQaStock({ factoryId: stock.factoryId, quantity: 1 });
    await prisma.style.update({
      where: { id: empty.styleId },
      data: {
        styleNumber: `B-EMPTY-${String(i).padStart(3, '0')}`,
        styleName: 'Repeated Name',
        seasonId: style.seasonId,
      },
    });
    const line = await prisma.saleOrderLine.create({
      data: {
        id: createId(),
        saleOrderId: orderId,
        destinationId: destination.id,
        styleId: empty.styleId,
        sizeId: empty.sizeId,
        quantity: 1,
      },
    });
    await prisma.stockAllocation.create({
      data: {
        id: createId(),
        qaReleaseLineId: empty.qaReleaseLineId,
        saleOrderLineId: line.id,
        quantity: 1,
        allocatedById: order.createdBy,
        allocationSource: 'MERCHANDISER_ALLOCATION',
      },
    });
  }
  for (let i = 0; i < 4; i++) {
    const s = await createReleasedQaStock({ factoryId: stock.factoryId, quantity: 10 });
    await prisma.style.update({
      where: { id: s.styleId },
      data: {
        styleNumber: `Z-LIVE-${i}`,
        styleName: 'Repeated Name',
        lmixNumber: `LMIX-${i}`,
        status: i === 3 ? 'INACTIVE' : 'ACTIVE',
      },
    });
    lateId = s.styleId;
  }
  const other = await createReleasedQaStock({ styleId: lateId, quantity: 99 });
  otherFactoryId = other.factoryId;
}, 300000);
afterAll(() => prisma.$disconnect());

function get(params: Record<string, unknown>, auth = token) {
  return request(app)
    .get(endpoint)
    .set('Authorization', `Bearer ${auth}`)
    .query({ factoryId: stock.factoryId, ...params });
}

describe('LOOKUP-10 bounded inventory Style discovery', () => {
  it('returns a bounded first page after exhausted candidates, with minimal metadata', async () => {
    const res = await get({ limit: 2 }).expect(200);
    expect(res.body.data.items.map((s: { styleNumber: string }) => s.styleNumber)).toEqual([
      'Z-LIVE-0',
      'Z-LIVE-1',
    ]);
    expect(res.body.data.pageInfo).toMatchObject({
      limit: 2,
      hasMore: true,
      nextCursor: expect.any(String),
    });
    expect(Object.keys(res.body.data.items[0]).sort()).toEqual([
      'lmixNumber',
      'primaryImage',
      'styleId',
      'styleName',
      'styleNumber',
    ]);
    expect(res.body.data.items[0].primaryImage).toBeNull();
  });
  it('walks stable pages without duplicates and includes inactive historical Styles', async () => {
    const first = (await get({ limit: 2 }).expect(200)).body.data;
    const second = (await get({ limit: 2, cursor: first.pageInfo.nextCursor }).expect(200)).body
      .data;
    expect(second.items.map((s: { styleNumber: string }) => s.styleNumber)).toEqual([
      'Z-LIVE-2',
      'Z-LIVE-3',
    ]);
    expect(new Set([...first.items, ...second.items].map((s) => s.styleId)).size).toBe(4);
    expect(second.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
  });
  it.each([
    ['live-3', 1],
    ['mix-2', 1],
    ['pEaTeD nA', 4],
    ['   ', 4],
    ["' OR TRUE --", 0],
    ['%', 0],
    ['_', 0],
  ])('searches server-side safely: %s', async (search, count) => {
    const res = await get({ search }).expect(200);
    expect(res.body.data.items).toHaveLength(count);
    expect(res.body.data.pageInfo.limit).toBe(20);
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 'x' },
    { cursor: 'garbage' },
    { search: 'x'.repeat(201) },
    { factoryId: 'bad' },
    { excludeSaleOrderId: 'bad' },
  ])('rejects invalid query %j', async (params) => {
    await get(params).expect(400);
  });
  it('requires an explicit Factory', async () => {
    await request(app).get(endpoint).set('Authorization', `Bearer ${token}`).expect(400);
  });
  it('binds the cursor to Factory, normalized search and exclusion', async () => {
    const first = (await get({ limit: 1 }).expect(200)).body.data;
    for (const context of [
      { search: 'LIVE' },
      { factoryId: otherFactoryId },
      { excludeSaleOrderId: orderId },
    ]) {
      await get({ ...context, cursor: first.pageInfo.nextCursor }).expect(400);
    }
    await get({ cursor: first.pageInfo.nextCursor, search: '   ' }).expect(200);
  });
  it('adds back only an authorized editable order own ACTIVE commitments', async () => {
    expect((await get({ search: 'A-CONSUMED' }).expect(200)).body.data.items).toEqual([]);
    const res = await get({ search: 'A-CONSUMED', excludeSaleOrderId: orderId }).expect(200);
    expect(res.body.data.items[0].styleId).toBe(stock.styleId);
    await get({ factoryId: otherFactoryId, excludeSaleOrderId: orderId }).expect(400);
    await get({ excludeSaleOrderId: createId() }).expect(400);
    await get({ excludeSaleOrderId: orderId }, tokens.SENIOR_MANAGEMENT).expect(403);
  });
  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'])(
    'allows ordinary %s discovery',
    async (role) => {
      await get({}, tokens[role]).expect(200);
    },
  );
  it.each(['QA_USER', 'FACTORY_USER', 'DISTRIBUTOR'])('denies %s catalog access', async (role) => {
    await get({}, tokens[role]).expect(403);
  });
  it('preserves complete selected-Style pool retrieval including exhausted Sizes', async () => {
    const res = await request(app)
      .get('/job-orders/pooled-inventory')
      .set('Authorization', `Bearer ${token}`)
      .query({ factoryId: stock.factoryId, styleId: stock.styleId })
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      styleId: stock.styleId,
      availableQuantity: 0,
      sizeId: stock.sizeId,
    });
  });

  it('uses per-Size availability across multiple releases and ignores RELEASED commitments', async () => {
    const extra = await createReleasedQaStock({
      factoryId: stock.factoryId,
      styleId: lateId,
      quantity: 5,
    });
    await createReleasedQaStock({
      factoryId: stock.factoryId,
      styleId: lateId,
      sizeId: extra.sizeId,
      quantity: 4,
    });
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });
    const destination = await prisma.saleOrderDestination.findFirstOrThrow({
      where: { saleOrderId: orderId },
    });
    const line = await prisma.saleOrderLine.create({
      data: {
        id: createId(),
        saleOrderId: orderId,
        destinationId: destination.id,
        styleId: lateId,
        sizeId: extra.sizeId,
        quantity: 5,
      },
    });
    await prisma.stockAllocation.create({
      data: {
        id: createId(),
        saleOrderLineId: line.id,
        qaReleaseLineId: extra.qaReleaseLineId,
        quantity: 30,
        allocatedById: order.createdBy,
        allocationSource: 'MERCHANDISER_ALLOCATION',
        status: 'RELEASED',
      },
    });
    const active = await prisma.stockAllocation.create({
      data: {
        id: createId(),
        saleOrderLineId: line.id,
        qaReleaseLineId: (
          await prisma.qaReleaseLine.findFirstOrThrow({
            where: {
              jobOrderLineSize: { sizeId: extra.sizeId },
              id: { not: extra.qaReleaseLineId },
            },
          })
        ).id,
        quantity: 9,
        allocatedById: order.createdBy,
        allocationSource: 'MERCHANDISER_ALLOCATION',
      },
    });
    const res = await get({ search: 'LIVE-3' }).expect(200);
    expect(res.body.data.items.map((s: { styleId: string }) => s.styleId)).toEqual([lateId]);
    // The original positive Size still makes the Style eligible even when
    // this Size is exhausted or negative; selected hydration keeps both.
    await prisma.stockAllocation.update({ where: { id: active.id }, data: { quantity: 30 } });
    expect((await get({ search: 'LIVE-3' }).expect(200)).body.data.items).toHaveLength(1);
    const pool = await request(app)
      .get('/job-orders/pooled-inventory')
      .set('Authorization', `Bearer ${token}`)
      .query({ factoryId: stock.factoryId, styleId: lateId })
      .expect(200);
    expect(
      pool.body.data
        .map((r: { availableQuantity: number }) => r.availableQuantity)
        .sort((a: number, b: number) => a - b),
    ).toEqual([-21, 10]);
  });

  it('uses existing primary and first-image fallback metadata without provenance', async () => {
    const file = await prisma.file.create({
      data: {
        id: createId(),
        fileName: 'lookup.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: 'lookup10/test.png',
      },
    });
    const fallback = await prisma.styleImage.create({
      data: { id: createId(), fileId: file.id, styleId: lateId, sortOrder: 0 },
    });
    expect((await get({ search: 'LIVE-3' }).expect(200)).body.data.items[0].primaryImage.id).toBe(
      fallback.id,
    );
    const primary = await prisma.styleImage.create({
      data: { id: createId(), fileId: file.id, styleId: lateId, sortOrder: 4, isPrimary: true },
    });
    expect((await get({ search: 'LIVE-3' }).expect(200)).body.data.items[0].primaryImage.id).toBe(
      primary.id,
    );
  });

  it('rejects edit add-back after Factory Dispatch locks the order', async () => {
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });
    await prisma.factoryDispatch.create({
      data: {
        id: createId(),
        factoryDispatchNumber: `LOOKUP-${createId()}`,
        factoryId: stock.factoryId,
        saleOrderId: orderId,
        status: 'READY_FOR_ERVE',
        preparedById: order.createdBy,
        financialYearId: order.financialYearId,
        factoryDispatchSerial: 999998,
      },
    });
    await get({ excludeSaleOrderId: orderId }).expect(400);
  });

  it.skipIf(process.env.LOOKUP10_BENCHMARK !== '1')(
    'measures sparse catalog discovery and selected hydration on the verified disposable target',
    async () => {
      const target = new URL(process.env.DATABASE_URL!);
      expect([target.hostname, target.port, target.pathname]).toEqual([
        '127.0.0.1',
        '55451',
        '/erve_batch10_lookup10_test',
      ]);
      // Populate several ordinary discovery pages as well as the sparse LIVE
      // search. Browser acceptance uses these records for actual continuation.
      for (let i = 0; i < 25; i++) {
        const extra = await createReleasedQaStock({ factoryId: stock.factoryId, quantity: 10 });
        await prisma.style.update({
          where: { id: extra.styleId },
          data: {
            styleNumber: `Y-UX-${String(i).padStart(2, '0')}`,
            styleName: 'Lookup browser fixture',
          },
        });
      }
      const release = await prisma.qaRelease.findUniqueOrThrow({
        where: { id: stock.qaReleaseId },
      });
      const batch = await prisma.finalQualityBatch.findUniqueOrThrow({
        where: { id: release.finalQualityBatchId },
      });
      const execution = await prisma.qualityActivityExecution.findUniqueOrThrow({
        where: { id: release.sourceQualityExecutionId },
      });
      const ownLine = await prisma.saleOrderLine.findFirstOrThrow({
        where: { saleOrderId: orderId, styleId: stock.styleId },
      });
      const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });
      const ownDestination = await prisma.saleOrderDestination.findUniqueOrThrow({
        where: { id: ownLine.destinationId },
      });
      const secondDestination = await prisma.saleOrderDestination.create({
        data: { ...ownDestination, id: createId() },
      });
      const secondLine = await prisma.saleOrderLine.create({
        data: { ...ownLine, id: createId(), destinationId: secondDestination.id },
      });
      const events: Prisma.QueryEvent[] = [];
      const measured = new PrismaClient({
        adapter: new PrismaPg({ connectionString: target.toString() }),
        log: [{ emit: 'event', level: 'query' }],
      });
      measured.$on('query', (event) => events.push(event));
      const samples: unknown[] = [];
      let seeded = 0;
      try {
        for (const count of [100, 1000, 10000]) {
          const indices = Array.from({ length: count - seeded }, (_, i) => seeded + i + 1);
          await prisma.$transaction(
            async (tx) => {
              await tx.finalQualityBatch.createMany({
                data: indices.map((n) => ({
                  ...batch,
                  id: `lookup-b-${n}`,
                  batchNumber: n + 100,
                  disposition: 'DRAFT',
                  terminalById: null,
                  terminalAt: null,
                })),
              });
              await tx.finalQualityBatchAllocation.createMany({
                data: indices.map((n) => ({
                  id: `lookup-ba-${n}`,
                  finalQualityBatchId: `lookup-b-${n}`,
                  jobOrderLineSizeId: stock.jobOrderLineSizeId,
                  quantity: stock.quantity,
                })),
              });
              await tx.qualityActivityExecution.createMany({
                data: indices.map((n) => ({
                  ...execution,
                  id: `lookup-e-${n}`,
                  finalQualityBatchId: `lookup-b-${n}`,
                  batchNumber: n + 100,
                })),
              });
              await tx.qaRelease.createMany({
                data: indices.map((n) => ({
                  ...release,
                  id: `lookup-r-${n}`,
                  finalQualityBatchId: `lookup-b-${n}`,
                  sourceQualityExecutionId: `lookup-e-${n}`,
                })),
              });
              await tx.qaReleaseLine.createMany({
                data: indices.map((n) => ({
                  id: `lookup-rl-${n}`,
                  qaReleaseId: `lookup-r-${n}`,
                  jobOrderLineSizeId: stock.jobOrderLineSizeId,
                  quantity: stock.quantity,
                })),
              });
              await tx.finalQualityBatch.updateMany({
                where: { id: { in: indices.map((n) => `lookup-b-${n}`) } },
                data: {
                  disposition: 'RELEASED',
                  terminalById: order.createdBy,
                  terminalAt: new Date(),
                },
              });
              await tx.stockAllocation.createMany({
                data: indices.flatMap((n) =>
                  [ownLine.id, secondLine.id].map((lineId, i) => ({
                    id: `lookup-sa-${n}-${i}`,
                    saleOrderLineId: lineId,
                    qaReleaseLineId: `lookup-rl-${n}`,
                    quantity: stock.quantity / 2,
                    status: 'ACTIVE',
                    allocationSource: 'MERCHANDISER_ALLOCATION',
                    allocatedById: order.createdBy,
                  })),
                ),
              });
            },
            { timeout: 180000 },
          );
          seeded = count;
          await prisma.$executeRaw`ANALYZE`;
          for (const search of ['', 'LIVE-0', 'LIVE-3']) {
            const filters = { factoryId: stock.factoryId, search, limit: 2 };
            await getPooledInventoryStyleOptions(measured, filters);
            const runs = [];
            let statement: Prisma.QueryEvent | undefined;
            for (let i = 0; i < 5; i++) {
              events.length = 0;
              const start = performance.now();
              const result = await getPooledInventoryStyleOptions(measured, filters);
              const ms = performance.now() - start;
              expect(result.items.length).toBeLessThanOrEqual(2);
              expect(result.items.length).toBe(search ? 1 : 2);
              statement = events.find((e) => e.query.includes('WITH filtered_releases'));
              runs.push({
                ms,
                queries: events.length,
                records: result.items.length,
                bytes: Buffer.byteLength(JSON.stringify({ success: true, data: result })),
              });
            }
            const values = JSON.parse(statement!.params) as unknown[];
            const strings = statement!.query.split(/\$\d+/g);
            strings[0] = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${strings[0]}`;
            const parameters = [...statement!.query.matchAll(/\$(\d+)/g)].map(
              (m) => values[Number(m[1]) - 1],
            );
            const plan = await measured.$queryRaw(new Prisma.Sql(strings, parameters));
            samples.push({
              historyReleases: count,
              styles: await prisma.style.count(),
              search,
              runs,
              plan,
            });
          }
          events.length = 0;
          const started = performance.now();
          const selected = await getPooledFactoryInventory(measured, {
            factoryId: stock.factoryId,
            styleId: lateId,
          });
          samples.push({
            historyReleases: count,
            selectedHydration: {
              ms: performance.now() - started,
              queries: events.length,
              records: selected.length,
              bytes: Buffer.byteLength(JSON.stringify(selected)),
            },
          });
          expect(selected.map((r) => r.availableQuantity).sort((a, b) => a - b)).toEqual([-21, 10]);
        }
        const output = process.env.LOOKUP10_BENCHMARK_OUTPUT;
        if (!output) throw new Error('LOOKUP10_BENCHMARK_OUTPUT required');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(
          path.join(output, 'lookup10-benchmark.json'),
          JSON.stringify(samples, null, 2),
        );
        fs.writeFileSync(
          path.join(output, 'lookup10-browser-fixtures.json'),
          JSON.stringify(
            {
              factory: await prisma.factory.findUniqueOrThrow({ where: { id: stock.factoryId } }),
              otherFactoryId,
              distributorId: stock.distributorId,
              styles: await prisma.style.findMany({
                where: { styleNumber: { in: ['Z-LIVE-0', 'Z-LIVE-1'] } },
                select: { id: true, styleNumber: true },
              }),
            },
            null,
            2,
          ),
        );
      } finally {
        await measured.$disconnect();
      }
    },
    600000,
  );
});
