// ISS-075 — external-user confidentiality for post-dispatch workflows.
//
// Exercises real HTTP requests (supertest against createApp) as ADMIN, MERCHANDISER, two
// Distributors, two Factories, two Transporters, ACCOUNTANT and an unauthenticated caller, over
// a disposable database. Disclosure assertions search every serialized response for unique
// markers that belong to the *other* counterparty, rather than checking individual field names,
// so a newly added nested field cannot silently leak.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createId } from '@erve/shared';
vi.hoisted(() => {
  vi.stubEnv('CARTON_DELIVERY_ENABLED', 'true');
  vi.stubEnv('CARTON_DELIVERY_PUBLIC_ORIGIN', 'https://delivery.example');
  vi.stubEnv('CARTON_DELIVERY_ACTIVE_KEY', 'test-v1');
  vi.stubEnv(
    'CARTON_DELIVERY_KEYS',
    JSON.stringify({ 'test-v1': Buffer.alloc(32, 7).toString('base64') }),
  );
});
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import {
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();

function pngFixture(fillByte: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(17, fillByte),
  ]);
}

type Side = {
  distributorId: string;
  factoryId: string;
  distributorToken: string;
  factoryToken: string;
  transporterToken: string;
  transporterId: string;
  saleOrderId: string;
  saleOrderNumber: string;
  saleOrderLineId: string;
  dispatchId: string;
  dispatchNumber: string;
  packingListId: string;
  cartonId: string;
  factoryDispatchId: string;
  factoryDispatchNumber: string;
  distributorName: string;
  distributorCode: string;
  factoryName: string;
  factoryCode: string;
  storeAddress: string;
  returnId: string;
  salesReportId: string;
  handoffId: string;
  factoryInvoiceId: string;
  qrSecret: string;
  styleId: string;
  sizeId: string;
  retailStoreId: string;
  imageId: string;
};

let A: Side;
let B: Side;
let adminToken: string;
let merchToken: string;
let accountantToken: string;
let seniorToken: string;
const internalEmails: string[] = [];

