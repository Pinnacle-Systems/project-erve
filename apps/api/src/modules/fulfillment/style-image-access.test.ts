import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestDistributor, createTestSeason, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { canReadAnyStyleImage } from '../master-data/style-images.service.js';
import {
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

// Each full Sale Order -> pack -> Erve Dispatch -> delivery fixture is several seconds and some
// scenarios (cross-Distributor, shared Style) need two or three of them.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function pngFixture(fillByte: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(17, fillByte),
  ]);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const getList = (token: string, styleId: string) => request(app).get(`/styles/${styleId}/images`).set(auth(token));
const getContent = (token: string, styleId: string, imageId: string) =>
  request(app).get(`/styles/${styleId}/images/${imageId}/content`).set(auth(token));

async function uploadImage(token: string, styleId: string, fill: number) {
  const res = await request(app)
    .post(`/styles/${styleId}/images`)
    .set(auth(token))
    .attach('image', pngFixture(fill), { filename: 'photo.png', contentType: 'image/png' })
    .expect(201);
  return res.body.data.id as string;
}

/** Both read endpoints must agree: list + bytes. */
async function expectReadable(token: string, styleId: string, imageId: string) {
  const list = await getList(token, styleId).expect(200);
  expect(list.body.data.map((image: { id: string }) => image.id)).toContain(imageId);
  const content = await getContent(token, styleId, imageId).expect(200);
  expect(content.headers['content-type']).toBe('image/png');
}

async function expectDenied(token: string, styleId: string, imageId: string) {
  const list = await getList(token, styleId);
  expect(list.status).toBe(403);
  expect(JSON.stringify(list.body)).not.toContain(imageId);
  const content = await getContent(token, styleId, imageId);
  expect(content.status).toBe(403);
  expect(content.headers['content-type']).not.toMatch(/image/);
}

/** A delivered dispatch (any purchase mode) with an uploaded primary image for its Style. */
async function dispatchedFixture(
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN',
  options?: { styleId?: string; sizeId?: string; withImage?: boolean; quantity?: number },
) {
  const quantity = options?.quantity ?? 100;
  const f = await createSingleFactoryApprovedSaleOrder(app, quantity, purchaseMode, {
    styleId: options?.styleId,
    sizeId: options?.sizeId,
  });
  const imageId = options?.withImage === false || options?.styleId ? null : await uploadImage(f.merchToken, f.stock.styleId, 0xaa);
  const factoryToken = await createFactoryUserToken(f.stock.factoryId);
  const factoryDispatch = await packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, quantity);
  const dispatch = await consolidateAndDispatch(app, f.merchToken, [factoryDispatch.cartonId]);
  const delivered = await confirmErveDispatchDelivery(app, f.merchToken, dispatch.id, dispatch.version, [
    { saleOrderLineId: f.saleOrderLineId, receivedQuantity: quantity },
  ]);
  const size = await prisma.size.findFirstOrThrow({ where: { saleOrderLines: { some: { id: f.saleOrderLineId } } } });
  return { ...f, imageId, factoryToken, dispatch: delivered.body.data, factoryDispatch, size };
}

type Fixture = Awaited<ReturnType<typeof dispatchedFixture>>;

async function submitReport(f: Fixture, quantitySold = 10) {
  const res = await request(app)
    .post('/distributor-sales-reports')
    .set(auth(f.distributorToken))
    .send({
      distributorId: f.stock.distributorId,
      reportDate: '2026-08-01',
      lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, quantitySold }],
    })
    .expect(201);
  return res.body.data.id as string;
}

async function submitReturn(f: Fixture, requestedQuantity = 10) {
  const res = await request(app)
    .post('/distributor-returns')
    .set(auth(f.distributorToken))
    .send({
      distributorId: f.stock.distributorId,
      returnDate: '2026-09-01',
      returnReason: 'End of season',
      lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, requestedQuantity }],
    })
    .expect(201);
  return res.body.data.id as string;
}

/** Makes the Dispatch/position pathways unavailable so only a report/return can associate the Style. */
async function retireCartons(f: Fixture) {
  await prisma.factoryPackingCarton.updateMany({ where: { id: { not: '' } }, data: { retiredAt: new Date() } });
  expect(await prisma.factoryPackingCarton.count({ where: { retiredAt: null } })).toBe(0);
  return f;
}

async function plainStyleWithImage(merchToken: string, fill = 0xcc) {
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `FREE-${createId()}`,
      styleName: 'Unassociated style',
      finalMrp: 100,
      seasonId: (await createTestSeason()).id,
    },
  });
  return { style, imageId: await uploadImage(merchToken, style.id, fill) };
}

