import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestSeason, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function tokenWithRoles(roles: Array<'ADMIN' | 'MERCHANDISER' | 'ACCOUNTANT' | 'FACTORY_USER' | 'SENIOR_MANAGEMENT'>) {
  const { token } = await createTestUserAndToken({
    email: `user-${createId().slice(-8)}@test.local`,
    password: 'pass',
    roles,
  });
  return token;
}

async function createRuleSet(token: string) {
  const res = await request(app)
    .post('/gst-rule-sets')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: `GST-${createId().slice(-6)}`, name: 'Test Rule Set' });
  return res.body.data.id as string;
}

describe('HSN master', () => {
  it('creates an HSN with no GST Rule Set assignment', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const res = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000', description: 'Boys / T-Shirt' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: '61091000', description: 'Boys / T-Shirt', gstRuleSet: null });
  });

  it('rejects a code that is not exactly 8 digits', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const res = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '123' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate HSN code', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    await request(app).post('/hsns').set('Authorization', `Bearer ${token}`).send({ code: '61091000' });
    const dup = await request(app).post('/hsns').set('Authorization', `Bearer ${token}`).send({ code: '61091000' });
    expect(dup.status).toBe(409);
  });

  it('rejects assigning a nonexistent GST Rule Set', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const res = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000', gstRuleSetId: 'does-not-exist' });
    expect(res.status).toBe(400);
  });

  it('assigns and reassigns a GST Rule Set on update, traceable via audit log', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetId = await createRuleSet(token);
    const created = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000' });
    const hsnId = created.body.data.id as string;

    const updated = await request(app)
      .patch(`/hsns/${hsnId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gstRuleSetId: ruleSetId });
    expect(updated.status).toBe(200);
    expect(updated.body.data.gstRuleSet.id).toBe(ruleSetId);

    const entries = await prisma.auditLog.findMany({ where: { entityId: hsnId, action: 'HSN_UPDATED' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({
      before: { gstRuleSetId: null },
      after: { gstRuleSetId: ruleSetId },
    });
  });

  it('lets many HSNs share the same GST Rule Set', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetId = await createRuleSet(token);
    const hsn1 = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000', gstRuleSetId: ruleSetId });
    const hsn2 = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61046200', gstRuleSetId: ruleSetId });

    expect(hsn1.body.data.gstRuleSet.id).toBe(ruleSetId);
    expect(hsn2.body.data.gstRuleSet.id).toBe(ruleSetId);
  });

  it('enforces RBAC: FACTORY_USER cannot manage or view HSNs', async () => {
    const factoryToken = await tokenWithRoles(['FACTORY_USER']);
    const createRes = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ code: '61091000' });
    expect(createRes.status).toBe(403);

    const listRes = await request(app).get('/hsns').set('Authorization', `Bearer ${factoryToken}`);
    expect(listRes.status).toBe(403);
  });

  it('allows SENIOR_MANAGEMENT to view but not manage HSNs', async () => {
    const seniorToken = await tokenWithRoles(['SENIOR_MANAGEMENT']);
    const listRes = await request(app).get('/hsns').set('Authorization', `Bearer ${seniorToken}`);
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ code: '61091000' });
    expect(createRes.status).toBe(403);
  });

  it('leaves existing Style create/update HSN free-text behavior untouched', async () => {
    const token = await tokenWithRoles(['ADMIN', 'MERCHANDISER']);
    const season = await createTestSeason();

    const res = await request(app)
      .post('/styles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        styleNumber: `ST-${createId().slice(-8)}`,
        styleName: 'Test Style',
        finalMrp: 500,
        seasonId: season.id,
        hsnCode: '61091000',
        hsnDescription: 'Boys / T-Shirt',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.hsnCode).toBe('61091000');

    const style = await prisma.style.findUnique({ where: { id: res.body.data.id } });
    // Nothing in the Style create/update flow sets hsnId — that link is
    // established only by the hsn-master-backfill script or the HSN admin
    // screens, never implicitly by saving a Style.
    expect(style!.hsnId).toBeNull();
  });
});
