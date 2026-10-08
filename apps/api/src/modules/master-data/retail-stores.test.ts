import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
const fields = {
  code: 'ST-001',
  name: 'Retail Chennai',
  addressLine1: '12 Market Road',
  city: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  postalCode: '600001',
  contactName: 'Manager',
  contactPhone: '9876543210',
  contactEmail: 'store@example.com',
  gstin: '22AAAAA0000A1Z5',
};
async function token(
  roles: Parameters<typeof createTestUserAndToken>[0]['roles'] = ['MERCHANDISER'],
) {
  return (
    await createTestUserAndToken({ email: `${createId()}@test.local`, password: 'pass', roles })
  ).token;
}
const post = (auth: string, distributorId: string, patch = {}) =>
  request(app)
    .post('/retail-stores')
    .set('Authorization', `Bearer ${auth}`)
    .send({ ...fields, distributorId, ...patch });

describe('DEMO-014 Retail Store master', () => {
  it('creates multiple stores per Distributor, rejects duplicates and permits the same code for another Distributor', async () => {
    const auth = await token();
    const a = await createTestDistributor();
    const b = await createTestDistributor();
    await post(auth, a.id).expect(201);
    await post(auth, a.id, { code: 'ST-002' }).expect(201);
    await post(auth, a.id).expect(409);
    await post(auth, b.id).expect(201);
    const list = await request(app)
      .get('/retail-stores')
      .query({ distributorId: a.id, limit: 1 })
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.pageInfo.hasMore).toBe(true);
    const next = await request(app)
      .get('/retail-stores')
      .query({ distributorId: a.id, limit: 1, cursor: list.body.data.pageInfo.nextCursor })
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(next.body.data.items[0].id).not.toBe(list.body.data.items[0].id);
  });

  it('validates required address/PIN, immutable owner, active lookup, search and audit', async () => {
    const auth = await token();
    const a = await createTestDistributor();
    const b = await createTestDistributor();
    await post(auth, a.id, { postalCode: '' }).expect(400);
    const created = (await post(auth, a.id).expect(201)).body.data;
    await request(app)
      .patch(`/retail-stores/${created.id}`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ distributorId: b.id })
      .expect(400);
    await request(app)
      .patch(`/retail-stores/${created.id}`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ name: 'Changed' })
      .expect(200);
    const lookup = () =>
      request(app)
        .get('/retail-stores/options')
        .query({ distributorId: a.id, search: 'ST-001' })
        .set('Authorization', `Bearer ${auth}`);
    expect((await lookup().expect(200)).body.data).toHaveLength(1);
    await request(app)
      .patch(`/retail-stores/${created.id}/status`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((await lookup().expect(200)).body.data).toHaveLength(0);
    await request(app).patch(`/retail-stores/${created.id}`).set('Authorization', `Bearer ${auth}`).send({ contactName: 'New Manager' }).expect(200);
    const detail = await request(app)
      .get(`/retail-stores/${created.id}`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      name: 'Changed',
      distributorId: a.id,
      status: 'INACTIVE',
    });
    expect(await prisma.auditLog.count({ where: { entityId: created.id } })).toBe(4);
    await request(app)
      .delete(`/retail-stores/${created.id}`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(404);
  });

  it('uses existing master roles for reads and mutations, including inline creation', async () => {
    const a = await createTestDistributor();
    for (const role of [
      'FACTORY_USER',
      'QA_USER',
      'ACCOUNTANT',
      'DISTRIBUTOR',
      'SENIOR_MANAGEMENT',
    ] as const) {
      const auth = await token([role]);
      await post(auth, a.id).expect(403);
      await request(app)
        .get('/retail-stores')
        .set('Authorization', `Bearer ${auth}`)
        .expect(role === 'SENIOR_MANAGEMENT' ? 200 : 403);
    }
    await post(await token(['ADMIN']), a.id).expect(201);
  });
});