async function tokenWithRoles(roles: Role[], extra?: { distributorId?: string }) {
  const { userId, token } = await createTestUserAndToken({
    email: `multi-${createId()}@test.local`,
    password: 'pass',
    roles,
  });
  if (extra?.distributorId) {
    await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId: extra.distributorId } });
  }
  return token;
}

describe('canReadAnyStyleImage role matrix', () => {
  it.each([
    [['ADMIN'], true],
    [['MERCHANDISER'], true],
    [['SENIOR_MANAGEMENT'], true],
    [['ACCOUNTANT'], true],
    [['DISTRIBUTOR'], false],
    [['FACTORY_USER'], false],
    [['QA_USER'], false],
    [['DISTRIBUTOR', 'ACCOUNTANT'], true],
  ] as Array<[Role[], boolean]>)('%j -> %s', (roles, expected) => {
    expect(canReadAnyStyleImage({ roles })).toBe(expected);
  });
});

describe('Style image read access: ACCOUNTANT', () => {
  it('reads the image list and bytes of any Style, including one on no operational record', async () => {
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const { token: accountant } = await createRoleToken('ACCOUNTANT');
    const { style, imageId } = await plainStyleWithImage(merch);
    await expectReadable(accountant, style.id, imageId);
  });

  it('reads the (empty) gallery of a Style with no image and gets a 404 for a missing image id', async () => {
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const { token: accountant } = await createRoleToken('ACCOUNTANT');
    const { style, imageId } = await plainStyleWithImage(merch);
    await prisma.styleImage.deleteMany({ where: { styleId: style.id } });
    const list = await getList(accountant, style.id).expect(200);
    expect(list.body.data).toEqual([]);
    await getContent(accountant, style.id, imageId).expect(404);
  });

  it('gains no image-management or Style Master permission', async () => {
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const { token: accountant } = await createRoleToken('ACCOUNTANT');
    const { style, imageId } = await plainStyleWithImage(merch);
    const before = await prisma.styleImage.findMany({ where: { styleId: style.id } });

    await request(app).post(`/styles/${style.id}/images`).set(auth(accountant))
      .attach('image', pngFixture(0x01), { filename: 'x.png', contentType: 'image/png' }).expect(403);
    await request(app).put(`/styles/${style.id}/images/${imageId}`).set(auth(accountant))
      .attach('image', pngFixture(0x02), { filename: 'x.png', contentType: 'image/png' }).expect(403);
    await request(app).patch(`/styles/${style.id}/images/${imageId}/primary`).set(auth(accountant)).expect(403);
    await request(app).delete(`/styles/${style.id}/images/${imageId}`).set(auth(accountant)).expect(403);
    // Style Master browsing/editing stays closed.
    await request(app).get('/styles').set(auth(accountant)).expect(403);
    await request(app).get(`/styles/${style.id}`).set(auth(accountant)).expect(403);
    await request(app).patch(`/styles/${style.id}`).set(auth(accountant)).send({ styleName: 'Renamed' }).expect(403);

    const after = await prisma.styleImage.findMany({ where: { styleId: style.id } });
    expect(after.map((i) => [i.id, i.fileId, i.isPrimary])).toEqual(before.map((i) => [i.id, i.fileId, i.isPrimary]));
  });
});