async function buildSide(
  tag: 'ALPHA' | 'BRAVO',
  merch: string,
  accountant: string,
  accountantId: string,
): Promise<Side> {
  const fx = await createSingleFactoryApprovedSaleOrder(app, 40, 'SALE_RETURN');
  const distributorId = fx.stock.distributorId;
  const factoryId = fx.stock.factoryId;
  const distributorName = `ZZ-DIST-${tag}-NAME`;
  const distributorCode = `ZZDIST${tag}`;
  const factoryName = `ZZ-FACTORY-${tag}-NAME`;
  const factoryCode = `ZZFAC${tag}`;
  await prisma.distributor.update({
    where: { id: distributorId },
    data: { name: distributorName, code: distributorCode },
  });
  await prisma.factory.update({
    where: { id: factoryId },
    data: { name: factoryName, code: factoryCode },
  });
  const storeAddress = `ZZ-${tag}-SECRET-STREET`;
  await prisma.retailStore.updateMany({
    where: { distributorId },
    data: { addressLine1: storeAddress },
  });
  await prisma.saleOrderDestination.updateMany({
    where: { saleOrderDistributor: { distributorId } },
    data: { addressLine1: storeAddress },
  });

  const factoryToken = await createFactoryUserToken(factoryId);
  const fd = await packAndFinalize(
    app,
    factoryToken,
    fx.saleOrder.id,
    fx.saleOrderLineId,
    fx.saleOrder.destinations[0].id,
    40,
  );
  const dispatch = await consolidateAndDispatch(app, merch, [fd.cartonId]);
  await confirmErveDispatchDelivery(app, merch, dispatch.id, dispatch.version, [
    { saleOrderLineId: fx.saleOrderLineId, receivedQuantity: 40 },
  ]);

  const transporter = await createTestUserAndToken({
    email: `transporter-${tag.toLowerCase()}-${createId()}@test.local`,
    password: 'pass',
    roles: ['TRANSPORTER'],
  });
  const current = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  await request(app)
    .patch(`/erve-dispatches/${dispatch.id}/transporter-assignment`)
    .set('Authorization', `Bearer ${merch}`)
    .send({ expectedVersion: current.version, transporterUserId: transporter.userId })
    .expect(200);

  const distributorToken = fx.distributorToken;
  const sale = await request(app)
    .post('/distributor-sales-reports')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId,
      reportDate: '2026-08-01',
      lines: [
        { erveDispatchId: dispatch.id, saleOrderLineId: fx.saleOrderLineId, quantitySold: 5 },
      ],
    })
    .expect(201);
  const ret = await request(app)
    .post('/distributor-returns')
    .set('Authorization', `Bearer ${distributorToken}`)
    .send({
      distributorId,
      returnDate: '2026-09-01',
      returnReason: 'Unsold stock',
      lines: [
        { erveDispatchId: dispatch.id, saleOrderLineId: fx.saleOrderLineId, requestedQuantity: 3 },
      ],
    })
    .expect(201);

  // Populate every internal "who did this" reference the external views carry.
  const returnLine = ret.body.data.lines[0] as { id: string };
  const approved = await request(app)
    .post(`/distributor-returns/${ret.body.data.id}/approve`)
    .set('Authorization', `Bearer ${accountant}`)
    .send({
      expectedVersion: ret.body.data.version,
      lines: [{ id: returnLine.id, approvedQuantity: 3 }],
    })
    .expect(200);
  const received = await request(app)
    .post(`/distributor-returns/${ret.body.data.id}/receive`)
    .set('Authorization', `Bearer ${merch}`)
    .send({
      expectedVersion: approved.body.data.version,
      lines: [{ id: returnLine.id, receivedQuantity: 3 }],
    })
    .expect(200);
  await request(app)
    .post(`/distributor-returns/${ret.body.data.id}/credit-note`)
    .set('Authorization', `Bearer ${accountant}`)
    .send({
      expectedVersion: received.body.data.version,
      creditNoteReference: `CN-${tag}`,
      creditNoteDate: '2026-09-05',
    })
    .expect(200);
  const invoiceBefore = await prisma.factoryInvoice.findFirstOrThrow({
    where: { factoryDispatchId: fd.id },
  });
  await request(app)
    .post(`/factory-invoices/${invoiceBefore.id}/confirm`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ expectedVersion: invoiceBefore.version })
    .expect(200);
  // Legacy finalized state: an Accountant is recorded as finalizing the invoice.
  await prisma.factoryInvoice.update({
    where: { id: invoiceBefore.id },
    data: { finalizedById: accountantId, finalizedAt: new Date() },
  });

  const handoff = await prisma.invoiceHandoff.findFirstOrThrow({
    where: { erveDispatchId: dispatch.id },
  });
  const factoryInvoice = await prisma.factoryInvoice.findFirstOrThrow({
    where: { factoryDispatchId: fd.id },
  });
  const fdRecord = await prisma.factoryDispatch.findUniqueOrThrow({ where: { id: fd.id } });
  const prepared = await request(app)
    .post(`/carton-delivery/labels/${fd.cartonId}/prepare`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({
      expectedVersion: (
        await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: fd.cartonId } })
      ).version,
    })
    .expect(200);
  const qrSecret = String(prepared.body.data.url).split('#')[1]!;
  const line = await prisma.saleOrderLine.findUniqueOrThrow({
    where: { id: fx.saleOrderLineId },
    include: { destination: true },
  });
  const upload = await request(app)
    .post(`/styles/${fx.stock.styleId}/images`)
    .set('Authorization', `Bearer ${merch}`)
    .attach('image', pngFixture(tag === 'ALPHA' ? 0xaa : 0xbb), {
      filename: 'photo.png',
      contentType: 'image/png',
    })
    .expect(201);

  return {
    distributorId,
    factoryId,
    distributorToken,
    factoryToken,
    transporterToken: transporter.token,
    transporterId: transporter.userId,
    saleOrderId: fx.saleOrder.id,
    saleOrderNumber: fx.saleOrder.saleOrderNumber,
    saleOrderLineId: fx.saleOrderLineId,
    dispatchId: dispatch.id,
    dispatchNumber: dispatch.erveDispatchNumber,
    packingListId: dispatch.ervePackingList.id,
    cartonId: fd.cartonId,
    factoryDispatchId: fd.id,
    factoryDispatchNumber: fdRecord.factoryDispatchNumber,
    distributorName,
    distributorCode,
    factoryName,
    factoryCode,
    storeAddress,
    returnId: ret.body.data.id,
    salesReportId: sale.body.data.id,
    handoffId: handoff.id,
    factoryInvoiceId: factoryInvoice.id,
    qrSecret,
    styleId: fx.stock.styleId,
    sizeId: line.sizeId,
    retailStoreId: line.destination.retailStoreId!,
    imageId: upload.body.data.id as string,
  };
}

