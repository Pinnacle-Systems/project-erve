import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { createId } from '@erve/shared';
import type {
  RetailStoreInventoryMeasures,
  SaleOrReturnStockSourcesResponse,
  SaleOrReturnStockStoresResponse,
  SaleOrReturnStockStyleDetail,
  SaleOrReturnStockStylesResponse,
} from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestRetailStore,
  createTestSeason,
  resetDatabase,
} from '../../test/helpers.js';
import {
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  packAndFinalize,
} from './fulfillment-test-helpers.js';
import {
  getStockStyleDetail,
  listStockStyleSources,
  listStockStyleStores,
  listStockStyles,
} from './sale-or-return-stock.service.js';

// Sale-or-Return Stock, Style-first. Fixtures use the real Packing -> EIPL -> Dispatch -> receipt ->
// Sales Report / Return flow. Only what no API can create (many historical Dispatches of one Style,
// an unmapped historical destination) is built directly in the database. Returns are approved as
// ADMIN so this suite does not depend on which operational role approves them.

const app = createApp();
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

type Mode = 'SALE_RETURN' | 'OUTRIGHT';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
async function setStyleSizes(styleId: string, sizes: Array<{ sizeId: string; active?: boolean }>) {
  for (const s of sizes) {
    const status = s.active === false ? 'INACTIVE' : 'ACTIVE';
    const existing = await prisma.styleSize.findFirst({ where: { styleId, sizeId: s.sizeId } });
    if (existing) await prisma.styleSize.update({ where: { id: existing.id }, data: { status } });
    else await prisma.styleSize.create({ data: { id: createId(), styleId, sizeId: s.sizeId, status } });
  }
}
async function newStyle(prefix: string) {
  const season = await createTestSeason();
  return prisma.style.create({
    data: { id: createId(), styleNumber: `${prefix}-${createId().slice(-6)}`, styleName: `${prefix} style`, finalMrp: 100, seasonId: season.id },
  });
}
async function newWorld(mode: Mode = 'SALE_RETURN') {
  const distributor = await createTestDistributor({ purchaseMode: mode });
  const distributorToken = await createDistributorToken(distributor.id);
  return { distributor, distributorToken };
}
type World = Awaited<ReturnType<typeof newWorld>>;

interface ShipOptions {
  retailStoreId?: string;
  styleId: string;
  sizeId: string;
  quantity: number;
  mode?: Mode;
}
async function ship(world: World, o: ShipOptions) {
  await prisma.styleSize.updateMany({ where: { styleId: o.styleId, sizeId: { not: o.sizeId } }, data: { status: 'INACTIVE' } });
  await setStyleSizes(o.styleId, [{ sizeId: o.sizeId }]);
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
  if (o.mode) {
    await prisma.saleOrderDistributor.updateMany({ where: { saleOrderId: f.saleOrder.id }, data: { purchaseMode: o.mode } });
  }
  const packed = await packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, o.quantity);
  const dispatch = await consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  return {
    dispatchId: dispatch.id as string,
    saleOrderLineId: f.saleOrderLineId,
    merchToken: f.merchToken,
    destinationId: f.saleOrder.destinations[0].id as string,
    cartonId: packed.cartonId as string,
    styleId: o.styleId,
    sizeId: o.sizeId,
  };
}
type Shipment = Awaited<ReturnType<typeof ship>>;

const currentVersion = async (dispatchId: string) =>
  (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatchId } })).version;

/** Merchandiser/Admin delivery confirmation: sets the received ledger (USER_CONFIRMED). */
async function confirmReceived(s: Shipment, quantity: number) {
  await confirmErveDispatchDelivery(app, s.merchToken, s.dispatchId, await currentVersion(s.dispatchId), [
    { saleOrderLineId: s.saleOrderLineId, receivedQuantity: quantity },
  ]);
}
/** The Distributor's own A4 receipt (separate evidence; sets the ledger itself when none exists yet). */
async function attest(world: World, s: Shipment, quantity: number) {
  await request(app)
    .post(`/erve-dispatches/${s.dispatchId}/distributor-receipt`)
    .set(auth(world.distributorToken))
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion: await currentVersion(s.dispatchId),
      acknowledged: true,
      remarks: 'receipt',
      groups: [{ styleId: s.styleId, sizeId: s.sizeId, receivedQuantity: quantity }],
    })
    .expect(201);
}

const get = (token: string, path: string, query: Record<string, string | number> = {}) =>
  request(app).get(path).query(query).set(auth(token));
