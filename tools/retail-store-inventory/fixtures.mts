import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import request from '../../apps/api/node_modules/supertest/index.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';
import { a6BrowserTarget } from './safety.mjs';

// Disposable browser-review world for A6 / ISS-088, built through the real
// Packing -> Erve Packing List -> Dispatch -> receipt flows. Refuses to run
// unless pointed at the explicit a6_browser_test database.
const target = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});
a6BrowserTarget(target.url, process.env.DATABASE_URL);
process.env.DATABASE_URL = target.url;
process.env.NODE_ENV = 'test';
const { createApp } = await import('../../apps/api/src/app.js');
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const base = await import('../../apps/api/src/test/helpers.js');
const { createId } = await import('../../packages/shared/src/id.js');
const helpers = await import('../../apps/api/src/modules/fulfillment/fulfillment-test-helpers.js');

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
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: side }, () => rgb).flat()),
  ]);
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
  const distributor = await base.createTestDistributor({
    purchaseMode: 'SALE_RETURN',
    name: 'Browser Review Distributor',
  });
  const distributorToken = await helpers.createDistributorToken(distributor.id);
  const admin = await helpers.createRoleToken('ADMIN');
  const merch = await helpers.createRoleToken('MERCHANDISER');
  const season = await base.createTestSeason();
  const mkStyle = (styleNumber: string, styleName: string) =>
    prisma.style.create({
      data: { id: createId(), styleNumber, styleName, finalMrp: 100, seasonId: season.id },
    });
  const mkSizes = async (specs: Array<[string, number]>) => {
    const out = [];
    for (const [code, order] of specs)
      out.push(
        await prisma.size.create({
          data: {
            id: createId(),
            code: `${code}-${createId().slice(-4)}`,
            label: code,
            sizeType: 'ALPHA',
            sortOrder: order,
          },
        }),
      );
    return out;
  };
  const tee = await mkStyle('TEE-2027', 'Graphic tee, crew neck');
  const jeans = await mkStyle('JEAN-2027', 'Slim fit denim');
  const [s, m, l, xl] = await mkSizes([
    ['S', 1],
    ['M', 2],
    ['L', 3],
    ['XL', 4],
  ]);
  const [w28, w30, w32, w34] = await mkSizes([
    ['28', 28],
    ['30', 30],
    ['32', 32],
    ['34', 34],
  ]);
  const alpha = await base.createTestRetailStore(distributor.id, {
    name: 'Alpha Mall — Level 2 Flagship Outlet',
    code: 'ALPHA-01',
    city: 'Chennai',
  });
  const beta = await base.createTestRetailStore(distributor.id, {
    name: 'Beta Plaza',
    code: 'BETA-02',
    city: 'Bengaluru',
    state: 'Karnataka',
  });

  const setSizes = async (styleId: string, sizes: Array<{ id: string }>, only?: string) => {
    for (const size of sizes) {
      const active = only === undefined || size.id === only;
      const existing = await prisma.styleSize.findFirst({ where: { styleId, sizeId: size.id } });
      if (existing)
        await prisma.styleSize.update({
          where: { id: existing.id },
          data: { status: active ? 'ACTIVE' : 'INACTIVE' },
        });
      else
        await prisma.styleSize.create({
          data: {
            id: createId(),
            styleId,
            sizeId: size.id,
            status: active ? 'ACTIVE' : 'INACTIVE',
          },
        });
    }
  };
  async function ship(opts: {
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
      distributorId: distributor.id,
      factoryId: factory.id,
      quantity: opts.quantity,
      retailStoreId: opts.store.id,
      styleId: opts.styleId,
      sizeId: opts.sizeId,
    });
    if (opts.mode)
      await prisma.saleOrderDistributor.updateMany({
        where: { saleOrderId: f.saleOrder.id },
        data: { purchaseMode: opts.mode },
      });
    const packed = await helpers.packAndFinalize(
      app,
      factoryToken,
      f.saleOrder.id,
      f.saleOrderLineId,
      f.saleOrder.destinations[0].id,
      opts.quantity,
    );
    const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
    return {
      ...f,
      dispatch,
      destinationId: f.saleOrder.destinations[0].id as string,
      styleId: opts.styleId,
      sizeId: opts.sizeId,
    };
  }
  const attest = (
    f: Awaited<ReturnType<typeof ship>>,
    received: number,
    version = f.dispatch.version,
  ) =>
    request(app)
      .post(`/erve-dispatches/${f.dispatch.id}/distributor-receipt`)
      .set('Authorization', `Bearer ${distributorToken}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: version,
        acknowledged: true,
        remarks: 'Browser review receipt',
        groups: [{ styleId: f.styleId, sizeId: f.sizeId, receivedQuantity: received }],
      })
      .expect(201);

  // Alpha Mall: Tee M shipped twice (one short-received, one awaiting), Tee L admin-confirmed with a sale, Jeans 32 legacy-assumed.
  const teeM1 = await ship({
    store: alpha,
    styleId: tee.id,
    styleSizes: [s!, m!, l!, xl!],
    sizeId: m!.id,
    quantity: 40,
  });
  await attest(teeM1, 30);
  await ship({
    store: alpha,
    styleId: tee.id,
    styleSizes: [s!, m!, l!, xl!],
    sizeId: m!.id,
    quantity: 20,
  });
  const teeL = await ship({
    store: alpha,
    styleId: tee.id,
    styleSizes: [s!, m!, l!, xl!],
    sizeId: l!.id,
    quantity: 25,
  });
  const confirmed = await helpers.confirmErveDispatchDelivery(
    app,
    teeL.merchToken,
    teeL.dispatch.id,
    teeL.dispatch.version,
    [{ saleOrderLineId: teeL.saleOrderLineId, receivedQuantity: 25 }],
  );
  void confirmed;
  await request(app)
    .post('/distributor-sales-reports')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId: distributor.id,
      reportDate: '2026-08-01',
      lines: [
        {
          erveDispatchId: teeL.dispatch.id,
          saleOrderLineId: teeL.saleOrderLineId,
          quantitySold: 5,
        },
      ],
    })
    .expect(201);
  const jeans32 = await ship({
    store: alpha,
    styleId: jeans.id,
    styleSizes: [w28!, w30!, w32!, w34!],
    sizeId: w32!.id,
    quantity: 15,
  });
  await helpers.confirmErveDispatchDelivery(
    app,
    jeans32.merchToken,
    jeans32.dispatch.id,
    jeans32.dispatch.version,
    [{ saleOrderLineId: jeans32.saleOrderLineId, receivedQuantity: 15 }],
  );
  await prisma.erveDispatch.update({
    where: { id: jeans32.dispatch.id },
    data: { deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' },
  });

  // Beta Plaza: an Outright jeans shipment, awaiting confirmation.
  await ship({
    store: beta,
    styleId: jeans.id,
    styleSizes: [w28!, w30!, w32!, w34!],
    sizeId: w30!.id,
    quantity: 12,
    mode: 'OUTRIGHT',
  });
  // Historical destination with no Retail Store link.
  const old = await ship({
    store: beta,
    styleId: tee.id,
    styleSizes: [s!, m!, l!, xl!],
    sizeId: s!.id,
    quantity: 8,
  });
  await prisma.$executeRaw`UPDATE sale_order_destinations SET retail_store_id = NULL, label = 'Old Outlet (pre-store-master)', store_code = NULL, city = 'Mysuru' WHERE id = ${old.destinationId}`;

  // Final Size sets: the Tee's native S-XL (XL unshipped), the Jeans' numeric 28-34.
  await setSizes(tee.id, [s!, m!, l!, xl!]);
  await setSizes(jeans.id, [w28!, w30!, w32!, w34!]);

  // A real image for the Tee: Admin sees it, the Distributor must not.
  await request(app)
    .post(`/styles/${tee.id}/images`)
    .set('Authorization', `Bearer ${admin.token}`)
    .attach('image', solidPng([200, 70, 70]), { filename: 'tee.png', contentType: 'image/png' })
    .expect(201);

  // Token fixtures embed an uppercase ULID; browser login uses canonical email.
  const emails: Record<string, string> = {};
  for (const [key, userId] of [
    ['admin', admin.userId],
    [
      'distributor',
      (await prisma.userDistributor.findFirstOrThrow({ where: { distributorId: distributor.id } }))
        .userId,
    ],
  ] as const) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    emails[key] = user.email.toLowerCase();
    await prisma.user.update({ where: { id: user.id }, data: { email: emails[key] } });
  }
  void merch;
  await writeFile(
    process.env.A6_FIXTURES!,
    JSON.stringify({ distributorId: distributor.id, emails, password: 'pass' }),
  );
} finally {
  await prisma.$disconnect();
}