describe('Style image read access: DISTRIBUTOR (own operational records only)', () => {
  it('allows a Style on the Distributor\'s own Erve Dispatch', async () => {
    const f = await dispatchedFixture('OUTRIGHT');
    await expectReadable(f.distributorToken, f.stock.styleId, f.imageId!);
  });

  it('allows a Style on the Distributor\'s own Sale-or-Return position', async () => {
    const f = await dispatchedFixture('SALE_RETURN');
    const positions = await request(app).get('/sale-or-return-positions').set(auth(f.distributorToken)).expect(200);
    expect(positions.body.data.items.map((row: { saleOrderLineId: string }) => row.saleOrderLineId)).toContain(f.saleOrderLineId);
    // Isolate the position pathway: the Dispatch is recorded against someone else, but the
    // Sale Order destination (which keys the position) still belongs to this Distributor.
    const other = await createTestDistributor({ purchaseMode: 'SALE_RETURN' });
    await prisma.erveDispatch.update({ where: { id: f.dispatch.id }, data: { distributorId: other.id } });
    await expectReadable(f.distributorToken, f.stock.styleId, f.imageId!);
  });

  it('allows a Style reached only through the Distributor\'s own Actual Sales Report, and stops when it is gone', async () => {
    const f = await dispatchedFixture('SALE_RETURN');
    const reportId = await submitReport(f);
    await retireCartons(f);
    await expectReadable(f.distributorToken, f.stock.styleId, f.imageId!);
    await prisma.distributorSalesReportLine.deleteMany({ where: { distributorSalesReportId: reportId } });
    await expectDenied(f.distributorToken, f.stock.styleId, f.imageId!);
  });

  it('allows a Style reached only through the Distributor\'s own Return, and stops when it is gone', async () => {
    const f = await dispatchedFixture('SALE_RETURN');
    const returnId = await submitReturn(f);
    await retireCartons(f);
    await expectReadable(f.distributorToken, f.stock.styleId, f.imageId!);
    await prisma.distributorReturnLine.deleteMany({ where: { distributorReturnId: returnId } });
    await expectDenied(f.distributorToken, f.stock.styleId, f.imageId!);
  });

  it('denies a Style that belongs exclusively to another Distributor (list and bytes), in both directions', async () => {
    const a = await dispatchedFixture('SALE_RETURN');
    const b = await dispatchedFixture('SALE_RETURN');
    expect(a.stock.distributorId).not.toBe(b.stock.distributorId);
    await expectDenied(a.distributorToken, b.stock.styleId, b.imageId!);
    await expectDenied(b.distributorToken, a.stock.styleId, a.imageId!);
    // ...and each still reads its own.
    await expectReadable(a.distributorToken, a.stock.styleId, a.imageId!);
    await expectReadable(b.distributorToken, b.stock.styleId, b.imageId!);
  });

  it('does not let a valid imageId of another Distributor\'s Style be fetched through the caller\'s own styleId', async () => {
    const a = await dispatchedFixture('OUTRIGHT');
    const b = await dispatchedFixture('OUTRIGHT');
    // Authorized styleId, foreign imageId: the image is bound to its Style, so it is not found.
    const res = await getContent(a.distributorToken, a.stock.styleId, b.imageId!);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).not.toMatch(/image/);
    // Foreign styleId, valid imageId: forbidden before any lookup.
    await expectDenied(a.distributorToken, b.stock.styleId, b.imageId!);
  });

  it('allows a Style shared by two Distributors for each of them, but not for a third', async () => {
    const a = await dispatchedFixture('OUTRIGHT');
    const b = await dispatchedFixture('OUTRIGHT', { styleId: a.stock.styleId, sizeId: a.size.id });
    expect(b.stock.styleId).toBe(a.stock.styleId);
    expect(b.stock.distributorId).not.toBe(a.stock.distributorId);
    const c = await dispatchedFixture('OUTRIGHT');
    await expectReadable(a.distributorToken, a.stock.styleId, a.imageId!);
    await expectReadable(b.distributorToken, a.stock.styleId, a.imageId!);
    await expectDenied(c.distributorToken, a.stock.styleId, a.imageId!);
  });

  it('is not granted by owning merely a Sale Order, a retired carton, or a Style with no record at all', async () => {
    const f = await dispatchedFixture('OUTRIGHT');
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const free = await plainStyleWithImage(merch);
    await expectDenied(f.distributorToken, free.style.id, free.imageId);
    await retireCartons(f);
    await expectDenied(f.distributorToken, f.stock.styleId, f.imageId!);
  });

  it('cannot browse the Style Master or manage images', async () => {
    const f = await dispatchedFixture('OUTRIGHT');
    const token = f.distributorToken;
    const styleId = f.stock.styleId;
    const imageId = f.imageId!;
    await request(app).get('/styles').set(auth(token)).expect(403);
    await request(app).get(`/styles/${styleId}`).set(auth(token)).expect(403);
    await request(app).post(`/styles/${styleId}/images`).set(auth(token))
      .attach('image', pngFixture(0x01), { filename: 'x.png', contentType: 'image/png' }).expect(403);
    await request(app).put(`/styles/${styleId}/images/${imageId}`).set(auth(token))
      .attach('image', pngFixture(0x02), { filename: 'x.png', contentType: 'image/png' }).expect(403);
    await request(app).patch(`/styles/${styleId}/images/${imageId}/primary`).set(auth(token)).expect(403);
    await request(app).delete(`/styles/${styleId}/images/${imageId}`).set(auth(token)).expect(403);
    expect(await prisma.styleImage.count({ where: { styleId } })).toBe(1);
  });

  it('fails closed for a Distributor user who is not mapped to any Distributor', async () => {
    // (An ambiguous multi-Distributor mapping cannot exist: user_distributors.user_id is unique.)
    const f = await dispatchedFixture('OUTRIGHT');
    const unmapped = await tokenWithRoles(['DISTRIBUTOR']);
    expect((await getContent(unmapped, f.stock.styleId, f.imageId!)).status).toBe(403);
    expect((await getList(unmapped, f.stock.styleId)).status).toBe(403);
  });
});

