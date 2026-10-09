import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import {
  BandLadderError,
  CURRENT_GARMENT_GST_RULE_SET_CODE,
  ensureCurrentGarmentGstRuleSet,
  resolveGstRuleForHsn,
  validateBandLadder,
} from './gst-rule-sets.service.js';

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

function auth(token: string) {
  return `Bearer ${token}`;
}

async function createRuleSet(token: string, overrides?: { code?: string }) {
  return request(app)
    .post('/gst-rule-sets')
    .set('Authorization', auth(token))
    .send({ code: overrides?.code ?? `GST-${createId().slice(-6)}`, name: 'Test Rule Set' });
}

async function createVersion(token: string, ruleSetId: string, body: { effectiveFrom?: string | null; effectiveTo?: string | null }) {
  return request(app).post(`/gst-rule-sets/${ruleSetId}/versions`).set('Authorization', auth(token)).send(body);
}

async function addBand(
  token: string,
  ruleSetId: string,
  versionId: string,
  body: { minValue?: number | null; maxValue?: number | null; gstPercent: number },
) {
  return request(app)
    .post(`/gst-rule-sets/${ruleSetId}/versions/${versionId}/bands`)
    .set('Authorization', auth(token))
    .send(body);
}

async function activateVersion(token: string, ruleSetId: string, versionId: string) {
  return request(app)
    .post(`/gst-rule-sets/${ruleSetId}/versions/${versionId}/actions/activate`)
    .set('Authorization', auth(token));
}

async function createHsn(token: string, code: string, gstRuleSetId?: string) {
  return request(app)
    .post('/hsns')
    .set('Authorization', auth(token))
    .send({ code, gstRuleSetId });
}

// Builds one ACTIVE version with the ticket's two confirmed bands
// (<=2500: 5%, >2500: 18%), effective from the given date, and one HSN
// assigned to it. Returns everything a resolution test needs.
async function setupActiveGarmentRuleSet(token: string, effectiveFrom: string) {
  const ruleSetRes = await createRuleSet(token);
  const ruleSetId = ruleSetRes.body.data.id as string;
  const versionRes = await createVersion(token, ruleSetId, { effectiveFrom });
  const versionId = versionRes.body.data.versions[0].id as string;
  await addBand(token, ruleSetId, versionId, { minValue: null, maxValue: 2500, gstPercent: 5 });
  await addBand(token, ruleSetId, versionId, { minValue: 2500, maxValue: null, gstPercent: 18 });
  const activateRes = await activateVersion(token, ruleSetId, versionId);
  expect(activateRes.status).toBe(200);
  const hsnRes = await createHsn(token, '61091000', ruleSetId);
  return { ruleSetId, versionId, hsnId: hsnRes.body.data.id as string };
}

