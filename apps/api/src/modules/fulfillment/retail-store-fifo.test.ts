import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { StoreFifoAvailability } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestRetailStore,
  createTestSeason,
  resetDatabase,
} from '../../test/helpers.js';
import {
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  packAndFinalize,
} from './fulfillment-test-helpers.js';
import { istDateOf } from './retail-store-fifo-allocation.js';

// ISS-089 / ISS-092. Fixtures go through the real Packing -> EIPL -> Dispatch -> Distributor receipt
// flow; only what no API can produce (an older receipt timestamp, a legacy assumed receipt) is set
// directly on the Dispatch row.

const app = createApp();
beforeAll(resetDatabase);
afterAll(() => prisma.$disconnect());

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dateAgo = (n: number) => istDateOf(daysAgo(n));
const today = () => istDateOf(new Date());

type Mode = 'SALE_RETURN' | 'OUTRIGHT';

async function newSizes(sizes: Array<{ code: string; order: number }>) {
  const created = [];
  for (const s of sizes) {
    created.push(
      await prisma.size.create({
        data: { id: createId(), code: `${s.code}-${createId().slice(-5)}`, label: s.code, sizeType: 'ALPHA', sortOrder: s.order },
      }),
    );
  }
  return created;
}
async function newStyle(prefix = 'FIFO') {
  const season = await createTestSeason();
  return prisma.style.create({
    data: { id: createId(), styleNumber: `${prefix}-${createId().slice(-6)}`, styleName: `${prefix} style`, finalMrp: 100, seasonId: season.id },
  });
}
async function newWorld(mode: Mode = 'SALE_RETURN') {
  const distributor = await createTestDistributor({ purchaseMode: mode });
  const distributorToken = await createDistributorToken(distributor.id);
  const admin = await createRoleToken('ADMIN');
  const merch = await createRoleToken('MERCHANDISER');
  const accountant = await createRoleToken('ACCOUNTANT');
  return { distributor, distributorToken, adminToken: admin.token, merchToken: merch.token, accountantToken: accountant.token };
}
type World = Awaited<ReturnType<typeof newWorld>>;

