import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { requireSafeTestDatabaseUrl } from './database-safety.js';

// This fixture creator is restricted to the disposable native-verification
// service database. Import business modules only after choosing the safe URL.
const safe = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});
const url = new URL(safe.url);
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  safe.databaseName !== 'erve_invoice_native_test'
)
  throw new Error('Native fixtures require the dedicated ephemeral GitHub test database');
process.env.DATABASE_URL = safe.url;
process.env.NODE_ENV = 'test';

const { prisma, Prisma } = await import('../db/prisma.js');
const { createApp } = await import('../app.js');
const { createId } = await import('@erve/shared');
const { default: request } = await import('supertest');
const { resetDatabase, createTestSellerRegistration, createTestUserAndToken } =
  await import('./helpers.js');
const {
  createSingleFactoryApprovedSaleOrder,
  createFactoryUserToken,
  packAndFinalize,
  ensureActiveDistributorPricing,
} = await import('../modules/fulfillment/fulfillment-test-helpers.js');
const app = createApp();

// Synthetic fixture markers, not photographs or images borrowed from another
// Style. Each marker is generated for its own Style, at original resolution.
function markerPng(index: number): Buffer {
  const width = index % 2 ? 192 : 320;
  const height = index % 2 ? 320 : 192;
  const channels = index === 1 ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * channels + 1) + 1 + x * channels;
      const band = x < 8 || y < 8 || x >= width - 8 || y >= height - 8 || (x + index * 9) % 47 < 7;
      raw[offset] = band ? 245 : index % 2 ? 32 : 196;
      raw[offset + 1] = band ? 245 : 54 + index * 5;
      raw[offset + 2] = band ? 245 : index % 2 ? 98 : 67;
      if (channels === 4)
        raw[offset + 3] = x < 8 || y < 8 || x >= width - 8 || y >= height - 8 ? 0 : 255;
    }
  function chunk(name: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await resetDatabase();
  await createTestSellerRegistration({
    branchCode: 'NATIVE-TEST',
    legalName: 'ERVE Native Acceptance — Synthetic Seller',
  });
  const password = randomBytes(20).toString('base64url');
  const actors = {} as Record<
    'accountant' | 'admin' | 'restricted',
    { email: string; password: string; token: string }
  >;
  for (const [name, role] of [
    ['accountant', 'ACCOUNTANT'],
    ['admin', 'ADMIN'],
    ['restricted', 'MERCHANDISER'],
  ] as const) {
    const email = `native-${name}@erve.test`;
    const user = await createTestUserAndToken({ email, password, roles: [role] });
    await prisma.user.update({ where: { id: user.userId }, data: { name: `Native ${name}` } });
    actors[name] = { email, password, token: user.token };
  }
  let marker = 0;
  async function source(
    quantity: number,
    distributorId?: string,
    image = true,
    hsn = true,
    shared?: { styleId: string; sizeId: string },
  ) {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, 'OUTRIGHT', {
      distributorId,
      ...shared,
    });
    marker++;
    const styleNumber = shared
      ? (await prisma.style.findUniqueOrThrow({ where: { id: shared.styleId } })).styleNumber
      : `UAT-STYLE-${String(marker).padStart(2, '0')}`;
    if (!shared)
      await prisma.style.update({
        where: { id: fixture.stock.styleId },
        data: {
          styleNumber,
          styleName: `Synthetic native marker ${marker}`,
          colour: marker % 2 ? 'Navy' : 'Coral',
          finalMrp: '3499.99',
          description: 'Disposable native acceptance data',
        },
      });
    await prisma.distributor.update({
      where: { id: fixture.stock.distributorId },
      data: {
        name: 'Native acceptance buyer — long recipient and distribution department',
        addressLine1: '123 Verification Road, Building 8, Distribution and Accounts Department',
        addressLine2: 'Long address wrapping fixture, not a real recipient',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        postalCode: '400001',
        gstin: '27AAAAA0000A1Z5',
      },
    });
    if (hsn && !shared) {
      const rule = createId();
      const version = createId();
      const hsnId = createId();
      await prisma.gstRuleSet.create({
        data: { id: rule, code: `NATIVE-${marker}`, name: 'Synthetic garment test rule' },
      });
      await prisma.gstRuleSetVersion.create({
        data: {
          id: version,
          gstRuleSetId: rule,
          versionNumber: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2017-07-01'),
        },
      });
      await prisma.gstValueBand.createMany({
        data: [
          {
            id: createId(),
            gstRuleSetVersionId: version,
            minValue: null,
            maxValue: 2500,
            gstPercent: 5,
          },
          {
            id: createId(),
            gstRuleSetVersionId: version,
            minValue: 2500,
            maxValue: null,
            gstPercent: 18,
          },
        ],
      });
      await prisma.hsn.create({
        data: { id: hsnId, code: `6109${String(marker).padStart(4, '0')}`, gstRuleSetId: rule },
      });
      await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { hsnId } });
    }
    let expectedImageChecksum: string | null = null;
    if (image && !shared) {
      const png = markerPng(marker);
      expectedImageChecksum = createHash('sha256').update(png).digest('hex');
      await request(app)
        .post(`/styles/${fixture.stock.styleId}/images`)
        .set('Authorization', `Bearer ${actors.admin.token}`)
        .attach('image', png, { filename: `${styleNumber}.png`, contentType: 'image/png' })
        .expect(201);
    }
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const packed = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      quantity,
    );
    return { fixture, cartonId: packed.cartonId, styleNumber, expectedImageChecksum };
  }
  async function invoice(
    sources: Awaited<ReturnType<typeof source>>[],
    finalize = false,
    rate?: number,
  ) {
    const first = sources[0]!;
    const packing = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${first.fixture.merchToken}`)
      .send({ cartonIds: sources.map((item) => item.cartonId) })
      .expect(201);
    const eiplId = packing.body.data.id as string;
    await ensureActiveDistributorPricing(first.fixture.stock.distributorId);
    await request(app)
      .post(`/erve-packing-lists/${eiplId}/finalize`)
      .set('Authorization', `Bearer ${first.fixture.merchToken}`)
      .send({})
      .expect(200);
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${actors.accountant.token}`)
      .send({ ervePackingListId: eiplId })
      .expect(201);
    if (rate !== undefined)
      await request(app)
        .patch(`/tax-invoices/${draft.body.data.id}/lines/${draft.body.data.lines[0].id}/override`)
        .set('Authorization', `Bearer ${actors.accountant.token}`)
        .send({ overrideUnitRate: rate, reason: 'Synthetic approved payable-rounding example' })
        .expect(200);
    const result = finalize
      ? await request(app)
          .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
          .set('Authorization', `Bearer ${actors.accountant.token}`)
          .send({})
          .expect(200)
      : draft;
    return {
      id: result.body.data.id as string,
      eiplNumber: packing.body.data.ervePackingListNumber as string,
      sources: sources.map((item) => ({
        styleId: item.fixture.stock.styleId,
        styleNumber: item.styleNumber,
        expectedImageChecksum: item.expectedImageChecksum,
      })),
      invoice: result.body.data,
    };
  }
  const issued = await invoice([await source(20)], true, 2097.6);
  const drafts = [];
  for (let i = 0; i < 3; i++) drafts.push(await invoice([await source(7)]));
  const blocked = await invoice([await source(1, undefined, false, false)]);
  // Synthetic legacy fixture initialization only, in the new empty test DB.
  const legacy = await invoice([await source(1, undefined, false)], true);
  await prisma.taxInvoice.update({
    where: { id: legacy.id },
    data: {
      documentSnapshot: Prisma.DbNull,
      payableTotal: null,
      roundOffAdjustment: null,
      roundingPolicy: null,
    },
  });
  const multiSources = [];
  let distributorId: string | undefined;
  for (let i = 0; i < 9; i++) {
    const item = await source(3, distributorId);
    distributorId ??= item.fixture.stock.distributorId;
    multiSources.push(item);
  }
  const multi = await invoice(multiSources, true);
  let grouped: Awaited<ReturnType<typeof invoice>> | undefined;
  let groupedIssued: Awaited<ReturnType<typeof invoice>> | undefined;
  if (process.env.NATIVE_VERIFY_GROUPING === 'true') {
    async function groupedSources() {
      const first = await source(2);
      await prisma.size.update({
        where: { id: first.fixture.stock.sizeId },
        data: { label: '3', sortOrder: 3 },
      });
      await prisma.style.update({
        where: { id: first.fixture.stock.styleId },
        data: {
          styleName: 'Synthetic grouped Style with a long description for compact invoice review',
          // A synthetic two-decimal calculated rate permits split/rejoin through
          // the unchanged currency override validation (never round a real rate).
          finalMrp: '200.00',
        },
      });
      const sources = [first];
      for (const label of [8, 4, 7, 5, 6]) {
        const size = await prisma.size.create({
          data: {
            id: createId(),
            code: `ISS015-${first.fixture.stock.styleId}-${label}`,
            label: String(label),
            sizeType: 'AGE',
            sortOrder: label,
          },
        });
        sources.push(
          await source(2, first.fixture.stock.distributorId, false, true, {
            styleId: first.fixture.stock.styleId,
            sizeId: size.id,
          }),
        );
      }
      return sources;
    }
    grouped = await invoice(await groupedSources());
    const issuedSources = await groupedSources();
    groupedIssued = await invoice(issuedSources);
    await request(app)
      .patch(
        `/tax-invoices/${groupedIssued.id}/lines/${groupedIssued.invoice.lines[0].id}/override`,
      )
      .set('Authorization', `Bearer ${actors.accountant.token}`)
      .send({ overrideUnitRate: 75.5, reason: 'Synthetic incompatible-rate group' })
      .expect(200);
    groupedIssued.invoice = (
      await request(app)
        .post(`/tax-invoices/${groupedIssued.id}/actions/finalize`)
        .set('Authorization', `Bearer ${actors.accountant.token}`)
        .send({})
        .expect(200)
    ).body.data;
  }
  if (process.env.NATIVE_VERIFY_PDF === 'true') {
    // Mutate only this disposable Style after issuance. The archived bytes and
    // issued presentation must remain independent of the current master.
    const styleId = issued.sources[0]!.styleId;
    const images = await prisma.styleImage.findMany({ where: { styleId } });
    for (const image of images)
      await request(app)
        .put(`/styles/${styleId}/images/${image.id}`)
        .set('Authorization', `Bearer ${actors.admin.token}`)
        .attach('image', markerPng(101), { filename: 'replacement.png', contentType: 'image/png' })
        .expect(200);
    await prisma.style.update({
      where: { id: styleId },
      data: {
        styleName: 'EDITED-AFTER-ISSUE',
        description: 'Edited current master',
        colour: 'Edited',
      },
    });
  }
  const fixturePath = path.resolve(
    process.env.NATIVE_FIXTURE_PATH ?? '.artifacts/native-invoice-fixtures.json',
  );
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  // Private inputs are not uploaded with browser evidence.
  await fs.writeFile(
    fixturePath,
    JSON.stringify(
      { actors, issued, drafts, blocked, legacy, multi, grouped, groupedIssued },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Prepared synthetic native fixtures in ${safe.databaseName}`);
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Native fixture preparation failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