describe('GST Rule Sets', () => {
  it('creates a rule set and shares it across multiple HSNs', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    expect(ruleSetRes.status).toBe(201);
    const ruleSetId = ruleSetRes.body.data.id as string;

    const hsn1 = await createHsn(token, '61091000', ruleSetId);
    const hsn2 = await createHsn(token, '61046200', ruleSetId);
    expect(hsn1.status).toBe(201);
    expect(hsn2.status).toBe(201);
    expect(hsn1.body.data.gstRuleSet.id).toBe(ruleSetId);
    expect(hsn2.body.data.gstRuleSet.id).toBe(ruleSetId);

    const detail = await request(app).get(`/gst-rule-sets/${ruleSetId}`).set('Authorization', auth(token));
    expect(detail.body.data.code).toBe(ruleSetRes.body.data.code);
  });

  it('resolves <=2500 to 5%, >2500 to 18%, and exactly 2500 to 5% (not 18%)', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const { hsnId } = await setupActiveGarmentRuleSet(token, '2017-07-01');

    const resolve = (value: number) =>
      request(app)
        .get('/gst-rule-sets/resolve')
        .query({ hsnId, date: '2024-01-01', value })
        .set('Authorization', auth(token));

    expect((await resolve(1000)).body.data).toMatchObject({ found: true, band: { gstPercent: 5 } });
    expect((await resolve(2500)).body.data).toMatchObject({ found: true, band: { gstPercent: 5 } });
    expect((await resolve(2500.01)).body.data).toMatchObject({ found: true, band: { gstPercent: 18 } });
    expect((await resolve(5000)).body.data).toMatchObject({ found: true, band: { gstPercent: 18 } });
  });

  it('resolves Decimal-input boundary values exactly (INV-006: no number round-trip), including 2500.000001', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const { hsnId } = await setupActiveGarmentRuleSet(token, '2017-07-01');

    const atBoundary = await resolveGstRuleForHsn({ hsnId, date: '2024-01-01', value: new Prisma.Decimal('2500.000000') });
    expect(atBoundary).toMatchObject({ found: true, band: { gstPercent: 5 } });

    const justOverBoundary = await resolveGstRuleForHsn({
      hsnId,
      date: '2024-01-01',
      value: new Prisma.Decimal('2500.000001'),
    });
    expect(justOverBoundary).toMatchObject({ found: true, band: { gstPercent: 18 } });

    // A plain `number` caller (e.g. the /resolve HTTP route above) must still work unchanged.
    const numberCaller = await resolveGstRuleForHsn({ hsnId, date: '2024-01-01', value: 2500 });
    expect(numberCaller).toMatchObject({ found: true, band: { gstPercent: 5 } });
  });

  it('resolves the version effective on the given date; a later version does not alter historical resolution', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const { ruleSetId, hsnId } = await setupActiveGarmentRuleSet(token, '2017-07-01');

    // A future rate change: a new version with a different (single, fully
    // open) band, effective far in the future. Activating it must not touch
    // the historical version's bands or its resolution for past dates.
    const futureVersionRes = await createVersion(token, ruleSetId, { effectiveFrom: '2030-01-01' });
    const futureVersionId = futureVersionRes.body.data.versions[0].id as string;
    await addBand(token, ruleSetId, futureVersionId, { minValue: null, maxValue: null, gstPercent: 12 });
    const activateRes = await activateVersion(token, ruleSetId, futureVersionId);
    expect(activateRes.status).toBe(200);

    const historical = await request(app)
      .get('/gst-rule-sets/resolve')
      .query({ hsnId, date: '2020-01-01', value: 5000 })
      .set('Authorization', auth(token));
    expect(historical.body.data).toMatchObject({ found: true, band: { gstPercent: 18 } });

    const future = await request(app)
      .get('/gst-rule-sets/resolve')
      .query({ hsnId, date: '2031-01-01', value: 5000 })
      .set('Authorization', auth(token));
    expect(future.body.data).toMatchObject({ found: true, band: { gstPercent: 12 } });
  });

  it('rejects activating a version whose effective period conflicts with another active version', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    const ruleSetId = ruleSetRes.body.data.id as string;

    const v1 = await createVersion(token, ruleSetId, { effectiveFrom: '2020-01-01', effectiveTo: '2029-12-31' });
    const v1Id = v1.body.data.versions[0].id as string;
    await addBand(token, ruleSetId, v1Id, { minValue: null, maxValue: null, gstPercent: 5 });
    expect((await activateVersion(token, ruleSetId, v1Id)).status).toBe(200);

    // Overlaps v1's bounded period entirely — not the "open-ended
    // predecessor" case that gets auto-superseded, so this must conflict.
    const v2 = await createVersion(token, ruleSetId, { effectiveFrom: '2021-01-01' });
    const v2Id = v2.body.data.versions[0].id as string;
    await addBand(token, ruleSetId, v2Id, { minValue: null, maxValue: null, gstPercent: 12 });
    const activateV2 = await activateVersion(token, ruleSetId, v2Id);
    expect(activateV2.status).toBe(409);
  });

  it('rejects activating a version with no bands', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    const ruleSetId = ruleSetRes.body.data.id as string;
    const v = await createVersion(token, ruleSetId, { effectiveFrom: '2020-01-01' });
    const versionId = v.body.data.versions[0].id as string;

    const res = await activateVersion(token, ruleSetId, versionId);
    expect(res.status).toBe(400);
  });

  it('rejects activating a version with a gap between bands', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    const ruleSetId = ruleSetRes.body.data.id as string;
    const v = await createVersion(token, ruleSetId, { effectiveFrom: '2020-01-01' });
    const versionId = v.body.data.versions[0].id as string;
    await addBand(token, ruleSetId, versionId, { minValue: null, maxValue: 2000, gstPercent: 5 });
    // Gap: next band should start at 2000, not 2500.
    await addBand(token, ruleSetId, versionId, { minValue: 2500, maxValue: null, gstPercent: 18 });

    const res = await activateVersion(token, ruleSetId, versionId);
    expect(res.status).toBe(400);
  });

  it('rejects activating a version with overlapping/ambiguous bands', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    const ruleSetId = ruleSetRes.body.data.id as string;
    const v = await createVersion(token, ruleSetId, { effectiveFrom: '2020-01-01' });
    const versionId = v.body.data.versions[0].id as string;
    // Two bands both open-ended at the lower bound — ambiguous.
    await addBand(token, ruleSetId, versionId, { minValue: null, maxValue: 3000, gstPercent: 5 });
    await addBand(token, ruleSetId, versionId, { minValue: null, maxValue: null, gstPercent: 18 });

    const res = await activateVersion(token, ruleSetId, versionId);
    expect(res.status).toBe(400);
  });

  it('rejects an inverted band range', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const ruleSetRes = await createRuleSet(token);
    const ruleSetId = ruleSetRes.body.data.id as string;
    const v = await createVersion(token, ruleSetId, { effectiveFrom: '2020-01-01' });
    const versionId = v.body.data.versions[0].id as string;

    const res = await addBand(token, ruleSetId, versionId, { minValue: 5000, maxValue: 4000, gstPercent: 10 });
    expect(res.status).toBe(400);
  });

  it('returns a miss when an HSN has no GST Rule Set, or no version covers the date', async () => {
    const token = await tokenWithRoles(['ADMIN']);
    const unassigned = await createHsn(token, '61142000');
    const hsnId = unassigned.body.data.id as string;

    const noRuleSet = await request(app)
      .get('/gst-rule-sets/resolve')
      .query({ hsnId, date: '2024-01-01', value: 1000 })
      .set('Authorization', auth(token));
    expect(noRuleSet.body.data).toMatchObject({ found: false, reason: 'HSN_HAS_NO_GST_RULE_SET' });

    const { hsnId: assignedHsnId } = await setupActiveGarmentRuleSet(token, '2017-07-01');
    const beforeEffective = await request(app)
      .get('/gst-rule-sets/resolve')
      .query({ hsnId: assignedHsnId, date: '2010-01-01', value: 1000 })
      .set('Authorization', auth(token));
    expect(beforeEffective.body.data).toMatchObject({ found: false, reason: 'NO_ACTIVE_VERSION_FOR_DATE' });
  });

  it('enforces RBAC: FACTORY_USER cannot manage or view GST Rule Sets', async () => {
    const factoryToken = await tokenWithRoles(['FACTORY_USER']);
    expect((await createRuleSet(factoryToken)).status).toBe(403);
    const listRes = await request(app).get('/gst-rule-sets').set('Authorization', auth(factoryToken));
    expect(listRes.status).toBe(403);
  });

  it('allows ACCOUNTANT (finance) to manage GST Rule Sets', async () => {
    const accountantToken = await tokenWithRoles(['ACCOUNTANT']);
    const res = await createRuleSet(accountantToken);
    expect(res.status).toBe(201);
  });

  describe('RBAC finalization: GST Rule Set maintenance is finance-only (ADMIN/ACCOUNTANT), not MERCHANDISER', () => {
    it('lets MERCHANDISER view GST Rule Sets but rejects every mutation', async () => {
      const adminToken = await tokenWithRoles(['ADMIN']);
      const ruleSetRes = await createRuleSet(adminToken);
      const ruleSetId = ruleSetRes.body.data.id as string;
      const versionRes = await createVersion(adminToken, ruleSetId, { effectiveFrom: '2020-01-01' });
      const versionId = versionRes.body.data.versions[0].id as string;
      await addBand(adminToken, ruleSetId, versionId, { minValue: null, maxValue: null, gstPercent: 5 });

      const merchToken = await tokenWithRoles(['MERCHANDISER']);

      expect((await request(app).get('/gst-rule-sets').set('Authorization', auth(merchToken))).status).toBe(200);
      expect((await request(app).get(`/gst-rule-sets/${ruleSetId}`).set('Authorization', auth(merchToken))).status).toBe(200);

      expect((await createRuleSet(merchToken)).status).toBe(403);
      expect(
        (await request(app).patch(`/gst-rule-sets/${ruleSetId}`).set('Authorization', auth(merchToken)).send({ name: 'Hijacked' }))
          .status,
      ).toBe(403);
      expect((await createVersion(merchToken, ruleSetId, { effectiveFrom: '2021-01-01' })).status).toBe(403);
      expect(
        (await addBand(merchToken, ruleSetId, versionId, { minValue: null, maxValue: null, gstPercent: 12 })).status,
      ).toBe(403);
      expect((await activateVersion(merchToken, ruleSetId, versionId)).status).toBe(403);
      expect(
        (await request(app).delete(`/gst-rule-sets/${ruleSetId}/versions/${versionId}`).set('Authorization', auth(merchToken)))
          .status,
      ).toBe(403);
    });
  });
});

