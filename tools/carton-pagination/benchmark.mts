import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Deliberately refuses every other target, before importing fixture/reset code.
const target = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ['127.0.0.1', '55452', '/erve_batch10_carton_pagination_test', 'cartonpagination'],
);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = target.toString();
const requireApi = createRequire(resolve('apps/api/package.json'));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const request = requireApi('supertest');
const { PrismaClient, Prisma } = await import('../../apps/api/src/generated/prisma/client.js');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: target.toString() }),
  log: [{ emit: 'event', level: 'query' }],
});
let hydratedRecords = 0;
const observed = db.$extends({
  query: {
    factoryPackingCarton: {
      async findMany({ args, query }) {
        const records = await query(args);
        hydratedRecords += records.length;
        return records;
      },
    },
  },
});
// Test-only instrumentation; the extended client's normal delegates are unchanged.
globalThis.__prisma = observed as unknown as typeof db;
const events: Array<{ query: string; params: string; duration: number }> = [];
db.$on('query', (event) => events.push(event));
const identity = await db.$queryRaw<
  Array<{ database: string; user: string }>
>`SELECT current_database() AS database, current_user AS "user"`;
assert.deepEqual(identity, [
  { database: 'erve_batch10_carton_pagination_test', user: 'cartonpagination' },
]);

const { createApp } = await import('../../apps/api/src/app.js');
const { resetDatabase, createTestUserAndToken, createTestDistributor } =
  await import('../../apps/api/src/test/helpers.js');
const helpers = await import('../../apps/api/src/modules/fulfillment/fulfillment-test-helpers.js');
const { createErvePackingList } =
  await import('../../apps/api/src/modules/fulfillment/erve-dispatch.service.js');
const { eligibleCartonCandidateQuery } =
  await import('../../apps/api/src/modules/fulfillment/eligible-carton-pagination.js');
const { currentUserSelect, toCurrentUser } =
  await import('../../apps/api/src/auth/current-user.js');
const output = resolve('.data/carton-pagination');
await mkdir(output, { recursive: true });
const app = createApp();