describe('Style image read access: multi-role users and unchanged Factory / QA scoping', () => {
  it('DISTRIBUTOR + ACCOUNTANT reads any Style (the unrestricted role wins)', async () => {
    const own = await dispatchedFixture('OUTRIGHT');
    const foreign = await dispatchedFixture('OUTRIGHT');
    const token = await tokenWithRoles(['DISTRIBUTOR', 'ACCOUNTANT'], { distributorId: own.stock.distributorId });
    await expectReadable(token, own.stock.styleId, own.imageId!);
    await expectReadable(token, foreign.stock.styleId, foreign.imageId!);
  });

  it('DISTRIBUTOR + QA_USER is granted by either pathway and denied when neither applies', async () => {
    const own = await dispatchedFixture('OUTRIGHT');
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const free = await plainStyleWithImage(merch);
    const token = await tokenWithRoles(['DISTRIBUTOR', 'QA_USER'], { distributorId: own.stock.distributorId });
    await expectReadable(token, own.stock.styleId, own.imageId!);
    // A foreign Distributor's Style that has a Job Order is reachable via the QA pathway...
    const foreign = await dispatchedFixture('OUTRIGHT');
    await expectReadable(token, foreign.stock.styleId, foreign.imageId!);
    // ...but a Style with neither a Job Order nor an own record is not.
    await expectDenied(token, free.style.id, free.imageId);
  });

  it('FACTORY_USER stays scoped to Job Orders of the mapped Factory', async () => {
    const f = await dispatchedFixture('OUTRIGHT');
    const other = await dispatchedFixture('OUTRIGHT');
    await expectReadable(f.factoryToken, f.stock.styleId, f.imageId!);
    await expectDenied(f.factoryToken, other.stock.styleId, other.imageId!);
    // Distributor-scoped records grant a Factory user nothing.
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const free = await plainStyleWithImage(merch);
    await expectDenied(f.factoryToken, free.style.id, free.imageId);
  });

  it('QA_USER stays scoped to Styles on Job Orders', async () => {
    const f = await dispatchedFixture('OUTRIGHT');
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const free = await plainStyleWithImage(merch);
    const { token: qa } = await createRoleToken('QA_USER');
    await expectReadable(qa, f.stock.styleId, f.imageId!);
    await expectDenied(qa, free.style.id, free.imageId);
  });

  it('keeps ADMIN / MERCHANDISER / SENIOR_MANAGEMENT unrestricted and unauthenticated callers out', async () => {
    const { token: merch } = await createRoleToken('MERCHANDISER');
    const { style, imageId } = await plainStyleWithImage(merch);
    for (const role of ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const) {
      await expectReadable((await createRoleToken(role)).token, style.id, imageId);
    }
    await request(app).get(`/styles/${style.id}/images`).expect(401);
    await request(app).get(`/styles/${style.id}/images/${imageId}/content`).expect(401);
  });
});

describe('Erve Dispatch detail projection of primaryImage', () => {
  it('gives the owning Distributor and an Accountant usable primaryImage metadata that the content endpoint serves', async () => {
    const f = await dispatchedFixture('SALE_RETURN');
    const { token: accountant } = await createRoleToken('ACCOUNTANT');
    for (const token of [f.distributorToken, accountant]) {
      const res = await request(app).get(`/erve-dispatches/${f.dispatch.id}`).set(auth(token)).expect(200);
      const line = res.body.data.quantityLines[0];
      expect(line.styleId).toBe(f.stock.styleId);
      expect(line.primaryImage.id).toBe(f.imageId);
      await getContent(token, line.styleId, line.primaryImage.id).expect(200);
    }
  });

  it('resolves null primaryImage for a Style with no image', async () => {
    const f = await dispatchedFixture('OUTRIGHT', { withImage: false });
    const { token: accountant } = await createRoleToken('ACCOUNTANT');
    for (const token of [f.distributorToken, accountant]) {
      const res = await request(app).get(`/erve-dispatches/${f.dispatch.id}`).set(auth(token)).expect(200);
      expect(res.body.data.quantityLines[0].primaryImage).toBeNull();
    }
  });

  it('never exposes another Distributor\'s dispatch (and so its image metadata) to a Distributor', async () => {
    const a = await dispatchedFixture('OUTRIGHT');
    const b = await dispatchedFixture('OUTRIGHT');
    const res = await request(app).get(`/erve-dispatches/${b.dispatch.id}`).set(auth(a.distributorToken));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(b.imageId!);
  });
});
