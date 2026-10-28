import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestRetailStore, resetDatabase } from '../../test/helpers.js';
import {
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture(count = 4) {
  const order = await createSingleFactoryApprovedSaleOrder(app, 1);
  const factoryToken = await createFactoryUserToken(order.stock.factoryId);
  const dispatch = await packAndFinalize(
    app,
    factoryToken,
    order.saleOrder.id,
    order.saleOrderLineId,
    order.saleOrder.destinations[0]!.id,
    1,
  );
  const original = await prisma.factoryPackingCarton.findUniqueOrThrow({
    where: { id: dispatch.cartonId },
    include: { audits: true },
  });
  const time = new Date('2026-01-01T00:00:00.000Z');
  await prisma.factoryPackingCarton.update({
    where: { id: original.id },
    data: { retiredAt: new Date() },
  });
  const ids = Array.from({ length: count }, (_, i) => `pagination-${String(i).padStart(5, '0')}`);
  await prisma.factoryPackingCarton.createMany({
    data: ids.map((id, i) => ({
      id,
      factoryDispatchId: dispatch.id,
      destinationId: original.destinationId,
      cartonNumber: `CTN-${i}`,
      createdById: original.createdById,
      createdAt: time,
      version: 1,
      netWeight: '1.250',
      packageDetails: 'Test carton',
    })),
  });
  await prisma.factoryPackingCartonLine.createMany({
    data: ids.map((id) => ({
      id: createId(),
      cartonId: id,
      saleOrderLineId: order.saleOrderLineId,
      quantity: 1,
    })),
  });
  await prisma.factoryPackingCartonAudit.createMany({
    data: ids.map((id) => ({
      id: createId(),
      cartonId: id,
      cartonVersion: 1,
      inspectedById: original.audits[0]!.inspectedById,
    })),
  });
  const get = (params: Record<string, unknown> = {}) =>
    request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${order.merchToken}`)
      .query(params);
  const createList = async () => {
    const res = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${order.merchToken}`)
      .send({ cartonIds: [ids[0]] })
      .expect(201);
    return res.body.data.id as string;
  };
  return { ...order, dispatch, original, ids, get, createList };
}