async function styles(token: string, query: Record<string, string | number> = {}, expected = 200) {
  const res = await get(token, '/sale-or-return-stock/styles', query).expect(expected);
  return res.body.data as SaleOrReturnStockStylesResponse;
}
async function detail(token: string, styleId: string, query: Record<string, string | number> = {}, expected = 200) {
  const res = await get(token, `/sale-or-return-stock/styles/${styleId}`, query).expect(expected);
  return res.body.data as SaleOrReturnStockStyleDetail;
}
async function stores(token: string, styleId: string, query: Record<string, string | number> = {}) {
  const res = await get(token, `/sale-or-return-stock/styles/${styleId}/stores`, query).expect(200);
  return res.body.data as SaleOrReturnStockStoresResponse;
}
async function sources(token: string, styleId: string, query: Record<string, string | number> = {}) {
  const res = await get(token, `/sale-or-return-stock/styles/${styleId}/sources`, query).expect(200);
  return res.body.data as SaleOrReturnStockSourcesResponse;
}
async function allSources(token: string, styleId: string, query: Record<string, string | number> = {}, limit = 25) {
  const out: SaleOrReturnStockSourcesResponse['items'] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await sources(token, styleId, { ...query, limit, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.pageInfo.nextCursor ?? undefined;
    pages += 1;
  } while (cursor);
  return { items: out, pages };
}

/** Every authoritative (Dispatch, Sale Order line) position of a Distributor, via the existing paginated endpoint. */
async function allPositions(token: string, distributorId: string, limit: number) {
  const items: Array<Record<string, number | string>> = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await get(token, '/sale-or-return-positions', { distributorId, limit, ...(cursor ? { cursor } : {}) }).expect(200);
    items.push(...res.body.data.items);
    cursor = res.body.data.pageInfo.hasMore ? res.body.data.pageInfo.nextCursor : undefined;
    pages += 1;
  } while (cursor);
  return { items, pages };
}

const sale = (token: string, distributorId: string, s: Shipment, quantitySold: number) =>
  request(app)
    .post('/distributor-sales-reports')
    .set(auth(token))
    .send({ distributorId, reportDate: '2026-08-01', lines: [{ erveDispatchId: s.dispatchId, saleOrderLineId: s.saleOrderLineId, quantitySold }] });
const returnRequest = (token: string, distributorId: string, s: Shipment, requestedQuantity: number) =>
  request(app)
    .post('/distributor-returns')
    .set(auth(token))
    .send({
      distributorId,
      returnDate: '2026-08-02',
      returnReason: 'Unsold',
      lines: [{ erveDispatchId: s.dispatchId, saleOrderLineId: s.saleOrderLineId, requestedQuantity }],
    });
const post = (token: string, path: string, body: object) => request(app).post(path).set(auth(token)).send(body);

const sr = (m: RetailStoreInventoryMeasures) => m.saleReturn!;

// ---------------------------------------------------------------------------
// One shared world for the read-path scenarios.
//
//   D1 (St1, St2 + an unmapped historical destination), D2 (St3), both Sale-or-Return
//   SA/M  D1 St1  20  ledger 20 (Merch), attested 18        <- a1: sold 5, returned 2, approved 3, pending 4
//   SA/L  D1 St1  10  ledger 10, no Distributor receipt     <- a2
//   SA/M  D1 St2  12  ledger 12, no Distributor receipt     <- a3
//   SA/M  D2 St3  15  Distributor receipt 15 (-> ledger 15) <- a4
//   SA/M  D1 St1   6  dispatched, NO ledger, NO receipt     <- a5
//   SA/M  D1 St1   4  OUTRIGHT shipment (must never count)  <- a6
//   SB/M  D1 St1   8  dispatched, NO ledger, NO receipt     (missing evidence != zero)
//   SC/M  D2 St3   9  ledger 9                              (a Style D1 does not have)
//   SD/M  D1 unmapped destination 7, ledger 7
//   SO/M  D1 St1  11  OUTRIGHT only (Style must not appear at all)
// ---------------------------------------------------------------------------

interface WorldA {
  d1: World;
  d2: World;
  st1: { id: string; name: string };
  st2: { id: string; name: string };
  st3: { id: string; name: string };
  SA: { id: string; styleNumber: string };
  SB: { id: string; styleNumber: string };
  SC: { id: string; styleNumber: string };
  SD: { id: string; styleNumber: string };
  SO: { id: string; styleNumber: string };
  M: { id: string };
  L: { id: string };
  a1: Shipment;
  merch: string;
  accountant: string;
  seniorManagement: string;
  admin: string;
}
let A: WorldA;