/** Ships `quantity` of a Style x Size to a Store through the real flow and records the Distributor's receipt. */
async function shipAndReceive(
  world: World,
  o: { retailStoreId: string; styleId: string; sizeId: string; quantity: number; receivedDaysAgo?: number },
) {
  // The order splits a Style total across its active Sizes: only the shipped Size may be active.
  await prisma.styleSize.updateMany({ where: { styleId: o.styleId, sizeId: { not: o.sizeId } }, data: { status: 'INACTIVE' } });
  const existing = await prisma.styleSize.findFirst({ where: { styleId: o.styleId, sizeId: o.sizeId } });
  if (existing) await prisma.styleSize.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
  else await prisma.styleSize.create({ data: { id: createId(), styleId: o.styleId, sizeId: o.sizeId, status: 'ACTIVE' } });

  const factory = await createTestFactory();
  const factoryToken = await createFactoryUserToken(factory.id);
  const f = await createApprovedSaleOrder(app, {
    distributorId: world.distributor.id,
    factoryId: factory.id,
    quantity: o.quantity,
    retailStoreId: o.retailStoreId,
    styleId: o.styleId,
    sizeId: o.sizeId,
  });
  const packed = await packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, o.quantity);
  const dispatch = await consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  await request(app)
    .post(`/erve-dispatches/${dispatch.id}/distributor-receipt`)
    .set('Authorization', `Bearer ${world.distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: dispatch.version, acknowledged: true, remarks: 'receipt', groups: [{ styleId: o.styleId, sizeId: o.sizeId, receivedQuantity: o.quantity }] })
    .expect(201);
  if (o.receivedDaysAgo !== undefined) {
    await prisma.erveDispatch.update({ where: { id: dispatch.id }, data: { deliveredAt: daysAgo(o.receivedDaysAgo) } });
  }
  return { dispatchId: dispatch.id as string, saleOrderLineId: f.saleOrderLineId as string, saleOrderId: f.saleOrder.id as string };
}

const storeKey = (retailStoreId: string) => `S:${retailStoreId}`;

function postSale(token: string, body: Record<string, unknown>, key: string | null = createId()) {
  const req = request(app).post('/retail-store-inventory/store-fifo/sales-reports').set('Authorization', `Bearer ${token}`);
  return (key === null ? req : req.set('Idempotency-Key', key)).send({ reportDate: today(), ...body });
}
function postReturn(token: string, body: Record<string, unknown>, key: string | null = createId()) {
  const req = request(app).post('/retail-store-inventory/store-fifo/returns').set('Authorization', `Bearer ${token}`);
  return (key === null ? req : req.set('Idempotency-Key', key)).send({ returnDate: today(), returnReason: 'Unsold stock', ...body });
}
async function availability(token: string, q: { storeKey: string; styleId: string; sizeId: string; date?: string }) {
  const res = await request(app)
    .get('/retail-store-inventory/store-fifo/availability')
    .query({ date: today(), ...q })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.data as StoreFifoAvailability;
}
async function soldBy(dispatchId: string, saleOrderLineId: string) {
  const r = await prisma.distributorSalesReportLine.aggregate({ where: { erveDispatchId: dispatchId, saleOrderLineId }, _sum: { quantitySold: true } });
  return r._sum.quantitySold ?? 0;
}
const lineSummary = (lines: Array<{ erveDispatch: { id: string }; quantitySold?: number; requestedQuantity?: number }>) =>
  lines.map((l) => [l.erveDispatch.id, l.quantitySold ?? l.requestedQuantity]);

/** One Store x Style x Size with two received Dispatches: A (older, 60) and B (newer, 40). B is created first on purpose. */
async function twoDispatchCell(world: World) {
  const style = await newStyle();
  const [m] = await newSizes([{ code: 'M', order: 2 }]);
  const store = await createTestRetailStore(world.distributor.id);
  const b = await shipAndReceive(world, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 40, receivedDaysAgo: 5 });
  const a = await shipAndReceive(world, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 60, receivedDaysAgo: 20 });
  return { style, size: m!, store, a, b, key: storeKey(store.id), cell: { storeKey: storeKey(store.id), styleId: style.id, sizeId: m!.id } };
}

describe('ISS-089 Store-level FIFO — Report Sold', { timeout: 90000 }, () => {
  it('allocates across two Dispatches oldest receipt first (60 + 40, sale 75 -> A 60, B 15, 25 left on B) without any Dispatch id in the request', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);

    const body = { ...c.cell, quantity: 75 };
    expect(JSON.stringify(body)).not.toMatch(/dispatch/i);
    const res = await postSale(w.distributorToken, body).expect(201);
    expect(res.body.data.replayed).toBe(false);
    const report = res.body.data.salesReport;
    expect(report.distributor.id).toBe(w.distributor.id);
    // Oldest receipt (A, 20 days ago) is fully consumed before the newer Dispatch (B) is touched.
    expect(new Map(lineSummary(report.lines) as Array<[string, number]>)).toEqual(
      new Map([
        [c.a.dispatchId, 60],
        [c.b.dispatchId, 15],
      ]),
    );
    expect(await soldBy(c.a.dispatchId, c.a.saleOrderLineId)).toBe(60);
    expect(await soldBy(c.b.dispatchId, c.b.saleOrderLineId)).toBe(15);

    const after = await availability(w.distributorToken, c.cell);
    expect(after.availableForSale).toBe(25);
    expect(after.availableForReturn).toBe(25);
    expect(after.eligibleSourceCount).toBe(1);

    // The existing Dispatch-linked position reports the same truth: 25 remain, all on B.
    const positions = await request(app)
      .get('/sale-or-return-positions')
      .query({ distributorId: w.distributor.id })
      .set('Authorization', `Bearer ${w.adminToken}`)
      .expect(200);
    const remaining = new Map<string, number>(
      positions.body.data.items.map((p: { erveDispatchId: string; remainingWithDistributor: number }) => [p.erveDispatchId, p.remainingWithDistributor]),
    );
    expect(remaining.get(c.a.dispatchId)).toBe(0);
    expect(remaining.get(c.b.dispatchId)).toBe(25);

    // Source-level allocations are preserved for audit.
    const audit = await prisma.auditLog.findFirst({ where: { entityId: report.id, action: 'DISTRIBUTOR_SALES_REPORT_SUBMITTED' } });
    expect(audit?.metadata).toMatchObject({ storeLevelFifo: true, requestedQuantity: 75, retailStoreId: c.store.id });
  });

  it('rejects a quantity above availability atomically (nothing written), and a later sale uses what is left', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    await postSale(w.distributorToken, { ...c.cell, quantity: 75 }).expect(201);
    const reportsBefore = await prisma.distributorSalesReport.count({ where: { distributorId: w.distributor.id } });

    const over = await postSale(w.distributorToken, { ...c.cell, quantity: 26 }).expect(400);
    expect(over.body.error.message).toMatch(/exceeds the 25 unit\(s\) available/);
    expect(over.body.error.details).toMatchObject({ requested: 26, available: 25 });
    expect(await prisma.distributorSalesReport.count({ where: { distributorId: w.distributor.id } })).toBe(reportsBefore);
    expect(await soldBy(c.b.dispatchId, c.b.saleOrderLineId)).toBe(15);

    await postSale(w.distributorToken, { ...c.cell, quantity: 25 }).expect(201);
    expect((await availability(w.distributorToken, c.cell)).availableForSale).toBe(0);
    await postSale(w.distributorToken, { ...c.cell, quantity: 1 }).expect(400);
  });

  it('keeps the same Style x Size at different Retail Stores isolated', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const s1 = await createTestRetailStore(w.distributor.id);
    const s2 = await createTestRetailStore(w.distributor.id);
    await shipAndReceive(w, { retailStoreId: s1.id, styleId: style.id, sizeId: m!.id, quantity: 10 });
    const other = await shipAndReceive(w, { retailStoreId: s2.id, styleId: style.id, sizeId: m!.id, quantity: 50 });

    // Store 1 only has 10, no matter that Store 2 holds 50 of the same Style x Size.
    await postSale(w.distributorToken, { storeKey: storeKey(s1.id), styleId: style.id, sizeId: m!.id, quantity: 11 }).expect(400);
    await postSale(w.distributorToken, { storeKey: storeKey(s1.id), styleId: style.id, sizeId: m!.id, quantity: 10 }).expect(201);
    expect(await soldBy(other.dispatchId, other.saleOrderLineId)).toBe(0);
    expect((await availability(w.distributorToken, { storeKey: storeKey(s2.id), styleId: style.id, sizeId: m!.id })).availableForSale).toBe(50);
  });

  it('keeps different Styles and Size systems isolated', async () => {
    const w = await newWorld();
    const tops = await newStyle('TOP');
    const jeans = await newStyle('JEAN');
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const [w32] = await newSizes([{ code: '32', order: 32 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const topShip = await shipAndReceive(w, { retailStoreId: store.id, styleId: tops.id, sizeId: m!.id, quantity: 12 });
    const jeanShip = await shipAndReceive(w, { retailStoreId: store.id, styleId: jeans.id, sizeId: w32!.id, quantity: 20 });

    await postSale(w.distributorToken, { storeKey: storeKey(store.id), styleId: tops.id, sizeId: m!.id, quantity: 13 }).expect(400);
    // A Size that belongs to another Style's system has no stock under this Style.
    await postSale(w.distributorToken, { storeKey: storeKey(store.id), styleId: tops.id, sizeId: w32!.id, quantity: 1 }).expect(400);
    await postSale(w.distributorToken, { storeKey: storeKey(store.id), styleId: tops.id, sizeId: m!.id, quantity: 12 }).expect(201);
    expect(await soldBy(jeanShip.dispatchId, jeanShip.saleOrderLineId)).toBe(0);
    expect(await soldBy(topShip.dispatchId, topShip.saleOrderLineId)).toBe(12);
  });

  it('excludes stock received after a backdated report date, and rejects future dates', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w); // A received 20 days ago (60), B 5 days ago (40)

    const preview = await availability(w.distributorToken, { ...c.cell, date: dateAgo(10) });
    expect(preview.availableForSale).toBe(60);
    expect(preview.excluded.receivedAfterDateUnits).toBe(40);

    const tooMany = await postSale(w.distributorToken, { ...c.cell, quantity: 61, reportDate: dateAgo(10) }).expect(400);
    expect(tooMany.body.error.message).toMatch(/exceeds the 60 unit\(s\) available/);
    const ok = await postSale(w.distributorToken, { ...c.cell, quantity: 60, reportDate: dateAgo(10) }).expect(201);
    expect(lineSummary(ok.body.data.salesReport.lines)).toEqual([[c.a.dispatchId, 60]]);
    expect(await soldBy(c.b.dispatchId, c.b.saleOrderLineId)).toBe(0);

    // Before anything was received at all.
    const none = await postSale(w.distributorToken, { ...c.cell, quantity: 1, reportDate: dateAgo(30) }).expect(400);
    expect(none.body.error.message).toMatch(/received on or before/);
    // Same day as receipt counts; the day before does not.
    await postSale(w.distributorToken, { ...c.cell, quantity: 1, reportDate: dateAgo(21) }).expect(400);

    const future = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    await postSale(w.distributorToken, { ...c.cell, quantity: 1, reportDate: future }).expect(400);
    await postSale(w.distributorToken, { ...c.cell, quantity: 1, reportDate: '2026-02-30' }).expect(400);
  });

  it('fails safely on legacy / missing receipt evidence and unmapped historical destinations', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const legacy = await shipAndReceive(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 30, receivedDaysAgo: 40 });
    await prisma.erveDispatch.update({
      where: { id: legacy.dispatchId },
      data: { deliveredAt: null, deliveredById: null, deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' },
    });
    const cell = { storeKey: storeKey(store.id), styleId: style.id, sizeId: m!.id };

    const preview = await availability(w.distributorToken, cell);
    expect(preview.availableForSale).toBe(0);
    expect(preview.excluded.unverifiedReceiptUnits).toBe(30);
    const rejected = await postSale(w.distributorToken, { ...cell, quantity: 1 }).expect(400);
    expect(rejected.body.error.message).toMatch(/cannot be verified/);
    await postReturn(w.distributorToken, { ...cell, quantity: 1 }).expect(400);
    expect(await soldBy(legacy.dispatchId, legacy.saleOrderLineId)).toBe(0);

    // Verified stock alongside it is still allocatable, and the legacy position is never touched.
    const verified = await shipAndReceive(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 10, receivedDaysAgo: 2 });
    await postSale(w.distributorToken, { ...cell, quantity: 11 }).expect(400);
    await postSale(w.distributorToken, { ...cell, quantity: 10 }).expect(201);
    expect(await soldBy(verified.dispatchId, verified.saleOrderLineId)).toBe(10);
    expect(await soldBy(legacy.dispatchId, legacy.saleOrderLineId)).toBe(0);

    // An unmapped historical destination key is ineligible until reconciled.
    const unmapped = await postSale(w.distributorToken, { storeKey: 'D:some-destination-id', styleId: style.id, sizeId: m!.id, quantity: 1 }).expect(400);
    expect(unmapped.body.error.message).toMatch(/unmapped historical destination/);
  });

  it('rejects Outright stock, non-Distributor callers, another Distributor\'s Store, and malformed input', async () => {
    const w = await newWorld('OUTRIGHT');
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const store = await createTestRetailStore(w.distributor.id);
    await shipAndReceive(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 20 });
    const cell = { storeKey: storeKey(store.id), styleId: style.id, sizeId: m!.id };

    const outright = await postSale(w.distributorToken, { ...cell, quantity: 1 }).expect(400);
    expect(outright.body.error.message).toMatch(/Outright/);
    await postReturn(w.distributorToken, { ...cell, quantity: 1 }).expect(400);

    const sr = await newWorld();
    const srStore = await createTestRetailStore(sr.distributor.id);
    const srShip = await shipAndReceive(sr, { retailStoreId: srStore.id, styleId: style.id, sizeId: m!.id, quantity: 20 });
    const srCell = { storeKey: storeKey(srStore.id), styleId: style.id, sizeId: m!.id };

    // Only the owning Distributor: ADMIN / Merchandiser / Accountant are not Distributors, another Distributor sees nothing.
    for (const token of [sr.adminToken, sr.merchToken, sr.accountantToken]) {
      await postSale(token, { ...srCell, quantity: 1 }).expect(403);
      await postReturn(token, { ...srCell, quantity: 1 }).expect(403);
    }
    await request(app).post('/retail-store-inventory/store-fifo/sales-reports').send({}).expect(401);
    const foreign = await postSale(w.distributorToken, { ...srCell, quantity: 1 }).expect(400);
    expect(foreign.body.error.message).toMatch(/no confirmed received stock/);
    await request(app)
      .get('/retail-store-inventory/store-fifo/availability')
      .query({ ...srCell, date: today() })
      .set('Authorization', `Bearer ${sr.adminToken}`)
      .expect(403);
    expect(await soldBy(srShip.dispatchId, srShip.saleOrderLineId)).toBe(0);

    // Validation: quantity, reason, idempotency key.
    await postSale(sr.distributorToken, { ...srCell, quantity: 0 }).expect(400);
    await postSale(sr.distributorToken, { ...srCell, quantity: 1.5 }).expect(400);
    await postSale(sr.distributorToken, { ...srCell, quantity: 1 }, null).expect(400);
    await postSale(sr.distributorToken, { ...srCell, quantity: 1 }, 'short').expect(400);
    await postReturn(sr.distributorToken, { ...srCell, quantity: 1, returnReason: '  ' }).expect(400);
  });
});

describe('ISS-089 Store-level FIFO — Request Return', { timeout: 90000 }, () => {
  it('allocates a return FIFO across Dispatches against its own available-for-new-return limit', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    await postSale(w.distributorToken, { ...c.cell, quantity: 30 }).expect(201); // all from A (60 -> 30)

    const res = await postReturn(w.distributorToken, { ...c.cell, quantity: 50 }).expect(201);
    const ret = res.body.data.distributorReturn;
    expect(ret.status).toBe('SUBMITTED');
    expect(ret.returnNumber).toBeTruthy();
    expect(new Map(lineSummary(ret.lines) as Array<[string, number]>)).toEqual(
      new Map([
        [c.a.dispatchId, 30],
        [c.b.dispatchId, 20],
      ]),
    );

    // Pending requests reserve new returns but not Actual Sale (the existing position semantics).
    const after = await availability(w.distributorToken, c.cell);
    expect(after.availableForReturn).toBe(20);
    expect(after.availableForSale).toBe(70);
    const over = await postReturn(w.distributorToken, { ...c.cell, quantity: 21 }).expect(400);
    expect(over.body.error.message).toMatch(/exceeds the 20 unit\(s\) available to return/);
    await postReturn(w.distributorToken, { ...c.cell, quantity: 20 }).expect(201);
    expect((await availability(w.distributorToken, c.cell)).availableForReturn).toBe(0);
  });

  it('cannot double-allocate pending or approved returns, and an approved return also reserves against Actual Sale', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);

    const first = await postReturn(w.distributorToken, { ...c.cell, quantity: 70 }).expect(201);
    await postReturn(w.distributorToken, { ...c.cell, quantity: 31 }).expect(400); // only 30 left to request
    const approved = first.body.data.distributorReturn;
    await request(app)
      .post(`/distributor-returns/${approved.id}/approve`)
      .set('Authorization', `Bearer ${w.accountantToken}`)
      .send({ expectedVersion: approved.version, lines: approved.lines.map((l: { id: string; requestedQuantity: number }) => ({ id: l.id, approvedQuantity: l.requestedQuantity })) })
      .expect(200);

    // 70 approved awaiting physical receipt: only 30 can still be sold or returned.
    expect((await availability(w.distributorToken, c.cell)).availableForSale).toBe(30);
    await postSale(w.distributorToken, { ...c.cell, quantity: 31 }).expect(400);
    await postReturn(w.distributorToken, { ...c.cell, quantity: 31 }).expect(400);
    await postSale(w.distributorToken, { ...c.cell, quantity: 30 }).expect(201);
    expect((await availability(w.distributorToken, c.cell)).availableForReturn).toBe(0);
  });
});

describe('ISS-089 Store-level FIFO — concurrency and idempotency', { timeout: 120000 }, () => {
  it('concurrent sales cannot over-allocate across the candidate set', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w); // 100 units on two positions
    const results = await Promise.all(
      Array.from({ length: 6 }, () => postSale(w.distributorToken, { ...c.cell, quantity: 30 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 400, 400, 400]);
    const sold = (await soldBy(c.a.dispatchId, c.a.saleOrderLineId)) + (await soldBy(c.b.dispatchId, c.b.saleOrderLineId));
    expect(sold).toBe(90);
    // Strict FIFO order survived the race: A is full, B holds the rest.
    expect(await soldBy(c.a.dispatchId, c.a.saleOrderLineId)).toBe(60);
    expect((await availability(w.distributorToken, c.cell)).availableForSale).toBe(10);
  });

  it('concurrent returns cannot over-allocate, and a racing sale/return mix never drives a position negative', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    const returns = await Promise.all(Array.from({ length: 5 }, () => postReturn(w.distributorToken, { ...c.cell, quantity: 30 })));
    expect(returns.map((r) => r.status).sort()).toEqual([201, 201, 201, 400, 400]);
    const requested = await prisma.distributorReturnLine.aggregate({ where: { distributorReturn: { distributorId: w.distributor.id } }, _sum: { requestedQuantity: true } });
    expect(requested._sum.requestedQuantity).toBe(90);

    const w2 = await newWorld();
    const c2 = await twoDispatchCell(w2);
    await Promise.all([
      ...Array.from({ length: 3 }, () => postSale(w2.distributorToken, { ...c2.cell, quantity: 40 })),
      ...Array.from({ length: 3 }, () => postReturn(w2.distributorToken, { ...c2.cell, quantity: 40 })),
    ]);
    const positions = await request(app)
      .get('/sale-or-return-positions')
      .query({ distributorId: w2.distributor.id })
      .set('Authorization', `Bearer ${w2.adminToken}`)
      .expect(200);
    for (const p of positions.body.data.items) expect(p.remainingWithDistributor).toBeGreaterThanOrEqual(0);
    const soldTotal = (await soldBy(c2.a.dispatchId, c2.a.saleOrderLineId)) + (await soldBy(c2.b.dispatchId, c2.b.saleOrderLineId));
    expect(soldTotal).toBeLessThanOrEqual(100);
  });

  it('a retried sale with the same Idempotency-Key creates exactly one report; a different payload is a conflict', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    const key = createId();
    const body = { ...c.cell, quantity: 20 };

    const first = await postSale(w.distributorToken, body, key).expect(201);
    const retry = await postSale(w.distributorToken, body, key).expect(200);
    expect(retry.body.data.replayed).toBe(true);
    expect(retry.body.data.salesReport.id).toBe(first.body.data.salesReport.id);
    const conflict = await postSale(w.distributorToken, { ...body, quantity: 21 }, key).expect(409);
    expect(conflict.body.error.code).toBe('CONFLICT');
    await postReturn(w.distributorToken, { ...c.cell, quantity: 1 }, key).expect(409);
    expect(await prisma.distributorSalesReport.count({ where: { distributorId: w.distributor.id } })).toBe(1);
    expect(await soldBy(c.a.dispatchId, c.a.saleOrderLineId)).toBe(20);

    // A parallel burst of the same key is also a single transaction, even when the stock would allow more.
    const burstKey = createId();
    const burst = await Promise.all(Array.from({ length: 4 }, () => postSale(w.distributorToken, { ...c.cell, quantity: 10 }, burstKey)));
    expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(await prisma.distributorSalesReport.count({ where: { distributorId: w.distributor.id } })).toBe(2);
    expect(await soldBy(c.a.dispatchId, c.a.saleOrderLineId)).toBe(30);
  });

  it('a retried return with the same Idempotency-Key creates exactly one Return (and one number)', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    const key = createId();
    const body = { ...c.cell, quantity: 15, returnReason: 'Slow mover' };
    const first = await postReturn(w.distributorToken, body, key).expect(201);
    const retry = await postReturn(w.distributorToken, body, key).expect(200);
    expect(retry.body.data.replayed).toBe(true);
    expect(retry.body.data.distributorReturn.id).toBe(first.body.data.distributorReturn.id);
    await postReturn(w.distributorToken, { ...body, returnReason: 'Different' }, key).expect(409);
    expect(await prisma.distributorReturn.count({ where: { distributorId: w.distributor.id } })).toBe(1);
    // The same key from another user of the Distributor is not a replay.
    const second = await createDistributorToken(w.distributor.id);
    await postReturn(second, body, key).expect(409);
  });
});

describe('ISS-089 / ISS-092 — coexistence with the Dispatch-linked flows and the Sales Report date', { timeout: 90000 }, () => {
  it('Dispatch-linked reports and returns still work on the same stock and are respected by the Store-level allocator', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);

    // The established Dispatch-linked flow: report 25 sold from B explicitly.
    await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${w.distributorToken}`)
      .send({ distributorId: w.distributor.id, reportDate: today(), lines: [{ erveDispatchId: c.b.dispatchId, saleOrderLineId: c.b.saleOrderLineId, quantitySold: 25 }] })
      .expect(201);
    await request(app)
      .post('/distributor-returns')
      .set('Authorization', `Bearer ${w.distributorToken}`)
      .send({
        distributorId: w.distributor.id,
        returnDate: today(),
        returnReason: 'Defect',
        lines: [{ erveDispatchId: c.a.dispatchId, saleOrderLineId: c.a.saleOrderLineId, requestedQuantity: 10 }],
      })
      .expect(201);

    // A has 50 to sell (60 received, 10 pending return only reserves against returns), B has 15 -> 75 for sale, 65 for return.
    const preview = await availability(w.distributorToken, c.cell);
    expect(preview.availableForSale).toBe(75);
    expect(preview.availableForReturn).toBe(65);
    const res = await postSale(w.distributorToken, { ...c.cell, quantity: 70 }).expect(201);
    expect(new Map(lineSummary(res.body.data.salesReport.lines) as Array<[string, number]>)).toEqual(
      new Map([
        [c.a.dispatchId, 60],
        [c.b.dispatchId, 10],
      ]),
    );
  });

  it('ISS-092: the Sales Report detail exposes a valid submittedAt for Dispatch-linked and Store-level reports alike', async () => {
    const w = await newWorld();
    const c = await twoDispatchCell(w);
    const linked = await request(app)
      .post('/distributor-sales-reports')
      .set('Authorization', `Bearer ${w.distributorToken}`)
      .send({ distributorId: w.distributor.id, reportDate: today(), lines: [{ erveDispatchId: c.a.dispatchId, saleOrderLineId: c.a.saleOrderLineId, quantitySold: 5 }] })
      .expect(201);
    const storeLevel = await postSale(w.distributorToken, { ...c.cell, quantity: 5 }).expect(201);

    for (const id of [linked.body.data.id, storeLevel.body.data.salesReport.id]) {
      const detail = await request(app).get(`/distributor-sales-reports/${id}`).set('Authorization', `Bearer ${w.distributorToken}`).expect(200);
      const submittedAt = detail.body.data.submittedAt as string;
      expect(Number.isNaN(new Date(submittedAt).getTime())).toBe(false);
      expect(Math.abs(Date.now() - new Date(submittedAt).getTime())).toBeLessThan(10 * 60 * 1000);
      expect(detail.body.data).not.toHaveProperty('createdAt');
      const stored = await prisma.distributorSalesReport.findUniqueOrThrow({ where: { id } });
      expect(submittedAt).toBe(stored.submittedAt.toISOString());
    }
    const list = await request(app).get('/distributor-sales-reports').set('Authorization', `Bearer ${w.distributorToken}`).expect(200);
    for (const item of list.body.data.items) expect(Number.isNaN(new Date(item.submittedAt).getTime())).toBe(false);
  });
});
