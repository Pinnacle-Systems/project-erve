import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const target = new URL(process.env.DATABASE_URL ?? '');
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ['127.0.0.1', '55452', '/erve_batch10_carton_pagination_test', 'cartonpagination'],
);
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const { currentUserSelect, toCurrentUser } =
  await import('../../apps/api/src/auth/current-user.js');
const { createErvePackingList, removeErvePackingListCarton } =
  await import('../../apps/api/src/modules/fulfillment/erve-dispatch.service.js');
const fixture = JSON.parse(await readFile('.data/carton-pagination/browser-fixtures.json', 'utf8'));
try {
  assert.deepEqual(
    await prisma.$queryRaw`SELECT current_database() AS database, current_user AS "user"`,
    [{ database: 'erve_batch10_carton_pagination_test', user: 'cartonpagination' }],
  );
  const actor = toCurrentUser(
    await prisma.user.findUniqueOrThrow({
      where: { email: fixture.email },
      select: currentUserSelect,
    }),
  );
  // Make the browser scenario repeatable through the actual removal mutation.
  const previous = await prisma.factoryPackingCarton.findMany({
    where: {
      id: { startsWith: 'bench-carton-', gte: 'bench-carton-10050' },
      ervePackingListId: { not: null },
    },
  });
  for (const carton of previous)
    await removeErvePackingListCarton(actor, carton.ervePackingListId!, carton.id);

  // The volume benchmark's 6000 historical claims must not appear in the small
  // OPEN list rendered by browser acceptance. Keep them claimed in two separate,
  // commercially compatible historical fixture lists, preserving discovery data.
  const history = await prisma.factoryPackingCarton.findMany({
    where: {
      ervePackingListId: fixture.listId,
      id: { startsWith: 'bench-carton-', lt: 'bench-carton-06000' },
    },
    select: { id: true },
  });
  for (const otherDistributor of [true, false]) {
    const ids = history
      .filter(({ id }) => (Number(id.slice(-5)) % 19 === 0) === otherDistributor)
      .map(({ id }) => id);
    if (!ids.length) continue;
    await prisma.factoryPackingCarton.update({
      where: { id: ids[0] },
      data: { ervePackingListId: null },
    });
    const list = await createErvePackingList(actor, { cartonIds: [ids[0]!] });
    await prisma.factoryPackingCarton.updateMany({
      where: { id: { in: ids } },
      data: { ervePackingListId: list.id },
    });
  }
  console.log(
    JSON.stringify({
      historicalClaimsSeparated: history.length,
      previousSelectionsRemoved: previous.length,
      activeListCartons: await prisma.factoryPackingCarton.count({
        where: { ervePackingListId: fixture.listId },
      }),
    }),
  );
} finally {
  await prisma.$disconnect();
}
