import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import request from '../../apps/api/node_modules/supertest/index.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';
import { sorStockBrowserTarget } from './safety.mjs';

// Disposable browser-review world for the Style-first Sale-or-Return Stock screens, built through the
// real Packing -> Erve Packing List -> Dispatch -> receipt -> Sales Report / Return flows. Synthetic
// names only - no customer data. Refuses to run unless pointed at the explicit sor_stock_browser_test database.
const target = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});
sorStockBrowserTarget(target.url, process.env.DATABASE_URL);
process.env.DATABASE_URL = target.url;
process.env.NODE_ENV = 'test';
const { createApp } = await import('../../apps/api/src/app.js');
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const base = await import('../../apps/api/src/test/helpers.js');
const { createId } = await import('../../packages/shared/src/id.js');
const helpers = await import('../../apps/api/src/modules/fulfillment/fulfillment-test-helpers.js');

const EXTRA_DISPATCHES = 30; // clones of the first Tee dispatch: the Dispatch table must page (25 per page)

function solidPng(rgb: [number, number, number], side = 96): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: side }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: side }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const app = createApp();
try {
  await base.resetDatabase();
  const distA = await base.createTestDistributor({ purchaseMode: 'SALE_RETURN', name: 'Review Distributor A' });
  const distB = await base.createTestDistributor({ purchaseMode: 'SALE_RETURN', name: 'Review Distributor B' });
  const tokenA = await helpers.createDistributorToken(distA.id);
  const tokenB = await helpers.createDistributorToken(distB.id);
  const admin = await helpers.createRoleToken('ADMIN');
  const accountant = await helpers.createRoleToken('ACCOUNTANT');
  const merch = await helpers.createRoleToken('MERCHANDISER');
  const season = await base.createTestSeason();
  const mkStyle = (styleNumber: string, styleName: string) =>
    prisma.style.create({ data: { id: createId(), styleNumber, styleName, finalMrp: 100, seasonId: season.id } });
  const mkSizes = async (specs: Array<[string, number]>) => {
    const out = [];
    for (const [code, order] of specs)
      out.push(
        await prisma.size.create({
          data: { id: createId(), code: `${code}-${createId().slice(-4)}`, label: code, sizeType: 'ALPHA', sortOrder: order },
        }),
      );
    return out;
  };
  const tee = await mkStyle('TEE-2027', 'Graphic tee, crew neck');
  const jeans = await mkStyle('JEAN-2027', 'Slim fit denim');
  const hood = await mkStyle('HOOD-2027', 'Style carried by Distributor B only');
  const [s, m, l, xl] = await mkSizes([
    ['S', 1],
    ['M', 2],
    ['L', 3],
    ['XL', 4],
  ]);
  const [w30, w32] = await mkSizes([
    ['30', 30],
    ['32', 32],
  ]);
  const alpha = await base.createTestRetailStore(distA.id, { name: 'Alpha Mall — Level 2 Flagship Outlet', code: 'ALPHA-01', city: 'Chennai' });
  const beta = await base.createTestRetailStore(distA.id, { name: 'Beta Plaza', code: 'BETA-02', city: 'Bengaluru', state: 'Karnataka' });
  const gamma = await base.createTestRetailStore(distB.id, { name: 'Gamma Outlet', code: 'GAMMA-03', city: 'Mumbai', state: 'Maharashtra' });

  const setSizes = async (styleId: string, sizes: Array<{ id: string }>, only?: string) => {
    for (const size of sizes) {
      const active = only === undefined || size.id === only;
      const existing = await prisma.styleSize.findFirst({ where: { styleId, sizeId: size.id } });
      if (existing) await prisma.styleSize.update({ where: { id: existing.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
      else await prisma.styleSize.create({ data: { id: createId(), styleId, sizeId: size.id, status: active ? 'ACTIVE' : 'INACTIVE' } });
    }
  };
  async function ship(opts: {
    distributor: { id: string };
    store: { id: string };
    styleId: string;
    styleSizes: Array<{ id: string }>;
    sizeId: string;
    quantity: number;
    mode?: 'OUTRIGHT' | 'SALE_RETURN';
  }) {
    await setSizes(opts.styleId, opts.styleSizes, opts.sizeId);
    const factory = await base.createTestFactory();
    const factoryToken = await helpers.createFactoryUserToken(factory.id);
    const f = await helpers.createApprovedSaleOrder(app, {
      distributorId: opts.distributor.id,
      factoryId: factory.id,
      quantity: opts.quantity,
      retailStoreId: opts.store.id,
      styleId: opts.styleId,
      sizeId: opts.sizeId,
    });
    if (opts.mode) await prisma.saleOrderDistributor.updateMany({ where: { saleOrderId: f.saleOrder.id }, data: { purchaseMode: opts.mode } });
    const packed = await helpers.packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, opts.quantity);
    const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
    return { ...f, dispatch, cartonId: packed.cartonId as string, styleId: opts.styleId, sizeId: opts.sizeId };
  }
  const attest = (f: Awaited<ReturnType<typeof ship>>, token: string, received: number) =>
    request(app)
      .post(`/erve-dispatches/${f.dispatch.id}/distributor-receipt`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: f.dispatch.version,
        acknowledged: true,
        remarks: 'Browser review receipt',
        groups: [{ styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: received }],
      })
      .expect(201);
  const teeSizes = [s!, m!, l!, xl!];

  // Distributor A / Alpha Mall: Tee M shipped twice (one short-received, one awaiting), Tee L confirmed with a sale and returns.
  const teeM1 = await ship({ distributor: distA, store: alpha, styleId: tee.id, styleSizes: teeSizes, sizeId: m!.id, quantity: 40 });
  await attest(teeM1, tokenA, 30);
  await ship({ distributor: distA, store: alpha, styleId: tee.id, styleSizes: teeSizes, sizeId: m!.id, quantity: 20 });
  const teeL = await ship({ distributor: distA, store: alpha, styleId: tee.id, styleSizes: teeSizes, sizeId: l!.id, quantity: 25 });
  await helpers.confirmErveDispatchDelivery(app, teeL.merchToken, teeL.dispatch.id, teeL.dispatch.version, [
    { saleOrderLineId: teeL.saleOrderLineId, receivedQuantity: 25 },
  ]);
  await request(app)
    .post('/distributor-sales-reports')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ distributorId: distA.id, reportDate: '2026-08-01', lines: [{ erveDispatchId: teeL.dispatch.id, saleOrderLineId: teeL.saleOrderLineId, quantitySold: 5 }] })
    .expect(201);
  // One approved return (awaiting physical receipt) and one pending request on the same source.
  const returnBody = (quantity: number) => ({
    distributorId: distA.id,
    returnDate: '2026-08-02',
    returnReason: 'Unsold',
    lines: [{ erveDispatchId: teeL.dispatch.id, saleOrderLineId: teeL.saleOrderLineId, requestedQuantity: quantity }],
  });
  const approvedReturn = (await request(app).post('/distributor-returns').set('Authorization', `Bearer ${tokenA}`).send(returnBody(3)).expect(201)).body.data;
  await request(app)
    .post(`/distributor-returns/${approvedReturn.id}/approve`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ expectedVersion: approvedReturn.version, lines: [{ id: approvedReturn.lines[0].id, approvedQuantity: 3 }] })
    .expect(200);
  await request(app).post('/distributor-returns').set('Authorization', `Bearer ${tokenA}`).send(returnBody(2)).expect(201);

  // Jeans 32 at Alpha: legacy assumed receipt. Jeans 30 at Beta: OUTRIGHT (must never appear in consignment stock).
  const jeans32 = await ship({ distributor: distA, store: alpha, styleId: jeans.id, styleSizes: [w30!, w32!], sizeId: w32!.id, quantity: 15 });
  await helpers.confirmErveDispatchDelivery(app, jeans32.merchToken, jeans32.dispatch.id, jeans32.dispatch.version, [
    { saleOrderLineId: jeans32.saleOrderLineId, receivedQuantity: 15 },
  ]);
  await prisma.erveDispatch.update({ where: { id: jeans32.dispatch.id }, data: { deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' } });
  await ship({ distributor: distA, store: beta, styleId: jeans.id, styleSizes: [w30!, w32!], sizeId: w30!.id, quantity: 12, mode: 'OUTRIGHT' });

  // Distributor B / Gamma Outlet: the same Tee (attested in full) plus a Style only B carries.
  const teeB = await ship({ distributor: distB, store: gamma, styleId: tee.id, styleSizes: teeSizes, sizeId: m!.id, quantity: 18 });
  await attest(teeB, tokenB, 18);
  const hoodB = await ship({ distributor: distB, store: gamma, styleId: hood.id, styleSizes: [m!], sizeId: m!.id, quantity: 10 });
  await helpers.confirmErveDispatchDelivery(app, hoodB.merchToken, hoodB.dispatch.id, hoodB.dispatch.version, [
    { saleOrderLineId: hoodB.saleOrderLineId, receivedQuantity: 10 },
  ]);

  // Final native Size sets.
  await setSizes(tee.id, teeSizes);
  await setSizes(jeans.id, [w30!, w32!]);
  await setSizes(hood.id, [m!]);

  // Many more Dispatches of the same Tee/M source line (Distributor A / Alpha), so the Dispatch table must page.
  const pl = await prisma.ervePackingList.findFirstOrThrow({ where: { dispatch: { id: teeM1.dispatch.id } } });
  const dispatch = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: teeM1.dispatch.id } });
  const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: teeM1.cartonId } });
  for (let n = 1; n <= EXTRA_DISPATCHES; n += 1) {
    const plId = createId();
    const dispatchId = createId();
    const cartonId = createId();
    await prisma.ervePackingList.create({ data: { ...pl, id: plId, ervePackingListNumber: `${pl.ervePackingListNumber}-C${n}`, ervePackingListSerial: pl.ervePackingListSerial + 1000 + n } });
    await prisma.erveDispatch.create({
      data: {
        ...dispatch,
        id: dispatchId,
        ervePackingListId: plId,
        erveDispatchNumber: `${dispatch.erveDispatchNumber}-C${n}`,
        erveDispatchSerial: dispatch.erveDispatchSerial + 1000 + n,
        dispatchDate: new Date(Date.UTC(2026, 6, 1 + (n % 28))),
      },
    });
    await prisma.factoryPackingCarton.create({ data: { ...carton, id: cartonId, ervePackingListId: plId, cartonNumber: `CLN-${n}` } });
    await prisma.factoryPackingCartonLine.create({ data: { id: createId(), cartonId, saleOrderLineId: teeM1.saleOrderLineId, quantity: 4 } });
    await prisma.erveDispatchDeliveryLine.create({ data: { id: createId(), erveDispatchId: dispatchId, saleOrderLineId: teeM1.saleOrderLineId, receivedQuantity: 3 } });
  }

  // A real image for the Tee; the Jeans deliberately have none (placeholder).
  await request(app)
    .post(`/styles/${tee.id}/images`)
    .set('Authorization', `Bearer ${admin.token}`)
    .attach('image', solidPng([200, 70, 70]), { filename: 'tee.png', contentType: 'image/png' })
    .expect(201);

  // Token fixtures embed an uppercase ULID; browser login uses the canonical lowercase email.
  const emails: Record<string, string> = {};
  for (const [key, userId] of [
    ['admin', admin.userId],
    ['accountant', accountant.userId],
    ['merchandiser', merch.userId],
    ['distributorA', (await prisma.userDistributor.findFirstOrThrow({ where: { distributorId: distA.id } })).userId],
    ['distributorB', (await prisma.userDistributor.findFirstOrThrow({ where: { distributorId: distB.id } })).userId],
  ] as const) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    emails[key] = user.email.toLowerCase();
    await prisma.user.update({ where: { id: user.id }, data: { email: emails[key] } });
  }
  await writeFile(
    process.env.SOR_STOCK_FIXTURES!,
    JSON.stringify({
      distributorAId: distA.id,
      distributorBId: distB.id,
      teeStyleId: tee.id,
      emails,
      password: 'pass',
      extraDispatches: EXTRA_DISPATCHES,
    }),
  );
} finally {
  await prisma.$disconnect();
}
