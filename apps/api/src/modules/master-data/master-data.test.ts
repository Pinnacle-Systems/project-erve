import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUser,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { assertProcessFlowVersionMutable } from './master-data.service.js';
import { toCompactFinancialYearCode } from './financial-year.util.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSize(code = 'AGE_3') {
  return prisma.size.create({
    data: { id: createId(), code, label: code.replace('_', ' '), sizeType: 'AGE', sortOrder: 3 },
  });
}

async function createActiveSeason(
  overrides?: Partial<{ code: string; name: string; financialYearId: string }>,
) {
  const suffix = createId().slice(-6);
  const financialYear = await createTestFinancialYear();
  return prisma.season.create({
    data: {
      id: createId(),
      code: `T-${suffix}`,
      name: `Test Season ${suffix}`,
      financialYearId: financialYear.id,
      ...overrides,
    },
  });
}

async function createStyle(token: string, overrides?: Record<string, unknown>) {
  const season = await createActiveSeason();
  return request(app)
    .post('/styles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      styleNumber: 'ST-001',
      styleName: 'Boys Regular T-Shirt',
      finalMrp: 849,
      hsnCode: '61091000',
      royaltyPercentage: 12,
      seasonId: season.id,
      ...overrides,
    });
}

describe('styles API', () => {
  it('allows ADMIN and MERCHANDISER to create styles', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { token: merchandiserToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });

    const adminRes = await createStyle(adminToken, { styleNumber: 'ST-ADMIN' });
    const merchRes = await createStyle(merchandiserToken, { styleNumber: 'ST-MERCH' });

    expect(adminRes.status).toBe(201);
    expect(merchRes.status).toBe(201);
    expect(adminRes.body.data.hsnCode).toBe('61091000');
  });

  it('rejects unauthorized roles from creating styles', async () => {
    const { token } = await createTestUserAndToken({
      email: 'qa@test.local',
      password: 'qa-password',
      roles: ['QA_USER'],
    });

    const res = await createStyle(token);

    expect(res.status).toBe(403);
  });

  it('validates style number uniqueness and monetary fields', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const created = await createStyle(token);
    expect(created.status).toBe(201);

    const duplicate = await createStyle(token);
    const badMrp = await createStyle(token, { styleNumber: 'ST-002', finalMrp: 0 });
    const badRoyalty = await createStyle(token, { styleNumber: 'ST-003', royaltyPercentage: 101 });

    expect(duplicate.status).toBe(409);
    expect(badMrp.status).toBe(400);
    expect(badRoyalty.status).toBe(400);
  });

  it('rejects a non-8-digit HSN and accepts a valid 8-digit HSN, preserving leading zeroes', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const tooShort = await createStyle(token, { styleNumber: 'ST-HSN-1', hsnCode: '6109100' });
    const tooLong = await createStyle(token, { styleNumber: 'ST-HSN-2', hsnCode: '610910001' });
    const nonNumeric = await createStyle(token, { styleNumber: 'ST-HSN-3', hsnCode: '6109100A' });
    const leadingZero = await createStyle(token, {
      styleNumber: 'ST-HSN-4',
      hsnCode: '06091000',
    });

    expect(tooShort.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(nonNumeric.status).toBe(400);
    expect(leadingZero.status).toBe(201);
    expect(leadingZero.body.data.hsnCode).toBe('06091000');

    const updated = await request(app)
      .patch(`/styles/${leadingZero.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hsnCode: '1234567' });
    expect(updated.status).toBe(400);
  });

  it('adds and removes style sizes without allowing duplicates', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const size = await createSize();
    const style = await createStyle(token).then((res) => res.body.data);

    const added = await request(app)
      .post(`/styles/${style.id}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: size.id });
    const duplicate = await request(app)
      .post(`/styles/${style.id}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: size.id });
    const removed = await request(app)
      .delete(`/styles/${style.id}/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(added.status).toBe(200);
    expect(added.body.data.sizes).toHaveLength(1);
    expect(duplicate.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(removed.body.data.sizes).toHaveLength(0);
  });

  it('adds and removes style factory mappings without allowing duplicates', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const factory = await createTestFactory({ code: 'FAC-001', name: 'Acme Factory' });
    const style = await createStyle(token).then((res) => res.body.data);

    const added = await request(app)
      .post(`/styles/${style.id}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id, exFactoryPrice: 188 });
    const duplicate = await request(app)
      .post(`/styles/${style.id}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id, exFactoryPrice: 188 });
    const removed = await request(app)
      .delete(`/styles/${style.id}/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(added.status).toBe(200);
    expect(added.body.data.factories).toHaveLength(1);
    expect(duplicate.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(removed.body.data.factories).toHaveLength(0);
  });

  // UXAUTH-013 regression: the Price List option-lookup endpoints exist so
  // ACCOUNTANT never needs direct access to this master. That fix only holds
  // if this denial actually stays in place, so lock it in here.
  it.each([
    ['ADMIN', 200],
    ['MERCHANDISER', 200],
    ['SENIOR_MANAGEMENT', 200],
    ['FACTORY_USER', 403],
    ['QA_USER', 403],
    ['ACCOUNTANT', 403],
  ] as const)('applies the Style master read authorization matrix for %s', async (role, expectedStatus) => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'style-read-admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const style = await createStyle(adminToken).then((res) => res.body.data);

    const { token } = await createTestUserAndToken({
      email: `${role.toLowerCase()}-style-read@test.local`,
      password: 'test-password',
      roles: [role],
    });

    const list = await request(app).get('/styles').set('Authorization', `Bearer ${token}`);
    const detail = await request(app)
      .get(`/styles/${style.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(expectedStatus);
    expect(detail.status).toBe(expectedStatus);
  });
});

