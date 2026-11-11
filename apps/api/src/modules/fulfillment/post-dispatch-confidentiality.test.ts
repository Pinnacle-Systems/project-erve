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
  ensureStyleFactoryRate,
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
  // ISS-075: destination fields a Factory legitimately keeps (store label/code/contact) and the two
  // that identify the counterparty indirectly and are withheld from it (GSTIN, contact e-mail).
  destinationId: string;
  storeLabel: string;
  storeCode: string;
  contactName: string;
  contactPhone: string;
  storeEmail: string;
  storeGstin: string;
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
  const storeEmail = `zz-${tag.toLowerCase()}-contact@zz${tag.toLowerCase()}-corp.example`;
  const storeGstin = `ZZGST${tag}0001`;
  const contactName = `ZZ ${tag} Store Manager`;
  const contactPhone = `+91-ZZ-${tag}-0001`;
  await prisma.retailStore.updateMany({
    where: { distributorId },
    data: { addressLine1: storeAddress },
  });
  await prisma.saleOrderDestination.updateMany({
    where: { saleOrderDistributor: { distributorId } },
    data: {
      addressLine1: storeAddress,
      contactEmail: storeEmail,
      gstin: storeGstin,
      contactName,
      contactPhone,
    },
  });
  const destination = await prisma.saleOrderDestination.findFirstOrThrow({
    where: { saleOrderDistributor: { distributorId } },
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
    destinationId: destination.id,
    storeLabel: destination.label!,
    storeCode: destination.storeCode!,
    contactName,
    contactPhone,
    storeEmail,
    storeGstin,
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

// ---------------------------------------------------------------------------------------------
// ISS-075 correction — Factory-facing documents must not identify the Distributor (and the
// Distributor-facing ones must not identify the Factory: asserted above), in BOTH directions.
//
// What a Factory legitimately keeps (needed to pack and dispatch): destination id, Store label,
// Store code/id, address, contact name/phone, Styles, Sizes, quantities, cartons, Dispatch Order
// and Factory Dispatch numbers. What it never receives: the Distributor's id/code/name, Purchase
// Mode, destination GSTIN (its PAN segment names the legal entity), destination contact e-mail
// (its domain names the company), Erve dispatch / delivery progress, or staff e-mail.
// ---------------------------------------------------------------------------------------------

// Keys whose presence (with a non-null value) in a restricted-reader response is itself a
// disclosure, independent of whether the value happens to match a marker string. The neutral
// Dispatch Order group deliberately carries `purchaseMode: null`, which discloses nothing.
const DISTRIBUTOR_KEYS = [
  'purchaseMode',
  'distributorId',
  'distributorCode',
  'distributorName',
  'gstin',
  'contactEmail',
];

function structuralLeaks(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => structuralLeaks(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  const leaks: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (DISTRIBUTOR_KEYS.includes(key) && child !== undefined && child !== null)
      leaks.push(`${path}.${key}`);
    if (key === 'distributor' && child !== null && child !== undefined) leaks.push(`${path}.${key}`);
    if (key === 'distributors' && Array.isArray(child) && child.length > 0)
      leaks.push(`${path}.${key}`);
    leaks.push(...structuralLeaks(child, `${path}.${key}`));
  }
  return leaks;
}

// Everything that names a Distributor (or its legal entity) — deliberately excludes the Store
// address, label, code and contact name/phone, which a Factory keeps.
const distributorMarkers = (s: Side) => [
  s.distributorName,
  s.distributorCode,
  s.distributorId,
  s.storeEmail,
  s.storeGstin,
];

type Snap = { surface: string; status: number; text: string; body: unknown };
const snap = (surface: string, res: request.Response): Snap => ({
  surface,
  status: res.status,
  text: JSON.stringify(res.body ?? null),
  body: res.body,
});

function expectNoDistributorIdentity(snaps: Snap[], markers: string[], label: string) {
  expectNoneOf(snaps, markers, label);
  expect(
    snaps.flatMap((r) => structuralLeaks(r.body).map((p) => `${label}: ${r.surface} ${p}`)),
  ).toEqual([]);
}

// Surfaces a Factory (or a QA inspector) may legitimately read for one Dispatch Order.
function factoryFlowPaths(saleOrderId: string, factoryDispatchId: string) {
  return [
    ['dispatch order list', '/sale-orders'],
    ['dispatch order detail', `/sale-orders/${saleOrderId}`],
    ['dispatch order packing list', `/sale-orders/${saleOrderId}/packing-list`],
    ['factory dispatch list', '/factory-dispatches'],
    ['factory dispatch detail', `/factory-dispatches/${factoryDispatchId}`],
    ['packing queue', '/factory-dispatches/packing-queue'],
  ] as const;
}

async function readAll(token: string, paths: ReadonlyArray<readonly [string, string]>) {
  const out: Snap[] = [];
  for (const [surface, path] of paths) out.push(snap(surface, await get(token, path)));
  return out;
}

describe.each([
  ['A', () => A],
  ['B', () => B],
] as const)('ISS-075 FACTORY_USER %s cannot identify either Distributor', (name, side) => {
  it('receives no Distributor identity, Purchase Mode, GSTIN or contact e-mail from any Factory-facing read', async () => {
    const own = side();
    const foreign = other(own);
    const flow = await readAll(
      own.factoryToken,
      factoryFlowPaths(own.saleOrderId, own.factoryDispatchId),
    );
    const responses = [
      ...flow,
      ...(await readAll(own.factoryToken, factoryFlowPaths(foreign.saleOrderId, foreign.factoryDispatchId))),
      ...(await readAll(own.factoryToken, surfaces(own))),
      ...(await readAll(own.factoryToken, surfaces(foreign))),
    ];
    // Not vacuous: the Factory's own Dispatch Order / packing list / Factory Dispatch are served.
    for (const r of flow) expect(r.status, r.surface).toBe(200);
    expectNoDistributorIdentity(
      responses,
      [...distributorMarkers(A), ...distributorMarkers(B)],
      `FACTORY_USER ${name}`,
    );
  });

  it('keeps every destination, Store and quantity detail needed to pack and dispatch', async () => {
    const own = side();
    const t = own.factoryToken;
    const detail = (await get(t, `/sale-orders/${own.saleOrderId}`).expect(200)).body.data;
    // One neutral group holding the destination; no per-Distributor grouping.
    expect(detail.distributors).toEqual([]);
    expect(detail.distributorGroups).toHaveLength(1);
    expect(detail.distributorGroups[0].distributor).toBeNull();
    expect(detail.distributorGroups[0].purchaseMode).toBeNull();
    const dest = detail.distributorGroups[0].destinations[0];
    expect(dest).toMatchObject({
      id: own.destinationId,
      label: own.storeLabel,
      storeCode: own.storeCode,
      retailStoreId: own.retailStoreId,
      addressLine1: own.storeAddress,
      contactName: own.contactName,
      contactPhone: own.contactPhone,
    });
    expect(dest).not.toHaveProperty('gstin');
    expect(dest).not.toHaveProperty('contactEmail');
    expect(detail.distributorGroups[0].lines).toHaveLength(1);
    expect(detail.distributorGroups[0].lines[0]).toMatchObject({
      destinationId: own.destinationId,
      quantity: 40,
      styleId: own.styleId,
      sizeId: own.sizeId,
    });
    expect(detail.totalQuantity).toBe(40);

    const packing = (await get(t, `/sale-orders/${own.saleOrderId}/packing-list`).expect(200)).body
      .data;
    expect(packing.distributors).toEqual([]);
    expect(packing.destinations[0]).toMatchObject({
      id: own.destinationId,
      label: own.storeLabel,
      storeCode: own.storeCode,
      addressLine1: own.storeAddress,
      contactName: own.contactName,
      contactPhone: own.contactPhone,
    });
    expect(packing.destinations[0]).not.toHaveProperty('distributor');
    expect(packing.destinations[0].lines[0]).toMatchObject({
      requiredQuantity: 40,
      packedQuantity: 40,
    });
    const carton = packing.destinations[0].cartons[0];
    expect(carton).toMatchObject({ id: own.cartonId, totalQuantity: 40, auditState: 'INSPECTED' });
    // Erve's QA operator name stays visible on the carton audit history (it is not a counterparty).
    expect(carton.auditHistory[0].inspectedByName).toBeTruthy();

    const list = (await get(t, '/factory-dispatches').expect(200)).body.data.items;
    expect(list).toHaveLength(1);
    expect(list[0].saleOrder.distributors).toEqual([]);
    expect(list[0].saleOrder.saleOrderNumber).toBe(own.saleOrderNumber);
  });

  it("shows only the Factory's own stages — never Erve dispatch or the Distributor's delivery", async () => {
    const own = side();
    // The Dispatch Order was dispatched by Erve and confirmed delivered to the Distributor.
    const internal = await get(merchToken, `/sale-orders/${own.saleOrderId}`).expect(200);
    expect(internal.body.data.fulfillment.stage).toBe('DELIVERED');
    const detail = await get(own.factoryToken, `/sale-orders/${own.saleOrderId}`).expect(200);
    expect(detail.body.data.fulfillment.stage).toBe('FACTORY_DISPATCHED');
    expect(detail.body.data.fulfillment.totalFactoryPackedQuantity).toBe(40);
    const list = await get(own.factoryToken, '/sale-orders').expect(200);
    expect(
      list.body.data.items.map((i: { fulfillment: { stage: string } }) => i.fulfillment.stage),
    ).toEqual(['FACTORY_DISPATCHED']);
    expect(bodyText(detail)).not.toMatch(/DELIVERED|ERVE_DISPATCHED/);
  });

  it('prepares a carton label source with the destination but without any Distributor identity', async () => {
    const own = side();
    const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({
      where: { id: own.cartonId },
    });
    const res = await request(app)
      .post(`/carton-delivery/labels/${own.cartonId}/prepare`)
      .set(auth(own.factoryToken))
      .send({ expectedVersion: carton.version })
      .expect(200);
    const source = res.body.data.source;
    expect(source.destination).toMatchObject({
      id: own.destinationId,
      label: own.storeLabel,
      addressLine1: own.storeAddress,
      contactName: own.contactName,
      contactPhone: own.contactPhone,
    });
    expect(source.carton).toMatchObject({ id: own.cartonId, totalQuantity: 40 });
    expectNoDistributorIdentity(
      [snap('label source', res)],
      [...distributorMarkers(A), ...distributorMarkers(B)],
      `label ${name}`,
    );
  });
});

describe('ISS-075 authorized internal readers keep the full Distributor picture', () => {
  it.each([
    ['ADMIN', () => adminToken],
    ['MERCHANDISER', () => merchToken],
    ['SENIOR_MANAGEMENT', () => seniorToken],
    ['ACCOUNTANT', () => accountantToken],
  ] as const)(
    '%s sees Distributor, Purchase Mode, GSTIN and contact e-mail on Dispatch Orders',
    async (_role, token) => {
      const detail = (await get(token(), `/sale-orders/${A.saleOrderId}`).expect(200)).body.data;
      expect(detail.distributors).toEqual([
        expect.objectContaining({
          id: A.distributorId,
          code: A.distributorCode,
          name: A.distributorName,
          purchaseMode: 'SALE_RETURN',
        }),
      ]);
      expect(detail.distributorGroups[0]).toMatchObject({
        distributor: { id: A.distributorId, code: A.distributorCode, name: A.distributorName },
        purchaseMode: 'SALE_RETURN',
      });
      expect(detail.distributorGroups[0].destinations[0]).toMatchObject({
        gstin: A.storeGstin,
        contactEmail: A.storeEmail,
      });
      expect(detail.fulfillment.stage).toBe('DELIVERED');
      const list = await get(token(), '/sale-orders').expect(200);
      expect(bodyText(list)).toContain(A.distributorName);
      expect(bodyText(list)).toContain(B.distributorName);
    },
  );

  it.each([
    ['ADMIN', () => adminToken],
    ['MERCHANDISER', () => merchToken],
    ['SENIOR_MANAGEMENT', () => seniorToken],
  ] as const)(
    '%s sees the Distributor on the packing list and Factory Dispatch list',
    async (_role, token) => {
      const packing = (await get(token(), `/sale-orders/${A.saleOrderId}/packing-list`).expect(200))
        .body.data;
      expect(packing.distributors).toEqual([
        { id: A.distributorId, code: A.distributorCode, name: A.distributorName },
      ]);
      expect(packing.destinations[0].distributor.name).toBe(A.distributorName);
      expect(packing.destinations[0]).toMatchObject({
        gstin: A.storeGstin,
        contactEmail: A.storeEmail,
      });
      const detail = await get(token(), `/factory-dispatches/${A.factoryDispatchId}`).expect(200);
      expect(detail.body.data.destinations[0].distributor.code).toBe(A.distributorCode);
      const dispatches = await get(token(), '/factory-dispatches').expect(200);
      expect(bodyText(dispatches)).toContain(A.distributorName);
    },
  );
});

describe('ISS-075 Factory packing flow end to end, with a Factory that never learns the Distributor', () => {
  type Flow = {
    factoryId: string;
    distributorId: string;
    distributorName: string;
    distributorCode: string;
    storeEmail: string;
    storeGstin: string;
    saleOrderId: string;
    saleOrderNumber: string;
    saleOrderLineId: string;
    styleId: string;
    destinationId: string;
    storeLabel: string;
    storeCode: string;
    storeAddress: string;
    factoryToken: string;
    factoryQaToken: string;
    factoryDistributorToken: string;
    qaToken: string;
    cartonId?: string;
    factoryDispatchId?: string;
  };
  let C: Flow;
  const payloads: Record<string, unknown> = {};
  const record = (name: string, res: request.Response) => {
    payloads[name] = res.body;
  };

  beforeAll(async () => {
    const fx = await createSingleFactoryApprovedSaleOrder(app, 30, 'SALE_RETURN');
    const distributorId = fx.stock.distributorId;
    const factoryId = fx.stock.factoryId;
    const distributorName = 'ZZ-DIST-CHARLIE-NAME';
    const distributorCode = 'ZZDISTCHARLIE';
    await prisma.distributor.update({
      where: { id: distributorId },
      data: { name: distributorName, code: distributorCode },
    });
    await prisma.factory.update({
      where: { id: factoryId },
      data: { name: 'ZZ-FACTORY-CHARLIE-NAME', code: 'ZZFACCHARLIE' },
    });
    const storeAddress = 'ZZ-CHARLIE-SECRET-STREET';
    const storeEmail = 'zz-charlie-contact@zzcharlie-corp.example';
    const storeGstin = 'ZZGSTCHARLIE0001';
    await prisma.saleOrderDestination.updateMany({
      where: { saleOrderDistributor: { distributorId } },
      data: {
        addressLine1: storeAddress,
        contactEmail: storeEmail,
        gstin: storeGstin,
        contactName: 'ZZ Charlie Store Manager',
        contactPhone: '+91-ZZ-CHARLIE-0001',
      },
    });
    const destination = await prisma.saleOrderDestination.findFirstOrThrow({
      where: { saleOrderDistributor: { distributorId } },
    });
    const factoryToken = await createFactoryUserToken(factoryId);
    const factoryQa = await createTestUserAndToken({
      email: `factory-qa-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER', 'QA_USER'],
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId: factoryQa.userId, factoryId },
    });
    // The account that spans BOTH counterparties: mapped to this Factory and to this Distributor.
    const both = await createTestUserAndToken({
      email: `factory-dist-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER', 'DISTRIBUTOR'],
    });
    await prisma.userFactory.create({ data: { id: createId(), userId: both.userId, factoryId } });
    await prisma.userDistributor.create({
      data: { id: createId(), userId: both.userId, distributorId },
    });
    const qa = await createRoleToken('QA_USER');
    C = {
      factoryId,
      distributorId,
      distributorName,
      distributorCode,
      storeEmail,
      storeGstin,
      saleOrderId: fx.saleOrder.id,
      saleOrderNumber: fx.saleOrder.saleOrderNumber,
      saleOrderLineId: fx.saleOrderLineId,
      styleId: fx.stock.styleId,
      destinationId: destination.id,
      storeLabel: destination.label!,
      storeCode: destination.storeCode!,
      storeAddress,
      factoryToken,
      factoryQaToken: factoryQa.token,
      factoryDistributorToken: both.token,
      qaToken: qa.token,
    };
  }, 60_000);

  const cMarkers = () => [
    C.distributorName,
    C.distributorCode,
    C.distributorId,
    C.storeEmail,
    C.storeGstin,
    ...distributorMarkers(A),
    ...distributorMarkers(B),
  ];

  it('lists the packing queue by destination; internal readers also get the Distributor', async () => {
    const res = await get(C.factoryToken, '/factory-dispatches/packing-queue').expect(200);
    record('packing-queue.factory', res);
    expect(res.body.data.items).toHaveLength(1);
    const item = res.body.data.items[0];
    expect(item).toMatchObject({
      saleOrderId: C.saleOrderId,
      remainingQuantity: 30,
      destination: { id: C.destinationId, label: C.storeLabel, storeCode: C.storeCode },
    });
    expect(item.destination.city).toBeTruthy();
    expect(item).not.toHaveProperty('distributor');
    expectNoDistributorIdentity([snap('packing queue', res)], cMarkers(), 'C');

    for (const token of [adminToken, merchToken, seniorToken]) {
      const internal = await get(
        token,
        `/factory-dispatches/packing-queue?factoryId=${C.factoryId}`,
      ).expect(200);
      expect(internal.body.data.items[0].distributor).toEqual({
        id: C.distributorId,
        code: C.distributorCode,
        name: C.distributorName,
      });
      expect(internal.body.data.items[0].destination.id).toBe(C.destinationId);
    }
  });

  it('lets the Factory pack a carton using only identifiers from its own neutral responses', async () => {
    const packing = await get(C.factoryToken, `/sale-orders/${C.saleOrderId}/packing-list`).expect(
      200,
    );
    record('packing-list.factory.before', packing);
    const dest = packing.body.data.destinations[0];
    const created = await request(app)
      .post(`/sale-orders/${C.saleOrderId}/packing-list/cartons`)
      .set(auth(C.factoryToken))
      .send({
        cartonNumber: 'CC1',
        destinationId: dest.id,
        netWeight: 5,
        grossWeight: 6,
        dimensions: '40 x 30 x 20 cm',
        lines: [{ saleOrderLineId: dest.lines[0].saleOrderLineId, quantity: 30 }],
      })
      .expect(200);
    record('packing-list.factory.after-pack', created);
    C.cartonId = created.body.data.destinations[0].cartons[0].id;
    C.factoryDispatchId = created.body.data.factoryDispatch.id;
    expect(created.body.data.destinations[0].cartons[0].totalQuantity).toBe(30);
    expect(created.body.data.destinations[0].lines[0].packedQuantity).toBe(30);
    expectNoDistributorIdentity(
      [snap('packing list before', packing), snap('create carton', created)],
      cMarkers(),
      'C pack',
    );
    expect(
      (await get(C.factoryToken, '/factory-dispatches/packing-queue').expect(200)).body.data.items,
    ).toEqual([]);
    const draft = await get(C.factoryToken, '/factory-dispatches').expect(200);
    record('factory-dispatch-list.factory', draft);
    expectNoDistributorIdentity([snap('draft list', draft)], cMarkers(), 'C');
    record('dispatch-order.factory', await get(C.factoryToken, `/sale-orders/${C.saleOrderId}`));
    record('dispatch-order-list.factory', await get(C.factoryToken, '/sale-orders'));
  });

  it('shows the QA inspector the carton and destination, never the Distributor — and still lets it audit', async () => {
    const queue = await get(C.qaToken, '/packing-audit/queue').expect(200);
    record('packing-audit-queue.qa', queue);
    const item = queue.body.data.items.find((i: { id: string }) => i.id === C.cartonId);
    expect(item).toBeTruthy();
    expect(item.destination).toMatchObject({ id: C.destinationId, label: C.storeLabel });
    expect(item.destination.city).toBeTruthy();
    expect(item.destination).not.toHaveProperty('distributor');
    const detail = await get(C.qaToken, `/packing-audit/cartons/${C.cartonId}`).expect(200);
    record('packing-audit-carton.qa', detail);
    expectNoDistributorIdentity(
      [snap('audit queue', queue), snap('audit detail', detail)],
      cMarkers(),
      'QA',
    );
    // Internal oversight (ADMIN) keeps the Distributor on the same documents.
    const adminQueue = await get(adminToken, '/packing-audit/queue').expect(200);
    const adminItem = adminQueue.body.data.items.find((i: { id: string }) => i.id === C.cartonId);
    expect(adminItem.destination.distributor).toEqual({
      id: C.distributorId,
      code: C.distributorCode,
      name: C.distributorName,
    });
    const adminDetail = await get(adminToken, `/packing-audit/cartons/${C.cartonId}`).expect(200);
    expect(adminDetail.body.data.destination.distributor.name).toBe(C.distributorName);

    const confirmed = await request(app)
      .post(`/factory-dispatches/${C.factoryDispatchId}/cartons/${C.cartonId}/audit`)
      .set(auth(C.qaToken))
      .send({})
      .expect(200);
    record('packing-audit-confirm.qa', confirmed);
    expectNoDistributorIdentity([snap('audit confirm', confirmed)], cMarkers(), 'QA confirm');
  });

  it('does not let a mixed-role account bypass the restriction', async () => {
    // FACTORY_USER + QA_USER: the cross-Factory audit surface must not become a Distributor lookup.
    // FACTORY_USER + DISTRIBUTOR: its Factory-side reads stay neutral even though it is also mapped
    // to this very Distributor, and its Distributor-side reads show no Factory identity.
    for (const [label, token] of [
      ['FACTORY_USER+QA_USER', C.factoryQaToken],
      ['FACTORY_USER+DISTRIBUTOR', C.factoryDistributorToken],
    ] as const) {
      const responses = await readAll(token, [
        ...factoryFlowPaths(C.saleOrderId, C.factoryDispatchId!),
        ['packing audit queue', '/packing-audit/queue'],
        ['packing audit carton', `/packing-audit/cartons/${C.cartonId}`],
      ]);
      expectNoDistributorIdentity(responses, cMarkers(), label);
    }
    const both = await get(C.factoryDistributorToken, '/erve-dispatches').expect(200);
    expectNoneOf(
      [snap('distributor side', both)],
      [
        ...factoryIdentities(A),
        ...factoryIdentities(B),
        'ZZ-FACTORY-CHARLIE-NAME',
        'ZZFACCHARLIE',
        C.factoryId,
      ],
      'FACTORY_USER+DISTRIBUTOR',
    );
  });

  it('finalizes, prepares a label and exposes no Distributor identity or downstream state', async () => {
    const fd = await prisma.factoryDispatch.findUniqueOrThrow({
      where: { id: C.factoryDispatchId! },
    });
    await ensureStyleFactoryRate(C.styleId, C.factoryId);
    const finalized = await request(app)
      .post(`/factory-dispatches/${C.factoryDispatchId}/actions/finalize`)
      .set(auth(C.factoryToken))
      .send({ expectedVersion: fd.version })
      .expect(200);
    record('finalize.factory', finalized);
    expectNoDistributorIdentity([snap('finalize', finalized)], cMarkers(), 'C');

    const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({
      where: { id: C.cartonId! },
    });
    const label = await request(app)
      .post(`/carton-delivery/labels/${C.cartonId}/prepare`)
      .set(auth(C.factoryToken))
      .send({ expectedVersion: carton.version })
      .expect(200);
    record('carton-label-source.factory', label);
    expect(label.body.data.source.destination).toMatchObject({
      id: C.destinationId,
      label: C.storeLabel,
      addressLine1: C.storeAddress,
    });
    expectNoDistributorIdentity([snap('label source', label)], cMarkers(), 'C');

    const so = await get(C.factoryToken, `/sale-orders/${C.saleOrderId}`).expect(200);
    expect(so.body.data.fulfillment.stage).toBe('FACTORY_DISPATCHED');
    expect(so.body.data.isLocked).toBe(true);

    const dir = process.env.ISS075_PAYLOAD_DIR;
    if (dir) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      // Internal views of the same records, for side-by-side rendered-PDF inspection.
      record('packing-list.merchandiser', await get(merchToken, `/sale-orders/${C.saleOrderId}/packing-list`));
      record('dispatch-order.merchandiser', await get(merchToken, `/sale-orders/${C.saleOrderId}`));
      record('dispatch-order-list.merchandiser', await get(merchToken, '/sale-orders'));
      record('packing-audit-carton.admin', await get(adminToken, `/packing-audit/cartons/${C.cartonId}`));
      await writeFile(`${dir}/payloads.json`, JSON.stringify(payloads, null, 2));
    }
  });
});
