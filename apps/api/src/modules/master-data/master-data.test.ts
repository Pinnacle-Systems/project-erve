import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { assertProcessFlowVersionMutable } from './master-data.service.js';

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

async function createStyle(token: string, overrides?: Record<string, unknown>) {
  return request(app)
    .post('/styles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      styleNumber: 'ST-001',
      styleName: 'Boys Regular T-Shirt',
      finalMrp: 849,
      hsnCode: '61091000',
      royaltyPercentage: 12,
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
});

describe('sizes API', () => {
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
});

describe('process flow API', () => {
  it('activates draft process flow versions and retires the previous active version', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const flow = await request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'PROD', name: 'Production' })
      .then((res) => res.body.data);
    const version1 = flow.versions[0];

    await request(app)
      .post(`/process-flow-versions/${version1.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const version2 = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [
          { sequence: 1, name: 'Cutting' },
          { sequence: 2, name: 'Sewing' },
        ],
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

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_CREATED', entityId: res.body.data.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  });

  it('rejects non-ADMIN roles from creating, updating, or changing distributor status', async () => {
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor();

    const created = await createDistributorViaApi(merchToken);
    const updated = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ name: 'Renamed' });
    const statusChanged = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ status: 'INACTIVE' });

    expect(created.status).toBe(403);
    expect(updated.status).toBe(403);
    expect(statusChanged.status).toBe(403);
  });

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

  it('updates a distributor, records an audit log, and rejects unknown ids', async () => {
    const { userId, token } = await createAdmin();
    const distributor = await createTestDistributor({ code: 'DIST-001', name: 'Acme Distribution' });

    const updated = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Distribution South', city: 'Chennai' });
    const unknown = await request(app)
      .patch('/distributors/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Acme Distribution South');
    expect(updated.body.data.city).toBe('Chennai');
    expect(unknown.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_UPDATED', entityId: distributor.id },
    });
    expect(audit?.actorId).toBe(userId);
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

    const list = await request(app).get('/distributors').set('Authorization', `Bearer ${distToken}`);
    const ownDetail = await request(app).get(`/distributors/${own.id}`).set('Authorization', `Bearer ${distToken}`);
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

    const list = await request(app).get('/distributors').set('Authorization', `Bearer ${distToken}`);
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
    const factoryList = await request(app).get('/distributors').set('Authorization', `Bearer ${factoryToken}`);
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
