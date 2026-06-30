import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
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
