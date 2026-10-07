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

  it('ignores raw hsnCode/hsnDescription sent to the Style API — HSN is selected by hsnId only', async () => {
    // INV-002 review correction: a Style's HSN is now a canonical Hsn
    // master reference, not free text. Zod strips unrecognized keys
    // silently (no .strict()), so a stale/malicious client sending
    // hsnCode/hsnDescription directly must have no effect at all — only
    // hsnId, resolved against an ACTIVE Hsn, can set them (and only via
    // the sync in master-data.service.ts).
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
    expect(res.body.data.hsnCode).toBeNull();
    expect(res.body.data.hsnDescription).toBeNull();
    expect(res.body.data.hsnId).toBeNull();

    const style = await prisma.style.findUnique({ where: { id: res.body.data.id } });
    expect(style!.hsnCode).toBeNull();
    expect(style!.hsnId).toBeNull();
  });

  it('selecting an HSN via hsnId syncs the legacy hsnCode/hsnDescription fields', async () => {
    const token = await tokenWithRoles(['ADMIN', 'MERCHANDISER']);
    const season = await createTestSeason();
    const hsnRes = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000', description: 'Boys / T-Shirt' });
    const hsnId = hsnRes.body.data.id as string;

    const res = await request(app)
      .post('/styles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        styleNumber: `ST-${createId().slice(-8)}`,
        styleName: 'Test Style',
        finalMrp: 500,
        seasonId: season.id,
        hsnId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      hsnId,
      hsnCode: '61091000',
      hsnDescription: 'Boys / T-Shirt',
      hsn: { id: hsnId, code: '61091000', description: 'Boys / T-Shirt', status: 'ACTIVE' },
    });
  });

  it('rejects assigning an INACTIVE HSN to a Style', async () => {
    const token = await tokenWithRoles(['ADMIN', 'MERCHANDISER']);
    const season = await createTestSeason();
    const hsnRes = await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61091000', status: 'INACTIVE' });

    const res = await request(app)
      .post('/styles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        styleNumber: `ST-${createId().slice(-8)}`,
        styleName: 'Test Style',
        finalMrp: 500,
        seasonId: season.id,
        hsnId: hsnRes.body.data.id,
      });
    expect(res.status).toBe(400);
  });

  it('GET /hsns/options returns every HSN regardless of status (mirrors /seasons/options)', async () => {
    const token = await tokenWithRoles(['ADMIN', 'MERCHANDISER']);
    await request(app).post('/hsns').set('Authorization', `Bearer ${token}`).send({ code: '61091000' });
    await request(app)
      .post('/hsns')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '61046200', status: 'INACTIVE' });

    const res = await request(app).get('/hsns/options').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((h: { code: string }) => h.code).sort()).toEqual(['61046200', '61091000']);
  });

  describe('RBAC finalization: HSN -> GST Rule Set assignment is finance-only', () => {
    it('lets MERCHANDISER create/edit HSN identity fields without ever touching gstRuleSetId', async () => {
      const token = await tokenWithRoles(['MERCHANDISER']);
      const created = await request(app)
        .post('/hsns')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '61091000', description: 'Boys / T-Shirt' });
      expect(created.status).toBe(201);
      expect(created.body.data.gstRuleSet).toBeNull();

      const updated = await request(app)
        .patch(`/hsns/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Updated description', status: 'INACTIVE' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ description: 'Updated description', status: 'INACTIVE' });
    });

    it('rejects MERCHANDISER creating an HSN with a GST Rule Set assignment', async () => {
      const adminToken = await tokenWithRoles(['ADMIN']);
      const ruleSetId = await createRuleSet(adminToken);
      const merchToken = await tokenWithRoles(['MERCHANDISER']);

      const res = await request(app)
        .post('/hsns')
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ code: '61091000', gstRuleSetId: ruleSetId });
      expect(res.status).toBe(403);
    });

    it('rejects MERCHANDISER assigning, reassigning, or unassigning an HSN\'s GST Rule Set', async () => {
      const adminToken = await tokenWithRoles(['ADMIN']);
      const ruleSetA = await createRuleSet(adminToken);
      const ruleSetB = await createRuleSet(adminToken);
      const merchToken = await tokenWithRoles(['MERCHANDISER']);

      const created = await request(app)
        .post('/hsns')
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ code: '61091000' });
      const hsnId = created.body.data.id as string;

      // Assign (null -> ruleSetA)
      const assign = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ gstRuleSetId: ruleSetA });
      expect(assign.status).toBe(403);

      // Now assign it as ADMIN so we can test reassign/unassign from a non-null state.
      await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gstRuleSetId: ruleSetA })
        .expect(200);

      // Reassign (ruleSetA -> ruleSetB)
      const reassign = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ gstRuleSetId: ruleSetB });
      expect(reassign.status).toBe(403);

      // Unassign (ruleSetA -> null)
      const unassign = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ gstRuleSetId: null });
      expect(unassign.status).toBe(403);

      const unchanged = await prisma.hsn.findUnique({ where: { id: hsnId } });
      expect(unchanged?.gstRuleSetId).toBe(ruleSetA);
    });

    it('does not re-trigger the finance-only check when an edit re-sends the same gstRuleSetId', async () => {
      const adminToken = await tokenWithRoles(['ADMIN']);
      const ruleSetId = await createRuleSet(adminToken);
      const created = await request(app)
        .post('/hsns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: '61091000', gstRuleSetId: ruleSetId });
      const hsnId = created.body.data.id as string;

      const merchToken = await tokenWithRoles(['MERCHANDISER']);
      const res = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${merchToken}`)
        .send({ gstRuleSetId: ruleSetId, description: 'Merchandiser edit' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ description: 'Merchandiser edit', gstRuleSet: { id: ruleSetId } });
    });

    it('allows ACCOUNTANT (finance) to assign, reassign, and unassign a GST Rule Set', async () => {
      const adminToken = await tokenWithRoles(['ADMIN']);
      const ruleSetA = await createRuleSet(adminToken);
      const ruleSetB = await createRuleSet(adminToken);
      const accountantToken = await tokenWithRoles(['ACCOUNTANT']);

      const created = await request(app)
        .post('/hsns')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ code: '61091000', gstRuleSetId: ruleSetA });
      expect(created.status).toBe(201);
      const hsnId = created.body.data.id as string;

      const reassigned = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ gstRuleSetId: ruleSetB });
      expect(reassigned.status).toBe(200);
      expect(reassigned.body.data.gstRuleSet.id).toBe(ruleSetB);

      const unassigned = await request(app)
        .patch(`/hsns/${hsnId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ gstRuleSetId: null });
      expect(unassigned.status).toBe(200);
      expect(unassigned.body.data.gstRuleSet).toBeNull();
    });
  });
});
