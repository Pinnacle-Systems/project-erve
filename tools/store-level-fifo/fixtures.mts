import { writeFile } from 'node:fs/promises';
import request from '../../apps/api/node_modules/supertest/index.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';
import { fifoBrowserTarget } from './safety.mjs';

// Disposable browser-review world for ISS-089 (Store-level FIFO), built through the real
// Packing -> Erve Packing List -> Dispatch -> Distributor receipt flows. Refuses to run unless
// pointed at the explicit fifo_browser_test database.
const target = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});
fifoBrowserTarget(target.url, process.env.DATABASE_URL);
process.env.DATABASE_URL = target.url;
process.env.NODE_ENV = 'test';
const { createApp } = await import('../../apps/api/src/app.js');
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const base = await import('../../apps/api/src/test/helpers.js');
const { createId } = await import('../../packages/shared/src/id.js');
const helpers = await import('../../apps/api/src/modules/fulfillment/fulfillment-test-helpers.js');

const DAY = 24 * 60 * 60 * 1000;
const app = createApp();
try {
  await base.resetDatabase();
  const distributor = await base.createTestDistributor({ purchaseMode: 'SALE_RETURN', name: 'FIFO Review Distributor' });
  const distributorToken = await helpers.createDistributorToken(distributor.id);
  const admin = await helpers.createRoleToken('ADMIN');
  const season = await base.createTestSeason();
  const tee = await prisma.style.create({
    data: { id: createId(), styleNumber: 'TEE-2027', styleName: 'Graphic tee, crew neck', finalMrp: 100, seasonId: season.id },
  });
  const sizes: Record<string, { id: string }> = {};
  for (const [code, order] of [['S', 1], ['M', 2], ['L', 3]] as const) {
    sizes[code] = await prisma.size.create({
      data: { id: createId(), code: `${code}-${createId().slice(-4)}`, label: code, sizeType: 'ALPHA', sortOrder: order },
    });
  }
  const alpha = await base.createTestRetailStore(distributor.id, { name: 'Alpha Mall — Level 2 Flagship Outlet', code: 'ALPHA-01', city: 'Chennai' });
  const beta = await base.createTestRetailStore(distributor.id, { name: 'Beta Plaza', code: 'BETA-02', city: 'Bengaluru', state: 'Karnataka' });

  async function shipAndReceive(store: { id: string }, sizeCode: 'S' | 'M' | 'L', quantity: number, receivedDaysAgo: number) {
    const sizeId = sizes[sizeCode]!.id;
    // A Dispatch Order splits a Style total across its active Sizes: only the shipped one may be active.
    for (const size of Object.values(sizes)) {
      const existing = await prisma.styleSize.findFirst({ where: { styleId: tee.id, sizeId: size.id } });
      const status = size.id === sizeId ? 'ACTIVE' : 'INACTIVE';
      if (existing) await prisma.styleSize.update({ where: { id: existing.id }, data: { status } });
      else await prisma.styleSize.create({ data: { id: createId(), styleId: tee.id, sizeId: size.id, status } });
    }
    const factory = await base.createTestFactory();
    const factoryToken = await helpers.createFactoryUserToken(factory.id);
    const f = await helpers.createApprovedSaleOrder(app, {
      distributorId: distributor.id,
      factoryId: factory.id,
      quantity,
      retailStoreId: store.id,
      styleId: tee.id,
      sizeId,
    });
    const packed = await helpers.packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, quantity);
    const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
    await request(app)
      .post(`/erve-dispatches/${dispatch.id}/distributor-receipt`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: dispatch.version, acknowledged: true, remarks: 'Browser review receipt', groups: [{ styleId: tee.id, sizeId, receivedQuantity: quantity }] })
      .expect(201);
    await prisma.erveDispatch.update({ where: { id: dispatch.id }, data: { deliveredAt: new Date(Date.now() - receivedDaysAgo * DAY) } });
    return dispatch.id as string;
  }

  // Alpha M: the NEWER Dispatch (40) is created first on purpose; FIFO must still consume the older 60 first.
  const alphaMNewer = await shipAndReceive(alpha, 'M', 40, 5);
  const alphaMOlder = await shipAndReceive(alpha, 'M', 60, 20);
  await shipAndReceive(alpha, 'L', 20, 3);
  await shipAndReceive(beta, 'M', 30, 2);

  const users = {
    distributor: (await prisma.userDistributor.findFirstOrThrow({ where: { distributorId: distributor.id }, include: { user: true } })).user,
    admin: await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } }),
  };
  const emails: Record<string, string> = {};
  for (const [key, user] of Object.entries(users)) {
    emails[key] = user.email.toLowerCase();
    await prisma.user.update({ where: { id: user.id }, data: { email: emails[key] } });
  }
  await writeFile(
    process.env.FIFO_FIXTURES!,
    JSON.stringify({ distributorId: distributor.id, emails, password: 'pass', dispatches: { alphaMNewer, alphaMOlder } }),
  );
} finally {
  await prisma.$disconnect();
}
