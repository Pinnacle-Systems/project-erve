import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestDistributor, resetDatabase } from '../../test/helpers.js';
import {
  createRoleToken,
  createFactoryUserToken,
  packAndFinalize,
  consolidateAndDispatch,
} from '../fulfillment/fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
const storeFields = {
  code: 'SAME',
  name: 'Retail Store',
  addressLine1: '12 Market Road',
  addressLine2: 'Floor 2',
  city: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  postalCode: '600001',
  contactName: 'Manager',
  contactPhone: '9876543210',
  contactEmail: 'store@example.com',
  gstin: '22AAAAA0000A1Z5',
};
const manual = { addressLine1: 'Legacy Road', city: 'Chennai', state: 'TN', country: 'India' };
async function fixture() {
  const stock = await createReleasedQaStock({ quantity: 100 });
  const { token } = await createRoleToken('MERCHANDISER');
  const store = (
    await request(app)
      .post('/retail-stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...storeFields, distributorId: stock.distributorId })
      .expect(201)
  ).body.data;
  const payload = {
    factoryId: stock.factoryId,
    soDate: '2026-06-30',
    distributors: [
      {
        clientKey: 'g1',
        distributorId: stock.distributorId,
        destinations: [{ ...manual, clientKey: 'd1', retailStoreId: store.id }],
      },
    ],
    lines: [
      { destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity: 20 },
    ],
  };
  return { stock, token, store, payload };
}
const create = (token: string, payload: object) =>
  request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send(payload);
const patch = (token: string, id: string, payload: object) =>
  request(app)
    .patch(`/sale-orders/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send(payload);

describe('DEMO-014 Distributor-owned Store destination snapshots', () => {
  it('captures every master field on selection, ignoring stale/client-supplied address data', async () => {
    const f = await fixture();
    const order = (await create(f.token, f.payload).expect(201)).body.data;
    expect(order.distributorGroups[0].destinations[0]!).toMatchObject({
      retailStoreId: f.store.id,
      storeCode: storeFields.code,
      label: storeFields.name,
      addressLine1: storeFields.addressLine1,
      addressLine2: storeFields.addressLine2,
      city: storeFields.city,
      state: storeFields.state,
      country: storeFields.country,
      postalCode: storeFields.postalCode,
      gstin: storeFields.gstin,
      contactName: storeFields.contactName,
      contactPhone: storeFields.contactPhone,
      contactEmail: storeFields.contactEmail,
    });
    const replayKey = createId();
    const first = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', replayKey)
      .send(f.payload)
      .expect(201);
    await prisma.retailStore.update({ where: { id: f.store.id }, data: { status: 'INACTIVE' } });
    const replay = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', replayKey)
      .send(f.payload)
      .expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
  });

  it('rejects cross-Distributor, nonexistent and inactive Store references without allocating stock', async () => {
    const f = await fixture();
    const other = await createTestDistributor();
    f.payload.distributors[0]!.distributorId = other.id;
    await create(f.token, f.payload).expect(400);
    f.payload.distributors[0]!.distributorId = f.stock.distributorId;
    f.payload.distributors[0]!.destinations[0]!.retailStoreId = 'missing';
    await create(f.token, f.payload).expect(400);
    f.payload.distributors[0]!.destinations[0]!.retailStoreId = f.store.id;
    await prisma.retailStore.update({ where: { id: f.store.id }, data: { status: 'INACTIVE' } });
    await create(f.token, f.payload).expect(400);
    expect(await prisma.saleOrder.count()).toBe(0);
    expect(await prisma.stockAllocation.count()).toBe(0);
  });

  it('retains inactive references and historical snapshots after Store edits, and permits explicit authorized corrections', async () => {
    const f = await fixture();
    const order = (await create(f.token, f.payload).expect(201)).body.data;
    const dest = order.distributorGroups[0].destinations[0]!;
    await request(app)
      .patch(`/retail-stores/${f.store.id}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({
        name: 'Changed Store',
        code: 'CHANGED',
        addressLine1: 'Changed Road',
        status: 'INACTIVE',
      })
      .expect(200);
    expect(
      (
        await request(app)
          .get(`/sale-orders/${order.id}`)
          .set('Authorization', `Bearer ${f.token}`)
          .expect(200)
      ).body.data.distributorGroups[0].destinations[0]!,
    ).toEqual(dest);
    const edit = {
      expectedVersion: order.version,
      distributors: [
        {
          ...f.payload.distributors[0]!,
          id: order.distributorGroups[0].id,
          destinations: [{ ...dest, clientKey: 'd1' }],
        },
      ],
      lines: [{ ...f.payload.lines[0]!, id: order.lines[0]!.id }],
    };
    const saved = (await patch(f.token, order.id, edit).expect(200)).body.data;
    expect(saved.distributorGroups[0].destinations[0]!).toEqual(dest);
    edit.expectedVersion = saved.version;
    edit.distributors[0]!.destinations[0]!.addressLine1 = 'Explicit correction';
    const corrected = (await patch(f.token, order.id, edit).expect(200)).body.data;
    expect(corrected.distributorGroups[0].destinations[0]!).toMatchObject({
      storeCode: 'SAME',
      label: 'Retail Store',
      addressLine1: 'Explicit correction',
      retailStoreId: f.store.id,
    });
    // Reselecting the same active Store is an explicit refresh; ordinary edits above never refresh it.
    await request(app)
      .patch(`/retail-stores/${f.store.id}/status`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const refresh = {
      ...edit,
      expectedVersion: corrected.version,
      distributors: [
        {
          ...edit.distributors[0]!,
          destinations: [{ ...edit.distributors[0]!.destinations[0]!, refreshStoreSnapshot: true }],
        },
      ],
    };
    const refreshed = (await patch(f.token, order.id, refresh).expect(200)).body.data;
    expect(refreshed.distributorGroups[0].destinations[0]).toMatchObject({
      storeCode: 'CHANGED',
      label: 'Changed Store',
      addressLine1: 'Changed Road',
    });
    await expect(prisma.retailStore.delete({ where: { id: f.store.id } })).rejects.toThrow();
    const anotherOwner = await createTestDistributor();
    await expect(
      prisma.retailStore.update({
        where: { id: f.store.id },
        data: { distributorId: anotherOwner.id },
      }),
    ).rejects.toThrow();
  });

  it('keeps legacy destinations without Store references and distinct same-code Stores across Distributor groups', async () => {
    const f = await fixture();
    const legacy = structuredClone(f.payload);
    delete (legacy.distributors[0]!.destinations[0]! as { retailStoreId?: string }).retailStoreId;
    const oldOrder = (await create(f.token, legacy).expect(201)).body.data;
    expect(oldOrder.distributorGroups[0].destinations[0]!).toMatchObject({
      retailStoreId: null,
      storeCode: null,
      addressLine1: 'Legacy Road',
    });
    const b = await createTestDistributor();
    const storeB = (
      await request(app)
        .post('/retail-stores')
        .set('Authorization', `Bearer ${f.token}`)
        .send({ ...storeFields, distributorId: b.id })
        .expect(201)
    ).body.data;
    f.payload.distributors.push({
      clientKey: 'g2',
      distributorId: b.id,
      destinations: [{ ...manual, clientKey: 'd2', retailStoreId: storeB.id }],
    });
    f.payload.lines.push({ ...f.payload.lines[0]!, destinationClientKey: 'd2' });
    const order = (await create(f.token, f.payload).expect(201)).body.data;
    expect(
      order.distributorGroups.map((g: { distributor: { id: string } }) => g.distributor.id),
    ).toEqual([f.stock.distributorId, b.id]);
    expect(order.distributorGroups[0].destinations[0]!.retailStoreId).toBe(f.store.id);
    expect(order.distributorGroups[1].destinations[0]!.retailStoreId).toBe(storeB.id);
    const edit = {
      expectedVersion: order.version,
      distributors: order.distributorGroups.map(
        (
          g: {
            id: string;
            distributor: { id: string };
            destinations: Array<{ id: string; retailStoreId: string }>;
          },
          i: number,
        ) => ({
          id: g.id,
          clientKey: `g${i + 1}`,
          distributorId: g.distributor.id,
          destinations: g.destinations.map((d) => ({
            ...d,
            clientKey: `d${i + 1}`,
            ...(i === 1 ? { retailStoreId: f.store.id } : {}),
          })),
        }),
      ),
      lines: order.lines.map(
        (l: { id: string; styleId: string; sizeId: string; quantity: number }, i: number) => ({
          ...l,
          destinationClientKey: `d${i + 1}`,
        }),
      ),
    };
    await patch(f.token, order.id, edit).expect(400);
  });

  it('carries the snapshot through packing, audit, Erve consolidation/dispatch and invoice handoff without live Store reads', async () => {
    const f = await fixture();
    const order = (await create(f.token, f.payload).expect(201)).body.data;
    const dest = order.distributorGroups[0].destinations[0]!;
    const factoryToken = await createFactoryUserToken(f.stock.factoryId);
    const packed = await packAndFinalize(
      app,
      factoryToken,
      order.id,
      order.lines[0]!.id,
      dest.id,
      20,
    );
    await request(app)
      .patch(`/retail-stores/${f.store.id}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ name: 'Changed', addressLine1: 'New address', city: 'Mumbai', status: 'INACTIVE' })
      .expect(200);
    const packing = await request(app)
      .get(`/sale-orders/${order.id}/packing-list`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .expect(200);
    expect(packing.body.data.destinations[0]!).toMatchObject({
      distributor: { id: f.stock.distributorId },
      retailStoreId: f.store.id,
      label: storeFields.name,
      addressLine1: storeFields.addressLine1,
      contactEmail: storeFields.contactEmail,
    });
    const dispatch = await consolidateAndDispatch(app, f.token, [packed.cartonId]);
    const list = await prisma.ervePackingList.findUniqueOrThrow({
      where: { id: dispatch.ervePackingList.id },
    });
    expect(list).toMatchObject({
      distributorId: f.stock.distributorId,
      originDestinationId: dest.id,
      destinationLabel: storeFields.name,
      destinationStoreCode: storeFields.code,
      destinationGstin: storeFields.gstin,
      destinationAddressLine1: storeFields.addressLine1,
      destinationPostalCode: storeFields.postalCode,
      destinationContactEmail: storeFields.contactEmail,
    });
    expect(await prisma.invoiceHandoff.count({ where: { erveDispatchId: dispatch.id } })).toBe(1);
    const detail = await request(app).get(`/erve-dispatches/${dispatch.id}`).set('Authorization', `Bearer ${f.token}`).expect(200);
    expect(detail.body.data.destination).toMatchObject({ storeCode: storeFields.code, gstin: storeFields.gstin, label: storeFields.name, addressLine1: storeFields.addressLine1 });
    await patch(f.token, order.id, {
      expectedVersion: 0,
      remarks: 'Cannot edit after Factory Dispatch',
    }).expect(400);
    await request(app)
      .patch(`/retail-stores/${f.store.id}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ addressLine1: 'Another master edit' })
      .expect(200);
    expect(
      (await prisma.ervePackingList.findUniqueOrThrow({ where: { id: list.id } }))
        .destinationAddressLine1,
    ).toBe(storeFields.addressLine1);
  });
});