beforeAll(async () => {
  await resetDatabase();
  const admin = await createRoleToken('ADMIN');
  adminToken = admin.token;
  const merch = await createRoleToken('MERCHANDISER');
  merchToken = merch.token;
  const acct = await createRoleToken('ACCOUNTANT');
  accountantToken = acct.token;
  const senior = await createRoleToken('SENIOR_MANAGEMENT');
  seniorToken = senior.token;
  A = await buildSide('ALPHA', merchToken, accountantToken, acct.userId);
  B = await buildSide('BRAVO', merchToken, accountantToken, acct.userId);
  const users = await prisma.user.findMany({
    where: {
      userRoles: {
        some: {
          role: {
            name: { in: ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT', 'QA_USER', 'SENIOR_MANAGEMENT'] },
          },
        },
      },
    },
    select: { email: true },
  });
  internalEmails.push(...users.map((u) => u.email));
}, 120_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

// Every read surface that touches post-dispatch data for the given side's records.
function surfaces(s: Side) {
  return [
    ['dispatch list', `/erve-dispatches?limit=50`],
    ['dispatch detail', `/erve-dispatches/${s.dispatchId}`],
    ['dispatch transport', `/erve-dispatches/${s.dispatchId}/transport`],
    ['assigned transport', `/erve-dispatches/assigned-transport`],
    ['transporter options', `/erve-dispatches/transporter-options`],
    ['packing list list', `/erve-packing-lists`],
    ['packing list detail', `/erve-packing-lists/${s.packingListId}`],
    ['eligible cartons', `/erve-packing-lists/eligible-cartons`],
    ['invoice handoff list', `/invoice-handoffs`],
    ['invoice handoff detail', `/invoice-handoffs/${s.handoffId}`],
    ['sale-or-return positions', `/sale-or-return-positions`],
    ['sales report list', `/distributor-sales-reports`],
    ['sales report detail', `/distributor-sales-reports/${s.salesReportId}`],
    ['return list', `/distributor-returns`],
    ['return detail', `/distributor-returns/${s.returnId}`],
    ['retail inventory', `/retail-store-inventory`],
    ['reconciliation queue', `/post-dispatch-reconciliation`],
    ['dispatch reconciliation', `/erve-dispatches/${s.dispatchId}/reconciliation`],
    ['carton delivery summary', `/carton-delivery/dispatches/${s.dispatchId}`],
    ['factory dispatch list', `/factory-dispatches`],
    ['factory dispatch detail', `/factory-dispatches/${s.factoryDispatchId}`],
    ['packing queue', `/factory-dispatches/packing-queue`],
    ['factory options', `/factory-dispatches/factory-options`],
    ['factory invoice list', `/factory-invoices`],
    ['factory invoice detail', `/factory-invoices/${s.factoryInvoiceId}`],
    ['packing audit queue', `/packing-audit/queue`],
    ['packing audit carton', `/packing-audit/cartons/${s.cartonId}`],
    ['dispatch order list', `/sale-orders`],
    ['dispatch order detail', `/sale-orders/${s.saleOrderId}`],
    ['dispatch order audit', `/sale-orders/${s.saleOrderId}/audit`],
    ['dispatch order packing list', `/sale-orders/${s.saleOrderId}/packing-list`],
    ['tax invoice list', `/tax-invoices`],
    ['distributor list', `/distributors`],
    ['factory list', `/factories`],
    ['retail stores', `/retail-stores`],
  ] as const;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (token: string | null, path: string) => {
  const r = request(app).get(path);
  return token ? r.set(auth(token)) : r;
};
const bodyText = (res: request.Response) => JSON.stringify(res.body) + (res.text ?? '');
const other = (s: Side) => (s === A ? B : A);

// Everything that identifies a counterparty or its commercial relationship.
function identitiesOf(s: Side): string[] {
  return [
    s.distributorName,
    s.distributorCode,
    s.distributorId,
    s.storeAddress,
    s.retailStoreId,
    s.saleOrderNumber,
    s.saleOrderId,
    s.dispatchNumber,
    s.dispatchId,
    s.packingListId,
    s.factoryName,
    s.factoryCode,
    s.factoryId,
    s.factoryDispatchNumber,
    s.factoryDispatchId,
    s.handoffId,
    s.returnId,
    s.salesReportId,
    s.factoryInvoiceId,
    s.transporterId,
    s.qrSecret,
  ];
}
const factoryIdentities = (s: Side) => [
  s.factoryName,
  s.factoryCode,
  s.factoryId,
  s.factoryDispatchNumber,
  s.factoryDispatchId,
  s.factoryInvoiceId,
];
const distributorIdentities = (s: Side) => [
  s.distributorName,
  s.distributorCode,
  s.distributorId,
  s.storeAddress,
  s.retailStoreId,
];

async function sweep(token: string | null, side: Side) {
  const out: Array<{ surface: string; path: string; status: number; text: string }> = [];
  for (const [surface, path] of surfaces(side)) {
    const res = await get(token, path);
    out.push({ surface, path, status: res.status, text: bodyText(res) });
  }
  return out;
}

function expectNoneOf(
  responses: Array<{ surface: string; text: string }>,
  markers: string[],
  label: string,
) {
  const hits: string[] = [];
  for (const r of responses)
    for (const m of markers)
      if (r.text.includes(m)) hits.push(`${label}: ${r.surface} discloses ${m}`);
  expect(hits).toEqual([]);
}

const ids = (res: request.Response) =>
  (res.body?.data?.items ?? []).map((i: { id: string }) => i.id);

describe.each([
  ['A', () => A],
  ['B', () => B],
] as const)(
  'DISTRIBUTOR %s — own data readable, nothing of the counterparty exposed',
  (_name, side) => {
    it('can still read its own post-dispatch records', async () => {
      const own = side();
      const t = own.distributorToken;
      const detail = await get(t, `/erve-dispatches/${own.dispatchId}`).expect(200);
      expect(detail.body.data.erveDispatchNumber).toBe(own.dispatchNumber);
      expect(detail.body.data.destination.addressLine1).toBe(own.storeAddress);
      expect(detail.body.data.quantityLines[0].quantity).toBe(40);
      expect(ids(await get(t, '/erve-dispatches').expect(200))).toEqual([own.dispatchId]);
      expect(ids(await get(t, '/invoice-handoffs').expect(200))).toEqual([own.handoffId]);
      await get(t, `/invoice-handoffs/${own.handoffId}`).expect(200);
      await get(t, `/distributor-sales-reports/${own.salesReportId}`).expect(200);
      await get(t, `/distributor-returns/${own.returnId}`).expect(200);
      expect(ids(await get(t, '/distributor-returns').expect(200))).toEqual([own.returnId]);
      const summary = await get(t, `/carton-delivery/dispatches/${own.dispatchId}`).expect(200);
      expect(summary.body.data.totalCartons).toBe(1);
      const positions = await get(t, '/sale-or-return-positions').expect(200);
      expect(bodyText(positions)).toContain(own.dispatchNumber);
      const inventory = await get(t, '/retail-store-inventory').expect(200);
      expect(bodyText(inventory)).toContain(own.distributorName);
      const imageList = await get(t, `/styles/${own.styleId}/images`).expect(200);
      expect(imageList.body.data.map((i: { id: string }) => i.id)).toContain(own.imageId);
      await get(t, `/styles/${own.styleId}/images/${own.imageId}/content`).expect(200);
    });

    it("never discloses the counterparty's records through any read surface or spoofed filter", async () => {
      const own = side();
      const foreign = other(own);
      const t = own.distributorToken;
      const responses = [...(await sweep(t, own)), ...(await sweep(t, foreign))];
      const spoofed = [
        `/erve-dispatches?distributorId=${foreign.distributorId}`,
        `/erve-dispatches?saleOrderId=${foreign.saleOrderId}`,
        `/invoice-handoffs?distributorId=${foreign.distributorId}`,
        `/sale-or-return-positions?distributorId=${foreign.distributorId}`,
        `/distributor-sales-reports?distributorId=${foreign.distributorId}`,
        `/distributor-returns?distributorId=${foreign.distributorId}`,
        `/retail-store-inventory?distributorId=${foreign.distributorId}`,
        `/retail-store-inventory?storeKey=S:${foreign.retailStoreId}`,
        `/retail-store-inventory/sources?distributorId=${foreign.distributorId}&storeKey=S:${foreign.retailStoreId}&styleId=${foreign.styleId}&purchaseMode=SALE_RETURN`,
      ];
      for (const path of spoofed) {
        const res = await get(t, path);
        responses.push({ surface: path, path, status: res.status, text: bodyText(res) });
      }
      expectNoneOf(responses, identitiesOf(foreign), `DISTRIBUTOR ${_name}`);
      // The availability probe echoes the caller-supplied key back, so assert that it reveals no stock instead.
      const probe = await get(
        t,
        `/retail-store-inventory/store-fifo/availability?storeKey=S:${foreign.retailStoreId}&styleId=${foreign.styleId}&sizeId=${foreign.sizeId}&date=2026-09-01`,
      );
      expect(probe.status).toBeLessThan(500);
      if (probe.status === 200) {
        expect(probe.body.data).toMatchObject({
          availableForSale: 0,
          availableForReturn: 0,
          eligibleSourceCount: 0,
        });
      }
    });

    it("denies direct access by the counterparty's record ids", async () => {
      const foreign = other(side());
      const t = side().distributorToken;
      for (const path of [
        `/erve-dispatches/${foreign.dispatchId}`,
        `/invoice-handoffs/${foreign.handoffId}`,
        `/distributor-sales-reports/${foreign.salesReportId}`,
        `/distributor-returns/${foreign.returnId}`,
        `/carton-delivery/dispatches/${foreign.dispatchId}`,
        `/styles/${foreign.styleId}/images/${foreign.imageId}/content`,
      ]) {
        const res = await get(t, path);
        expect([403, 404], path).toContain(res.status);
        expectNoneOf([{ surface: path, text: bodyText(res) }], identitiesOf(foreign), path);
      }
    });

    it('never exposes Factory identity, provenance, or Factory-side documents', async () => {
      const own = side();
      const t = own.distributorToken;
      const responses = [...(await sweep(t, own)), ...(await sweep(t, other(own)))];
      expectNoneOf(
        responses,
        [...factoryIdentities(A), ...factoryIdentities(B)],
        `DISTRIBUTOR ${_name}`,
      );
      for (const path of [
        `/erve-packing-lists/${own.packingListId}`,
        `/factory-dispatches/${own.factoryDispatchId}`,
        `/factory-invoices/${own.factoryInvoiceId}`,
        `/sale-orders/${own.saleOrderId}/packing-list`,
        `/packing-audit/cartons/${own.cartonId}`,
        `/erve-dispatches/${own.dispatchId}/reconciliation`,
        `/erve-dispatches/${own.dispatchId}/transport`,
      ]) {
        expect((await get(t, path)).status, path).toBe(403);
      }
    });

    it("cannot mutate the counterparty's records or act on its behalf", async () => {
      const own = side();
      const foreign = other(own);
      const t = own.distributorToken;
      const before = {
        reports: await prisma.distributorSalesReport.count(),
        returns: await prisma.distributorReturn.count(),
        receipts: await prisma.erveDispatchDistributorReceipt.count(),
      };
      const foreignVersion = (
        await prisma.erveDispatch.findUniqueOrThrow({ where: { id: foreign.dispatchId } })
      ).version;
      const attempts = [
        request(app)
          .post(`/erve-dispatches/${foreign.dispatchId}/distributor-receipt`)
          .set(auth(t))
          .set('Idempotency-Key', createId())
          .send({
            expectedVersion: foreignVersion,
            acknowledged: true,
            groups: [{ styleId: foreign.styleId, sizeId: foreign.sizeId, receivedQuantity: 40 }],
          }),
        // body names the other Distributor
        request(app)
          .post('/distributor-sales-reports')
          .set(auth(t))
          .send({
            distributorId: foreign.distributorId,
            reportDate: '2026-08-02',
            lines: [
              {
                erveDispatchId: foreign.dispatchId,
                saleOrderLineId: foreign.saleOrderLineId,
                quantitySold: 1,
              },
            ],
          }),
        // body names itself but references the other Distributor's dispatch line
        request(app)
          .post('/distributor-sales-reports')
          .set(auth(t))
          .send({
            distributorId: own.distributorId,
            reportDate: '2026-08-02',
            lines: [
              {
                erveDispatchId: foreign.dispatchId,
                saleOrderLineId: foreign.saleOrderLineId,
                quantitySold: 1,
              },
            ],
          }),
        request(app)
          .post('/distributor-returns')
          .set(auth(t))
          .send({
            distributorId: foreign.distributorId,
            returnDate: '2026-09-02',
            returnReason: 'x',
            lines: [
              {
                erveDispatchId: foreign.dispatchId,
                saleOrderLineId: foreign.saleOrderLineId,
                requestedQuantity: 1,
              },
            ],
          }),
        request(app)
          .post('/distributor-returns')
          .set(auth(t))
          .send({
            distributorId: own.distributorId,
            returnDate: '2026-09-02',
            returnReason: 'x',
            lines: [
              {
                erveDispatchId: foreign.dispatchId,
                saleOrderLineId: foreign.saleOrderLineId,
                requestedQuantity: 1,
              },
            ],
          }),
        request(app)
          .post('/retail-store-inventory/store-fifo/sales-reports')
          .set(auth(t))
          .set('Idempotency-Key', createId())
          .send({
            storeKey: `S:${foreign.retailStoreId}`,
            styleId: foreign.styleId,
            sizeId: foreign.sizeId,
            quantity: 1,
            reportDate: '2026-09-01',
          }),
        request(app)
          .post('/retail-store-inventory/store-fifo/returns')
          .set(auth(t))
          .set('Idempotency-Key', createId())
          .send({
            storeKey: `S:${foreign.retailStoreId}`,
            styleId: foreign.styleId,
            sizeId: foreign.sizeId,
            quantity: 1,
            returnDate: '2026-09-01',
            returnReason: 'x',
          }),
        // internal-only actions
        request(app)
          .patch(`/erve-dispatches/${foreign.dispatchId}/lr`)
          .set(auth(t))
          .send({ expectedVersion: foreignVersion, lrNumber: 'HACK' }),
        request(app)
          .patch(`/erve-dispatches/${own.dispatchId}/lr`)
          .set(auth(t))
          .send({ expectedVersion: 1, lrNumber: 'HACK' }),
        request(app)
          .patch(`/erve-dispatches/${foreign.dispatchId}/delivery`)
          .set(auth(t))
          .send({ expectedVersion: foreignVersion, lines: [] }),
        request(app)
          .patch(`/erve-dispatches/${own.dispatchId}/transporter-assignment`)
          .set(auth(t))
          .send({ expectedVersion: 1, transporterUserId: null }),
        request(app)
          .patch(`/invoice-handoffs/${own.handoffId}/tally-reference`)
          .set(auth(t))
          .send({ expectedVersion: 0, tallyInvoiceNumber: 'X', tallyInvoiceDate: '2026-09-01' }),
        request(app).post(`/distributor-returns/${own.returnId}/approve`).set(auth(t)).send({}),
        request(app)
          .post(`/carton-delivery/credentials/${foreign.cartonId}`)
          .set(auth(t))
          .send({ action: 'revoke', reason: 'x', expectedTokenId: 'x' }),
        request(app)
          .post(`/carton-delivery/labels/${foreign.cartonId}/prepare`)
          .set(auth(t))
          .send({ expectedVersion: 1 }),
      ];
      for (const attempt of attempts) {
        const res = await attempt;
        expect(
          res.status,
          `${res.request.method} ${res.request.url}: ${bodyText(res).slice(0, 200)}`,
        ).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expectNoneOf(
          [{ surface: res.request.url, text: bodyText(res) }],
          identitiesOf(foreign),
          res.request.url,
        );
      }
      expect({
        reports: await prisma.distributorSalesReport.count(),
        returns: await prisma.distributorReturn.count(),
        receipts: await prisma.erveDispatchDistributorReceipt.count(),
      }).toEqual(before);
      expect(
        (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: foreign.dispatchId } }))
          .version,
      ).toBe(foreignVersion);
    });
  },
);

