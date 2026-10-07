import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestDistributor, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function adminToken() {
  const { token } = await createTestUserAndToken({
    email: `admin-${createId().slice(-8)}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  return token;
}

async function distributorUserToken(distributorId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `dist-${createId().slice(-8)}@test.local`,
    password: 'pass',
    roles: ['DISTRIBUTOR'],
  });
  await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  return token;
}

interface PriceListPayload {
  distributorId?: string;
  name?: string;
  percentageOfMrp?: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

async function createDraft(token: string, payload: PriceListPayload) {
  return request(app)
    .post('/price-lists')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'FY Price List', percentageOfMrp: 60, ...payload });
}

async function activate(token: string, priceListId: string) {
  return request(app)
    .post(`/price-lists/${priceListId}/actions/activate`)
    .set('Authorization', `Bearer ${token}`);
}

// Creates an activatable DRAFT via the API and returns its id.
async function createActivatableDraft(
  token: string,
  distributorId: string,
  options?: { effectiveFrom?: string | null; effectiveTo?: string | null; percentageOfMrp?: number },
) {
  const res = await createDraft(token, {
    distributorId,
    percentageOfMrp: options?.percentageOfMrp ?? 60,
    effectiveFrom: options?.effectiveFrom === undefined ? '2026-01-01' : options.effectiveFrom,
    effectiveTo: options?.effectiveTo ?? null,
  });
  expect(res.status).toBe(201);
  return { priceListId: res.body.data.id as string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('price lists API', () => {
  describe('POST /price-lists — create draft', () => {
    it('creates a DRAFT price list with a generated code and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const res = await createDraft(token, {
        distributorId: dist.id,
        percentageOfMrp: 60,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.code).toMatch(/^PL-\d{4}-\d{6}$/);
      expect(res.body.data.distributor.id).toBe(dist.id);
      expect(res.body.data.percentageOfMrp).toBe(60);
      expect(res.body.data.effectiveFrom).toBe('2026-01-01');
      expect(res.body.data.effectiveTo).toBe('2026-12-31');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_CREATED', entityId: res.body.data.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ distributorId: dist.id, percentageOfMrp: 60 });
    });

    it('persists a fractional percentage exactly', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const res = await createDraft(token, { distributorId: dist.id, percentageOfMrp: 57.25 });

      expect(res.status).toBe(201);
      expect(res.body.data.percentageOfMrp).toBe(57.25);
    });

    it('allows MERCHANDISER to create price lists', async () => {
      const { token } = await createTestUserAndToken({
        email: 'merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();

      const res = await createDraft(token, { distributorId: dist.id });
      expect(res.status).toBe(201);
    });

    it('rejects creation without distributorId, name or percentage', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const noDistributor = await request(app)
        .post('/price-lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X', percentageOfMrp: 50 });
      expect(noDistributor.status).toBe(400);

      const noName = await request(app)
        .post('/price-lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ distributorId: dist.id, name: '', percentageOfMrp: 50 });
      expect(noName.status).toBe(400);

      const noPercentage = await request(app)
        .post('/price-lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ distributorId: dist.id, name: 'X' });
      expect(noPercentage.status).toBe(400);
    });

    it('rejects a percentage outside 0-100', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      expect((await createDraft(token, { distributorId: dist.id, percentageOfMrp: -1 })).status).toBe(400);
      expect((await createDraft(token, { distributorId: dist.id, percentageOfMrp: 100.01 })).status).toBe(
        400,
      );
      expect((await createDraft(token, { distributorId: dist.id, percentageOfMrp: 0 })).status).toBe(201);
      expect((await createDraft(token, { distributorId: dist.id, percentageOfMrp: 100 })).status).toBe(201);
    });

    it('rejects invalid date formats and inverted effective periods', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const badFormat = await createDraft(token, {
        distributorId: dist.id,
        effectiveFrom: '01/01/2026',
      });
      expect(badFormat.status).toBe(400);

      const inverted = await createDraft(token, {
        distributorId: dist.id,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-01-01',
      });
      expect(inverted.status).toBe(400);

      const endWithoutStart = await createDraft(token, {
        distributorId: dist.id,
        effectiveFrom: null,
        effectiveTo: '2026-01-01',
      });
      expect(endWithoutStart.status).toBe(400);
    });

    it('rejects creation for an unknown or inactive distributor', async () => {
      const token = await adminToken();
      const inactive = await createTestDistributor({ status: 'INACTIVE' });

      const unknown = await createDraft(token, { distributorId: createId() });
      expect(unknown.status).toBe(400);

      const res = await createDraft(token, { distributorId: inactive.id });
      expect(res.status).toBe(400);
    });

    it('allows ACCOUNTANT to create price lists (finance exception)', async () => {
      const dist = await createTestDistributor();
      const { token } = await createTestUserAndToken({
        email: `accountant-${createId().slice(-6)}@test.local`,
        password: 'pass',
        roles: ['ACCOUNTANT'],
      });

      const res = await createDraft(token, { distributorId: dist.id });

      expect(res.status).toBe(201);
    });

    it('rejects creation by roles without price-list management access', async () => {
      const dist = await createTestDistributor();

      for (const role of ['SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'] as const) {
        const { token } = await createTestUserAndToken({
          email: `${role.toLowerCase()}-${createId().slice(-6)}@test.local`,
          password: 'pass',
          roles: [role],
        });
        const res = await createDraft(token, { distributorId: dist.id });
        expect(res.status).toBe(403);
      }

      const distToken = await distributorUserToken(dist.id);
      const res = await createDraft(distToken, { distributorId: dist.id });
      expect(res.status).toBe(403);

      const unauthenticated = await request(app).post('/price-lists').send({ distributorId: dist.id, name: 'X' });
      expect(unauthenticated.status).toBe(401);
    });
  });

  describe('PATCH /price-lists/:id — draft metadata', () => {
    it('updates draft metadata (including the percentage) and records before/after audit metadata', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const createRes = await createDraft(token, {
        distributorId: dist.id,
        percentageOfMrp: 60,
        effectiveFrom: '2026-01-01',
      });
      const priceListId = createRes.body.data.id as string;

      const res = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed', percentageOfMrp: 65.5, effectiveFrom: '2026-02-01', effectiveTo: '2026-12-31' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed');
      expect(res.body.data.percentageOfMrp).toBe(65.5);
      expect(res.body.data.effectiveFrom).toBe('2026-02-01');
      expect(res.body.data.effectiveTo).toBe('2026-12-31');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_UPDATED', entityId: priceListId },
      });
      expect(audit!.metadata).toMatchObject({
        before: { name: 'FY Price List', percentageOfMrp: 60, effectiveFrom: '2026-01-01' },
        after: { name: 'Renamed', percentageOfMrp: 65.5, effectiveFrom: '2026-02-01' },
      });
    });

    it('rejects an inverted effective period resulting from the update', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const createRes = await createDraft(token, { distributorId: dist.id, effectiveFrom: '2026-06-01' });

      const res = await request(app)
        .patch(`/price-lists/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ effectiveTo: '2026-01-01' });
      expect(res.status).toBe(400);
    });

    it('rejects a percentage update outside 0-100', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const createRes = await createDraft(token, { distributorId: dist.id });

      const res = await request(app)
        .patch(`/price-lists/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ percentageOfMrp: 150 });
      expect(res.status).toBe(400);
    });
  });

  describe('activation lifecycle', () => {
    it('activates a valid draft and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id);

      const res = await activate(token, priceListId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_ACTIVATED', entityId: priceListId },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ effectiveFrom: '2026-01-01' });
    });

    it('rejects activation without an effective-from date', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id, { effectiveFrom: null });

      const res = await activate(token, priceListId);
      expect(res.status).toBe(400);
    });

    it('rejects activation for an inactive distributor', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id);
      await prisma.distributor.update({ where: { id: dist.id }, data: { status: 'INACTIVE' } });

      const res = await activate(token, priceListId);
      expect(res.status).toBe(400);
    });

    it('rejects invalid status transitions', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id);

      // Draft cannot be retired
      const retireDraft = await request(app)
        .post(`/price-lists/${priceListId}/actions/retire`)
        .set('Authorization', `Bearer ${token}`);
      expect(retireDraft.status).toBe(400);

      await activate(token, priceListId);

      // Active cannot be re-activated
      const reactivate = await activate(token, priceListId);
      expect(reactivate.status).toBe(400);

      await request(app)
        .post(`/price-lists/${priceListId}/actions/retire`)
        .set('Authorization', `Bearer ${token}`);

      // Retired cannot be activated or retired again
      expect((await activate(token, priceListId)).status).toBe(400);
      const retireAgain = await request(app)
        .post(`/price-lists/${priceListId}/actions/retire`)
        .set('Authorization', `Bearer ${token}`);
      expect(retireAgain.status).toBe(400);
    });

    it('rejects modification of an ACTIVE price list', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id);
      await activate(token, priceListId);

      const metadata = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope' });
      expect(metadata.status).toBe(400);

      const percentage = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ percentageOfMrp: 10 });
      expect(percentage.status).toBe(400);
    });

    it('retires an ACTIVE list, keeps it readable, and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id, { percentageOfMrp: 42.5 });
      await activate(token, priceListId);

      const res = await request(app)
        .post(`/price-lists/${priceListId}/actions/retire`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('EXPIRED');

      // Historical list stays readable with its percentage and dates untouched
      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.percentageOfMrp).toBe(42.5);
      expect(detail.body.data.effectiveFrom).toBe('2026-01-01');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_RETIRED', entityId: priceListId },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('overlapping effective periods', () => {
    it('rejects activation overlapping a bounded ACTIVE list', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const first = await createActivatableDraft(token, dist.id, {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });
      expect((await activate(token, first.priceListId)).status).toBe(200);

      const second = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-06-01' });
      const res = await activate(token, second.priceListId);
      expect(res.status).toBe(409);
    });

    it('allows overlapping periods for different distributors', async () => {
      const token = await adminToken();
      const distA = await createTestDistributor();
      const distB = await createTestDistributor();

      const a = await createActivatableDraft(token, distA.id);
      const b = await createActivatableDraft(token, distB.id);

      expect((await activate(token, a.priceListId)).status).toBe(200);
      expect((await activate(token, b.priceListId)).status).toBe(200);
    });

    it('ends an open-ended predecessor the day before the replacement takes effect', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const first = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, first.priceListId);

      const second = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-07-01' });
      const res = await activate(token, second.priceListId);
      expect(res.status).toBe(200);

      const previous = await request(app)
        .get(`/price-lists/${first.priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(previous.body.data.status).toBe('ACTIVE');
      expect(previous.body.data.effectiveTo).toBe('2026-06-30');

      const supersededAudit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_SUPERSEDED', entityId: first.priceListId },
      });
      expect(supersededAudit!.metadata).toMatchObject({
        supersededByPriceListId: second.priceListId,
        effectiveTo: '2026-06-30',
      });
    });

    it('rejects replacing an open-ended predecessor that starts on the same day', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const first = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, first.priceListId);

      const second = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });
      const res = await activate(token, second.priceListId);
      expect(res.status).toBe(409);
    });

    it('database exclusion constraint blocks overlapping ACTIVE rows even without the API', async () => {
      const dist = await createTestDistributor();
      await prisma.priceList.create({
        data: {
          id: createId(),
          code: `PL-RAW-${createId().slice(-6)}`,
          name: 'Raw A',
          distributorId: dist.id,
          percentageOfMrp: 50,
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
      });

      await expect(
        prisma.priceList.create({
          data: {
            id: createId(),
            code: `PL-RAW-${createId().slice(-6)}`,
            name: 'Raw B',
            distributorId: dist.id,
            percentageOfMrp: 55,
            effectiveFrom: new Date('2026-06-01'),
            status: 'ACTIVE',
          },
        }),
      ).rejects.toThrowError(/price_lists_no_overlapping_active_periods|exclusion/i);
    });

    it('serializes concurrent activations — exactly one wins', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const a = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });
      const b = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });

      const [resA, resB] = await Promise.all([
        activate(token, a.priceListId),
        activate(token, b.priceListId),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const activeCount = await prisma.priceList.count({
        where: { distributorId: dist.id, status: 'ACTIVE' },
      });
      expect(activeCount).toBe(1);
    });
  });

  describe('GET /price-lists — list and history', () => {
    it('filters by distributor, status and effective date', async () => {
      const token = await adminToken();
      const distA = await createTestDistributor();
      const distB = await createTestDistributor();

      const a = await createActivatableDraft(token, distA.id, {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      });
      await activate(token, a.priceListId);
      await createDraft(token, { distributorId: distB.id, name: 'B Draft' });

      const byDistributor = await request(app)
        .get('/price-lists')
        .query({ distributorId: distA.id })
        .set('Authorization', `Bearer ${token}`);
      expect(byDistributor.body.data).toHaveLength(1);
      expect(byDistributor.body.data[0].id).toBe(a.priceListId);
      expect(byDistributor.body.data[0].percentageOfMrp).toBe(60);

      const byStatus = await request(app)
        .get('/price-lists')
        .query({ status: 'DRAFT' })
        .set('Authorization', `Bearer ${token}`);
      expect(byStatus.body.data).toHaveLength(1);
      expect(byStatus.body.data[0].distributor.id).toBe(distB.id);

      const effectiveHit = await request(app)
        .get('/price-lists')
        .query({ effectiveOn: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(effectiveHit.body.data).toHaveLength(1);
      expect(effectiveHit.body.data[0].id).toBe(a.priceListId);

      const effectiveMiss = await request(app)
        .get('/price-lists')
        .query({ effectiveOn: '2026-07-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(effectiveMiss.body.data).toHaveLength(0);
    });

    it('returns distributor price-list history ordered by effective date', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const older = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, older.priceListId);
      const newer = await createActivatableDraft(token, dist.id, { effectiveFrom: '2026-07-01' });
      await activate(token, newer.priceListId);
      await createDraft(token, { distributorId: dist.id, name: 'Pending draft' });

      const res = await request(app)
        .get(`/price-lists/distributors/${dist.id}/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].id).toBe(newer.priceListId);
      expect(res.body.data[1].id).toBe(older.priceListId);
      expect(res.body.data[1].effectiveTo).toBe('2026-06-30');
    });
  });

  describe('GET /price-lists/lookup — deterministic percentage resolver', () => {
    it('returns the applicable percentage with source identifiers', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id, { percentageOfMrp: 49.75 });
      await activate(token, priceListId);

      const res = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, date: '2026-05-15' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.percentageOfMrp).toBe(49.75);
      expect(res.body.data.priceListId).toBe(priceListId);
      expect(res.body.data.distributorId).toBe(dist.id);
      expect(res.body.data.effectiveFrom).toBe('2026-01-01');
    });

    it('resolves the correct historical percentage after supersession', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const first = await createDraft(token, {
        distributorId: dist.id,
        percentageOfMrp: 50,
        effectiveFrom: '2026-01-01',
      });
      await activate(token, first.body.data.id);

      const second = await createDraft(token, {
        distributorId: dist.id,
        percentageOfMrp: 55,
        effectiveFrom: '2026-07-01',
      });
      await activate(token, second.body.data.id);

      const before = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, date: '2026-06-30' })
        .set('Authorization', `Bearer ${token}`);
      expect(before.body.data).toMatchObject({ found: true, percentageOfMrp: 50 });

      const after = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, date: '2026-07-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.data).toMatchObject({ found: true, percentageOfMrp: 55 });
    });

    it('returns a clear not-found result when no price list applies', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id, {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      });
      await activate(token, priceListId);

      const outsidePeriod = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, date: '2026-07-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(outsidePeriod.status).toBe(200);
      expect(outsidePeriod.body.data).toEqual({ found: false, reason: 'NO_ACTIVE_PRICE_LIST' });
    });

    it('does not fall back to another distributor price list', async () => {
      const token = await adminToken();
      const priced = await createTestDistributor();
      const unpriced = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, priced.id);
      await activate(token, priceListId);

      const res = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: unpriced.id, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.data).toEqual({ found: false, reason: 'NO_ACTIVE_PRICE_LIST' });
    });

    it('rejects lookups for an unknown or inactive distributor', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(token, dist.id);
      await activate(token, priceListId);

      const unknown = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: createId(), date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(unknown.status).toBe(400);

      await prisma.distributor.update({ where: { id: dist.id }, data: { status: 'INACTIVE' } });
      const inactiveDist = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(inactiveDist.status).toBe(400);
    });
  });

  describe('distributor-user isolation', () => {
    // DISTRIBUTOR has no access to the Price List master module at all —
    // not even scoped to their own distributor. A distributor's own
    // commercial percentage, if ever shown, must come from an embedded field
    // on an authorized transaction, not from browsing Price Lists.
    it('blocks a DISTRIBUTOR user from list, detail, history and lookup — even for their own distributor', async () => {
      const admin = await adminToken();
      const own = await createTestDistributor();
      const other = await createTestDistributor();

      const ownActive = await createActivatableDraft(admin, own.id, { percentageOfMrp: 40 });
      await activate(admin, ownActive.priceListId);
      const otherActive = await createActivatableDraft(admin, other.id);
      await activate(admin, otherActive.priceListId);

      const token = await distributorUserToken(own.id);
      const auth = { Authorization: `Bearer ${token}` };

      expect((await request(app).get('/price-lists').set(auth)).status).toBe(403);
      expect(
        (await request(app).get(`/price-lists/${ownActive.priceListId}`).set(auth)).status,
      ).toBe(403);
      expect(
        (await request(app).get(`/price-lists/distributors/${own.id}/history`).set(auth)).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/price-lists/lookup')
            .query({ distributorId: own.id, date: '2026-03-01' })
            .set(auth)
        ).status,
      ).toBe(403);
    });

    it('blocks distributor users from every mutation endpoint', async () => {
      const admin = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(admin, dist.id);
      const token = await distributorUserToken(dist.id);
      const auth = { Authorization: `Bearer ${token}` };

      expect(
        (
          await request(app)
            .post('/price-lists')
            .set(auth)
            .send({ distributorId: dist.id, name: 'X', percentageOfMrp: 10 })
        ).status,
      ).toBe(403);
      expect((await request(app).patch(`/price-lists/${priceListId}`).set(auth).send({ name: 'X' })).status).toBe(
        403,
      );
      expect((await request(app).post(`/price-lists/${priceListId}/actions/activate`).set(auth)).status).toBe(
        403,
      );
      expect((await request(app).post(`/price-lists/${priceListId}/actions/retire`).set(auth)).status).toBe(403);
    });

    it('allows a read-only role (SENIOR_MANAGEMENT) to view but not mutate', async () => {
      const admin = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(admin, dist.id);

      const { token } = await createTestUserAndToken({
        email: 'senior-mgmt@test.local',
        password: 'pass',
        roles: ['SENIOR_MANAGEMENT'],
      });

      const list = await request(app).get('/price-lists').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);

      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);

      const mutate = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' });
      expect(mutate.status).toBe(403);
    });

    it('allows ACCOUNTANT to both view and mutate (finance exception)', async () => {
      const admin = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createActivatableDraft(admin, dist.id);

      const { token } = await createTestUserAndToken({
        email: 'accountant@test.local',
        password: 'pass',
        roles: ['ACCOUNTANT'],
      });

      const list = await request(app).get('/price-lists').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);

      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);

      const mutate = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' });
      expect(mutate.status).toBe(200);
      expect(mutate.body.data.name).toBe('X');
    });
  });

  // UXAUTH-013: ACCOUNTANT can manage Price Lists but is denied on the broad
  // Distributor master. This endpoint gives ACCOUNTANT (and the other
  // Price-List-capable roles) the minimal option data the Price List
  // Distributor selector needs, without granting master-data browsing.
  describe('GET /price-lists/distributor-options (UXAUTH-013)', () => {
    it.each([
      ['ADMIN', 200],
      ['MERCHANDISER', 200],
      ['SENIOR_MANAGEMENT', 200],
      ['ACCOUNTANT', 200],
      ['FACTORY_USER', 403],
      ['QA_USER', 403],
      ['DISTRIBUTOR', 403],
    ] as const)('applies the Price List read authorization matrix for %s', async (role, expectedStatus) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}-pl-options@test.local`,
        password: 'test-password',
        roles: [role],
      });

      const distributorOptions = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);

      expect(distributorOptions.status).toBe(expectedStatus);
    });

    it('lets ACCOUNTANT fetch distributor options while still denying the broad master', async () => {
      await createTestDistributor({ code: 'DIST-OPT', name: 'Option Distributors' });

      const { token } = await createTestUserAndToken({
        email: 'accountant-options@test.local',
        password: 'test-password',
        roles: ['ACCOUNTANT'],
      });

      const distributorOptions = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);
      const directDistributors = await request(app)
        .get('/distributors')
        .set('Authorization', `Bearer ${token}`);

      expect(distributorOptions.status).toBe(200);
      expect(distributorOptions.body.data.length).toBeGreaterThan(0);
      expect(directDistributors.status).toBe(403);
    });

    it('returns only the minimal DTO fields, not the full master record', async () => {
      await createTestDistributor({ code: 'DIST-MIN', name: 'Minimal Distributors' });
      const token = await adminToken();

      const distributorOptions = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);

      expect(Object.keys(distributorOptions.body.data[0]).sort()).toEqual(
        ['code', 'id', 'name', 'status'].sort(),
      );
    });

    it('includes inactive distributors unless a status filter is passed (historical read access)', async () => {
      const inactiveDist = await createTestDistributor({
        code: 'DIST-INA',
        name: 'Inactive Distributors',
        status: 'INACTIVE',
      });
      const token = await adminToken();

      const allDistributors = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);
      const activeDistributors = await request(app)
        .get('/price-lists/distributor-options')
        .query({ status: 'ACTIVE' })
        .set('Authorization', `Bearer ${token}`);

      expect(allDistributors.body.data.map((d: { id: string }) => d.id)).toContain(inactiveDist.id);
      expect(activeDistributors.body.data.map((d: { id: string }) => d.id)).not.toContain(inactiveDist.id);
    });

    it('returns the complete option set, not just a first page', async () => {
      const token = await adminToken();
      const created = await Promise.all(
        Array.from({ length: 25 }, (_, i) => createTestDistributor({ code: `DIST-BULK-${i}`, name: `Bulk Distributor ${i}` })),
      );

      const res = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);

      const returnedIds = new Set(res.body.data.map((d: { id: string }) => d.id));
      expect(created.every((d) => returnedIds.has(d.id))).toBe(true);
    });

    it("is not swallowed by the '/:id' route", async () => {
      const token = await adminToken();

      const distributorOptions = await request(app)
        .get('/price-lists/distributor-options')
        .set('Authorization', `Bearer ${token}`);

      expect(distributorOptions.status).toBe(200);
      expect(Array.isArray(distributorOptions.body.data)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// P1L8 — bounded Price List Distributor lookup
// ---------------------------------------------------------------------------

describe('GET /price-lists/distributor-options — bounded search (P1L8)', () => {
  function searchOptions(token: string, query: Record<string, string | number>) {
    return request(app)
      .get('/price-lists/distributor-options')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }

  function codes(res: request.Response): string[] {
    return (res.body.data as Array<{ code: string }>).map((option) => option.code).sort();
  }

  it('searches code and name case-insensitively and keeps the status filter', async () => {
    const token = await adminToken();
    await createTestDistributor({ code: 'KOC-001', name: 'Kerala Kids Wear' });
    await createTestDistributor({ code: 'KOC-002', name: 'Kochi Retired', status: 'INACTIVE' });
    await createTestDistributor({ code: 'BLR-001', name: 'Bangalore Apparel' });

    expect(codes(await searchOptions(token, { search: 'koc', limit: 20 }))).toEqual(['KOC-001', 'KOC-002']);
    expect(codes(await searchOptions(token, { search: 'KIDS', limit: 20 }))).toEqual(['KOC-001']);
    expect(codes(await searchOptions(token, { search: 'koc', status: 'ACTIVE', limit: 20 }))).toEqual([
      'KOC-001',
    ]);
  });

  it('bounds results when a limit is given, rejects an over-max limit, and keeps the full set without one', async () => {
    const token = await adminToken();
    for (let index = 0; index < 23; index += 1) {
      const suffix = String(index).padStart(2, '0');
      await createTestDistributor({ code: `BULK-${suffix}`, name: `Bulk Distributor ${suffix}` });
    }

    expect((await searchOptions(token, { search: 'Bulk', limit: 20 })).body.data).toHaveLength(20);
    expect(codes(await searchOptions(token, { search: 'Bulk', limit: 2 }))).toEqual(['BULK-00', 'BULK-01']);
    expect((await searchOptions(token, { limit: 51 })).status).toBe(400);
    expect((await searchOptions(token, {})).body.data).toHaveLength(23);
  });

  it('treats an empty search as the bounded initial options, status filter first, name then id (LU0)', async () => {
    const token = await adminToken();
    for (let index = 0; index < 3; index += 1) {
      await createTestDistributor({ code: `INIT-OFF-${index}`, name: `AAA Retired ${index}`, status: 'INACTIVE' });
    }
    const twins = [];
    for (let index = 0; index < 3; index += 1) {
      twins.push(await createTestDistributor({ code: `INIT-TWIN-${index}`, name: 'Bharat Twin' }));
    }

    const res = await searchOptions(token, { search: '', status: 'ACTIVE', limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual(
      twins.map((twin) => twin.id).sort().slice(0, 2),
    );
  });

  it('keeps the minimal DTO and the Price List read permission', async () => {
    await createTestDistributor({ code: 'DTO-01', name: 'Dto Distributor' });
    const { token: accountant } = await createTestUserAndToken({
      email: 'accountant-pl-dist-search@test.local',
      password: 'test-password',
      roles: ['ACCOUNTANT'],
    });
    const { token: distributorUser } = await createTestUserAndToken({
      email: 'distributor-pl-dist-search@test.local',
      password: 'test-password',
      roles: ['DISTRIBUTOR'],
    });

    const res = await searchOptions(accountant, { search: 'DTO', limit: 20 });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'status']);
    expect((await searchOptions(distributorUser, { search: 'DTO', limit: 20 })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PAG6 — opt-in cursor pagination for the Price List list
// ---------------------------------------------------------------------------

describe('GET /price-lists pagination (PAG6)', () => {
  it('keeps the legacy array without paging params, and pages every list exactly once in the same order', async () => {
    const token = await adminToken();
    const dist = await createTestDistributor();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const res = await createDraft(token, { distributorId: dist.id, name: `List ${index}` });
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    // Identical createdAt for every row: only the id tie-breaker keeps pages stable.
    await prisma.priceList.updateMany({ data: { createdAt: new Date('2026-01-01T00:00:00Z') } });

    const legacy = await request(app).get('/price-lists').set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(legacy.body.data)).toBe(true);

    const paged: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const res = await request(app)
        .get('/price-lists')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      paged.push(...res.body.data.items.map((item: { id: string }) => item.id));
      if (!res.body.data.pageInfo.hasMore) break;
      cursor = res.body.data.pageInfo.nextCursor;
    }

    expect(paged).toHaveLength(5);
    expect(new Set(paged)).toEqual(new Set(ids));
    expect(paged).toEqual(legacy.body.data.map((item: { id: string }) => item.id));
  });

  it('applies filters before paging and rejects an over-max limit', async () => {
    const token = await adminToken();
    const distA = await createTestDistributor({ code: 'PG-A' });
    const distB = await createTestDistributor({ code: 'PG-B' });
    await createDraft(token, { distributorId: distA.id, name: 'A list' });
    await createDraft(token, { distributorId: distB.id, name: 'B list' });

    const res = await request(app)
      .get('/price-lists')
      .query({ distributorId: distA.id, limit: 10 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data.items.map((item: { name: string }) => item.name)).toEqual(['A list']);
    expect(res.body.data.pageInfo.hasMore).toBe(false);
    expect((await request(app).get('/price-lists').query({ limit: 101 }).set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});