try {
  await resetDatabase();
  const order = await helpers.createSingleFactoryApprovedSaleOrder(app, 1);
  const factoryToken = await helpers.createFactoryUserToken(order.stock.factoryId);
  const dispatch = await helpers.packAndFinalize(
    app,
    factoryToken,
    order.saleOrder.id,
    order.saleOrderLineId,
    order.saleOrder.destinations[0]!.id,
    1,
  );
  const original = await db.factoryPackingCarton.findUniqueOrThrow({
    where: { id: dispatch.cartonId },
    include: { audits: true },
  });
  const actor = toCurrentUser(
    await db.user.findUniqueOrThrow({
      where: { id: original.createdById },
      select: currentUserSelect,
    }),
  );
  // Use the actual authorized Merchandiser for service calls.
  const merch = await createTestUserAndToken({
    email: 'carton-browser@test.local',
    password: 'carton-browser-pass',
    roles: ['ADMIN'],
  });
  const admin = toCurrentUser(
    await db.user.findUniqueOrThrow({ where: { id: merch.userId }, select: currentUserSelect }),
  );
  assert.equal(actor.factoryIds[0], order.stock.factoryId);
  const list = await createErvePackingList(admin, { cartonIds: [original.id] });
  const second = await helpers.createSingleFactoryApprovedSaleOrder(app, 1, 'OUTRIGHT', {
    distributorId: order.stock.distributorId,
  });
  const secondToken = await helpers.createFactoryUserToken(second.stock.factoryId);
  const secondDispatch = await helpers.packAndFinalize(
    app,
    secondToken,
    second.saleOrder.id,
    second.saleOrderLineId,
    second.saleOrder.destinations[0]!.id,
    1,
  );
  await db.factoryPackingCarton.update({
    where: { id: secondDispatch.cartonId },
    data: { retiredAt: new Date() },
  });
  const destination = await db.saleOrderDestination.findUniqueOrThrow({
    where: { id: original.destinationId },
  });
  const otherDistributor = await createTestDistributor();
  const otherGroup = await db.saleOrderDistributor.create({
    data: {
      id: 'bench-other-group',
      saleOrderId: order.saleOrder.id,
      distributorId: otherDistributor.id,
      purchaseMode: 'OUTRIGHT',
    },
  });
  const destinations = [
    destination,
    await db.saleOrderDestination.create({
      data: { ...destination, id: 'bench-other-address', addressLine1: 'Other street, same city' },
    }),
    await db.saleOrderDestination.create({
      data: {
        ...destination,
        id: 'bench-other-distributor',
        saleOrderDistributorId: otherGroup.id,
      },
    }),
  ];
  const secondDestination = await db.saleOrderDestination.findUniqueOrThrow({
    where: { id: second.saleOrder.destinations[0]!.id },
  });
  const secondGroup = await db.saleOrderDistributor.create({
    data: {
      id: 'bench-second-other-group',
      saleOrderId: second.saleOrder.id,
      distributorId: otherDistributor.id,
      purchaseMode: 'OUTRIGHT',
    },
  });
  destinations.push(
    secondDestination,
    await db.saleOrderDestination.create({
      data: {
        ...secondDestination,
        id: 'bench-second-other-address',
        addressLine1: 'Other street, same city',
      },
    }),
    await db.saleOrderDestination.create({
      data: {
        ...secondDestination,
        id: 'bench-second-other-distributor',
        saleOrderDistributorId: secondGroup.id,
      },
    }),
  );
  await db.factoryDispatch.update({
    where: { id: secondDispatch.id },
    data: { factoryDispatchNumber: 'BENCH-LATE-FPL' },
  });
  const size = await db.size.findUniqueOrThrow({ where: { id: order.stock.sizeId } });
  const sourceLine = await db.saleOrderLine.findUniqueOrThrow({
    where: { id: order.saleOrderLineId },
  });
  const lineIds: string[][] = destinations.map(() => []);
  for (let n = 0; n < 8; n++) {
    const sizeId = `bench-size-${n}`;
    await db.size.create({
      data: { ...size, id: sizeId, code: `BENCH-${n}`, label: `Bench size ${n}` },
    });
    for (let d = 0; d < destinations.length; d++) {
      const id = `bench-line-${d}-${n}`;
      await db.saleOrderLine.create({
        data: {
          ...sourceLine,
          id,
          destinationId: destinations[d]!.id,
          saleOrderId: destinations[d]!.saleOrderId,
          sizeId,
          quantity: 12000,
        },
      });
      lineIds[d]!.push(id);
    }
  }
  const count = 12000;
  const time = new Date('2026-01-01T00:00:00Z');
  const cartons = Array.from({ length: count }, (_, n) => {
    const destinationIndex =
      (n % 19 === 0 ? 2 : n < 10600 || n % 17 !== 0 ? 1 : 0) + (n % 2 ? 3 : 0);
    return {
      id: `bench-carton-${String(n).padStart(5, '0')}`,
      factoryDispatchId: n % 2 ? secondDispatch.id : dispatch.id,
      destinationId: destinations[destinationIndex]!.id,
      cartonNumber: `BENCH-CTN-${n}`,
      createdById: original.createdById,
      createdAt: time,
      version: n >= 9500 && n < 10000 ? 4 : 3,
      ervePackingListId: n < 6000 ? list.id : null,
      retiredAt: n >= 6000 && n < 9000 ? time : null,
      netWeight: '1.250',
      grossWeight: '1.500',
      dimensions: '40 x 30 x 20',
      packageDetails: 'Synthetic benchmark carton',
      destinationIndex,
    };
  });
  for (let start = 0; start < count; start += 1000) {
    await db.factoryPackingCarton.createMany({
      data: cartons.slice(start, start + 1000).map(({ destinationIndex: _index, ...data }) => data),
    });
    await db.factoryPackingCartonLine.createMany({
      data: cartons.slice(start, start + 1000).flatMap((carton) =>
        lineIds[carton.destinationIndex]!.map((saleOrderLineId, n) => ({
          id: `${carton.id}-line-${n}`,
          cartonId: carton.id,
          saleOrderLineId,
          quantity: 1,
        })),
      ),
    });
    await db.factoryPackingCartonAudit.createMany({
      data: cartons.slice(start, start + 1000).flatMap((carton, offset) => {
        const n = start + offset;
        if (n >= 9000 && n < 9500) return [];
        return Array.from({ length: n >= 10000 && n < 10050 ? 4 : 3 }, (_, a) => ({
          id: `${carton.id}-audit-${a}`,
          cartonId: carton.id,
          cartonVersion: a + 1,
          inspectedById: original.audits[0]!.inspectedById,
        }));
      }),
    });
  }
  // Statistics only, on this guarded disposable database; no index/schema changes.
  await db.$executeRawUnsafe('ANALYZE');

  async function measure(filters: {
    ervePackingListId?: string;
    limit?: number;
    search?: string;
    cursor?: string;
  }) {
    globalThis.gc?.();
    const before = process.memoryUsage();
    events.length = 0;
    hydratedRecords = 0;
    const start = performance.now();
    const response = await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${merch.token}`)
      .query(filters)
      .expect(200);
    const data = response.body.data;
    const ms = performance.now() - start;
    const queries = events.splice(0);
    const after = process.memoryUsage();
    return {
      data,
      stats: {
        fullCartonsHydrated: hydratedRecords,
        ms,
        sqlQueries: queries.length,
        sqlDurationMs: queries.reduce((sum, q) => sum + q.duration, 0),
        responseBytes: Buffer.byteLength(response.text),
        heapDeltaBytes: after.heapUsed - before.heapUsed,
        rssDeltaBytes: after.rss - before.rss,
      },
      queries,
    };
  }
  const rows: unknown[] = [];
  let legacyQueries: typeof events = [];
  for (const [name, filters] of [
    ['all', {}],
    ['destination', { ervePackingListId: list.id }],
  ] as const) {
    const old = await measure(filters);
    assert.ok(Array.isArray(old.data));
    if (name === 'all') legacyQueries = old.queries;
    const first = await measure({ ...filters, limit: 25 });
    assert.ok(!Array.isArray(first.data));
    const all: unknown[] = [];
    const pages: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await measure({ ...filters, limit: 25, ...(cursor ? { cursor } : {}) });
      assert.ok(!Array.isArray(page.data));
      all.push(...page.data.items);
      const position = cursor
        ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        : undefined;
      const candidates = await db.$queryRaw<Array<{ id: string }>>(
        eligibleCartonCandidateQuery({
          search: '',
          distributorId: name === 'destination' ? order.stock.distributorId : undefined,
          position: position ? { id: position.id, createdAt: new Date(position.at) } : undefined,
        }),
      );
      const next = page.data.pageInfo.nextCursor;
      const examined = next
        ? candidates.findIndex(
            (c) => c.id === JSON.parse(Buffer.from(next, 'base64url').toString('utf8')).id,
          ) + 1
        : candidates.length;
      pages.push({
        ...page.stats,
        slimRowsFetched: candidates.length,
        candidatesExamined: examined,
      });
      assert.ok(examined <= 200);
      assert.ok(page.data.items.length <= 25);
      cursor = next ?? undefined;
    } while (cursor);
    // Exact complete projections, not just counts or IDs; ordering is deterministic.
    const sort = (items: unknown[]) =>
      [...items].sort((a, b) => (a as { id: string }).id.localeCompare((b as { id: string }).id));
    assert.deepEqual(sort(all), sort(old.data));
    rows.push({
      name,
      legacy: { ...old.stats, eligible: old.data.length },
      boundedFirst: {
        ...first.stats,
        returned: first.data.items.length,
        hasMore: first.data.pageInfo.hasMore,
      },
      parityCount: all.length,
      pages,
    });
  }
  const searches = [];
  for (const search of [
    'bench-ctn-10050',
    'BENCH-CTN-11999',
    'bench-late-fpl',
    order.saleOrder.saleOrderNumber.toLowerCase(),
    '%_',
  ]) {
    const result = await measure({ limit: 25, search });
    assert.ok(!Array.isArray(result.data));
    searches.push({ search, ...result.stats, returned: result.data.items.length });
  }
  const candidate = eligibleCartonCandidateQuery({ search: '' });
  const candidatePlan = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${candidate}`,
  );
  const sparsePlan = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${eligibleCartonCandidateQuery({ search: '', distributorId: order.stock.distributorId })}`,
  );
  const lateSearchPlan = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${eligibleCartonCandidateQuery({ search: 'bench-ctn-11999' })}`,
  );
  const oldCartonQuery = legacyQueries.find((q) =>
    q.query.includes('FROM "public"."factory_packing_cartons"'),
  )!;
  assert.ok(oldCartonQuery);
  const legacyPlan = await db.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${oldCartonQuery.query}`,
    ...JSON.parse(oldCartonQuery.params),
  );
  const report = {
    identity,
    count,
    packedLines: count * 8,
    auditRows: await db.factoryPackingCartonAudit.count(),
    categories: {
      claimed: 6000,
      retired: 3000,
      missingAudits: 500,
      staleAudits: 500,
      futureAudits: 50,
      eligible: 1950,
    },
    rows,
    searches,
    candidatePlan,
    sparsePlan,
    lateSearchPlan,
    legacyPlan,
    caveat:
      'Single local synthetic run, live inventory, no constant-time SQL claim. Heap/RSS deltas are noisy; candidate work bound applies to Node rows, not PostgreSQL scans.',
  };
  await writeFile(resolve(output, 'benchmark.json'), JSON.stringify(report, null, 2));
  await writeFile(
    resolve(output, 'browser-fixtures.json'),
    JSON.stringify({
      listId: list.id,
      email: 'carton-browser@test.local',
      password: 'carton-browser-pass',
    }),
  );
  console.log(JSON.stringify({ parity: rows, searches }, null, 2));
} finally {
  await db.$disconnect();
}