describe.each([
  ['A', () => A],
  ['B', () => B],
] as const)(
  'FACTORY_USER %s — own Factory documents readable, nothing downstream or foreign exposed',
  (_name, side) => {
    it('can still read its own Factory Dispatch, Dispatch Order, packing list and Factory Invoice', async () => {
      const own = side();
      const t = own.factoryToken;
      const fd = await get(t, `/factory-dispatches/${own.factoryDispatchId}`).expect(200);
      expect(fd.body.data.destinations[0].cartons[0].totalQuantity).toBe(40);
      expect(fd.body.data.destinations[0].addressLine1).toBe(own.storeAddress);
      expect(ids(await get(t, '/factory-dispatches').expect(200))).toEqual([own.factoryDispatchId]);
      await get(t, '/factory-dispatches/packing-queue').expect(200);
      const so = await get(t, `/sale-orders/${own.saleOrderId}`).expect(200);
      expect(so.body.data.saleOrderNumber).toBe(own.saleOrderNumber);
      expect(ids(await get(t, '/sale-orders').expect(200))).toEqual([own.saleOrderId]);
      await get(t, `/sale-orders/${own.saleOrderId}/packing-list`).expect(200);
      const invoice = await get(t, `/factory-invoices/${own.factoryInvoiceId}`).expect(200);
      expect(invoice.body.data.total).toBe(6000);
      expect(ids(await get(t, '/factory-invoices').expect(200))).toEqual([own.factoryInvoiceId]);
    });

    it("never discloses the other Factory's or the other Distributor's records", async () => {
      const own = side();
      const foreign = other(own);
      const responses = [
        ...(await sweep(own.factoryToken, own)),
        ...(await sweep(own.factoryToken, foreign)),
      ];
      expectNoneOf(responses, identitiesOf(foreign), `FACTORY_USER ${_name}`);
    });

    it("denies direct access by the other Factory's ids", async () => {
      const foreign = other(side());
      const t = side().factoryToken;
      for (const path of [
        `/factory-dispatches/${foreign.factoryDispatchId}`,
        `/factory-invoices/${foreign.factoryInvoiceId}`,
        `/sale-orders/${foreign.saleOrderId}`,
        `/sale-orders/${foreign.saleOrderId}/packing-list`,
      ]) {
        const res = await get(t, path);
        expect([403, 404], path).toContain(res.status);
        expectNoneOf([{ surface: path, text: bodyText(res) }], identitiesOf(foreign), path);
      }
      const prepare = await request(app)
        .post(`/carton-delivery/labels/${foreign.cartonId}/prepare`)
        .set(auth(t))
        .send({ expectedVersion: 1 });
      expect([403, 404]).toContain(prepare.status);
      expectNoneOf(
        [{ surface: 'prepare', text: bodyText(prepare) }],
        identitiesOf(foreign),
        'prepare',
      );
    });

    it('has no access to post-dispatch (Erve Dispatch, receipt, returns, sales, inventory, tax) surfaces', async () => {
      const own = side();
      const t = own.factoryToken;
      for (const path of [
        '/erve-dispatches',
        `/erve-dispatches/${own.dispatchId}`,
        `/erve-dispatches/${own.dispatchId}/transport`,
        '/erve-packing-lists',
        `/erve-packing-lists/${own.packingListId}`,
        '/invoice-handoffs',
        '/sale-or-return-positions',
        '/distributor-sales-reports',
        '/distributor-returns',
        '/retail-store-inventory',
        '/post-dispatch-reconciliation',
        `/erve-dispatches/${own.dispatchId}/reconciliation`,
        `/carton-delivery/dispatches/${own.dispatchId}`,
        '/tax-invoices',
        '/distributors',
      ]) {
        expect((await get(t, path)).status, path).toBe(403);
      }
    });

    it("does not expose the Distributor's financial or post-dispatch commercial state", async () => {
      const own = side();
      const t = own.factoryToken;
      const text = [
        bodyText(await get(t, `/sale-orders/${own.saleOrderId}`)),
        bodyText(await get(t, `/factory-dispatches/${own.factoryDispatchId}`)),
        bodyText(await get(t, `/factory-invoices/${own.factoryInvoiceId}`)),
      ].join('\n');
      for (const forbidden of [
        own.dispatchNumber,
        own.dispatchId,
        own.packingListId,
        own.handoffId,
        own.returnId,
        own.salesReportId,
        'tallyInvoice',
        'percentageOfMrp',
        'finalMrp',
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });
  },
);

describe('Internal staff contact details', () => {
  // ISS-074 keeps the generating operator off external labels and the Invoice Handoff view already
  // withholds "who recorded it" from Distributors; staff e-mail addresses are never displayed to
  // external users, so no external read surface may carry them.
  it.each([
    ['DISTRIBUTOR A', () => [A.distributorToken, A] as const],
    ['DISTRIBUTOR B', () => [B.distributorToken, B] as const],
    ['FACTORY_USER A', () => [A.factoryToken, A] as const],
    ['FACTORY_USER B', () => [B.factoryToken, B] as const],
  ])('%s receives no internal staff e-mail address', async (_label, who) => {
    const [token, side] = who();
    const responses = [...(await sweep(token, side))];
    expect(internalEmails.length).toBeGreaterThan(0);
    expectNoneOf(responses, internalEmails, _label);
  });
});

describe('Internal staff identity that remains visible', () => {
  it('keeps the operator names Distributors and Factories see today, and keeps e-mail for internal readers', async () => {
    const dist = await get(A.distributorToken, `/erve-dispatches/${A.dispatchId}`).expect(200);
    expect(dist.body.data.dispatchedBy.name).toBeTruthy();
    expect(dist.body.data.dispatchedBy).not.toHaveProperty('email');
    expect(dist.body.data.deliveredBy.name).toBeTruthy();
    const ret = await get(A.distributorToken, `/distributor-returns/${A.returnId}`).expect(200);
    for (const key of ['submittedBy', 'approvedBy', 'receivedBy', 'creditNoteRecordedBy']) {
      expect(ret.body.data[key].name, key).toBeTruthy();
      expect(ret.body.data[key], key).not.toHaveProperty('email');
    }
    const report = await get(
      A.distributorToken,
      `/distributor-sales-reports/${A.salesReportId}`,
    ).expect(200);
    expect(report.body.data.submittedBy.name).toBeTruthy();
    expect(report.body.data.submittedBy).not.toHaveProperty('email');

    const invoice = await get(A.factoryToken, `/factory-invoices/${A.factoryInvoiceId}`).expect(
      200,
    );
    expect(invoice.body.data.finalizedBy.name).toBeTruthy();
    expect(invoice.body.data.finalizedBy).not.toHaveProperty('email');
    expect(invoice.body.data.factoryConfirmedBy.name).toBeTruthy();
    const order = await get(A.factoryToken, `/sale-orders/${A.saleOrderId}`).expect(200);
    expect(order.body.data.creator.name).toBeTruthy();
    expect(order.body.data.creator).not.toHaveProperty('email');

    for (const token of [adminToken, merchToken, seniorToken, accountantToken]) {
      const internal = await get(token, `/erve-dispatches/${A.dispatchId}`).expect(200);
      expect(internal.body.data.dispatchedBy.email).toContain('@');
      expect(
        (await get(token, `/distributor-returns/${A.returnId}`).expect(200)).body.data.approvedBy
          .email,
      ).toContain('@');
    }
    for (const token of [adminToken, accountantToken]) {
      expect(
        (await get(token, `/factory-invoices/${A.factoryInvoiceId}`).expect(200)).body.data
          .finalizedBy.email,
      ).toContain('@');
    }
    expect(
      (await get(merchToken, `/sale-orders/${A.saleOrderId}`).expect(200)).body.data.creator.email,
    ).toContain('@');
  });
});

describe('TRANSPORTER — only the assigned transport fields', () => {
  const TRANSPORT_KEYS = [
    'dispatchDate',
    'erveDispatchNumber',
    'id',
    'lrNumber',
    'lrUpdatedAt',
    'status',
    'transporter',
    'vehicleNumber',
    'version',
  ];

  it('sees exactly its assigned dispatch and only the transport allowlist', async () => {
    const t = A.transporterToken;
    const list = await get(t, '/erve-dispatches/assigned-transport').expect(200);
    expect(ids(list)).toEqual([A.dispatchId]);
    expect(Object.keys(list.body.data.items[0]).sort()).toEqual(TRANSPORT_KEYS);
    const detail = await get(t, `/erve-dispatches/${A.dispatchId}/transport`).expect(200);
    expect(Object.keys(detail.body.data).sort()).toEqual(TRANSPORT_KEYS);
    expectNoneOf(
      [
        { surface: 'list', text: bodyText(list) },
        { surface: 'detail', text: bodyText(detail) },
      ],
      [
        ...distributorIdentities(A),
        ...factoryIdentities(A),
        A.saleOrderNumber,
        A.saleOrderId,
        A.packingListId,
        ...identitiesOf(B).filter((m) => m !== B.transporterId),
      ],
      'TRANSPORTER',
    );
  });

  it("cannot read or update another Transporter's dispatch", async () => {
    const t = A.transporterToken;
    const read = await get(t, `/erve-dispatches/${B.dispatchId}/transport`);
    expect(read.status).toBe(404);
    const version = (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: B.dispatchId } }))
      .version;
    const write = await request(app)
      .patch(`/erve-dispatches/${B.dispatchId}/lr`)
      .set(auth(t))
      .send({ expectedVersion: version, lrNumber: 'HACK' });
    expect(write.status).toBe(404);
    expect(
      (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: B.dispatchId } })).lrNumber,
    ).toBeNull();
    expectNoneOf(
      [{ surface: 'transport', text: bodyText(read) + bodyText(write) }],
      identitiesOf(B),
      'TRANSPORTER',
    );
  });

  it('can update LR on its own dispatch and receives only the transport allowlist back', async () => {
    const version = (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: B.dispatchId } }))
      .version;
    const res = await request(app)
      .patch(`/erve-dispatches/${B.dispatchId}/lr`)
      .set(auth(B.transporterToken))
      .send({
        expectedVersion: version,
        transporter: 'Test Carrier',
        vehicleNumber: 'TN01AB1234',
        lrNumber: 'LR-1',
      })
      .expect(200);
    expect(Object.keys(res.body.data).sort()).toEqual(TRANSPORT_KEYS);
    expect(res.body.data.lrNumber).toBe('LR-1');
  });

  it('is denied every non-transport route', async () => {
    const t = A.transporterToken;
    const denied = (await sweep(t, A)).filter(
      (r) => !['dispatch transport', 'assigned transport'].includes(r.surface),
    );
    expect(denied.filter((r) => r.status !== 403).map((r) => `${r.surface}=${r.status}`)).toEqual(
      [],
    );
    for (const path of [
      '/styles',
      `/styles/${A.styleId}/images/${A.imageId}/content`,
      `/sale-orders/${A.saleOrderId}`,
      '/users',
      '/job-orders',
    ]) {
      expect((await get(t, path)).status, path).toBe(403);
    }
    const attempts = [
      request(app)
        .patch(`/erve-dispatches/${A.dispatchId}/delivery`)
        .send({ expectedVersion: 1, lines: [] }),
      request(app)
        .patch(`/erve-dispatches/${A.dispatchId}/transporter-assignment`)
        .send({ expectedVersion: 1, transporterUserId: null }),
      request(app)
        .post(`/carton-delivery/labels/${A.cartonId}/prepare`)
        .send({ expectedVersion: 1 }),
      request(app)
        .post(`/erve-dispatches/${A.dispatchId}/distributor-receipt`)
        .set('Idempotency-Key', 'x')
        .send({}),
    ];
    for (const a of attempts) expect((await a.set(auth(t))).status).toBe(403);
  });
});