describe('validateBandLadder (unit)', () => {
  it('accepts a valid two-band ladder', () => {
    expect(() =>
      validateBandLadder([
        { minValue: null, maxValue: 2500 },
        { minValue: 2500, maxValue: null },
      ]),
    ).not.toThrow();
  });

  it('accepts a single fully-open band', () => {
    expect(() => validateBandLadder([{ minValue: null, maxValue: null }])).not.toThrow();
  });

  it('rejects an empty band list', () => {
    expect(() => validateBandLadder([])).toThrow(BandLadderError);
  });

  it('rejects a gap between bands', () => {
    expect(() =>
      validateBandLadder([
        { minValue: null, maxValue: 2000 },
        { minValue: 2500, maxValue: null },
      ]),
    ).toThrow(BandLadderError);
  });

  it('rejects two bands open at the same lower bound', () => {
    expect(() =>
      validateBandLadder([
        { minValue: null, maxValue: 2000 },
        { minValue: null, maxValue: null },
      ]),
    ).toThrow(BandLadderError);
  });

  it('rejects a ladder missing an open lower bound', () => {
    expect(() =>
      validateBandLadder([
        { minValue: 0, maxValue: 2000 },
        { minValue: 2000, maxValue: null },
      ]),
    ).toThrow(BandLadderError);
  });

  it('rejects a ladder missing an open upper bound', () => {
    expect(() => validateBandLadder([{ minValue: null, maxValue: 2000 }])).toThrow(BandLadderError);
  });
});