describe('seasons API', () => {
  it('allows management roles to create, read, update and toggle Seasons', async () => {
    const { token } = await createTestUserAndToken({
      email: 'season-admin@test.local',
      password: 'password',
      roles: ['ADMIN'],
    });
    const financialYear = await createTestFinancialYear();
    const created = await request(app)
      .post('/seasons')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: ' aw-core ', name: ' Autumn/Winter ', financialYearId: financialYear.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: 'AW-CORE',
      name: 'Autumn/Winter',
      financialYear: { id: financialYear.id, code: financialYear.code },
      displayName: `AW-CORE ${toCompactFinancialYearCode(financialYear.code)}`,
    });
    const read = await request(app)
      .get(`/seasons/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    const updated = await request(app)
      .patch(`/seasons/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Autumn Winter' });
    expect(updated.body.data.name).toBe('Autumn Winter');
    const inactive = await request(app)
      .patch(`/seasons/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    expect(inactive.body.data.status).toBe('INACTIVE');
  });

  it('enforces configurable code/year identity and Season-management authorization', async () => {
    const admin = await createTestUserAndToken({
      email: 'season-admin@test.local',
      password: 'password',
      roles: ['ADMIN'],
    });
    const factory = await createTestUserAndToken({
      email: 'season-factory@test.local',
      password: 'password',
      roles: ['FACTORY_USER'],
    });
    const financialYear = await createTestFinancialYear();
    const payload = { code: 'custom-1', name: 'Shared descriptive name', financialYearId: financialYear.id };
    expect(
      (
        await request(app)
          .post('/seasons')
          .set('Authorization', `Bearer ${admin.token}`)
          .send(payload)
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/seasons')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ ...payload, code: 'CUSTOM-2' })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/seasons')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ ...payload, code: 'custom-1' })
      ).status,
    ).toBe(409);

    // The same code is valid again in a *different* Financial Year — this
    // is a code+FY composite identity, not a global code uniqueness rule.
    const otherFinancialYear = await createTestFinancialYear(new Date('2030-06-01'));
    const otherFyRes = await request(app)
      .post('/seasons')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ...payload, code: 'custom-1', financialYearId: otherFinancialYear.id });
    expect(otherFyRes.status).toBe(201);

    const unknownFyRes = await request(app)
      .post('/seasons')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ...payload, code: 'custom-3', financialYearId: 'not-a-real-financial-year-id' });
    expect(unknownFyRes.status).toBe(400);

    expect(
      (
        await request(app)
          .post('/seasons')
          .set('Authorization', `Bearer ${factory.token}`)
          .send(payload)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/seasons')).status).toBe(401);
  });
});

describe('sizes API', () => {
  it('enforces the size-master read policy for direct API requests', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin-sizes@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { token: factoryToken } = await createTestUserAndToken({
      email: 'factory-sizes@test.local',
      password: 'factory-password',
      roles: ['FACTORY_USER'],
    });
    await createSize();

    const allowed = await request(app).get('/sizes').set('Authorization', `Bearer ${adminToken}`);
    const denied = await request(app).get('/sizes').set('Authorization', `Bearer ${factoryToken}`);
    const unauthenticated = await request(app).get('/sizes');

    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toHaveLength(1);
    expect(denied.status).toBe(403);
    expect(denied.body.data).toBeUndefined();
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.data).toBeUndefined();
  });

  it('validates unique size code', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    await request(app)
      .post('/sizes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'AGE_3', label: '3', sizeType: 'AGE', sortOrder: 3 })
      .expect(201);

    const duplicate = await request(app)
      .post('/sizes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'AGE_3', label: 'Three', sizeType: 'AGE', sortOrder: 4 });

    expect(duplicate.status).toBe(409);
  });

  it('returns detail usage, updates safely, changes status, and audits mutations', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const size = await createSize();
    const style = await createStyle(token).then((res) => res.body.data);
    await prisma.styleSize.create({
      data: { id: createId(), styleId: style.id, sizeId: size.id },
    });

    const detail = await request(app)
      .get(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`);
    const updated = await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Age 3 years', sortOrder: 4 });
    const deactivated = await request(app)
      .patch(`/sizes/${size.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    const mapping = await request(app)
      .post(`/styles/${style.id}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: size.id });

    expect(detail.status).toBe(200);
    expect(detail.body.data.usage.styleMappings).toBe(1);
    expect(updated.body.data.label).toBe('Age 3 years');
    expect(deactivated.body.data.status).toBe('INACTIVE');
    expect(mapping.status).toBe(400);
    expect(await prisma.styleSize.count({ where: { sizeId: size.id } })).toBe(1);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: size.id },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['SIZE_UPDATED', 'SIZE_STATUS_CHANGED']),
    );
  });

  it('rejects invalid and unauthorized updates', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { token: qaToken } = await createTestUserAndToken({
      email: 'qa@test.local',
      password: 'qa-password',
      roles: ['QA_USER'],
    });
    const size = await createSize();
    await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sortOrder: 1.5 })
      .expect(400);
    await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ label: 'Nope' })
      .expect(403);
  });

  it('locks identity fields after transactional use while allowing descriptive correction', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const distributor = await createTestDistributor();
    const size = await createSize();
    const style = await createStyle(token).then((res) => res.body.data);
    await prisma.styleSize.create({ data: { id: createId(), styleId: style.id, sizeId: size.id } });
    await request(app)
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        distributorId: distributor.id,
        poDate: '2026-07-17',
        purchaseMode: 'OUTRIGHT',
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      })
      .expect(201);

    await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'AGE_03' })
      .expect(409);
    await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeType: 'ALPHA' })
      .expect(409);
    const correction = await request(app)
      .patch(`/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: '3 years' });
    expect(correction.status).toBe(200);
  });
});

describe('factories API', () => {
  it('validates unique factory code and name', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-001', name: 'Acme Factory' })
      .expect(201);

    const duplicateCode = await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-001', name: 'Other Factory' });
    const duplicateName = await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-002', name: 'Acme Factory' });

    expect(duplicateCode.status).toBe(409);
    expect(duplicateName.status).toBe(409);
  });

  it('returns detail usage, updates, changes status, blocks new style mappings, and audits', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const factory = await createTestFactory({ code: 'FAC-001', name: 'Acme Factory' });
    const style = await createStyle(token).then((res) => res.body.data);
    await prisma.styleFactoryMapping.create({
      data: { id: createId(), styleId: style.id, factoryId: factory.id, exFactoryPrice: 100 },
    });
    const detail = await request(app)
      .get(`/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`);
    const updated = await request(app)
      .patch(`/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ city: 'Bengaluru' });
    await request(app)
      .patch(`/factories/${factory.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const mapping = await request(app)
      .post(`/styles/${style.id}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id, exFactoryPrice: 120 });

    expect(detail.body.data.usage.styleMappings).toBe(1);
    expect(updated.body.data.city).toBe('Bengaluru');
    expect(mapping.status).toBe(400);
    expect(await prisma.styleFactoryMapping.count({ where: { factoryId: factory.id } })).toBe(1);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: factory.id },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['FACTORY_UPDATED', 'FACTORY_STATUS_CHANGED']),
    );
  });

  it.each([
    ['ADMIN', 200],
    ['MERCHANDISER', 200],
    ['FACTORY_USER', 403],
    ['QA_USER', 403],
    ['DISTRIBUTOR', 403],
    ['ACCOUNTANT', 403],
    ['SENIOR_MANAGEMENT', 403],
  ] as const)(
    'applies the Factory master read authorization matrix for %s',
    async (role, expectedStatus) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}-factory-read@test.local`,
        password: 'test-password',
        roles: [role],
      });
      const factory = await createTestFactory();

      const list = await request(app).get('/factories').set('Authorization', `Bearer ${token}`);
      const detail = await request(app)
        .get(`/factories/${factory.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(list.status).toBe(expectedStatus);
      expect(detail.status).toBe(expectedStatus);
    },
  );

  it('FACTORY_USER cannot browse the Factory master even when assigned to that factory', async () => {
    const factory = await createTestFactory();
    const { userId, token } = await createTestUserAndToken({
      email: 'assigned-factory-user@test.local',
      password: 'test-password',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({ data: { id: createId(), userId, factoryId: factory.id } });

    const list = await request(app).get('/factories').set('Authorization', `Bearer ${token}`);
    const detail = await request(app)
      .get(`/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
  });
});

describe('process flow API', () => {
  async function createManager(role: 'ADMIN' | 'MERCHANDISER' = 'ADMIN') {
    return createTestUserAndToken({
      email: `${role.toLowerCase()}@test.local`,
      password: 'test-password',
      roles: [role],
    });
  }

  function createFlow(token: string, suffix = '', overrides?: Record<string, unknown>) {
    return request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: `PROD${suffix}`,
        name: `Production${suffix}`,
        description: 'Main production flow',
        stages: [
          { sequence: 1, name: 'Cutting' },
          { sequence: 2, name: 'Sewing' },
        ],
        ...overrides,
      });
  }

  async function holdProcessFlowLock(processFlowId: string) {
    let signalAcquired!: () => void;
    let signalRelease!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    const transaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow:' || ${processFlowId}, 0))::text`;
        signalAcquired();
        await release;
      },
      { timeout: 10_000 },
    );

    await acquired;
    return async () => {
      signalRelease();
      await transaction;
    };
  }

  async function waitForAdvisoryLockWaiters(expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [result] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%pg_advisory_xact_lock%'
      `;
      if (Number(result?.count ?? 0) >= expected) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expected} advisory-lock waiter(s)`);
  }

  it('creates a flow with an initial draft, normalizes stages, and records an audit log', async () => {
    const { token, userId } = await createManager('MERCHANDISER');
    const response = await createFlow(token).expect(201);
    const flow = response.body.data;
    const version = await request(app)
      .get(`/process-flow-versions/${flow.versions[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(flow.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT' });
    expect(
      version.body.data.stages.map((stage: { sequence: number; name: string }) => [
        stage.sequence,
        stage.name,
      ]),
    ).toEqual([
      [1, 'Cutting'],
      [2, 'Sewing'],
    ]);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_CREATED' } }),
    ).toMatchObject({
      actorId: userId,
      entityId: flow.id,
    });
  });

  it('validates creation, rejects duplicate code or name, and enforces mutation roles', async () => {
    const { token } = await createManager();
    await request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '', name: '', stages: [] })
      .expect(400);
    await createFlow(token).expect(201);
    await createFlow(token, '-CODE', {
      code: 'PROD',
      name: 'Other',
      stages: [{ name: 'Cutting' }],
    }).expect(409);
    await createFlow(token, '-NAME', {
      code: 'OTHER',
      name: 'production',
      stages: [{ name: 'Cutting' }],
    }).expect(409);

    const { token: factoryToken } = await createTestUserAndToken({
      email: 'factory@test.local',
      password: 'test-password',
      roles: ['FACTORY_USER'],
    });
    await createFlow(factoryToken, '-FORBIDDEN').expect(403);
    await request(app).post('/process-flows').send({}).expect(401);
  });

  it('creates empty and copied versions without changing source stages', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const sourceId = flow.versions[0].id;

    const empty = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(empty.body.data).toMatchObject({ versionNumber: 2, status: 'DRAFT', stages: [] });

    const copied = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: sourceId })
      .expect(201);
    expect(copied.body.data.versionNumber).toBe(3);
    expect(copied.body.data.stages.map((stage: { name: string }) => stage.name)).toEqual([
      'Cutting',
      'Sewing',
    ]);

    await request(app)
      .put(`/process-flow-versions/${copied.body.data.id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Packing' }] })
      .expect(200);
    const source = await request(app)
      .get(`/process-flow-versions/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(source.body.data.stages.map((stage: { name: string }) => stage.name)).toEqual([
      'Cutting',
      'Sewing',
    ]);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_COPIED' } }),
    ).not.toBeNull();
  });

  it('atomically adds, removes, and reorders draft stages with full-list validation', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const versionId = flow.versions[0].id;

    const replaced = await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Sewing' }, { name: 'Packing' }, { name: 'Cutting' }] })
      .expect(200);
    expect(
      replaced.body.data.stages.map((stage: { sequence: number; name: string }) => [
        stage.sequence,
        stage.name,
      ]),
    ).toEqual([
      [1, 'Sewing'],
      [2, 'Packing'],
      [3, 'Cutting'],
    ]);

    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Cutting' }, { name: ' cutting ' }] })
      .expect(400);
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: '   ' }] })
      .expect(400);
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [
          { sequence: 2, name: 'Cutting' },
          { sequence: 1, name: 'Sewing' },
        ],
      })
      .expect(400);

    const persisted = await prisma.processFlowVersionStage.findMany({
      where: { processFlowVersionId: versionId },
      orderBy: { sequence: 'asc' },
    });
    expect(persisted.map((stage) => stage.name)).toEqual(['Sewing', 'Packing', 'Cutting']);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED' } }),
    ).not.toBeNull();
  });

  it('activates draft process flow versions and retires the previous active version', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const version1 = flow.versions[0];

    await request(app)
      .post(`/process-flow-versions/${version1.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const version2 = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [{ name: 'Cutting' }, { name: 'Sewing' }, { name: 'Packing' }],
      })
      .then((res) => res.body.data);

    await request(app)
      .post(`/process-flow-versions/${version2.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [first, second] = await Promise.all([
      prisma.processFlowVersion.findUniqueOrThrow({ where: { id: version1.id } }),
      prisma.processFlowVersion.findUniqueOrThrow({ where: { id: version2.id } }),
    ]);

    expect(first.status).toBe('RETIRED');
    expect(second.status).toBe('ACTIVE');
    expect(
      await prisma.processFlowVersion.count({
        where: { processFlowId: flow.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_RETIRED' } }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED' } }),
    ).not.toBeNull();
  });

  it('rejects empty activation and makes active and retired stages immutable', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const version1Id = flow.versions[0].id;
    const empty = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .then((response) => response.body.data);
    await request(app)
      .post(`/process-flow-versions/${empty.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app)
      .post(`/process-flow-versions/${version1Id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .put(`/process-flow-versions/${version1Id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Changed' }] })
      .expect(409);

    const version2 = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: version1Id })
      .then((response) => response.body.data);
    await request(app)
      .post(`/process-flow-versions/${version2.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .put(`/process-flow-versions/${version1Id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Changed' }] })
      .expect(409);
  });

  it('serializes concurrent version creation and activation', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const requests = [1, 2].map(() =>
      request(app)
        .post(`/process-flows/${flow.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stages: [{ name: 'Cutting' }] }),
    );
    const results = await Promise.all(requests);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const versionNumbers = await prisma.processFlowVersion.findMany({
      where: { processFlowId: flow.id },
      orderBy: { versionNumber: 'asc' },
      select: { versionNumber: true },
    });
    expect(versionNumbers.map(({ versionNumber }) => versionNumber)).toEqual([1, 2, 3]);

    const draftId = results[0]!.body.data.id;
    const activations = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/process-flow-versions/${draftId}/activate`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(activations.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.processFlowVersion.count({
        where: { processFlowId: flow.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('rejects one of two competing draft activations without retiring the winner', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const previousActiveId = flow.versions[0].id as string;
    await request(app)
      .post(`/process-flow-versions/${previousActiveId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const drafts = await Promise.all(
      ['Packing', 'Dispatch'].map((name) =>
        request(app)
          .post(`/process-flows/${flow.id}/versions`)
          .set('Authorization', `Bearer ${token}`)
          .send({ stages: [{ name }] })
          .expect(201),
      ),
    );
    const draftIds = drafts.map((response) => response.body.data.id as string);

    const releaseLock = await holdProcessFlowLock(flow.id);
    const activationsPromise = Promise.all(
      draftIds.map((draftId) =>
        request(app)
          .post(`/process-flow-versions/${draftId}/activate`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    try {
      await waitForAdvisoryLockWaiters(2);
    } finally {
      await releaseLock();
    }
    const activations = await activationsPromise;

    expect(activations.map(({ status }) => status).sort()).toEqual([200, 409]);
    const winnerId = activations.find(({ status }) => status === 200)!.body.data.id as string;
    const loserId = draftIds.find((draftId) => draftId !== winnerId)!;
    const versions = await prisma.processFlowVersion.findMany({
      where: { processFlowId: flow.id },
      select: { id: true, status: true },
    });
    const statusById = new Map(versions.map((version) => [version.id, version.status]));

    expect(statusById.get(winnerId)).toBe('ACTIVE');
    expect(statusById.get(loserId)).toBe('DRAFT');
    expect(statusById.get(previousActiveId)).toBe('RETIRED');
    expect(versions.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'PROCESS_FLOW_VERSION_ACTIVATED',
          entityId: { in: draftIds },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_VERSION_RETIRED', entityId: previousActiveId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED', entityId: loserId },
      }),
    ).toBe(0);
  });

  it('allows two pre-existing drafts to be activated deliberately in sequence', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    await request(app)
      .post(`/process-flow-versions/${flow.versions[0].id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const draftIds: string[] = [];
    for (const name of ['Packing', 'Dispatch']) {
      const response = await request(app)
        .post(`/process-flows/${flow.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stages: [{ name }] })
        .expect(201);
      draftIds.push(response.body.data.id as string);
    }

    await request(app)
      .post(`/process-flow-versions/${draftIds[0]}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post(`/process-flow-versions/${draftIds[1]}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [first, second] = await Promise.all(
      draftIds.map((draftId) =>
        prisma.processFlowVersion.findUniqueOrThrow({ where: { id: draftId } }),
      ),
    );
    expect(first!.status).toBe('RETIRED');
    expect(second!.status).toBe('ACTIVE');
  });

  it('serializes draft-stage replacement against activation of that draft', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const draftId = flow.versions[0].id as string;
    const replacementStages = [{ name: 'Printing' }, { name: 'Packing' }];

    const releaseLock = await holdProcessFlowLock(flow.id);
    const replacementPromise = request(app)
      .put(`/process-flow-versions/${draftId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: replacementStages });
    const activationPromise = request(app)
      .post(`/process-flow-versions/${draftId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    const resultsPromise = Promise.all([replacementPromise, activationPromise]);
    try {
      await waitForAdvisoryLockWaiters(2);
    } finally {
      await releaseLock();
    }
    const [replacement, activation] = await resultsPromise;

    expect(activation.status).toBe(200);
    expect([200, 409]).toContain(replacement.status);
    const persisted = await prisma.processFlowVersion.findUniqueOrThrow({
      where: { id: draftId },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });
    expect(persisted.status).toBe('ACTIVE');
    const persistedStageNames = persisted.stages.map(({ name }) => name);
    const replacementWon = replacement.status === 200;
    expect(persistedStageNames).toEqual(
      replacementWon ? ['Printing', 'Packing'] : ['Cutting', 'Sewing'],
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED', entityId: draftId },
      }),
    ).toBe(replacementWon ? 1 : 0);
    const activationAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED', entityId: draftId },
    });
    expect(
      (activationAudit.metadata as { stages: Array<{ name: string }> }).stages.map(
        ({ name }) => name,
      ),
    ).toEqual(persistedStageNames);
  });

  it('keeps the partial unique index as an independent single-active backstop', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const firstId = flow.versions[0].id as string;
    const second = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Packing' }] })
      .expect(201);
    const secondId = second.body.data.id as string;

    await prisma.processFlowVersion.update({
      where: { id: firstId },
      data: { status: 'ACTIVE' },
    });
    await expect(
      prisma.processFlowVersion.update({
        where: { id: secondId },
        data: { status: 'ACTIVE' },
      }),
    ).rejects.toThrow();

    expect(
      await prisma.processFlowVersion.findMany({
        where: { processFlowId: flow.id },
        orderBy: { versionNumber: 'asc' },
        select: { status: true },
      }),
    ).toEqual([{ status: 'ACTIVE' }, { status: 'DRAFT' }]);
  });

  it('treats active and retired process flow versions as immutable business objects', () => {
    expect(() => assertProcessFlowVersionMutable('DRAFT')).not.toThrow();
    expect(() => assertProcessFlowVersionMutable('ACTIVE')).toThrow(
      'ACTIVE and RETIRED process flow versions are immutable',
    );
    expect(() => assertProcessFlowVersionMutable('RETIRED')).toThrow(
      'ACTIVE and RETIRED process flow versions are immutable',
    );
  });
});

describe('distributors API', () => {
  async function createAdmin() {
    return createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
  }

  async function createDistributorViaApi(token: string, overrides?: Record<string, unknown>) {
    return request(app)
      .post('/distributors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'DIST-001',
        name: 'Acme Distribution',
        gstin: '27AAAAA0000A1Z5',
        purchaseMode: 'OUTRIGHT',
        contactName: 'Asha Nair',
        contactEmail: 'asha@acme.test',
        city: 'Kochi',
        ...overrides,
      });
  }

  it('allows ADMIN to create a distributor and records an audit log', async () => {
    const { userId, token } = await createAdmin();

    const res = await createDistributorViaApi(token);

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('DIST-001');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.gstin).toBe('27AAAAA0000A1Z5');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_CREATED', entityId: res.body.data.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  });

  it.each([
    ['ADMIN', 201, 200],
    ['MERCHANDISER', 201, 200],
    ['FACTORY_USER', 403, 403],
    ['QA_USER', 403, 403],
    ['DISTRIBUTOR', 403, 403],
  ] as const)(
    'applies distributor mutation permissions for %s',
    async (role, expectedCreateStatus, expectedUpdateStatus) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}@test.local`,
        password: 'test-password',
        roles: [role],
      });
      const distributor = await createTestDistributor();

      const created = await createDistributorViaApi(token);
      const updated = await request(app)
        .patch(`/distributors/${distributor.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed' });
      const statusChanged = await request(app)
        .patch(`/distributors/${distributor.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'INACTIVE' });

      expect(created.status).toBe(expectedCreateStatus);
      expect(updated.status).toBe(expectedUpdateStatus);
      expect(statusChanged.status).toBe(expectedUpdateStatus);
    },
  );

  // UXAUTH-013 regression: the Price List option-lookup endpoints exist so
  // ACCOUNTANT never needs direct access to this master. That fix only holds
  // if this denial actually stays in place, so lock it in here. DISTRIBUTOR
  // is excluded — it is self-scoped to its own mapped record rather than
  // uniformly allowed or denied, and is covered by the dedicated
  // distributor-scoping tests elsewhere in this file.
  it.each([
    ['ADMIN', 200],
    ['MERCHANDISER', 200],
    ['SENIOR_MANAGEMENT', 200],
    ['FACTORY_USER', 403],
    ['QA_USER', 403],
    ['ACCOUNTANT', 403],
  ] as const)(
    'applies the Distributor master read authorization matrix for %s',
    async (role, expectedStatus) => {
      const distributor = await createTestDistributor();
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}-distributor-read@test.local`,
        password: 'test-password',
        roles: [role],
      });

      const list = await request(app).get('/distributors').set('Authorization', `Bearer ${token}`);
      const detail = await request(app)
        .get(`/distributors/${distributor.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(list.status).toBe(expectedStatus);
      expect(detail.status).toBe(expectedStatus);
    },
  );

  it('validates required fields and rejects duplicate code or name', async () => {
    const { token } = await createAdmin();

    const created = await createDistributorViaApi(token);
    expect(created.status).toBe(201);

    const missingName = await createDistributorViaApi(token, { code: 'DIST-002', name: '' });
    const duplicateCode = await createDistributorViaApi(token, { name: 'Other Distribution' });
    const duplicateName = await createDistributorViaApi(token, { code: 'DIST-003' });

    expect(missingName.status).toBe(400);
    expect(duplicateCode.status).toBe(409);
    expect(duplicateName.status).toBe(409);
  });

  it('rejects creating a distributor without a valid GSTIN', async () => {
    const { token } = await createAdmin();

    const missingGstin = await createDistributorViaApi(token, {
      code: 'DIST-010',
      name: 'No GSTIN Distribution',
      gstin: undefined,
    });
    const malformedGstin = await createDistributorViaApi(token, {
      code: 'DIST-011',
      name: 'Bad GSTIN Distribution',
      gstin: 'not-a-gstin',
    });

    expect(missingGstin.status).toBe(400);
    expect(malformedGstin.status).toBe(400);
  });

  it('updates a distributor, records an audit log, and rejects unknown ids', async () => {
    const { userId, token } = await createAdmin();
    const distributor = await createTestDistributor({
      code: 'DIST-001',
      name: 'Acme Distribution',
    });

    const updated = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Distribution South', city: 'Chennai', gstin: '29BBBBB1111B1Z6' });
    const unknown = await request(app)
      .patch('/distributors/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Acme Distribution South');
    expect(updated.body.data.city).toBe('Chennai');
    expect(updated.body.data.gstin).toBe('29BBBBB1111B1Z6');
    expect(unknown.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_UPDATED', entityId: distributor.id },
    });
    expect(audit?.actorId).toBe(userId);
  });

  it('requires purchaseMode on create and rejects it entirely on update — immutable even for ADMIN', async () => {
    const { token } = await createAdmin();

    const missingMode = await createDistributorViaApi(token, {
      code: 'DIST-PM-1',
      name: 'No Mode Distribution',
      purchaseMode: undefined,
    });
    expect(missingMode.status).toBe(400);

    const created = await createDistributorViaApi(token, {
      code: 'DIST-PM-2',
      name: 'Sale Return Distribution',
      purchaseMode: 'SALE_RETURN',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.purchaseMode).toBe('SALE_RETURN');

    const updateAttempt = await request(app)
      .patch(`/distributors/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ purchaseMode: 'OUTRIGHT' });
    expect(updateAttempt.status).toBe(400);

    const reloaded = await prisma.distributor.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(reloaded.purchaseMode).toBe('SALE_RETURN');
  });

  it('rejects updating a distributor with a malformed GSTIN', async () => {
    const { token } = await createAdmin();
    const distributor = await createTestDistributor();

    const res = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gstin: 'not-a-gstin' });

    expect(res.status).toBe(400);
  });

  it('rejects renaming a distributor to an existing name', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D1', name: 'Dist One' });
    const second = await createTestDistributor({ code: 'D2', name: 'Dist Two' });

    const res = await request(app)
      .patch(`/distributors/${second.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dist One' });

    expect(res.status).toBe(409);
  });

  it('deactivates and reactivates a distributor with audit metadata', async () => {
    const { token } = await createAdmin();
    const distributor = await createTestDistributor();

    const deactivated = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.status).toBe('INACTIVE');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_STATUS_CHANGED', entityId: distributor.id },
    });
    expect(audit?.metadata).toEqual({ from: 'ACTIVE', to: 'INACTIVE' });

    const reactivated = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });
    expect(reactivated.body.data.status).toBe('ACTIVE');
  });

  it('excludes inactive distributors from status=ACTIVE listing used by the PO form', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D-ACT', name: 'Active Dist' });
    await createTestDistributor({ code: 'D-INA', name: 'Inactive Dist', status: 'INACTIVE' });

    const res = await request(app)
      .get('/distributors')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { code: string }) => d.code)).toEqual(['D-ACT']);
  });

  it('returns each distributor purchaseMode in the list used by the Order Sheet form', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D-OUT', name: 'Alpha Outright', purchaseMode: 'OUTRIGHT' });
    await createTestDistributor({ code: 'D-SOR', name: 'Beta Sale Return', purchaseMode: 'SALE_RETURN' });

    const res = await request(app)
      .get('/distributors')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ code: 'D-OUT', name: 'Alpha Outright', purchaseMode: 'OUTRIGHT' }),
      expect.objectContaining({ code: 'D-SOR', name: 'Beta Sale Return', purchaseMode: 'SALE_RETURN' }),
    ]);
    for (const option of res.body.data) {
      expect(Object.keys(option).sort()).toEqual(
        ['city', 'code', 'contactName', 'id', 'name', 'purchaseMode', 'status'],
      );
    }
  });

  it('supports searching distributors by code or name', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D-100', name: 'North Traders' });
    await createTestDistributor({ code: 'D-200', name: 'South Traders' });

    const res = await request(app)
      .get('/distributors')
      .query({ search: 'north' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('North Traders');
  });

  it('limits DISTRIBUTOR users to their mapped distributor in list and detail', async () => {
    const { userId: distUserId, token: distToken } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const own = await createTestDistributor({ code: 'D-OWN', name: 'Own Dist' });
    const other = await createTestDistributor({ code: 'D-OTHER', name: 'Other Dist' });
    await prisma.userDistributor.create({
      data: { id: createId(), userId: distUserId, distributorId: own.id },
    });

    const list = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${distToken}`);
    const ownDetail = await request(app)
      .get(`/distributors/${own.id}`)
      .set('Authorization', `Bearer ${distToken}`);
    const otherDetail = await request(app)
      .get(`/distributors/${other.id}`)
      .set('Authorization', `Bearer ${distToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([own.id]);
    expect(ownDetail.status).toBe(200);
    expect(otherDetail.status).toBe(403);
  });

  it('fails closed for a DISTRIBUTOR user with no distributor mapping', async () => {
    const { token: distToken } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor();

    const list = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${distToken}`);
    const detail = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${distToken}`);

    expect(list.status).toBe(403);
    expect(list.body.error.message).toBe('No distributor is mapped to your account');
    expect(detail.status).toBe(403);
  });

  it('allows ADMIN and MERCHANDISER to read any distributor detail', async () => {
    const { token: adminToken } = await createAdmin();
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor();

    const adminRes = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const merchRes = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${merchToken}`);

    expect(adminRes.status).toBe(200);
    expect(merchRes.status).toBe(200);
  });

  it('rejects unauthenticated and factory-role access to distributors', async () => {
    const { token: factoryToken } = await createTestUserAndToken({
      email: 'factory@test.local',
      password: 'factory-password',
      roles: ['FACTORY_USER'],
    });
    const distributor = await createTestDistributor();

    const anonymous = await request(app).get('/distributors');
    const factoryList = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${factoryToken}`);
    const factoryDetail = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${factoryToken}`);

    expect(anonymous.status).toBe(401);
    expect(factoryList.status).toBe(403);
    expect(factoryDetail.status).toBe(403);
  });

  it('lists users mapped to a distributor for ADMIN only', async () => {
    const { token: adminToken } = await createAdmin();
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const { userId: distUserId } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor();
    await prisma.userDistributor.create({
      data: { id: createId(), userId: distUserId, distributorId: distributor.id },
    });

    const adminRes = await request(app)
      .get(`/distributors/${distributor.id}/users`)
      .set('Authorization', `Bearer ${adminToken}`);
    const merchRes = await request(app)
      .get(`/distributors/${distributor.id}/users`)
      .set('Authorization', `Bearer ${merchToken}`);
    const unknownRes = await request(app)
      .get('/distributors/does-not-exist/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data).toHaveLength(1);
    expect(adminRes.body.data[0]).toMatchObject({
      id: distUserId,
      email: 'dist@test.local',
      roles: ['DISTRIBUTOR'],
    });
    expect(merchRes.status).toBe(403);
    expect(unknownRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// P1L3 — Distributor lookup
// ---------------------------------------------------------------------------

describe('Distributor lookup — GET /distributors/options (P1L3)', () => {
  async function tokenFor(role: 'ADMIN' | 'MERCHANDISER' | 'SENIOR_MANAGEMENT' | 'ACCOUNTANT' | 'FACTORY_USER' | 'QA_USER') {
    const { token } = await createTestUserAndToken({
      email: `${role.toLowerCase()}-dist-lookup@test.local`,
      password: 'test-password',
      roles: [role],
    });
    return token;
  }

  async function distributorUserToken(distributorId: string) {
    const { userId, token } = await createTestUserAndToken({
      email: 'distributor-dist-lookup@test.local',
      password: 'test-password',
      roles: ['DISTRIBUTOR'],
    });
    await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
    return token;
  }

  function searchOptions(token: string, query: Record<string, string | number>) {
    return request(app).get('/distributors/options').query(query).set('Authorization', `Bearer ${token}`);
  }

  function codes(res: request.Response): string[] {
    return (res.body.data as Array<{ code: string }>).map((option) => option.code).sort();
  }

  it('finds Distributors by partial code and by partial name, case-insensitively', async () => {
    const token = await tokenFor('MERCHANDISER');
    await createTestDistributor({ code: 'KOC-001', name: 'Kerala Kids Wear' });
    await createTestDistributor({ code: 'BLR-002', name: 'Bangalore Apparel' });

    expect(codes(await searchOptions(token, { search: 'koc' }))).toEqual(['KOC-001']);
    expect(codes(await searchOptions(token, { search: 'KIDS wear' }))).toEqual(['KOC-001']);
    expect(codes(await searchOptions(token, { search: 'apparel' }))).toEqual(['BLR-002']);
  });

  it('offers only ACTIVE Distributors and accepts no status override', async () => {
    const token = await tokenFor('ADMIN');
    await createTestDistributor({ code: 'ELIG-ACTIVE', name: 'Eligible Active' });
    await createTestDistributor({ code: 'ELIG-INACTIVE', name: 'Eligible Inactive', status: 'INACTIVE' });

    expect(codes(await searchOptions(token, { search: 'ELIG' }))).toEqual(['ELIG-ACTIVE']);
    expect(codes(await searchOptions(token, { search: 'ELIG', status: 'INACTIVE' }))).toEqual(['ELIG-ACTIVE']);
  });

  it('bounds the result count (default 20, caller limit honoured, over-max rejected)', async () => {
    const token = await tokenFor('ADMIN');
    for (let index = 0; index < 23; index += 1) {
      const suffix = String(index).padStart(2, '0');
      await createTestDistributor({ code: `BULK-${suffix}`, name: `Bulk Distributor ${suffix}` });
    }

    const byDefault = await searchOptions(token, { search: 'Bulk' });
    const noSearch = await searchOptions(token, {});
    const limited = await searchOptions(token, { search: 'Bulk', limit: 3 });
    const overMax = await searchOptions(token, { search: 'Bulk', limit: 51 });

    expect(byDefault.status).toBe(200);
    expect(byDefault.body.data).toHaveLength(20);
    expect(noSearch.body.data).toHaveLength(20);
    expect(codes(limited)).toEqual(['BULK-00', 'BULK-01', 'BULK-02']);
    expect(overMax.status).toBe(400);
  });

  it('returns a slim option — no GSTIN, contacts or address', async () => {
    const token = await tokenFor('ADMIN');
    const distributor = await createTestDistributor({
      code: 'SLIM-01',
      name: 'Slim Distribution',
      purchaseMode: 'SALE_RETURN',
    });

    const res = await searchOptions(token, { search: 'SLIM' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'purchaseMode', 'status']);
    expect(res.body.data[0]).toEqual({
      id: distributor.id,
      code: 'SLIM-01',
      name: 'Slim Distribution',
      status: 'ACTIVE',
      purchaseMode: 'SALE_RETURN',
    });
  });

  it('returns the selected Distributor by id in any status; 404 for an unknown id', async () => {
    const token = await tokenFor('MERCHANDISER');
    const inactive = await createTestDistributor({ code: 'RET-01', name: 'Retired Distribution', status: 'INACTIVE' });

    const res = await request(app).get(`/distributors/options/${inactive.id}`).set('Authorization', `Bearer ${token}`);
    const missing = await request(app).get('/distributors/options/does-not-exist').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: inactive.id,
      code: 'RET-01',
      name: 'Retired Distribution',
      status: 'INACTIVE',
      purchaseMode: 'OUTRIGHT',
    });
    expect(missing.status).toBe(404);
  });

  it('keeps a DISTRIBUTOR user scoped to its own mapped Distributor for search and hydration', async () => {
    const own = await createTestDistributor({ code: 'OWN-01', name: 'Scope Own' });
    const other = await createTestDistributor({ code: 'OTHER-01', name: 'Scope Other' });
    const token = await distributorUserToken(own.id);

    expect(codes(await searchOptions(token, { search: 'Scope' }))).toEqual(['OWN-01']);
    expect(codes(await searchOptions(token, {}))).toEqual(['OWN-01']);
    const ownDetail = await request(app).get(`/distributors/options/${own.id}`).set('Authorization', `Bearer ${token}`);
    const otherDetail = await request(app)
      .get(`/distributors/options/${other.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ownDetail.status).toBe(200);
    expect(otherDetail.status).toBe(403);
  });

  it.each([
    ['ADMIN', 200],
    ['MERCHANDISER', 200],
    ['SENIOR_MANAGEMENT', 200],
    ['ACCOUNTANT', 403],
    ['FACTORY_USER', 403],
    ['QA_USER', 403],
  ] as const)('follows the Distributor view permission for %s', async (role, expectedStatus) => {
    const distributor = await createTestDistributor({ code: 'RBAC-01', name: 'Rbac Distribution' });
    const token = await tokenFor(role);

    expect((await searchOptions(token, { search: 'RBAC' })).status).toBe(expectedStatus);
    const detail = await request(app)
      .get(`/distributors/options/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(expectedStatus);
  });

  it('treats an empty search as the initial options: ACTIVE only, filtered before the limit, name then id (LU0)', async () => {
    const token = await tokenFor('ADMIN');
    // INACTIVE rows sort first by name — they must not consume the limit.
    for (let index = 0; index < 5; index += 1) {
      await createTestDistributor({ code: `INIT-OFF-${index}`, name: `AAA Retired ${index}`, status: 'INACTIVE' });
    }
    const twins = [];
    for (let index = 0; index < 3; index += 1) {
      twins.push(await createTestDistributor({ code: `INIT-TWIN-${index}`, name: 'Bharat Twin' }));
    }
    for (let index = 0; index < 20; index += 1) {
      await createTestDistributor({ code: `INIT-${index}`, name: `Zeta ${String(index).padStart(2, '0')}` });
    }

    const res = await searchOptions(token, { search: '' });

    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ id: string; name: string; status: string }>;
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.status === 'ACTIVE')).toBe(true);
    // Identical names fall back to id order, so the bounded page is stable.
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual(twins.map((twin) => twin.id).sort());
    expect(rows.slice(3).map((row) => row.name)).toEqual(
      Array.from({ length: 17 }, (_, index) => `Zeta ${String(index).padStart(2, '0')}`),
    );
  });

  it("is not swallowed by the '/:id' route", async () => {
    const token = await tokenFor('ADMIN');
    const res = await searchOptions(token, {});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PAG5 — opt-in cursor pagination for the Style and Distributor lists
// ---------------------------------------------------------------------------

describe('Style/Distributor list pagination (PAG5)', () => {
  async function adminToken() {
    const { token } = await createTestUserAndToken({
      email: `admin-${createId().slice(-8)}@test.local`,
      password: 'test-password',
      roles: ['ADMIN'],
    });
    return token;
  }

  // Follows nextCursor until hasMore is false, returning every page.
  async function walkPages(token: string, path: string, query: Record<string, string | number>) {
    const pages: Array<{ items: Array<{ id: string }>; pageInfo: { hasMore: boolean; nextCursor: string | null } }> = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const res = await request(app)
        .get(path)
        .query({ ...query, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      pages.push(res.body.data);
      if (!res.body.data.pageInfo.hasMore) break;
      cursor = res.body.data.pageInfo.nextCursor;
    }
    return pages;
  }

  it('keeps the legacy full array for Styles without paging params, and pages every Style exactly once with them', async () => {
    const token = await adminToken();
    for (let index = 0; index < 7; index += 1) {
      const res = await createStyle(token, { styleNumber: `PG-${String(index).padStart(2, '0')}` });
      expect(res.status).toBe(201);
    }

    const legacy = await request(app).get('/styles').set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    expect(legacy.body.data).toHaveLength(7);

    const pages = await walkPages(token, '/styles', { limit: 3 });
    expect(pages.map((page) => page.items.length)).toEqual([3, 3, 1]);
    const paged = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(paged).toEqual(legacy.body.data.map((style: { id: string }) => style.id));
  });

  it('applies Style search before paging', async () => {
    const token = await adminToken();
    for (const styleNumber of ['KEEP-1', 'KEEP-2', 'DROP-1', 'KEEP-3']) {
      expect((await createStyle(token, { styleNumber })).status).toBe(201);
    }

    const pages = await walkPages(token, '/styles', { search: 'keep', limit: 2 });
    expect(pages.flatMap((page) => page.items.map((item) => (item as unknown as { styleNumber: string }).styleNumber))).toEqual([
      'KEEP-1',
      'KEEP-2',
      'KEEP-3',
    ]);
  });

  it('pages Distributors in name order with an id tie-breaker — tied names are never skipped or repeated', async () => {
    const token = await adminToken();
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await createTestDistributor({ code: `TIE-${index}`, name: 'Same Name Traders' }));
    }
    created.push(await createTestDistributor({ code: 'AAA-1', name: 'Alpha Traders' }));
    created.push(await createTestDistributor({ code: 'ZZZ-1', name: 'Zulu Traders', status: 'INACTIVE' }));

    const legacy = await request(app).get('/distributors').set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(legacy.body.data)).toBe(true);

    const pages = await walkPages(token, '/distributors', { limit: 2 });
    const paged = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(paged).toHaveLength(7);
    expect(new Set(paged).size).toBe(7);
    expect(paged).toEqual(legacy.body.data.map((distributor: { id: string }) => distributor.id));
    expect(paged[0]).toBe(created[5]!.id);
    expect(paged.at(-1)).toBe(created[6]!.id);

    const activeOnly = await walkPages(token, '/distributors', { status: 'ACTIVE', limit: 4 });
    expect(activeOnly.flatMap((page) => page.items.map((item) => item.id))).not.toContain(created[6]!.id);
  });

  it('keeps a DISTRIBUTOR user scoped to its own Distributor in paginated mode', async () => {
    const own = await createTestDistributor({ code: 'OWN-9', name: 'Own Traders' });
    await createTestDistributor({ code: 'OTHER-9', name: 'Other Traders' });
    const { userId, token } = await createTestUserAndToken({
      email: 'dist-page@test.local',
      password: 'test-password',
      roles: ['DISTRIBUTOR'],
    });
    await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId: own.id } });

    const res = await request(app).get('/distributors').query({ limit: 10 }).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([own.id]);
    expect(res.body.data.pageInfo).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });

  it('rejects a limit over the maximum', async () => {
    const token = await adminToken();
    expect((await request(app).get('/styles').query({ limit: 101 }).set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/distributors').query({ limit: 101 }).set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PAG7 — selector option endpoints for the small masters
// ---------------------------------------------------------------------------

describe('selector option endpoints (PAG7)', () => {
  async function tokenFor(role: 'ADMIN' | 'MERCHANDISER' | 'SENIOR_MANAGEMENT' | 'FACTORY_USER') {
    const { token } = await createTestUserAndToken({
      email: `${role.toLowerCase()}-${createId().slice(-6)}@test.local`,
      password: 'test-password',
      roles: [role],
    });
    return token;
  }

  function get(token: string, path: string) {
    return request(app).get(path).set('Authorization', `Bearer ${token}`);
  }

  it('GET /factories/options: ACTIVE Factories only, slim, name order, under the Factory view permission', async () => {
    const token = await tokenFor('MERCHANDISER');
    await createTestFactory({ code: 'F-B', name: 'Bravo Mills' });
    await createTestFactory({ code: 'F-A', name: 'Alpha Mills' });
    const closed = await createTestFactory({ code: 'F-X', name: 'Closed Mills' });
    await prisma.factory.update({ where: { id: closed.id }, data: { status: 'INACTIVE' } });

    const res = await get(token, '/factories/options');

    expect(res.status).toBe(200);
    expect(res.body.data.map((f: { code: string }) => f.code)).toEqual(['F-A', 'F-B']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'status']);
    expect((await get(await tokenFor('SENIOR_MANAGEMENT'), '/factories/options')).status).toBe(403);
  });

  it('GET /sizes/options: ACTIVE Sizes only, in sortOrder', async () => {
    const token = await tokenFor('ADMIN');
    const age3 = await createSize('AGE_3');
    const age1 = await prisma.size.create({
      data: { id: createId(), code: 'AGE_1', label: 'AGE 1', sizeType: 'AGE', sortOrder: 1 },
    });
    await prisma.size.create({
      data: { id: createId(), code: 'AGE_9', label: 'AGE 9', sizeType: 'AGE', sortOrder: 9, status: 'INACTIVE' },
    });

    const res = await get(token, '/sizes/options');

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([age1.id, age3.id]);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'label', 'sortOrder', 'status']);
    expect((await get(await tokenFor('SENIOR_MANAGEMENT'), '/sizes/options')).status).toBe(403);
  });

  it('GET /seasons/options: every Season including INACTIVE (a saved Style keeps its Season), slim with displayName', async () => {
    const token = await tokenFor('ADMIN');
    const active = await createActiveSeason({ code: 'SS27', name: 'Spring' });
    const inactive = await createActiveSeason({ code: 'AW24', name: 'Autumn' });
    await prisma.season.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });

    const res = await get(token, '/seasons/options');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([active.id, inactive.id]));
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'displayName', 'id', 'name', 'status']);
    expect((await get(await tokenFor('SENIOR_MANAGEMENT'), '/seasons/options')).status).toBe(403);
  });

  it('GET /process-flows/options: each flow with only its ACTIVE versions and their runtimeSupport', async () => {
    const token = await tokenFor('ADMIN');
    const created = await request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'OPT', name: 'Options Flow', stages: [{ sequence: 1, name: 'Cutting' }] });
    expect(created.status).toBe(201);
    const flowId = created.body.data.id as string;
    const [v1] = await prisma.processFlowVersion.findMany({ where: { processFlowId: flowId } });
    await prisma.processFlowVersion.update({ where: { id: v1!.id }, data: { status: 'ACTIVE' } });
    const retired = await prisma.processFlowVersion.create({
      data: { id: createId(), processFlowId: flowId, versionNumber: 2, status: 'RETIRED' },
    });

    const res = await get(token, '/process-flows/options');

    expect(res.status).toBe(200);
    const flow = res.body.data.find((f: { id: string }) => f.id === flowId);
    expect(flow.versions.map((v: { id: string }) => v.id)).toEqual([v1!.id]);
    expect(flow.versions.map((v: { id: string }) => v.id)).not.toContain(retired.id);
    expect(flow.versions[0]).toHaveProperty('runtimeSupport.supported');
    expect((await get(await tokenFor('SENIOR_MANAGEMENT'), '/process-flows/options')).status).toBe(403);
  });

  it("the option routes are not swallowed by '/:id'", async () => {
    const token = await tokenFor('ADMIN');
    for (const path of ['/factories/options', '/sizes/options', '/seasons/options', '/process-flows/options']) {
      const res = await get(token, path);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PAG8 — opt-in cursor pagination for the Factory, Size, Season and Process
// Flow lists
// ---------------------------------------------------------------------------

describe('small master list pagination (PAG8)', () => {
  async function adminToken() {
    const { token } = await createTestUserAndToken({
      email: `admin-${createId().slice(-8)}@test.local`,
      password: 'test-password',
      roles: ['ADMIN'],
    });
    return token;
  }

  // Follows nextCursor to the end and returns every id, in page order.
  async function walk(token: string, path: string, query: Record<string, string | number> = {}) {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const res = await request(app)
        .get(path)
        .query({ limit: 2, ...query, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      ids.push(...res.body.data.items.map((item: { id: string }) => item.id));
      if (!res.body.data.pageInfo.hasMore) return ids;
      cursor = res.body.data.pageInfo.nextCursor;
    }
    throw new Error('pagination did not terminate');
  }

  async function legacyIds(token: string, path: string, query: Record<string, string> = {}) {
    const res = await request(app).get(path).query(query).set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(res.body.data)).toBe(true);
    return res.body.data.map((item: { id: string }) => item.id);
  }

  it('Factories: legacy array unchanged; pages cover tied names exactly once in the same order', async () => {
    const token = await adminToken();
    for (let index = 0; index < 4; index += 1) await createTestFactory({ code: `TIE-${index}`, name: 'Same Mills' });
    await createTestFactory({ code: 'AAA', name: 'Alpha Mills' });

    const legacy = await legacyIds(token, '/factories');
    const paged = await walk(token, '/factories');
    expect(paged).toHaveLength(5);
    expect(new Set(paged).size).toBe(5);
    expect(paged).toEqual(legacy);
  });

  it('Sizes: pages follow sortOrder/code and the status filter applies before paging', async () => {
    const token = await adminToken();
    for (let index = 1; index <= 5; index += 1) {
      await prisma.size.create({
        data: { id: createId(), code: `AGE_${index}`, label: `AGE ${index}`, sizeType: 'AGE', sortOrder: index, status: index === 3 ? 'INACTIVE' : 'ACTIVE' },
      });
    }

    expect(await walk(token, '/sizes')).toEqual(await legacyIds(token, '/sizes'));
    const active = await walk(token, '/sizes', { status: 'ACTIVE' });
    expect(active).toHaveLength(4);
  });

  it('Seasons: pages keep FY/name order with an id tie-breaker and the financialYearId filter', async () => {
    const token = await adminToken();
    const fy = await createTestFinancialYear();
    for (let index = 0; index < 3; index += 1) {
      await prisma.season.create({
        data: { id: createId(), code: `SS-${index}`, name: 'Same Season', financialYearId: fy.id },
      });
    }

    const paged = await walk(token, '/seasons', { financialYearId: fy.id });
    expect(paged).toHaveLength(3);
    expect(paged).toEqual(await legacyIds(token, '/seasons', { financialYearId: fy.id }));
  });

  it('Process Flows: legacy array unchanged; pages follow code order', async () => {
    const token = await adminToken();
    for (const code of ['PF-C', 'PF-A', 'PF-B']) {
      const res = await request(app)
        .post('/process-flows')
        .set('Authorization', `Bearer ${token}`)
        .send({ code, name: code, stages: [{ sequence: 1, name: 'Cutting' }] });
      expect(res.status).toBe(201);
    }

    const paged = await walk(token, '/process-flows');
    expect(paged).toHaveLength(3);
    expect(paged).toEqual(await legacyIds(token, '/process-flows'));
  });

  it('rejects an over-max limit on each list', async () => {
    const token = await adminToken();
    for (const path of ['/factories', '/sizes', '/seasons', '/process-flows']) {
      expect((await request(app).get(path).query({ limit: 101 }).set('Authorization', `Bearer ${token}`)).status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// UL — user-assignment lookups
// ---------------------------------------------------------------------------

describe('user-assignment lookups (UL)', () => {
  type CandidateRole = 'DISTRIBUTOR' | 'FACTORY_USER' | 'MERCHANDISER';

  async function candidate(input: {
    name: string;
    email?: string;
    roles?: CandidateRole[];
    status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  }) {
    const id = await createTestUser({
      email: input.email ?? `${input.name.toLowerCase().replace(/\W+/g, '.')}@ul.test.local`,
      password: 'test-password',
      roles: input.roles,
      status: input.status,
    });
    await prisma.user.update({ where: { id }, data: { name: input.name } });
    return id;
  }

  async function tokenFor(role: 'ADMIN' | 'MERCHANDISER' | 'SENIOR_MANAGEMENT' | 'ACCOUNTANT') {
    const { token } = await createTestUserAndToken({
      email: `${role.toLowerCase()}-ul-caller@test.local`,
      password: 'test-password',
      roles: [role],
    });
    return token;
  }

  function get(token: string, path: string, query: Record<string, string | number> = {}) {
    return request(app).get(path).query(query).set('Authorization', `Bearer ${token}`);
  }

  function names(res: request.Response): string[] {
    return (res.body.data as Array<{ name: string }>).map((option) => option.name);
  }

  describe('GET /distributors/:id/user-options', () => {
    it('offers only ACTIVE, DISTRIBUTOR-role users with no distributor mapping anywhere', async () => {
      const token = await tokenFor('ADMIN');
      const distributor = await createTestDistributor({ code: 'UL-D1', name: 'UL Distribution' });
      const other = await createTestDistributor({ code: 'UL-D2', name: 'UL Other' });
      await candidate({ name: 'Eligible Dana', roles: ['DISTRIBUTOR'] });
      await candidate({ name: 'Inactive Ivan', roles: ['DISTRIBUTOR'], status: 'INACTIVE' });
      await candidate({ name: 'Suspended Sam', roles: ['DISTRIBUTOR'], status: 'SUSPENDED' });
      await candidate({ name: 'Wrong Role Wes', roles: ['FACTORY_USER'] });
      await candidate({ name: 'No Role Nia' });
      const mappedHere = await candidate({ name: 'Mapped Here Mo', roles: ['DISTRIBUTOR'] });
      const mappedElsewhere = await candidate({ name: 'Mapped Else Mae', roles: ['DISTRIBUTOR'] });
      await prisma.userDistributor.create({
        data: { id: createId(), userId: mappedHere, distributorId: distributor.id },
      });
      await prisma.userDistributor.create({
        data: { id: createId(), userId: mappedElsewhere, distributorId: other.id },
      });

      const res = await get(token, `/distributors/${distributor.id}/user-options`);

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Eligible Dana']);
    });

    it('returns exactly id/name/email', async () => {
      const token = await tokenFor('ADMIN');
      const distributor = await createTestDistributor();
      const id = await candidate({ name: 'Slim Sue', email: 'slim.sue@ul.test.local', roles: ['DISTRIBUTOR'] });

      const res = await get(token, `/distributors/${distributor.id}/user-options`, { search: '' });

      expect(res.body.data).toEqual([{ id, name: 'Slim Sue', email: 'slim.sue@ul.test.local' }]);
    });

    it('searches name and email case-insensitively', async () => {
      const token = await tokenFor('ADMIN');
      const distributor = await createTestDistributor();
      await candidate({ name: 'Kerala Kumar', email: 'kk@alpha.example', roles: ['DISTRIBUTOR'] });
      await candidate({ name: 'Bangalore Bea', email: 'bea@kochi.example', roles: ['DISTRIBUTOR'] });

      const path = `/distributors/${distributor.id}/user-options`;
      expect(names(await get(token, path, { search: 'KERALA' }))).toEqual(['Kerala Kumar']);
      expect(names(await get(token, path, { search: 'kochi.EX' }))).toEqual(['Bangalore Bea']);
      expect(names(await get(token, path, { search: 'zzz' }))).toEqual([]);
    });

    it('bounds results (default 20, caller limit, max 50) in name then id order', async () => {
      const token = await tokenFor('ADMIN');
      const distributor = await createTestDistributor();
      const twins: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        twins.push(
          await candidate({ name: 'Aaron Twin', email: `twin${index}@ul.test.local`, roles: ['DISTRIBUTOR'] }),
        );
      }
      for (let index = 0; index < 20; index += 1) {
        await candidate({ name: `Bulk ${String(index).padStart(2, '0')}`, roles: ['DISTRIBUTOR'] });
      }
      const path = `/distributors/${distributor.id}/user-options`;

      const initial = await get(token, path);
      expect(initial.body.data).toHaveLength(20);
      expect(initial.body.data.slice(0, 3).map((row: { id: string }) => row.id)).toEqual([...twins].sort());
      expect(names(await get(token, path, { limit: 4 }))).toEqual([
        'Aaron Twin',
        'Aaron Twin',
        'Aaron Twin',
        'Bulk 00',
      ]);
      expect((await get(token, path, { limit: 50 })).body.data).toHaveLength(23);
      expect((await get(token, path, { limit: 51 })).status).toBe(400);
    });

    it('is ADMIN only, and 404s for an unknown distributor', async () => {
      const distributor = await createTestDistributor();
      for (const role of ['MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] as const) {
        expect((await get(await tokenFor(role), `/distributors/${distributor.id}/user-options`)).status).toBe(403);
      }
      const admin = await tokenFor('ADMIN');
      expect((await get(admin, '/distributors/does-not-exist/user-options')).status).toBe(404);
      expect((await request(app).get(`/distributors/${distributor.id}/user-options`)).status).toBe(401);
    });
  });

  describe('GET /factories/:id/user-options', () => {
    it('offers ACTIVE FACTORY_USER users not mapped to this factory — users on other factories stay eligible', async () => {
      const token = await tokenFor('ADMIN');
      const factory = await createTestFactory({ code: 'UL-F1', name: 'UL Factory' });
      const other = await createTestFactory({ code: 'UL-F2', name: 'UL Other Factory' });
      const onThis = await candidate({ name: 'On This Otto', roles: ['FACTORY_USER'] });
      const onOther = await candidate({ name: 'On Other Olga', roles: ['FACTORY_USER'] });
      await prisma.userFactory.create({ data: { id: createId(), userId: onThis, factoryId: factory.id } });
      await prisma.userFactory.create({ data: { id: createId(), userId: onOther, factoryId: other.id } });
      await candidate({ name: 'Unmapped Una', roles: ['FACTORY_USER'] });
      await candidate({ name: 'Inactive Ike', roles: ['FACTORY_USER'], status: 'INACTIVE' });
      await candidate({ name: 'Suspended Sid', roles: ['FACTORY_USER'], status: 'SUSPENDED' });
      await candidate({ name: 'Distributor Dee', roles: ['DISTRIBUTOR'] });

      const res = await get(token, `/factories/${factory.id}/user-options`);

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['On Other Olga', 'Unmapped Una']);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['email', 'id', 'name']);
    });

    it('searches name and email, and bounds results (default 20, max 50) in name then id order', async () => {
      const token = await tokenFor('ADMIN');
      const factory = await createTestFactory();
      await candidate({ name: 'Tiruppur Tara', email: 'tara@knit.example', roles: ['FACTORY_USER'] });
      for (let index = 0; index < 21; index += 1) {
        await candidate({ name: `Bulk ${String(index).padStart(2, '0')}`, roles: ['FACTORY_USER'] });
      }
      const path = `/factories/${factory.id}/user-options`;

      expect(names(await get(token, path, { search: 'tiruppur' }))).toEqual(['Tiruppur Tara']);
      expect(names(await get(token, path, { search: 'KNIT.example' }))).toEqual(['Tiruppur Tara']);
      const initial = await get(token, path, { search: '' });
      expect(initial.body.data).toHaveLength(20);
      expect(names(initial)[0]).toBe('Bulk 00');
      expect(names(await get(token, path, { limit: 2 }))).toEqual(['Bulk 00', 'Bulk 01']);
      expect((await get(token, path, { limit: 51 })).status).toBe(400);
    });

    it('is ADMIN only, and 404s for an unknown factory', async () => {
      const factory = await createTestFactory();
      for (const role of ['MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] as const) {
        expect((await get(await tokenFor(role), `/factories/${factory.id}/user-options`)).status).toBe(403);
      }
      const admin = await tokenFor('ADMIN');
      expect((await get(admin, '/factories/does-not-exist/user-options')).status).toBe(404);
    });
  });
});