describe('Unauthenticated callers and the public QR endpoint', () => {
  it('receives 401 from every authenticated post-dispatch surface', async () => {
    const res = await sweep(null, A);
    expect(res.filter((r) => r.status !== 401).map((r) => `${r.surface}=${r.status}`)).toEqual([]);
    expectNoneOf(res, [...identitiesOf(A), ...identitiesOf(B)], 'UNAUTHENTICATED');
    expect((await get(null, `/styles/${A.styleId}/images/${A.imageId}/content`)).status).toBe(401);
    const bad = await request(app)
      .get('/erve-dispatches')
      .set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
  });

  it('resolves a QR to the carton number, label reference and state only', async () => {
    for (const side of [A, B]) {
      const res = await request(app)
        .post('/public/carton-delivery/resolve')
        .set('X-Carton-Delivery-Token', side.qrSecret)
        .send({})
        .expect(200);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'cartonNumber',
        'labelReference',
        'state',
      ]);
      expect(res.body.data.state).toBe('READY');
      expectNoneOf(
        [{ surface: 'resolve', text: bodyText(res) }],
        [...identitiesOf(A), ...identitiesOf(B)].filter((m) => m !== side.qrSecret),
        'QR',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('confirms only its own carton and returns no business data', async () => {
    const res = await request(app)
      .post('/public/carton-delivery/confirm')
      .set('X-Carton-Delivery-Token', A.qrSecret)
      .send({
        recipientName: 'Receiver',
        deliveredAt: new Date().toISOString(),
        timezone: 'UTC',
        offsetMinutes: 0,
        remarks: 'Received intact',
        confirmed: true,
        idempotencyKey: randomUUID(),
      })
      .expect(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['state', 'submittedAt']);
    expectNoneOf(
      [{ surface: 'confirm', text: bodyText(res) }],
      [...identitiesOf(A), ...identitiesOf(B)].filter((m) => m !== A.qrSecret),
      'QR',
    );
    expect(await prisma.cartonDeliveryConfirmation.count({ where: { cartonId: B.cartonId } })).toBe(
      0,
    );
    const bResolve = await request(app)
      .post('/public/carton-delivery/resolve')
      .set('X-Carton-Delivery-Token', B.qrSecret)
      .send({})
      .expect(200);
    expect(bResolve.body.data.state).toBe('READY');
  });

  it('rejects missing, malformed, wrong-method and query-string QR access without disclosure', async () => {
    const probes = [
      request(app).post('/public/carton-delivery/resolve').send({}),
      request(app)
        .post('/public/carton-delivery/resolve')
        .set('X-Carton-Delivery-Token', 'short')
        .send({}),
      request(app)
        .post('/public/carton-delivery/resolve')
        .set('X-Carton-Delivery-Token', 'A'.repeat(43))
        .send({}),
      request(app)
        .post(`/public/carton-delivery/resolve?token=${A.qrSecret}`)
        .set('X-Carton-Delivery-Token', A.qrSecret)
        .send({}),
      request(app)
        .get('/public/carton-delivery/resolve')
        .set('X-Carton-Delivery-Token', A.qrSecret),
      request(app).get(`/public/carton-delivery/${A.cartonId}`),
      request(app)
        .post('/public/carton-delivery/resolve')
        .set('X-Carton-Delivery-Token', A.qrSecret)
        .send({ cartonId: B.cartonId }),
    ];
    for (const p of probes) {
      const res = await p;
      expect(res.status, `${res.request.method} ${res.request.url}`).toBeGreaterThanOrEqual(400);
      expectNoneOf(
        [{ surface: res.request.url, text: bodyText(res) }],
        [...identitiesOf(A), ...identitiesOf(B)].filter((m) => m !== A.qrSecret),
        'QR',
      );
    }
  });
});

describe('Authorized internal roles keep their access (regression guard against over-restriction)', () => {
  it.each([
    ['ADMIN', () => adminToken],
    ['MERCHANDISER', () => merchToken],
    ['SENIOR_MANAGEMENT', () => seniorToken],
    ['ACCOUNTANT', () => accountantToken],
  ] as const)("%s reads both Distributors' dispatches", async (_role, token) => {
    const list = await get(token(), '/erve-dispatches?limit=50').expect(200);
    expect(ids(list).sort()).toEqual([A.dispatchId, B.dispatchId].sort());
    await get(token(), `/erve-dispatches/${A.dispatchId}`).expect(200);
    await get(token(), `/erve-dispatches/${B.dispatchId}`).expect(200);
    await get(token(), `/invoice-handoffs/${B.handoffId}`).expect(200);
  });

  it('ADMIN/MERCHANDISER/SENIOR_MANAGEMENT keep Factory provenance on the Erve Packing List', async () => {
    for (const token of [adminToken, merchToken, seniorToken]) {
      const res = await get(token, `/erve-packing-lists/${A.packingListId}`).expect(200);
      expect(bodyText(res)).toContain(A.factoryName);
    }
  });

  it('ACCOUNTANT keeps Factory Invoice and Tax Invoice access; MERCHANDISER does not gain financials', async () => {
    await get(accountantToken, `/factory-invoices/${A.factoryInvoiceId}`).expect(200);
    await get(accountantToken, '/tax-invoices').expect(200);
    expect((await get(merchToken, '/tax-invoices')).status).toBe(403);
    expect((await get(merchToken, `/factory-invoices/${A.factoryInvoiceId}`)).status).toBe(403);
  });

  it('ADMIN/MERCHANDISER see delivery evidence; other roles cannot manage QR credentials', async () => {
    await get(merchToken, `/carton-delivery/dispatches/${B.dispatchId}`).expect(200);
    const summary = await get(adminToken, `/carton-delivery/dispatches/${A.dispatchId}`).expect(
      200,
    );
    expect(summary.body.data.items[0].evidence.recipientName).toBe('Receiver');
    const res = await request(app)
      .post(`/carton-delivery/credentials/${B.cartonId}`)
      .set(auth(accountantToken))
      .send({ action: 'revoke', reason: 'x', expectedTokenId: 'x' });
    expect(res.status).toBe(403);
  });
});