describe('bounded eligible-carton discovery', () => {
  it('defaults to 25, permits 100, and preserves the exact legacy projection', async () => {
    const f = await fixture(105);
    const legacy = (await f.get().expect(200)).body.data;
    expect(legacy).toHaveLength(105);
    const first = (await f.get({ search: '' }).expect(200)).body.data;
    expect(first.items).toEqual(legacy.slice(0, 25));
    expect(first.pageInfo).toMatchObject({ limit: 25, hasMore: true });
    expect(first.items[0]).toMatchObject({
      weight: '1.25',
      totalQuantity: 1,
      packageDetails: 'Test carton',
      lines: [{ quantity: 1 }],
    });
    expect((await f.get({ limit: 100 }).expect(200)).body.data.items).toHaveLength(100);
  });

  it.each(['0', '-1', '101', '1.5', 'bad', ''])('rejects invalid limit %j', async (limit) => {
    const { token } = await createRoleToken('MERCHANDISER');
    await request(app)
      .get('/erve-packing-lists/eligible-cartons')
      .set('Authorization', `Bearer ${token}`)
      .query({ limit })
      .expect(400);
  });

  it('rejects malformed cursors and cursors used with another search or list', async () => {
    const f = await fixture();
    for (const cursor of ['?', 'e30', 'a'.repeat(3000)])
      await f.get({ limit: 1, cursor }).expect(400);
    const first = (await f.get({ limit: 1 }).expect(200)).body.data;
    const position = JSON.parse(
      Buffer.from(first.pageInfo.nextCursor, 'base64url').toString('utf8'),
    );
    for (const changed of [
      { v: 99 },
      { at: 'not-a-date' },
      { id: '' },
      { at: '2026-13-01T00:00:00.000Z' },
    ]) {
      const cursor = Buffer.from(JSON.stringify({ ...position, ...changed })).toString('base64url');
      await f.get({ limit: 1, cursor }).expect(400);
    }
    await f.get({ limit: 1, search: 'CTN', cursor: first.pageInfo.nextCursor }).expect(400);
    const listId = await f.createList();
    await f
      .get({ limit: 1, ervePackingListId: listId, cursor: first.pageInfo.nextCursor })
      .expect(400);
    // Case and outer whitespace normalize to the same search context.
    const searched = (await f.get({ limit: 1, search: ' CTN ' }).expect(200)).body.data;
    expect(
      (await f.get({ limit: 1, search: 'ctn', cursor: searched.pageInfo.nextCursor }).expect(200))
        .body.data.items[0].id,
    ).toBe(f.ids[2]);
  });

  it('searches carton, Factory Packing List and Dispatch Order identifiers before paging', async () => {
    const f = await fixture(210);
    expect(
      (await f.get({ limit: 1, search: ' cTn-209 ' }).expect(200)).body.data.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([f.ids[209]]);
    for (const search of [
      f.dispatch.factoryDispatchNumber.toLowerCase(),
      f.saleOrder.saleOrderNumber.toLowerCase(),
    ]) {
      expect((await f.get({ limit: 1, search }).expect(200)).body.data.items[0].id).toBe(f.ids[0]);
    }
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[209] },
      data: { cartonNumber: 'literal%_\\carton' },
    });
    expect(
      (await f.get({ limit: 25, search: '%_\\' }).expect(200)).body.data.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([f.ids[209]]);
    await f.get({ search: 'x'.repeat(257) }).expect(400);
    await f.get({ search: '\u0000' }).expect(400);
  });

  it('never skips fetched but unexamined cartons, including equal timestamps and claims between pages', async () => {
    const f = await fixture(9);
    let cursor: string | undefined;
    const found: string[] = [];
    do {
      const page = (await f.get({ limit: 2, ...(cursor ? { cursor } : {}) }).expect(200)).body.data;
      found.push(...page.items.map((c: { id: string }) => c.id));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(found).toEqual(f.ids);
    const first = (await f.get({ limit: 2 }).expect(200)).body.data;
    await f.createList(); // Claim an earlier row; keyset position must remain valid.
    const next = (await f.get({ limit: 2, cursor: first.pageInfo.nextCursor }).expect(200)).body
      .data;
    expect(next.items.map((c: { id: string }) => c.id)).toEqual(f.ids.slice(2, 4));
  });

  it('continues after 200 nonmatching destinations, including empty and sparse pages', async () => {
    const f = await fixture(405);
    const listId = await f.createList();
    const destination = await prisma.saleOrderDestination.findUniqueOrThrow({
      where: { id: f.original.destinationId },
    });
    // ISS-100: "non-matching" now means a different Retail Store, not a
    // different address — same city/distributor, genuinely different store.
    const otherStore = await createTestRetailStore(f.stock.distributorId);
    const other = await prisma.saleOrderDestination.create({
      data: { ...destination, id: createId(), retailStoreId: otherStore.id, storeCode: otherStore.code, addressLine1: 'Other address, same city' },
    });
    await prisma.factoryPackingCarton.updateMany({
      where: { id: { in: f.ids.slice(1, 401) } },
      data: { destinationId: other.id },
    });
    // One match in the second batch, with a third batch still to scan.
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[250] },
      data: { destinationId: destination.id },
    });
    const first = (await f.get({ limit: 25, ervePackingListId: listId }).expect(200)).body.data;
    expect(first.items).toEqual([]);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = (
      await f
        .get({ limit: 25, ervePackingListId: listId, cursor: first.pageInfo.nextCursor })
        .expect(200)
    ).body.data;
    expect(second.items.map((c: { id: string }) => c.id)).toEqual([f.ids[250]]);
    expect(second.pageInfo.hasMore).toBe(true);
    const third = (
      await f
        .get({ limit: 25, ervePackingListId: listId, cursor: second.pageInfo.nextCursor })
        .expect(200)
    ).body.data;
    expect(third.items.map((c: { id: string }) => c.id)).toEqual(f.ids.slice(401));
    expect(third.pageInfo).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('preserves highest-audit semantics and filters retired, claimed, empty and non-ready cartons', async () => {
    const f = await fixture(8);
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[0] },
      data: { retiredAt: new Date() },
    });
    await prisma.factoryPackingCartonLine.deleteMany({ where: { cartonId: f.ids[1] } });
    await prisma.factoryPackingCartonAudit.deleteMany({ where: { cartonId: f.ids[2] } });
    await prisma.factoryPackingCarton.update({ where: { id: f.ids[3] }, data: { version: 2 } });
    await prisma.factoryPackingCartonAudit.create({
      data: {
        id: createId(),
        cartonId: f.ids[4]!,
        cartonVersion: 2,
        inspectedById: f.original.audits[0]!.inspectedById,
      },
    });
    const listId = (
      await request(app)
        .post('/erve-packing-lists')
        .set('Authorization', `Bearer ${f.merchToken}`)
        .send({ cartonIds: [f.ids[5]] })
        .expect(201)
    ).body.data.id;
    const page = (await f.get({ limit: 100 }).expect(200)).body.data;
    expect(page.items.map((c: { id: string }) => c.id)).toEqual(f.ids.slice(6));
    expect(page.items).toEqual((await f.get().expect(200)).body.data);
    await prisma.factoryDispatch.update({
      where: { id: f.dispatch.id },
      data: { status: 'DRAFT' },
    });
    expect((await f.get({ limit: 25 }).expect(200)).body.data.items).toEqual([]);
    await prisma.ervePackingList.update({ where: { id: listId }, data: { status: 'FINALIZED' } });
    await f.get({ limit: 25, ervePackingListId: listId }).expect(409);
    await f.get({ limit: 25, ervePackingListId: 'missing' }).expect(404);
  });

  it('keeps Retail Store identity (never address text) and Distributor identity authoritative; preserves null legacy fields', async () => {
    const f = await fixture(5);
    const listId = await f.createList();
    const destination = await prisma.saleOrderDestination.findUniqueOrThrow({
      where: { id: f.original.destinationId },
    });
    // ISS-100: same Retail Store, wildly different address wording \u2014 still
    // the same destination identity, since address text is never compared.
    const equivalent = await prisma.saleOrderDestination.create({
      data: {
        ...destination,
        id: createId(),
        addressLine1: '\u00a0 test\t\n address\u2003',
        city: '\uFEFFchennai ',
        country: 'india',
      },
    });
    // A genuinely different Retail Store (same Distributor, same address
    // text) \u2014 must be excluded on store identity alone.
    const differentStore = await createTestRetailStore(f.stock.distributorId);
    const different = await prisma.saleOrderDestination.create({
      data: { ...destination, id: createId(), retailStoreId: differentStore.id, storeCode: differentStore.code },
    });
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[1] },
      data: { destinationId: equivalent.id },
    });
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[2] },
      data: { destinationId: different.id },
    });
    const otherOrder = await createSingleFactoryApprovedSaleOrder(app, 1);
    const otherDestination = await prisma.saleOrderDestination.findUniqueOrThrow({
      where: { id: otherOrder.saleOrder.destinations[0]!.id },
    });
    await prisma.factoryPackingCarton.update({
      where: { id: f.ids[3] },
      data: { destinationId: otherDestination.id },
    });
    expect(
      (await f.get({ limit: 25, ervePackingListId: listId }).expect(200)).body.data.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([f.ids[1], f.ids[4]]);
    // ISS-100: a Retail Store belongs to exactly one Distributor, so unlike
    // the old address-based key, a matching destinationMatchKey now always
    // implies a matching distributorId — there is no longer a constructible
    // "same key, different Distributor" case to show the distributorId
    // filter alone widening results. What's still meaningful: with ONLY
    // destinationMatchKey cleared (distributorId still active), the
    // Distributor-only filter admits a different Store under the SAME
    // Distributor (f.ids[2]) while still excluding a different Distributor
    // entirely (f.ids[3]).
    await prisma.ervePackingList.update({
      where: { id: listId },
      data: { destinationMatchKey: null },
    });
    expect(
      (await f.get({ limit: 25, ervePackingListId: listId }).expect(200)).body.data.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([f.ids[1], f.ids[2], f.ids[4]]);
    await prisma.ervePackingList.update({
      where: { id: listId },
      data: { distributorId: null, destinationMatchKey: null },
    });
    expect(
      (await f.get({ limit: 25, ervePackingListId: listId }).expect(200)).body.data.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual(f.ids.slice(1));
    // Discovery can include legacy candidates; adding still enforces existing mutation rules.
    await request(app)
      .post(`/erve-packing-lists/${listId}/cartons`)
      .set('Authorization', `Bearer ${f.merchToken}`)
      .send({ cartonIds: [f.ids[1], f.ids[2]] })
      .expect(409);
  });

  it('rechecks eligibility after hydration and never hydrates the entire candidate batch', async () => {
    const f = await fixture(40);
    const original = prisma.factoryPackingCarton.findMany.bind(prisma.factoryPackingCarton);
    const find = vi.spyOn(prisma.factoryPackingCarton, 'findMany');
    find.mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      await prisma.factoryPackingCarton.update({
        where: { id: f.ids[0] },
        data: { retiredAt: new Date() },
      });
      return original(...args);
    }) as typeof original);
    try {
      const page = (await f.get({ limit: 2 }).expect(200)).body.data;
      expect(page.items.map((c: { id: string }) => c.id)).toEqual([f.ids[1]]);
      expect(find).toHaveBeenCalledTimes(1);
      expect(find.mock.calls[0]?.[0]?.where?.id).toEqual({ in: f.ids.slice(0, 2) });
      const next = (await f.get({ limit: 2, cursor: page.pageInfo.nextCursor }).expect(200)).body
        .data;
      expect(next.items.map((c: { id: string }) => c.id)).toEqual(f.ids.slice(2, 4));
    } finally {
      find.mockRestore();
    }
  });

  it.each(['SENIOR_MANAGEMENT', 'FACTORY_USER', 'DISTRIBUTOR', 'QA_USER', 'ACCOUNTANT'] as const)(
    'denies discovery to %s',
    async (role) => {
      const { token } = await createRoleToken(role);
      await request(app)
        .get('/erve-packing-lists/eligible-cartons')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 25 })
        .expect(403);
    },
  );

  it.each(['retired', 'stale-audit', 'future-audit', 'empty', 'draft'] as const)(
    'mutation reload rejects a discovered carton that becomes %s',
    async (change) => {
      const f = await fixture(3);
      const listId = await f.createList();
      expect(
        (await f.get({ limit: 25 }).expect(200)).body.data.items.map((c: { id: string }) => c.id),
      ).toContain(f.ids[2]);
      const cartonId = f.ids[2]!;
      if (change === 'retired')
        await prisma.factoryPackingCarton.update({
          where: { id: cartonId },
          data: { retiredAt: new Date() },
        });
      if (change === 'stale-audit')
        await prisma.factoryPackingCarton.update({ where: { id: cartonId }, data: { version: 2 } });
      if (change === 'future-audit')
        await prisma.factoryPackingCartonAudit.create({
          data: {
            id: createId(),
            cartonId,
            cartonVersion: 2,
            inspectedById: f.original.audits[0]!.inspectedById,
          },
        });
      if (change === 'empty')
        await prisma.factoryPackingCartonLine.deleteMany({ where: { cartonId } });
      if (change === 'draft')
        await prisma.factoryDispatch.update({
          where: { id: f.dispatch.id },
          data: { status: 'DRAFT' },
        });
      for (const path of ['/erve-packing-lists', `/erve-packing-lists/${listId}/cartons`]) {
        await request(app)
          .post(path)
          .set('Authorization', `Bearer ${f.merchToken}`)
          .send({ cartonIds: [cartonId] })
          .expect(400);
      }
      expect(
        (await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: cartonId } }))
          .ervePackingListId,
      ).toBeNull();
    },
  );

  it('guards competing additions to two OPEN lists with exactly one successful claim', async () => {
    const f = await fixture(3);
    const listA = await f.createList();
    const listB = (
      await request(app)
        .post('/erve-packing-lists')
        .set('Authorization', `Bearer ${f.merchToken}`)
        .send({ cartonIds: [f.ids[1]] })
        .expect(201)
    ).body.data.id;
    const attempts = await Promise.all(
      [listA, listB].map((id) =>
        request(app)
          .post(`/erve-packing-lists/${id}/cartons`)
          .set('Authorization', `Bearer ${f.merchToken}`)
          .send({ cartonIds: [f.ids[2]] }),
      ),
    );
    expect(attempts.map((res) => res.status).sort()).toEqual([200, 409]);
    expect([listA, listB]).toContain(
      (await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: f.ids[2] } }))
        .ervePackingListId,
    );
  });
});
