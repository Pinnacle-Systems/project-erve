import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createId } from '@erve/shared';
import type {
  RetailStoreInventoryResponse,
  RetailStoreInventorySourcesResponse,
  RetailStoreInventoryStoreGroup,
} from '@erve/types';
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
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createApprovedSaleOrder,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

// A6 / ISS-088. Every test builds its own Distributor, so the (shared, once-reset)
// disposable database never couples scenarios: internal viewers always pass
// distributorId, exactly as the UI does. Fixtures use the real Packing -> EIPL
// -> Dispatch -> receipt flow; only structural variants that no API can create
// (historical unmapped destinations, a retired carton) are set up in SQL.

const app = createApp();
beforeAll(resetDatabase);
afterAll(() => prisma.$disconnect());

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
/** Sets a Style's Size set (the Style's native columns). Done AFTER shipping: a Dispatch Order splits a Style total across its active Sizes. */
async function setStyleSizes(styleId: string, sizes: Array<{ sizeId: string; active?: boolean }>) {
  for (const s of sizes) {
    const status = s.active === false ? 'INACTIVE' : 'ACTIVE';
    const existing = await prisma.styleSize.findFirst({ where: { styleId, sizeId: s.sizeId } });
    if (existing) await prisma.styleSize.update({ where: { id: existing.id }, data: { status } });
    else await prisma.styleSize.create({ data: { id: createId(), styleId, sizeId: s.sizeId, status } });
  }
}
async function newStyle(prefix = 'A6') {
  const season = await createTestSeason();
  return prisma.style.create({
    data: { id: createId(), styleNumber: `${prefix}-${createId().slice(-6)}`, styleName: `${prefix} style`, finalMrp: 100, seasonId: season.id },
  });
}

async function newWorld(mode: Mode = 'SALE_RETURN') {
  const distributor = await createTestDistributor({ purchaseMode: mode });
  const factory = await createTestFactory();
  const factoryToken = await createFactoryUserToken(factory.id);
  const distributorToken = await createDistributorToken(distributor.id);
  const merch = await createRoleToken('MERCHANDISER');
  return { distributor, factory, factoryToken, distributorToken, merchToken: merch.token };
}
type World = Awaited<ReturnType<typeof newWorld>>;

interface ShipOptions {
  retailStoreId?: string;
  styleId: string;
  sizeId: string;
  quantity: number;
  /** Override the commercial mode stored on the Sale Order's Distributor group. */
  mode?: Mode;
  dispatch?: boolean;
}
async function ship(world: World, o: ShipOptions) {
  // The order splits the line total across the Style's active Sizes: only the shipped Size may be active now.
  await prisma.styleSize.updateMany({ where: { styleId: o.styleId, sizeId: { not: o.sizeId } }, data: { status: 'INACTIVE' } });
  await setStyleSizes(o.styleId, [{ sizeId: o.sizeId }]);
  // A Factory's pooled stock for the Style also joins the split, so each shipment gets its own Factory.
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
  const dispatch = o.dispatch === false ? null : await consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  const line = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: f.saleOrderLineId } });
  return { ...f, packed, cartonId: packed.cartonId, dispatch, destinationId: f.saleOrder.destinations[0].id as string, line };
}