describe('Sale-or-Return Stock — Style-first consolidated read model', () => {
  beforeAll(async () => {
    await resetDatabase();
    const d1 = await newWorld();
    const d2 = await newWorld();
    const [M, L] = await newSizes([
      { code: 'M', order: 2 },
      { code: 'L', order: 3 },
    ]);
    const store = async (distributorId: string) => {
      const s = await createTestRetailStore(distributorId);
      return { id: s.id, name: s.name };
    };
    const st1 = await store(d1.distributor.id);
    const st2 = await store(d1.distributor.id);
    const st3 = await store(d2.distributor.id);
    const SA = await newStyle('STKA');
    const SB = await newStyle('STKB');
    const SC = await newStyle('STKC');
    const SD = await newStyle('STKD');
    const SO = await newStyle('STKO');

    const a1 = await ship(d1, { retailStoreId: st1.id, styleId: SA.id, sizeId: M!.id, quantity: 20 });
    const a2 = await ship(d1, { retailStoreId: st1.id, styleId: SA.id, sizeId: L!.id, quantity: 10 });
    const a3 = await ship(d1, { retailStoreId: st2.id, styleId: SA.id, sizeId: M!.id, quantity: 12 });
    const a4 = await ship(d2, { retailStoreId: st3.id, styleId: SA.id, sizeId: M!.id, quantity: 15 });
    await ship(d1, { retailStoreId: st1.id, styleId: SA.id, sizeId: M!.id, quantity: 6 }); // a5
    await ship(d1, { retailStoreId: st1.id, styleId: SA.id, sizeId: M!.id, quantity: 4, mode: 'OUTRIGHT' }); // a6
    await ship(d1, { retailStoreId: st1.id, styleId: SB.id, sizeId: M!.id, quantity: 8 });
    const sc = await ship(d2, { retailStoreId: st3.id, styleId: SC.id, sizeId: M!.id, quantity: 9 });
    const sd = await ship(d1, { styleId: SD.id, sizeId: M!.id, quantity: 7 });
    await prisma.saleOrderDestination.update({ where: { id: sd.destinationId }, data: { retailStoreId: null } }); // historical, unmapped
    await ship(d1, { retailStoreId: st1.id, styleId: SO.id, sizeId: M!.id, quantity: 11, mode: 'OUTRIGHT' });

    await confirmReceived(a1, 20);
    await attest(d1, a1, 18); // evidence only: differs from the earlier ledger
    await confirmReceived(a2, 10);
    await confirmReceived(a3, 12);
    await attest(d2, a4, 15); // sets the ledger itself
    await confirmReceived(sc, 9);
    await confirmReceived(sd, 7);

    // a1: sold 5, returned 2 (received), approved 3 (awaiting receipt), pending 4.
    await sale(d1.distributorToken, d1.distributor.id, a1, 5).expect(201);
    const admin = await createRoleToken('ADMIN');
    const merch = await createRoleToken('MERCHANDISER');
    const r1 = (await returnRequest(d1.distributorToken, d1.distributor.id, a1, 2).expect(201)).body.data;
    const r1Approved = (
      await post(admin.token, `/distributor-returns/${r1.id}/approve`, { expectedVersion: r1.version, lines: [{ id: r1.lines[0].id, approvedQuantity: 2 }] }).expect(200)
    ).body.data;
    await post(merch.token, `/distributor-returns/${r1.id}/receive`, {
      expectedVersion: r1Approved.version,
      lines: [{ id: r1.lines[0].id, receivedQuantity: 2 }],
    }).expect(200);
    const r2 = (await returnRequest(d1.distributorToken, d1.distributor.id, a1, 3).expect(201)).body.data;
    await post(admin.token, `/distributor-returns/${r2.id}/approve`, { expectedVersion: r2.version, lines: [{ id: r2.lines[0].id, approvedQuantity: 3 }] }).expect(200);
    await returnRequest(d1.distributorToken, d1.distributor.id, a1, 4).expect(201);

    // The Style's native columns, set after shipping (a Dispatch Order splits a Style across its active Sizes).
    await setStyleSizes(SA.id, [{ sizeId: M!.id }, { sizeId: L!.id }]);

    A = {
      d1,
      d2,
      st1,
      st2,
      st3,
      SA,
      SB,
      SC,
      SD,
      SO,
      M: M!,
      L: L!,
      a1,
      merch: merch.token,
      accountant: (await createRoleToken('ACCOUNTANT')).token,
      seniorManagement: (await createRoleToken('SENIOR_MANAGEMENT')).token,
      admin: admin.token,
    };
  }, 900_000);

  describe('Level 1 — one consolidated row per Style', () => {
    it('summarises each Style once across Distributors and Dispatches, excludes OUTRIGHT, and defaults to all Distributors', async () => {
      const r = await styles(A.merch, { limit: 100 });
      expect(r.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SB.id, A.SC.id, A.SD.id].sort());
      expect(r.items.some((i) => i.styleId === A.SO.id)).toBe(false); // OUTRIGHT-only Style never appears

      const sa = r.items.find((i) => i.styleId === A.SA.id)!;
      expect(sa.distributorCount).toBe(2);
      expect(sa.storeCount).toBe(3);
      const m = sa.measures;
      expect(m.sourceCount).toBe(5); // a1..a5; the OUTRIGHT a6 is not a source
      expect(m.shippedQuantity).toBe(63); // 20+10+12+15+6, never +4 of OUTRIGHT
      expect(m.ledgerQuantity).toBe(57); // a5 has no ledger
      expect(sr(m).actualSoldQuantity).toBe(5);
      expect(sr(m).returnedQuantity).toBe(2);
      expect(sr(m).approvedAwaitingReceiptQuantity).toBe(3);
      expect(sr(m).pendingRequestedQuantity).toBe(4);
      expect(sr(m).remainingWithDistributor).toBe(50); // 57 - 5 - 2
      expect(sr(m).availableForActualSale).toBe(47); // 50 - 3
      expect(sr(m).availableForNewReturn).toBe(43); // 47 - 4

      expect(r.summary.styleCount).toBe(4);
      expect(r.summary.distributorCount).toBe(2);
      expect(r.summary.measures.shippedQuantity).toBe(63 + 8 + 9 + 7);
      expect(r.pageInfo.hasMore).toBe(false);
    });

    it('filters to one Distributor and clearing the filter restores the all-Distributor totals', async () => {
      const all = await styles(A.merch, { limit: 100 });
      const d1 = await styles(A.merch, { limit: 100, distributorId: A.d1.distributor.id });
      const d2 = await styles(A.merch, { limit: 100, distributorId: A.d2.distributor.id });

      const pick = (r: SaleOrReturnStockStylesResponse, id: string) => r.items.find((i) => i.styleId === id);
      expect(d1.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SB.id, A.SD.id].sort());
      expect(d2.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SC.id].sort());
      expect(pick(d1, A.SA.id)!.measures.shippedQuantity).toBe(48); // 20+10+12+6
      expect(pick(d1, A.SA.id)!.measures.ledgerQuantity).toBe(42);
      expect(sr(pick(d1, A.SA.id)!.measures).remainingWithDistributor).toBe(35); // 42-5-2
      expect(pick(d2, A.SA.id)!.measures.shippedQuantity).toBe(15);
      expect(sr(pick(d2, A.SA.id)!.measures).remainingWithDistributor).toBe(15);
      // The two Distributor slices add up to the consolidated row.
      expect(pick(d1, A.SA.id)!.measures.shippedQuantity + pick(d2, A.SA.id)!.measures.shippedQuantity).toBe(
        pick(all, A.SA.id)!.measures.shippedQuantity,
      );
      // Clearing the filter (no distributorId) is the all-Distributor view again.
      const cleared = await styles(A.merch, { limit: 100 });
      expect(pick(cleared, A.SA.id)!.measures).toEqual(pick(all, A.SA.id)!.measures);
      expect(cleared.summary).toEqual(all.summary);
    });

    it('matches the sum of the authoritative source positions of the existing endpoint, page boundaries included', async () => {
      for (const world of [A.d1, A.d2]) {
        const positions = await allPositions(A.merch, world.distributor.id, 3); // small pages: many boundaries
        if (world === A.d1) expect(positions.pages).toBeGreaterThan(1); // 6 positions -> pages of 3
        const summary = await styles(A.merch, { limit: 100, distributorId: world.distributor.id });
        const byStyleNumber = new Map(summary.items.map((i) => [i.styleNumber, i.measures]));
        const sum = (rows: typeof positions.items, key: string) => rows.reduce((n, r) => n + Number(r[key]), 0);
        for (const [styleNumber, m] of byStyleNumber) {
          const rows = positions.items.filter((p) => p.styleNumber === styleNumber);
          expect(m.sourceCount).toBe(rows.length);
          expect(m.shippedQuantity).toBe(sum(rows, 'dispatchedQuantity'));
          expect(sr(m).actualSoldQuantity).toBe(sum(rows, 'actualSoldQuantity'));
          expect(sr(m).returnedQuantity).toBe(sum(rows, 'returnedQuantity'));
          expect(sr(m).approvedAwaitingReceiptQuantity).toBe(sum(rows, 'approvedAwaitingReceiptQuantity'));
          expect(sr(m).pendingRequestedQuantity).toBe(sum(rows, 'pendingRequestedQuantity'));
          expect(sr(m).remainingWithDistributor).toBe(sum(rows, 'remainingWithDistributor'));
          expect(sr(m).availableForNewReturn).toBe(sum(rows, 'returnableQuantity'));
          expect(m.ledgerQuantity ?? 0).toBe(sum(rows, 'receivedQuantity'));
        }
        // Every authoritative position belongs to a Style that is summarised (nothing is dropped).
        expect(new Set(positions.items.map((p) => p.styleNumber as string))).toEqual(new Set(byStyleNumber.keys()));
      }
    });

    it('paginates on aggregated Styles with a stable cursor, no gaps, and identical whole-result totals on every page', async () => {
      const first = await styles(A.merch, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.pageInfo.hasMore).toBe(true);
      const second = await styles(A.merch, { limit: 2, cursor: first.pageInfo.nextCursor! });
      expect(second.items).toHaveLength(2);
      expect(second.pageInfo.hasMore).toBe(false);
      expect([...first.items, ...second.items].map((i) => i.styleNumber)).toEqual(
        [A.SA.styleNumber, A.SB.styleNumber, A.SC.styleNumber, A.SD.styleNumber], // lower(style number) order
      );
      expect(second.summary).toEqual(first.summary);
      expect(first.summary.styleCount).toBe(4);
      await get(A.merch, '/sale-or-return-stock/styles', { cursor: 'not-a-cursor' }).expect(400);
    });

    it('searches Styles by number or name', async () => {
      const byNumber = await styles(A.merch, { style: A.SB.styleNumber.toLowerCase().slice(0, 7) });
      expect(byNumber.items.map((i) => i.styleId)).toEqual([A.SB.id]);
      expect(byNumber.summary.styleCount).toBe(1);
      const byName = await styles(A.merch, { style: 'stkc style' });
      expect(byName.items.map((i) => i.styleId)).toEqual([A.SC.id]);
      const none = await styles(A.merch, { style: 'zzz-no-such-style' });
      expect(none.items).toEqual([]);
      expect(none.summary.styleCount).toBe(0);
      expect(none.summary.measures.shippedQuantity).toBe(0);
    });

    it('keeps missing evidence distinct from zero', async () => {
      const r = await styles(A.merch, { limit: 100, distributorId: A.d1.distributor.id });
      const sb = r.items.find((i) => i.styleId === A.SB.id)!.measures;
      // SB was dispatched but never confirmed and never receipted by the Distributor.
      expect(sb.shippedQuantity).toBe(8);
      expect(sb.ledgerQuantity).toBeNull();
      expect(sb.attestedReceivedQuantity).toBeNull();
      expect(sb.shortageQuantity).toBeNull();
      expect(sb.awaitingConfirmationQuantity).toBe(8);
      expect(sr(sb).remainingWithDistributor).toBe(0); // computed from a missing ledger as 0, but ledgerQuantity stays null
      expect(sr(sb).availableForActualSale).toBe(0);

      // SA: the Distributor's own receipt (18) is separate evidence from the ledger (20) of the same source.
      const sa = r.items.find((i) => i.styleId === A.SA.id)!.measures;
      expect(sa.attestedReceivedQuantity).toBe(18);
      expect(sa.attestedShippedQuantity).toBe(20);
      expect(sa.shortageQuantity).toBe(2);
      expect(sa.discrepancySourceCount).toBe(1);
      expect(sa.ledgerBySource.userConfirmed).toBe(42); // a1 20 + a2 10 + a3 12
      expect(sa.awaitingConfirmationQuantity).toBe(28); // a2 10 + a3 12 + a5 6 have no Distributor receipt
    });
  });

  describe('Level 2 — one Style, native Style x Size matrix', () => {
    it('returns one consolidated block with native Sizes in canonical order and per-Size cells that add up to the total', async () => {
      const d = await detail(A.merch, A.SA.id);
      expect(d.card.styleNumber).toBe(A.SA.styleNumber);
      expect(d.card.purchaseMode).toBe('SALE_RETURN');
      expect(d.card.sizes.map((s) => s.sizeId)).toEqual([A.M.id, A.L.id]);
      expect(d.card.sizes.every((s) => s.active)).toBe(true);
      const mCell = d.card.cells[A.M.id]!;
      const lCell = d.card.cells[A.L.id]!;
      expect(mCell.shippedQuantity).toBe(53); // a1 20 + a3 12 + a4 15 + a5 6
      expect(mCell.ledgerQuantity).toBe(47);
      expect(lCell.shippedQuantity).toBe(10);
      expect(lCell.ledgerQuantity).toBe(10);
      expect(mCell.shippedQuantity + lCell.shippedQuantity).toBe(d.card.total.shippedQuantity);
      for (const key of ['actualSoldQuantity', 'returnedQuantity', 'approvedAwaitingReceiptQuantity', 'pendingRequestedQuantity', 'remainingWithDistributor', 'availableForActualSale', 'availableForNewReturn'] as const) {
        expect(sr(mCell)[key] + sr(lCell)[key]).toBe(sr(d.card.total)[key]);
      }
    });

    it('breaks the Style down by Distributor and the Distributor totals add up to the Style total', async () => {
      const d = await detail(A.merch, A.SA.id);
      expect(d.distributors.map((x) => x.distributor.id).sort()).toEqual([A.d1.distributor.id, A.d2.distributor.id].sort());
      const sum = (key: (m: RetailStoreInventoryMeasures) => number) => d.distributors.reduce((n, x) => n + key(x.measures), 0);
      expect(sum((m) => m.shippedQuantity)).toBe(d.card.total.shippedQuantity);
      expect(sum((m) => sr(m).remainingWithDistributor)).toBe(sr(d.card.total).remainingWithDistributor);
      expect(d.distributors.find((x) => x.distributor.id === A.d1.distributor.id)!.storeCount).toBe(2);

      const only2 = await detail(A.merch, A.SA.id, { distributorId: A.d2.distributor.id });
      expect(only2.distributors.map((x) => x.distributor.id)).toEqual([A.d2.distributor.id]);
      expect(only2.card.total.shippedQuantity).toBe(15);
      expect(only2.card.sizes.map((s) => s.sizeId)).toContain(A.M.id);
    });

    it('answers one uniform 404 for an unknown Style, an OUTRIGHT-only Style and a Style with nothing in the filter', async () => {
      await detail(A.merch, createId(), {}, 404);
      await detail(A.merch, A.SO.id, {}, 404);
      await detail(A.merch, A.SC.id, { distributorId: A.d1.distributor.id }, 404);
    });
  });

  describe('Level 3 — Distributor, then Retail Store', () => {
    it('lists Store-wise totals per Distributor on stable Store identities, summing to the Distributor total', async () => {
      const r = await stores(A.merch, A.SA.id, { distributorId: A.d1.distributor.id });
      expect(r.items.map((s) => s.retailStoreId).sort()).toEqual([A.st1.id, A.st2.id].sort());
      const s1 = r.items.find((s) => s.retailStoreId === A.st1.id)!;
      const s2 = r.items.find((s) => s.retailStoreId === A.st2.id)!;
      expect(s1.storeKey).toBe(`S:${A.st1.id}`);
      expect(s1.mapped).toBe(true);
      expect(s1.distributor.id).toBe(A.d1.distributor.id);
      expect(s1.measures.shippedQuantity).toBe(36); // a1 20 + a2 10 + a5 6
      expect(sr(s1.measures).actualSoldQuantity).toBe(5);
      expect(s2.measures.shippedQuantity).toBe(12);
      const d = await detail(A.merch, A.SA.id, { distributorId: A.d1.distributor.id });
      expect(s1.measures.shippedQuantity + s2.measures.shippedQuantity).toBe(d.card.total.shippedQuantity);
      // Without a Distributor filter an internal viewer gets every Distributor's Stores, each tagged with its Distributor.
      const everyone = await stores(A.merch, A.SA.id);
      expect(everyone.items.map((s) => s.retailStoreId).sort()).toEqual([A.st1.id, A.st2.id, A.st3.id].sort());
    });

    it('keeps an unmapped historical destination as its own Store group, never matched by name', async () => {
      const r = await stores(A.merch, A.SD.id, { distributorId: A.d1.distributor.id });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.mapped).toBe(false);
      expect(r.items[0]!.retailStoreId).toBeNull();
      expect(r.items[0]!.storeKey.startsWith('D:')).toBe(true);
      expect(r.items[0]!.measures.shippedQuantity).toBe(7);
    });
  });

  describe('Level 4 — contributing Dispatches and Orders', () => {
    it('lists every contributing (Dispatch, Sale Order line) with its original attribution and quantities', async () => {
      const { items } = await allSources(A.merch, A.SA.id, {}, 100);
      expect(items).toHaveLength(5); // never the OUTRIGHT shipment
      expect(new Set(items.map((i) => `${i.erveDispatchId}:${i.saleOrderLineId}`)).size).toBe(5);
      expect(items.reduce((n, i) => n + i.shippedQuantity, 0)).toBe(63);
      expect(items.every((i) => i.purchaseMode === 'SALE_RETURN')).toBe(true);
      expect(items.every((i) => i.distributor.id && i.storeKey && i.erveDispatchNumber && i.saleOrderNumber)).toBe(true);

      const a1 = items.find((i) => i.erveDispatchId === A.a1.dispatchId)!;
      expect(a1.saleOrderLineId).toBe(A.a1.saleOrderLineId);
      expect(a1.storeKey).toBe(`S:${A.st1.id}`);
      expect(a1.distributor.id).toBe(A.d1.distributor.id);
      expect(a1.shippedQuantity).toBe(20);
      expect(a1.receipt).toMatchObject({ status: 'ATTESTED', receivedQuantity: 18 });
      expect(a1.ledger.quantity).toBe(20);
      expect(a1.discrepancy).toBe(true);
      // Pending and approved returns, sold and returned all attributed to their original source.
      expect(a1.saleReturn).toMatchObject({
        actualSoldQuantity: 5,
        returnedQuantity: 2,
        approvedAwaitingReceiptQuantity: 3,
        pendingRequestedQuantity: 4,
        remainingWithDistributor: 13, // 20 - 5 - 2
        availableForActualSale: 10, // 13 - 3
        availableForNewReturn: 6, // 10 - 4
      });
      // A source with no receipt and no ledger says so; it is not zero.
      const awaiting = items.find((i) => i.shippedQuantity === 6)!;
      expect(awaiting.receipt.status).toBe('AWAITING');
      expect(awaiting.receipt.receivedQuantity).toBeNull();
      expect(awaiting.ledger.quantity).toBeNull();
    });

    it('paginates with a stable keyset and no gaps, and paging never changes the Style summary', async () => {
      const before = await styles(A.merch, { limit: 100 });
      const paged = await allSources(A.merch, A.SA.id, {}, 2);
      expect(paged.pages).toBe(3);
      expect(new Set(paged.items.map((i) => `${i.erveDispatchId}:${i.saleOrderLineId}`)).size).toBe(5);
      expect(paged.items.reduce((n, i) => n + i.shippedQuantity, 0)).toBe(63);
      expect(await styles(A.merch, { limit: 100 })).toEqual(before);
    });

    it('filters by Distributor, Store and Size', async () => {
      const byStore = (await allSources(A.merch, A.SA.id, { storeKey: `S:${A.st1.id}` }, 100)).items;
      expect(byStore.map((i) => i.shippedQuantity).sort((a, b) => a - b)).toEqual([6, 10, 20]);
      const bySize = (await allSources(A.merch, A.SA.id, { sizeId: A.L.id }, 100)).items;
      expect(bySize).toHaveLength(1);
      expect(bySize[0]!.sizeId).toBe(A.L.id);
      const byDistributor = (await allSources(A.merch, A.SA.id, { distributorId: A.d2.distributor.id }, 100)).items;
      expect(byDistributor).toHaveLength(1);
      expect(byDistributor[0]!.distributor.id).toBe(A.d2.distributor.id);
    });
  });

  describe('visibility by role', () => {
    it('lets ADMIN, ACCOUNTANT and SENIOR_MANAGEMENT read the same consolidated totals as the Merchandiser', async () => {
      const baseline = (await styles(A.merch, { limit: 100 })).summary;
      for (const token of [A.admin, A.accountant, A.seniorManagement]) {
        const r = await styles(token, { limit: 100 });
        expect(r.summary).toEqual(baseline);
        await detail(token, A.SA.id);
        await sources(token, A.SA.id);
      }
      const adminFiltered = await styles(A.admin, { limit: 100, distributorId: A.d2.distributor.id });
      expect(adminFiltered.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SC.id].sort());
    });

    it('pins a Distributor to its own Distributor: only its own Styles and quantities, whatever filters it sends', async () => {
      const own = await styles(A.d1.distributorToken, { limit: 100 });
      expect(own.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SB.id, A.SD.id].sort()); // never SC (D2) or SO (OUTRIGHT)
      expect(own.summary.distributorCount).toBe(1);
      const sa = own.items.find((i) => i.styleId === A.SA.id)!.measures;
      expect(sa.shippedQuantity).toBe(48); // D1 only, not D2's 15
      expect(sr(sa).remainingWithDistributor).toBe(35);

      // Naming itself is fine; naming another Distributor is refused at the service layer.
      await styles(A.d1.distributorToken, { distributorId: A.d1.distributor.id });
      await get(A.d1.distributorToken, '/sale-or-return-stock/styles', { distributorId: A.d2.distributor.id }).expect(403);
      await get(A.d1.distributorToken, `/sale-or-return-stock/styles/${A.SA.id}`, { distributorId: A.d2.distributor.id }).expect(403);
      await get(A.d1.distributorToken, `/sale-or-return-stock/styles/${A.SA.id}/stores`, { distributorId: A.d2.distributor.id }).expect(403);
      await get(A.d1.distributorToken, `/sale-or-return-stock/styles/${A.SA.id}/sources`, { distributorId: A.d2.distributor.id }).expect(403);

      const other = await styles(A.d2.distributorToken, { limit: 100 });
      expect(other.items.map((i) => i.styleId).sort()).toEqual([A.SA.id, A.SC.id].sort());
      expect(other.items.find((i) => i.styleId === A.SA.id)!.measures.shippedQuantity).toBe(15);
    });

    it("never leaks another Distributor's Styles, Stores, dispatches or totals to a Distributor, at any level", async () => {
      const token = A.d1.distributorToken;
      const bodies: string[] = [];
      bodies.push(JSON.stringify(await styles(token, { limit: 100 })));
      bodies.push(JSON.stringify(await detail(token, A.SA.id)));
      bodies.push(JSON.stringify(await stores(token, A.SA.id)));
      bodies.push(JSON.stringify((await allSources(token, A.SA.id, {}, 100)).items));
      // A Style D1 has no stock in: not found / empty, never D2's data.
      await detail(token, A.SC.id, {}, 404);
      expect((await stores(token, A.SC.id)).items).toEqual([]);
      expect((await sources(token, A.SC.id)).items).toEqual([]);

      const other = await prisma.distributor.findUniqueOrThrow({ where: { id: A.d2.distributor.id } });
      const forbidden = [A.d2.distributor.id, other.code, other.name, A.st3.id, A.st3.name, A.SC.id, A.SC.styleNumber];
      for (const body of bodies) for (const needle of forbidden) expect(body).not.toContain(needle);
      // The Style detail for D1's own Style only knows D1.
      expect((await detail(token, A.SA.id)).distributors.map((d) => d.distributor.id)).toEqual([A.d1.distributor.id]);
    });

    it('refuses roles outside the audience and unauthenticated callers', async () => {
      const factory = await createTestFactory();
      const factoryToken = await createFactoryUserToken(factory.id);
      await get(factoryToken, '/sale-or-return-stock/styles').expect(403);
      await get(factoryToken, `/sale-or-return-stock/styles/${A.SA.id}`).expect(403);
      await request(app).get('/sale-or-return-stock/styles').expect(401);
    });

    it('has no mutation routes: it is a read model', async () => {
      await post(A.admin, '/sale-or-return-stock/styles', {}).expect(404);
      await request(app).delete(`/sale-or-return-stock/styles/${A.SA.id}`).set(auth(A.admin)).expect(404);
      await request(app).patch(`/sale-or-return-stock/styles/${A.SA.id}`).set(auth(A.admin)).send({}).expect(404);
    });
  });

  describe('Style images follow the existing access rules', () => {
    function pngFixture(fillByte: number): Buffer {
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0x00, 0x00, 0x0d]),
        Buffer.from('IHDR', 'latin1'),
        Buffer.alloc(17, fillByte),
      ]);
    }
    it('exposes the primary image of a Style to Merchandiser, Accountant and the owning Distributor, and never lists another Distributor Style', async () => {
      await request(app)
        .post(`/styles/${A.SA.id}/images`)
        .set(auth(A.merch))
        .attach('image', pngFixture(7), { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);
      for (const token of [A.merch, A.accountant, A.d1.distributorToken, A.d2.distributorToken]) {
        const sa = (await styles(token, { limit: 100 })).items.find((i) => i.styleId === A.SA.id)!;
        expect(sa.primaryImage).not.toBeNull();
        expect((await detail(token, A.SA.id)).card.primaryImage).not.toBeNull();
      }
      // D1 cannot see SC at all, so there is no image metadata of it to leak.
      expect((await styles(A.d1.distributorToken, { limit: 100 })).items.some((i) => i.styleId === A.SC.id)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Scale: the same Style across 120 Dispatches.
// ---------------------------------------------------------------------------

const measured = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: [{ emit: 'event', level: 'query' }],
});
const queries: Prisma.QueryEvent[] = [];
measured.$on('query', (event) => queries.push(event));
afterAll(() => measured.$disconnect());

describe('Sale-or-Return Stock — one Style across 100+ Dispatches', () => {
  const EXTRA = 119; // + 1 real Dispatch = 120
  let world: World;
  let styleId: string;
  let store: { id: string };
  let base: Shipment;
  let admin: { token: string; userId: string };
  let actor: ReturnType<typeof toCurrentUser>;

  beforeAll(async () => {
    await resetDatabase();
    world = await newWorld();
    const [M] = await newSizes([{ code: 'M', order: 2 }]);
    const style = await newStyle('STKX');
    styleId = style.id;
    store = await createTestRetailStore(world.distributor.id);
    base = await ship(world, { retailStoreId: store.id, styleId, sizeId: M!.id, quantity: 20 });
    await confirmReceived(base, 20);
    admin = await createRoleToken('ADMIN');
    actor = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: currentUserSelect }));
  }, 600_000);

  /** Clone the real Dispatch (Packing List, Dispatch, carton, line, ledger) N more times. Not creatable through the API at this volume. */
  async function addDispatches(count: number, from: number) {
    const pl = await prisma.ervePackingList.findFirstOrThrow({ where: { dispatch: { id: base.dispatchId } } });
    const dispatch = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: base.dispatchId } });
    const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: base.cartonId } });
    for (let n = from; n < from + count; n += 1) {
      const plId = createId();
      const dispatchId = createId();
      const cartonId = createId();
      await prisma.ervePackingList.create({
        data: { ...pl, id: plId, ervePackingListNumber: `${pl.ervePackingListNumber}-C${n}`, ervePackingListSerial: pl.ervePackingListSerial + 1000 + n },
      });
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
      await prisma.factoryPackingCartonLine.create({ data: { id: createId(), cartonId, saleOrderLineId: base.saleOrderLineId, quantity: 5 } });
      await prisma.erveDispatchDeliveryLine.create({
        data: { id: createId(), erveDispatchId: dispatchId, saleOrderLineId: base.saleOrderLineId, receivedQuantity: 4 },
      });
    }
  }

  const TOTAL_SHIPPED = 20 + EXTRA * 5; // 615
  const TOTAL_LEDGER = 20 + EXTRA * 4; // 496

  it('keeps SQL volume flat from 1 to 120 Dispatches (no per-source follow-up queries) and totals correct', async () => {
    const sample = async () => {
      vi.spyOn(prisma, '$transaction').mockImplementation(measured.$transaction.bind(measured));
      queries.length = 0;
      const summary = await listStockStyles(actor, { limit: 25 });
      await getStockStyleDetail(actor, styleId, {});
      await listStockStyleStores(actor, styleId, {});
      const page = await listStockStyleSources(actor, styleId, { limit: 25 });
      vi.restoreAllMocks();
      return { count: queries.length, summary, page };
    };
    const one = await sample();
    expect(one.summary.items[0]!.measures.shippedQuantity).toBe(20);
    expect(one.page.items).toHaveLength(1);

    await addDispatches(EXTRA, 1);
    const many = await sample();
    expect(many.summary.items).toHaveLength(1);
    expect(many.summary.items[0]!.measures.sourceCount).toBe(120);
    expect(many.summary.items[0]!.measures.shippedQuantity).toBe(TOTAL_SHIPPED);
    expect(many.page.items).toHaveLength(25);
    expect(many.page.pageInfo.hasMore).toBe(true);
    expect(many.count).toBe(one.count);
    // Four service calls, each one transaction (BEGIN/COMMIT counted): a small constant, not a function of the data.
    expect(many.count).toBeLessThanOrEqual(24);
  }, 600_000);

  it('summarises the Style once, completely, although the existing position list needs five pages', async () => {
    const r = await styles(admin.token, { limit: 25 });
    expect(r.items).toHaveLength(1);
    const m = r.items[0]!.measures;
    expect(m.sourceCount).toBe(120);
    expect(m.shippedQuantity).toBe(TOTAL_SHIPPED);
    expect(m.ledgerQuantity).toBe(TOTAL_LEDGER);
    expect(sr(m).remainingWithDistributor).toBe(TOTAL_LEDGER);
    expect(r.summary.styleCount).toBe(1);

    // The existing endpoint returns only 25 of the 120 positions at its default page size.
    const firstPage = await get(admin.token, '/sale-or-return-positions', { distributorId: world.distributor.id }).expect(200);
    expect(firstPage.body.data.items).toHaveLength(25);
    expect(firstPage.body.data.pageInfo.hasMore).toBe(true);
    // Summing every authoritative position (across all its page boundaries) equals the Style total.
    const positions = await allPositions(admin.token, world.distributor.id, 25);
    expect(positions.pages).toBe(5);
    expect(positions.items).toHaveLength(120);
    expect(positions.items.reduce((n, p) => n + Number(p.dispatchedQuantity), 0)).toBe(m.shippedQuantity);
    expect(positions.items.reduce((n, p) => n + Number(p.receivedQuantity), 0)).toBe(m.ledgerQuantity);
    expect(positions.items.reduce((n, p) => n + Number(p.remainingWithDistributor), 0)).toBe(sr(m).remainingWithDistributor);
  });

  it('pages the 120 contributing Dispatches without gaps or duplicates and without changing any total', async () => {
    const before = await styles(admin.token, { limit: 25 });
    const paged = await allSources(admin.token, styleId, {}, 25);
    expect(paged.pages).toBe(5);
    expect(paged.items).toHaveLength(120);
    expect(new Set(paged.items.map((i) => `${i.erveDispatchId}:${i.saleOrderLineId}`)).size).toBe(120);
    expect(paged.items.reduce((n, i) => n + i.shippedQuantity, 0)).toBe(TOTAL_SHIPPED);
    expect(paged.items.every((i) => i.saleOrderLineId === base.saleOrderLineId && i.storeKey === `S:${store.id}`)).toBe(true);
    expect(await styles(admin.token, { limit: 25 })).toEqual(before);

    const d = await detail(admin.token, styleId);
    expect(d.card.total.shippedQuantity).toBe(TOTAL_SHIPPED);
    expect(d.distributors).toHaveLength(1);
    expect(d.distributors[0]!.measures.sourceCount).toBe(120);
    const s = await stores(admin.token, styleId, { distributorId: world.distributor.id });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.measures.shippedQuantity).toBe(TOTAL_SHIPPED);
  });
});