describe('ensureCurrentGarmentGstRuleSet (bootstrap)', () => {
  it('seeds the rule set and bands as DRAFT with no effective date — never invents one', async () => {
    const result = await ensureCurrentGarmentGstRuleSet(null);
    expect(result.action).toBe('created_draft');

    const version = await prisma.gstRuleSetVersion.findUnique({
      where: { id: result.versionId },
      include: { bands: true },
    });
    expect(version).toMatchObject({ status: 'DRAFT', effectiveFrom: null, effectiveTo: null });
    expect(version!.bands).toHaveLength(2);
    expect(version!.bands.map((b) => b.gstPercent.toNumber()).sort((a, b) => a - b)).toEqual([5, 18]);

    const ruleSet = await prisma.gstRuleSet.findUnique({ where: { id: result.gstRuleSetId } });
    expect(ruleSet?.code).toBe(CURRENT_GARMENT_GST_RULE_SET_CODE);
  });

  it('is idempotent on repeated calls with no activation in between', async () => {
    const first = await ensureCurrentGarmentGstRuleSet(null);
    const second = await ensureCurrentGarmentGstRuleSet(null);
    expect(second).toEqual({ ...first, action: 'unchanged' });
    expect(await prisma.gstRuleSetVersion.count({ where: { gstRuleSetId: first.gstRuleSetId } })).toBe(1);
  });

  it('is idempotent even after an admin has activated the seeded version with a real date', async () => {
    const seeded = await ensureCurrentGarmentGstRuleSet(null);
    const token = (
      await createTestUserAndToken({ email: `admin-${createId().slice(-8)}@test.local`, password: 'pass', roles: ['ADMIN'] })
    ).token;

    // The admin supplies the real effective date and activates it — the
    // bootstrap must never have guessed this itself.
    await request(app)
      .patch(`/gst-rule-sets/${seeded.gstRuleSetId}/versions/${seeded.versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ effectiveFrom: '2026-04-01' })
      .expect(200);
    await request(app)
      .post(`/gst-rule-sets/${seeded.gstRuleSetId}/versions/${seeded.versionId}/actions/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const again = await ensureCurrentGarmentGstRuleSet(null);
    expect(again).toEqual({ ...seeded, action: 'unchanged' });

    const version = await prisma.gstRuleSetVersion.findUnique({ where: { id: seeded.versionId } });
    expect(version?.status).toBe('ACTIVE');
    expect(version?.effectiveFrom?.toISOString().slice(0, 10)).toBe('2026-04-01');
  });
});
