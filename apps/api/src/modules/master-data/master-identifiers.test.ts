import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma, type Prisma } from '../../db/prisma.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { createDistributor, createFactory, updateDistributor } from './master-data.service.js';
import { createRetailStore } from './retail-stores.service.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function admin() {
  const auth = await createTestUserAndToken({
    email: `${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const actor = toCurrentUser(
    await prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: currentUserSelect }),
  );
  return { ...auth, actor };
}
const distributorFields = {
  name: 'North Traders',
  gstin: '27AAAAA0000A1Z5',
  purchaseMode: 'OUTRIGHT' as const,
};
const storeFields = {
  name: 'Market Store',
  addressLine1: '12 Market Road',
  city: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  postalCode: '600001',
  status: 'ACTIVE' as const,
};

describe('server-owned ordinary master identifiers', () => {
  it.each(['factories', 'distributors', 'retail-stores'] as const)(
    'accepts omitted codes and ignores legacy overrides for %s',
    async (route) => {
      const { token } = await admin();
      const owner = await createTestDistributor();
      const fields =
        route === 'factories'
          ? { name: 'Mill One' }
          : route === 'distributors'
            ? distributorFields
            : { ...storeFields, distributorId: owner.id };
      const prefix = route === 'factories' ? 'FAC' : route === 'distributors' ? 'DST' : 'STR';
      const first = await request(app)
        .post(`/${route}`)
        .set('Authorization', `Bearer ${token}`)
        .send(fields)
        .expect(201);
      expect(first.body.data.code).toBe(`${prefix}-000001`);
      const second = await request(app)
        .post(`/${route}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...fields, name: 'Second Record', code: 'ARBITRARY-CALLER-CODE' })
        .expect(201);
      expect(second.body.data.code).toBe(`${prefix}-000002`);
    },
  );

  it.each(['factories', 'distributors', 'retail-stores'] as const)(
    'keeps existing %s codes immutable and accepts same-code updates',
    async (route) => {
      const { token } = await admin();
      const owner = await createTestDistributor();
      const record =
        route === 'factories'
          ? await createTestFactory({ code: 'LEGACY-F' })
          : route === 'distributors'
            ? owner
            : await prisma.retailStore.create({
                data: { id: createId(), distributorId: owner.id, code: 'LEGACY-S', ...storeFields },
              });
      await request(app)
        .patch(`/${route}/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: record.code, contactName: 'Updated Contact' })
        .expect(200);
      await request(app)
        .patch(`/${route}/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'NEW-CODE', contactName: 'Rejected Contact' })
        .expect(400);
      const loaded = await request(app)
        .get(`/${route}/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(loaded.body.data).toMatchObject({ code: record.code, contactName: 'Updated Contact' });
    },
  );

  it('allows normalized Distributor name once per purchase mode and protects direct service mode updates', async () => {
    const { actor } = await admin();
    const first = await createDistributor(actor, { ...distributorFields, code: 'OLD-A' });
    const other = await createDistributor(actor, {
      ...distributorFields,
      purchaseMode: 'SALE_RETURN',
      code: 'OLD-B',
    });
    expect(other.id).not.toBe(first.id);
    await expect(
      createDistributor(actor, { ...distributorFields, name: ' NORTH   traders ', code: 'OLD-C' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      updateDistributor(actor, first.id, { purchaseMode: 'SALE_RETURN' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await updateDistributor(actor, first.id, {
      purchaseMode: 'OUTRIGHT',
      name: 'North Traders Renamed',
    });
    expect(
      (await prisma.distributor.findUniqueOrThrow({ where: { id: first.id } })).purchaseMode,
    ).toBe('OUTRIGHT');
  });

  it('enforces mode-aware normalized names on direct DB writes and rename', async () => {
    const { actor } = await admin();
    await createTestDistributor({ name: 'Acme   Distribution', code: 'LEGACY-A' });
    await expect(
      createTestDistributor({ name: ' acme distribution ', code: 'LEGACY-B' }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const second = await createTestDistributor({ name: 'Other Company', code: 'LEGACY-C' });
    await expect(
      updateDistributor(actor, second.id, { name: ' ACME distribution ' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allocates distinct serials concurrently for all master namespaces', async () => {
    const { actor } = await admin();
    const owner = await createTestDistributor();
    const [factories, distributors, stores] = await Promise.all([
      Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          createFactory(actor, { name: `Mill ${index}`, code: 'IGNORED' }),
        ),
      ),
      Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          createDistributor(actor, {
            ...distributorFields,
            name: `Traders ${index}`,
            code: 'IGNORED',
          }),
        ),
      ),
      Promise.all(
        Array.from({ length: 8 }, () =>
          createRetailStore(actor, { ...storeFields, distributorId: owner.id, code: 'IGNORED' }),
        ),
      ),
    ]);
    for (const [records, prefix] of [
      [factories, 'FAC'],
      [distributors, 'DST'],
      [stores, 'STR'],
    ] as const) {
      expect(records.map((record) => record.code).sort()).toEqual(
        Array.from({ length: 8 }, (_, index) => `${prefix}-00000${index + 1}`),
      );
    }
    expect(await prisma.auditLog.count()).toBe(24);
    expect(await prisma.documentSequence.count()).toBe(0);
  });

  it('skips existing generated-looking codes and never reissues deleted allocated serials', async () => {
    const { actor } = await admin();
    await createTestFactory({ code: 'FAC-000042', name: 'Legacy Mill' });
    const next = await createFactory(actor, { name: 'New Mill', code: 'FAC-000042' });
    expect(next.code).toBe('FAC-000043');
    await prisma.factory.delete({ where: { id: next.id } });
    expect((await createFactory(actor, { name: 'Another Mill', code: 'OTHER' })).code).toBe(
      'FAC-000044',
    );
    expect((await prisma.factory.findFirstOrThrow({ where: { name: 'Legacy Mill' } })).code).toBe(
      'FAC-000042',
    );
  });

  it('preserves sealed historical Factory codes only through an explicit ADMIN option', async () => {
    const { actor } = await admin();
    const legacy = await createFactory(actor, { name: 'Historical Mill', code: 'IGNORED' }, { legacyImportCode: 'FAC-999999' });
    expect(legacy.code).toBe('FAC-999999');
    await expect(createFactory({ ...actor, roles: ['MERCHANDISER'] }, { name: 'Forbidden Mill' }, { legacyImportCode: 'LEGACY-F' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(createFactory(actor, { name: 'Duplicate Legacy Mill' }, { legacyImportCode: 'FAC-999999' })).rejects.toMatchObject({ statusCode: 409 });
    await prisma.factory.delete({ where: { id: legacy.id } });
    expect((await createFactory(actor, { name: 'Ordinary Mill', code: 'FAC-999999' })).code).toBe('FAC-1000000');
    expect(await prisma.factory.count()).toBe(1);
  });

  it.each(['factory', 'distributor'] as const)(
    'rolls back %s creation when its audit actor is invalid',
    async (kind) => {
      const { actor } = await admin();
      const invalidActor = { ...actor, id: 'missing-audit-actor' };
      await expect(
        kind === 'factory'
          ? createFactory(invalidActor, { name: 'Audit Mill', code: 'IGNORED' })
          : createDistributor(invalidActor, { ...distributorFields, code: 'IGNORED' }),
      ).rejects.toBeDefined();
      expect(await prisma.factory.count()).toBe(0);
      expect(await prisma.distributor.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.masterCodeCounter.count()).toBe(0);
    },
  );

  it.each(['factory', 'distributor', 'store'] as const)(
    'rolls back %s, audit and counter when provenance fails',
    async (kind) => {
      const { actor } = await admin();
      const owner = await createTestDistributor();
      const options = {
        onCreatedInTransaction: async (
          tx: Prisma.TransactionClient,
          created: { id: string; code: string },
        ) => {
          expect(created.code).toMatch(/^(FAC|DST|STR)-000001$/);
          expect(await tx.auditLog.count({ where: { entityId: created.id } })).toBe(1);
          await tx.auditLog.create({
            data: {
              id: createId(),
              actorId: actor.id,
              entityId: created.id,
              entityType: 'ImportSource',
              action: 'PROVENANCE',
            },
          });
          throw new Error('Injected provenance failure');
        },
      };
      const create = () =>
        kind === 'factory'
          ? createFactory(actor, { name: 'Rollback Mill', code: 'IGNORED' }, options)
          : kind === 'distributor'
            ? createDistributor(actor, { ...distributorFields, code: 'IGNORED' }, options)
            : createRetailStore(
                actor,
                { ...storeFields, distributorId: owner.id, code: 'IGNORED' },
                options,
              );
      await expect(create()).rejects.toThrow('Injected provenance failure');
      expect(await prisma.factory.count()).toBe(0);
      expect(await prisma.distributor.count()).toBe(1);
      expect(await prisma.retailStore.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.masterCodeCounter.count()).toBe(0);
    },
  );
});