async function attest(world: World, dispatch: { id: string; version: number }, styleId: string, sizeId: string, receivedQuantity: number, expectedVersion = dispatch.version) {
  await request(app)
    .post(`/erve-dispatches/${dispatch.id}/distributor-receipt`)
    .set('Authorization', `Bearer ${world.distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion, acknowledged: true, remarks: 'receipt', groups: [{ styleId, sizeId, receivedQuantity }] })
    .expect(201);
}

async function inventory(token: string, query: Record<string, string | number> = {}, expected = 200) {
  const res = await request(app).get('/retail-store-inventory').query(query).set('Authorization', `Bearer ${token}`).expect(expected);
  return res.body.data as RetailStoreInventoryResponse;
}
async function sources(token: string, query: Record<string, string | number>, expected = 200) {
  const res = await request(app).get('/retail-store-inventory/sources').query(query).set('Authorization', `Bearer ${token}`).expect(expected);
  return res.body.data as RetailStoreInventorySourcesResponse;
}
const findStore = (r: RetailStoreInventoryResponse, retailStoreId: string): RetailStoreInventoryStoreGroup =>
  r.items.find((s) => s.retailStoreId === retailStoreId)!;

describe('A6 Retail Store Inventory — aggregation', () => {
  it('sums the same Style x Size across Dispatches into one Store cell, keeps other Stores separate, and drills down to every source', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const s1 = await createTestRetailStore(w.distributor.id);
    const s2 = await createTestRetailStore(w.distributor.id);
    const a = await ship(w, { retailStoreId: s1.id, styleId: style.id, sizeId: m!.id, quantity: 10 });
    const b = await ship(w, { retailStoreId: s1.id, styleId: style.id, sizeId: m!.id, quantity: 5 });
    await ship(w, { retailStoreId: s2.id, styleId: style.id, sizeId: m!.id, quantity: 7 });

    const r = await inventory(w.distributorToken);
    expect(r.items).toHaveLength(2);
    const card1 = findStore(r, s1.id).styles[0]!;
    expect(card1.cells[m!.id]!.shippedQuantity).toBe(15);
    expect(card1.cells[m!.id]!.sourceCount).toBe(2);
    expect(card1.total.shippedQuantity).toBe(15);
    expect(findStore(r, s1.id).dispatchCount).toBe(2);
    expect(findStore(r, s2.id).styles[0]!.cells[m!.id]!.shippedQuantity).toBe(7);
    expect(r.summary.storeCount).toBe(2);
    expect(r.summary.totalsByMode.SALE_RETURN!.shippedQuantity).toBe(22);

    const src = await sources(w.distributorToken, { storeKey: `S:${s1.id}`, styleId: style.id, sizeId: m!.id, purchaseMode: 'SALE_RETURN' });
    expect(src.items.map((i) => i.erveDispatchId).sort()).toEqual([a.dispatch!.id, b.dispatch!.id].sort());
    expect(src.items.map((i) => i.saleOrderLineId).sort()).toEqual([a.saleOrderLineId, b.saleOrderLineId].sort());
    expect(src.items.reduce((sum, i) => sum + i.shippedQuantity, 0)).toBe(15);
    expect(src.items[0]!.dispatchDestination.label).toBeTruthy();
  });

  it('gives each Style its own native Size columns, ordered by sort order, with inactive sizes shown only when they carry shipments', async () => {
    const w = await newWorld();
    const tops = await newStyle('TOP');
    const jeans = await newStyle('JEAN');
    const [s, m, l, xl] = await newSizes([
      { code: 'S', order: 1 },
      { code: 'M', order: 2 },
      { code: 'L', order: 3 },
      { code: 'XL', order: 4 },
    ]);
    const [w30, w32] = await newSizes([
      { code: '30', order: 30 },
      { code: '32', order: 32 },
    ]);
    const store = await createTestRetailStore(w.distributor.id);
    await ship(w, { retailStoreId: store.id, styleId: tops.id, sizeId: l!.id, quantity: 4 });
    await ship(w, { retailStoreId: store.id, styleId: tops.id, sizeId: xl!.id, quantity: 2 });
    await ship(w, { retailStoreId: store.id, styleId: jeans.id, sizeId: w32!.id, quantity: 6 });
    await setStyleSizes(tops.id, [{ sizeId: s!.id }, { sizeId: m!.id }, { sizeId: l!.id }, { sizeId: xl!.id, active: false }]);
    await setStyleSizes(jeans.id, [{ sizeId: w30!.id }, { sizeId: w32!.id }]);

    const group = findStore(await inventory(w.distributorToken), store.id);
    const topsCard = group.styles.find((c) => c.styleId === tops.id)!;
    const jeansCard = group.styles.find((c) => c.styleId === jeans.id)!;
    expect(topsCard.sizes.map((c) => c.sizeId)).toEqual([s!.id, m!.id, l!.id, xl!.id]);
    expect(topsCard.sizes.map((c) => c.active)).toEqual([true, true, true, false]);
    expect(Object.keys(topsCard.cells).sort()).toEqual([l!.id, xl!.id].sort());
    expect(topsCard.total.shippedQuantity).toBe(6);
    expect(jeansCard.sizes.map((c) => c.sizeId)).toEqual([w30!.id, w32!.id]);
    expect(jeansCard.total.shippedQuantity).toBe(6);
    // Same-named labels on different Size ids are never combined.
    expect(new Set([...topsCard.sizes, ...jeansCard.sizes].map((c) => c.sizeId)).size).toBe(6);
  });

  it('counts only physical Dispatch: packed-only, open/finalized lists and retired cartons are excluded', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const real = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 10 });
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 20, dispatch: false }); // packed only
    const consolidatedOnly = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 30, dispatch: false });
    await request(app).post('/erve-packing-lists').set('Authorization', `Bearer ${real.merchToken}`).send({ cartonIds: [consolidatedOnly.cartonId] }).expect(201);
    // A retired carton on a real Dispatch: same grain, must not count.
    const retired = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 40 });
    await prisma.factoryPackingCarton.update({ where: { id: retired.cartonId }, data: { retiredAt: new Date(), retiredById: (await prisma.user.findFirstOrThrow()).id } });

    const group = findStore(await inventory(w.distributorToken), store.id);
    expect(group.styles[0]!.cells[m!.id]!.shippedQuantity).toBe(10);
    expect(group.dispatchCount).toBe(1);
  });

  it('keeps SALE_RETURN and OUTRIGHT visible but with distinct stock semantics, never merged into one card', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 2 }]);
    const store = await createTestRetailStore(w.distributor.id);
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 10, mode: 'SALE_RETURN' });
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 8, mode: 'OUTRIGHT' });

    const r = await inventory(w.distributorToken);
    const group = findStore(r, store.id);
    expect(group.styles.map((c) => c.purchaseMode).sort()).toEqual(['OUTRIGHT', 'SALE_RETURN']);
    const sale = group.styles.find((c) => c.purchaseMode === 'SALE_RETURN')!;
    const outright = group.styles.find((c) => c.purchaseMode === 'OUTRIGHT')!;
    expect(sale.cells[m!.id]!.shippedQuantity).toBe(10);
    expect(sale.cells[m!.id]!.saleReturn).not.toBeNull();
    expect(outright.cells[m!.id]!.shippedQuantity).toBe(8);
    // No authoritative retailer sell-through / on-hand exists for OUTRIGHT.
    expect(outright.cells[m!.id]!.saleReturn).toBeNull();
    expect(outright.total.saleReturn).toBeNull();
    expect(Object.keys(group.totalsByMode).sort()).toEqual(['OUTRIGHT', 'SALE_RETURN']);

    const onlyOutright = await inventory(w.distributorToken, { purchaseMode: 'OUTRIGHT' });
    expect(findStore(onlyOutright, store.id).styles.map((c) => c.purchaseMode)).toEqual(['OUTRIGHT']);
  });
});

describe('A6 Retail Store Inventory — receipt evidence', () => {
  it('labels missing, full, partial and all-zero Distributor receipts without ever showing missing as zero', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const sizes = await newSizes([
      { code: 'A', order: 1 },
      { code: 'B', order: 2 },
      { code: 'C', order: 3 },
      { code: 'D', order: 4 },
    ]);
    const store = await createTestRetailStore(w.distributor.id);
    const shipments = [];
    for (const size of sizes) shipments.push(await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: size.id, quantity: 10 }));
    const [full, partial, zero, none] = shipments;
    await attest(w, full!.dispatch!, style.id, sizes[0]!.id, 10);
    await attest(w, partial!.dispatch!, style.id, sizes[1]!.id, 6);
    await attest(w, zero!.dispatch!, style.id, sizes[2]!.id, 0);
    void none;

    const card = findStore(await inventory(w.distributorToken), store.id).styles[0]!;
    const [a, b, c, d] = sizes.map((s) => card.cells[s.id]!);
    expect(a).toMatchObject({ attestedReceivedQuantity: 10, shortageQuantity: 0, awaitingConfirmationQuantity: 0, ledgerQuantity: 10 });
    expect(b).toMatchObject({ attestedReceivedQuantity: 6, shortageQuantity: 4, ledgerQuantity: 6 });
    // All-zero: attested 0 (final evidence, a real zero), 10 short, no ledger applied.
    expect(c).toMatchObject({ attestedReceivedQuantity: 0, shortageQuantity: 10, ledgerQuantity: null });
    // No receipt at all: not zero, not "in transit" — awaiting confirmation.
    expect(d).toMatchObject({ attestedReceivedQuantity: null, shortageQuantity: null, awaitingConfirmationQuantity: 10, ledgerQuantity: null });
    expect(d!.attestedShippedQuantity).toBe(0);
    expect(card.total).toMatchObject({ shippedQuantity: 40, attestedReceivedQuantity: 16, shortageQuantity: 14, awaitingConfirmationQuantity: 10 });
    // Distributor-confirmed ledger is attributed to the Distributor, not to an Admin.
    expect(a!.ledgerBySource).toMatchObject({ distributorConfirmed: 10, userConfirmed: 0, legacyAssumedFullReceipt: 0 });
  });

  it('labels an Admin/Merchandiser fallback and a legacy assumed receipt as such, never as Distributor-verified', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const sizes = await newSizes([
      { code: 'A', order: 1 },
      { code: 'B', order: 2 },
    ]);
    const store = await createTestRetailStore(w.distributor.id);
    const admin = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: sizes[0]!.id, quantity: 10 });
    const legacy = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: sizes[1]!.id, quantity: 12 });
    await confirmErveDispatchDelivery(app, admin.merchToken, admin.dispatch!.id, admin.dispatch!.version, [{ saleOrderLineId: admin.saleOrderLineId, receivedQuantity: 9 }], 'one short');
    const legacyConfirm = await confirmErveDispatchDelivery(app, legacy.merchToken, legacy.dispatch!.id, legacy.dispatch!.version, [{ saleOrderLineId: legacy.saleOrderLineId, receivedQuantity: 12 }]);
    void legacyConfirm;
    await prisma.erveDispatch.update({ where: { id: legacy.dispatch!.id }, data: { deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' } });

    const card = findStore(await inventory(w.distributorToken), store.id).styles[0]!;
    const a = card.cells[sizes[0]!.id]!;
    const b = card.cells[sizes[1]!.id]!;
    // No A4 attestation exists for either: still awaiting the Distributor, and no shortage is claimed from the ledger.
    for (const cell of [a, b]) expect(cell).toMatchObject({ attestedReceivedQuantity: null, shortageQuantity: null });
    expect(a).toMatchObject({ ledgerQuantity: 9, awaitingConfirmationQuantity: 10 });
    expect(a.ledgerBySource).toMatchObject({ userConfirmed: 9, distributorConfirmed: 0, legacyAssumedFullReceipt: 0 });
    expect(b.ledgerBySource).toMatchObject({ legacyAssumedFullReceipt: 12, userConfirmed: 0, distributorConfirmed: 0 });
    const src = await sources(w.distributorToken, { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' });
    expect(src.items.map((i) => i.ledger.source).sort()).toEqual(['LEGACY_ASSUMED_FULL_RECEIPT', 'USER_CONFIRMED']);
    expect(src.items.every((i) => i.receipt.status === 'AWAITING')).toBe(true);
  });

  it('shows the Distributor attestation and the earlier ledger separately, with a discrepancy indicator (A4 EVIDENCE_ONLY_EXISTING)', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const f = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 100 });
    const confirmed = await confirmErveDispatchDelivery(app, f.merchToken, f.dispatch!.id, f.dispatch!.version, [{ saleOrderLineId: f.saleOrderLineId, receivedQuantity: 90 }], '10 short');
    await attest(w, f.dispatch!, style.id, m!.id, 70, confirmed.body.data.version);

    const cell = findStore(await inventory(w.distributorToken), store.id).styles[0]!.cells[m!.id]!;
    expect(cell).toMatchObject({ attestedReceivedQuantity: 70, shortageQuantity: 30, ledgerQuantity: 90, discrepancySourceCount: 1 });
    const [source] = (await sources(w.distributorToken, { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' })).items;
    expect(source).toMatchObject({ discrepancy: true, shortageQuantity: 30, ledger: { quantity: 90, source: 'USER_CONFIRMED' } });
    expect(source!.receipt).toMatchObject({ status: 'ATTESTED', receivedQuantity: 70, ledgerDisposition: 'EVIDENCE_ONLY_EXISTING' });
    // The position keyed off the ledger is untouched by the attestation.
    expect(cell.saleReturn!.remainingWithDistributor).toBe(90);
  });

  it('treats QR carton confirmation as physical-delivery evidence only: it changes no inventory quantity', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const f = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 20 });
    const before = findStore(await inventory(w.distributorToken), store.id).styles[0]!.cells[m!.id]!;

    const issuer = await prisma.user.findFirstOrThrow();
    const token = await prisma.cartonDeliveryToken.create({
      data: { id: createId(), cartonId: f.cartonId, tokenDigest: createId(), encryptedToken: 'x', keyVersion: 'v1', labelReference: createId(), issuedById: issuer.id, validForDays: 30 },
    });
    await prisma.cartonDeliveryConfirmation.create({
      data: { id: createId(), cartonId: f.cartonId, dispatchId: f.dispatch!.id, tokenId: token.id, recipientName: 'Store staff', deliveredAt: new Date(), timezone: 'Asia/Kolkata', offsetMinutes: 330, idempotencyKey: createId(), payloadDigest: 'd' },
    });

    const after = findStore(await inventory(w.distributorToken), store.id).styles[0]!.cells[m!.id]!;
    expect(after).toEqual(before);
    expect(after).toMatchObject({ shippedQuantity: 20, awaitingConfirmationQuantity: 20, attestedReceivedQuantity: null, ledgerQuantity: null });
    const [source] = (await sources(w.distributorToken, { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' })).items;
    expect(source!.qr).toEqual({ cartonCount: 1, confirmedCartonCount: 1 });
    expect(source!.receipt.status).toBe('AWAITING');
  });
});

describe('A6 Retail Store Inventory — SALE_RETURN position', () => {
  it('matches the existing Sale-or-Return formulas for sold, returned, approved-awaiting and pending quantities', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const f = await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 100 });
    await confirmErveDispatchDelivery(app, f.merchToken, f.dispatch!.id, f.dispatch!.version, [{ saleOrderLineId: f.saleOrderLineId, receivedQuantity: 100 }]);
    const accountant = (await createRoleToken('ACCOUNTANT')).token;
    const lineBody = (quantity: number) => ({ distributorId: w.distributor.id, returnDate: '2026-09-01', returnReason: 'Unsold', lines: [{ erveDispatchId: f.dispatch!.id, saleOrderLineId: f.saleOrderLineId, requestedQuantity: quantity }] });
    const post = (path: string, token: string, body: object) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);

    await post('/distributor-sales-reports', w.distributorToken, { distributorId: w.distributor.id, reportDate: '2026-08-01', lines: [{ erveDispatchId: f.dispatch!.id, saleOrderLineId: f.saleOrderLineId, quantitySold: 25 }] }).expect(201);
    // 30 physically returned
    const r1 = (await post('/distributor-returns', w.distributorToken, lineBody(30)).expect(201)).body.data;
    const a1 = (await post(`/distributor-returns/${r1.id}/approve`, accountant, { expectedVersion: r1.version, lines: [{ id: r1.lines[0].id, approvedQuantity: 30 }] }).expect(200)).body.data;
    await post(`/distributor-returns/${a1.id}/receive`, f.merchToken, { expectedVersion: a1.version, lines: [{ id: r1.lines[0].id, receivedQuantity: 30 }] }).expect(200);
    // 10 approved, awaiting physical receipt
    const r2 = (await post('/distributor-returns', w.distributorToken, lineBody(10)).expect(201)).body.data;
    await post(`/distributor-returns/${r2.id}/approve`, accountant, { expectedVersion: r2.version, lines: [{ id: r2.lines[0].id, approvedQuantity: 10 }] }).expect(200);
    // 5 pending request
    await post('/distributor-returns', w.distributorToken, lineBody(5)).expect(201);

    const cell = findStore(await inventory(w.distributorToken), store.id).styles[0]!.cells[m!.id]!;
    expect(cell.saleReturn).toEqual({
      actualSoldQuantity: 25,
      returnedQuantity: 30,
      approvedAwaitingReceiptQuantity: 10,
      pendingRequestedQuantity: 5,
      remainingWithDistributor: 45, // 100 - 25 - 30: physical position, reservations not subtracted
      availableForActualSale: 35, // 45 - 10 approved
      availableForNewReturn: 30, // 35 - 5 pending (each reservation subtracted exactly once)
    });
    // Cross-check against the existing authoritative Sale-or-Return endpoint.
    const positions = await request(app).get('/sale-or-return-positions').set('Authorization', `Bearer ${w.distributorToken}`).expect(200);
    const row = positions.body.data.items.find((p: { saleOrderLineId: string }) => p.saleOrderLineId === f.saleOrderLineId);
    expect(row).toMatchObject({ remainingWithDistributor: 45, returnableQuantity: 30, actualSoldQuantity: 25, returnedQuantity: 30 });
    const [source] = (await sources(w.distributorToken, { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' })).items;
    expect(source!.saleReturn).toEqual(cell.saleReturn);
  });
});

describe('A6 Retail Store Inventory — Retail Store identity', () => {
  it('never merges unmapped historical destinations by name or address; each keeps its own identity', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const a = await ship(w, { styleId: style.id, sizeId: m!.id, quantity: 4 });
    const b = await ship(w, { styleId: style.id, sizeId: m!.id, quantity: 6 });
    const mapped = await ship(w, { styleId: style.id, sizeId: m!.id, quantity: 3 });
    // Pre-ISS-100 history: no stable store id, identical descriptive text.
    for (const d of [a, b]) {
      await prisma.$executeRaw`UPDATE sale_order_destinations SET retail_store_id = NULL, label = 'Same Name', store_code = 'SAME', address_line1 = '1 Same Street', city = 'Pune' WHERE id = ${d.destinationId}`;
    }

    const r = await inventory(w.distributorToken);
    const unmapped = r.items.filter((s) => !s.mapped);
    expect(unmapped).toHaveLength(2);
    expect(unmapped.map((s) => s.storeKey).sort()).toEqual([`D:${a.destinationId}`, `D:${b.destinationId}`].sort());
    expect(unmapped.every((s) => s.retailStoreId === null && s.name === 'Same Name' && s.status === null)).toBe(true);
    expect(unmapped.map((s) => s.styles[0]!.total.shippedQuantity).sort()).toEqual([4, 6]);
    expect(r.items.filter((s) => s.mapped)).toHaveLength(1);
    expect(r.summary.storeCount).toBe(3);
    void mapped;

    const one = await sources(w.distributorToken, { storeKey: `D:${a.destinationId}`, styleId: style.id, purchaseMode: 'SALE_RETURN' });
    expect(one.items).toHaveLength(1);
    expect(one.items[0]!.erveDispatchId).toBe(a.dispatch!.id);
  });

  it('keeps one stable group when a Retail Store is renamed, while sources keep the original frozen snapshot', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id, { name: 'Old Name', code: `OLD-${createId().slice(-4)}` });
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 5 });
    await prisma.retailStore.update({ where: { id: store.id }, data: { name: 'New Name' } });
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 9 });

    const r = await inventory(w.distributorToken);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'New Name', retailStoreId: store.id, dispatchCount: 2 });
    expect(r.items[0]!.styles[0]!.cells[m!.id]!.shippedQuantity).toBe(14);
    const src = await sources(w.distributorToken, { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' });
    // The Dispatch before the rename keeps its frozen snapshot; the later order captured the new master name.
    expect(src.items.map((i) => i.dispatchDestination.label).sort()).toEqual(['New Name', 'Old Name']);
    // Both searches resolve to the same single group.
    expect((await inventory(w.distributorToken, { store: 'new name' })).items).toHaveLength(1);
  });
});

describe('A6 Retail Store Inventory — authorization', () => {
  it('pins a Distributor to its own data and rejects another Distributor, in both endpoints', async () => {
    const mine = await newWorld();
    const other = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const myStore = await createTestRetailStore(mine.distributor.id);
    const otherStore = await createTestRetailStore(other.distributor.id);
    await ship(mine, { retailStoreId: myStore.id, styleId: style.id, sizeId: m!.id, quantity: 5 });
    await ship(other, { retailStoreId: otherStore.id, styleId: style.id, sizeId: m!.id, quantity: 8 });

    const own = await inventory(mine.distributorToken);
    expect(own.items.map((s) => s.retailStoreId)).toEqual([myStore.id]);
    await inventory(mine.distributorToken, { distributorId: other.distributor.id }, 403);
    await sources(mine.distributorToken, { distributorId: other.distributor.id, storeKey: `S:${otherStore.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' }, 403);
    // Guessing the other Distributor's Store key leaks nothing.
    const probe = await sources(mine.distributorToken, { storeKey: `S:${otherStore.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' });
    expect(probe.items).toEqual([]);
    const probeInventory = await inventory(mine.distributorToken, { storeKey: `S:${otherStore.id}` });
    expect(probeInventory.items).toEqual([]);
    expect(probeInventory.summary.storeCount).toBe(0);
  });

  it('allows internal viewers (including ACCOUNTANT) to pick a Distributor and denies Factory, Transporter and QA users', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id);
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 5 });

    for (const role of ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] as const) {
      const { token } = await createRoleToken(role);
      const r = await inventory(token, { distributorId: w.distributor.id });
      expect(r.items.map((s) => s.retailStoreId)).toEqual([store.id]);
    }
    for (const role of ['TRANSPORTER', 'QA_USER'] as const) {
      const { token } = await createRoleToken(role);
      await inventory(token, { distributorId: w.distributor.id }, 403);
      await sources(token, { distributorId: w.distributor.id, storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN' }, 403);
    }
    await inventory(w.factoryToken, { distributorId: w.distributor.id }, 403);
    // Extra internal role cannot widen a Factory user.
    const mixed = await createFactoryUserToken(w.factory.id, ['MERCHANDISER']);
    await inventory(mixed, { distributorId: w.distributor.id }, 403);
    await request(app).get('/retail-store-inventory').expect(401);
  });

  it('rejects malformed store keys and cursors', async () => {
    const { token } = await createRoleToken('ADMIN');
    await inventory(token, { storeKey: "S:x'; DROP TABLE users;--" }, 400);
    await inventory(token, { cursor: 'not-a-cursor' }, 400);
    await sources(token, { storeKey: 'X:1', styleId: 's', purchaseMode: 'SALE_RETURN' }, 400);
  });

  it('serves no Style image to a Distributor but does to Admin/Merchandiser, reusing the protected-media policy', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const file = await prisma.file.create({
      data: { id: createId(), fileName: 'a.png', mimeType: 'image/png', sizeBytes: 10, storageKey: `k/${createId()}`, checksumSha256: createId() },
    });
    await prisma.styleImage.create({ data: { id: createId(), styleId: style.id, fileId: file.id, isPrimary: true } });
    const store = await createTestRetailStore(w.distributor.id);
    await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: 5 });

    expect(findStore(await inventory(w.distributorToken), store.id).styles[0]!.primaryImage).toBeNull();
    const admin = (await createRoleToken('ADMIN')).token;
    const image = findStore(await inventory(admin, { distributorId: w.distributor.id }), store.id).styles[0]!.primaryImage;
    expect(image).toMatchObject({ styleId: style.id, isPrimary: true });
    const accountant = (await createRoleToken('ACCOUNTANT')).token;
    expect(findStore(await inventory(accountant, { distributorId: w.distributor.id }), store.id).styles[0]!.primaryImage).toBeNull();
  });
});

describe('A6 Retail Store Inventory — filtering, totals and pagination', () => {
  it('filters in PostgreSQL by store name/code, style and mode; totals and counts cover all matches, not the page', async () => {
    const w = await newWorld();
    const red = await newStyle('RED');
    const blue = await newStyle('BLUE');
    const [rm] = await newSizes([{ code: 'M', order: 1 }]);
    const [bm] = await newSizes([{ code: 'M', order: 1 }]);
    const stores = [
      await createTestRetailStore(w.distributor.id, { name: 'Alpha Mall', code: 'AAA' }),
      await createTestRetailStore(w.distributor.id, { name: 'Beta Plaza', code: 'BBB' }),
      await createTestRetailStore(w.distributor.id, { name: 'Gamma Square', code: 'CCC' }),
    ];
    await ship(w, { retailStoreId: stores[0]!.id, styleId: red.id, sizeId: rm!.id, quantity: 1 });
    await ship(w, { retailStoreId: stores[1]!.id, styleId: red.id, sizeId: rm!.id, quantity: 2 });
    await ship(w, { retailStoreId: stores[2]!.id, styleId: red.id, sizeId: rm!.id, quantity: 4 });
    await ship(w, { retailStoreId: stores[2]!.id, styleId: blue.id, sizeId: bm!.id, quantity: 8 });

    // Pages of 2 Stores: stable order, no duplicates, whole-result summary on every page.
    const page1 = await inventory(w.distributorToken, { limit: 2 });
    expect(page1.items.map((s) => s.name)).toEqual(['Alpha Mall', 'Beta Plaza']);
    expect(page1.pageInfo.hasMore).toBe(true);
    const page2 = await inventory(w.distributorToken, { limit: 2, cursor: page1.pageInfo.nextCursor! });
    expect(page2.items.map((s) => s.name)).toEqual(['Gamma Square']);
    expect(page2.pageInfo).toMatchObject({ hasMore: false, nextCursor: null });
    for (const page of [page1, page2]) {
      expect(page.summary.storeCount).toBe(3);
      expect(page.summary.totalsByMode.SALE_RETURN!.shippedQuantity).toBe(15);
    }
    // Store-level totals are exact even though they cover several Styles.
    expect(page2.items[0]!.totalsByMode.SALE_RETURN!.shippedQuantity).toBe(12);

    expect((await inventory(w.distributorToken, { store: 'bbb' })).items.map((s) => s.name)).toEqual(['Beta Plaza']);
    expect((await inventory(w.distributorToken, { store: 'plaza' })).items).toHaveLength(1);
    const blueOnly = await inventory(w.distributorToken, { style: 'blue' });
    expect(blueOnly.items.map((s) => s.name)).toEqual(['Gamma Square']);
    expect(blueOnly.summary.totalsByMode.SALE_RETURN!.shippedQuantity).toBe(8);
    expect((await inventory(w.distributorToken, { purchaseMode: 'OUTRIGHT' })).items).toEqual([]);
  });

  it('paginates source drilldown with a stable keyset and no gaps', async () => {
    const w = await newWorld();
    const style = await newStyle();
    const [m] = await newSizes([{ code: 'M', order: 1 }]);
    const store = await createTestRetailStore(w.distributor.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await ship(w, { retailStoreId: store.id, styleId: style.id, sizeId: m!.id, quantity: i + 1 })).dispatch!.id);
    const q = { storeKey: `S:${store.id}`, styleId: style.id, purchaseMode: 'SALE_RETURN', limit: 2 };
    const first = await sources(w.distributorToken, q);
    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await sources(w.distributorToken, { ...q, cursor: first.pageInfo.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((i) => i.erveDispatchId).sort()).toEqual([...ids].sort());
  });
});

export type { Express };
