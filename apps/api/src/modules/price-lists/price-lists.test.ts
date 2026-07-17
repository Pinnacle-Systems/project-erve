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

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function createStyle(overrides?: { status?: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' }) {
  return prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-${createId().slice(-8)}`,
      styleName: 'Test Style',
      finalMrp: 500,
      status: overrides?.status ?? 'ACTIVE',
    },
  });
}

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
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

async function createDraft(token: string, payload: PriceListPayload) {
  return request(app)
    .post('/price-lists')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'FY Price List', ...payload });
}

async function addLine(token: string, priceListId: string, styleId: string, unitPrice: number) {
  return request(app)
    .post(`/price-lists/${priceListId}/lines`)
    .set('Authorization', `Bearer ${token}`)
    .send({ styleId, unitPrice });
}

async function activate(token: string, priceListId: string) {
  return request(app)
    .post(`/price-lists/${priceListId}/actions/activate`)
    .set('Authorization', `Bearer ${token}`);
}

// Creates a DRAFT with one priced style via the API and returns ids.
async function createDraftWithLine(
  token: string,
  distributorId: string,
  options?: { effectiveFrom?: string | null; effectiveTo?: string | null; unitPrice?: number },
) {
  const style = await createStyle();
  const createRes = await createDraft(token, {
    distributorId,
    effectiveFrom: options?.effectiveFrom === undefined ? '2026-01-01' : options.effectiveFrom,
    effectiveTo: options?.effectiveTo ?? null,
  });
  expect(createRes.status).toBe(201);
  const priceListId = createRes.body.data.id as string;
  const lineRes = await addLine(token, priceListId, style.id, options?.unitPrice ?? 199.5);
  expect(lineRes.status).toBe(201);
  return { priceListId, styleId: style.id };
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
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.code).toMatch(/^PL-\d{4}-\d{6}$/);
      expect(res.body.data.distributor.id).toBe(dist.id);
      expect(res.body.data.effectiveFrom).toBe('2026-01-01');
      expect(res.body.data.effectiveTo).toBe('2026-12-31');
      expect(res.body.data.lines).toEqual([]);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_CREATED', entityId: res.body.data.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ distributorId: dist.id });
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

    it('rejects creation without distributorId or name', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const noDistributor = await request(app)
        .post('/price-lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' });
      expect(noDistributor.status).toBe(400);

      const noName = await request(app)
        .post('/price-lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ distributorId: dist.id, name: '' });
      expect(noName.status).toBe(400);
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

    it('rejects creation by roles without price-list management access', async () => {
      const dist = await createTestDistributor();

      for (const role of ['SENIOR_MANAGEMENT', 'ACCOUNTANT', 'FACTORY_USER', 'QA_USER'] as const) {
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

  describe('price list lines — draft editing', () => {
    it('adds a valid line and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const style = await createStyle();
      const createRes = await createDraft(token, { distributorId: dist.id });
      const priceListId = createRes.body.data.id as string;

      const res = await addLine(token, priceListId, style.id, 249.99);

      expect(res.status).toBe(201);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0]).toMatchObject({
        styleId: style.id,
        unitPrice: 249.99,
        currency: 'INR',
      });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_LINE_ADDED', entityId: priceListId },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects duplicate style lines', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const style = await createStyle();
      const createRes = await createDraft(token, { distributorId: dist.id });
      const priceListId = createRes.body.data.id as string;

      await addLine(token, priceListId, style.id, 100);
      const duplicate = await addLine(token, priceListId, style.id, 200);

      expect(duplicate.status).toBe(409);
    });

    it('rejects unknown, inactive styles and non-positive prices', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const inactiveStyle = await createStyle({ status: 'INACTIVE' });
      const style = await createStyle();
      const createRes = await createDraft(token, { distributorId: dist.id });
      const priceListId = createRes.body.data.id as string;

      expect((await addLine(token, priceListId, createId(), 100)).status).toBe(400);
      expect((await addLine(token, priceListId, inactiveStyle.id, 100)).status).toBe(400);
      expect((await addLine(token, priceListId, style.id, 0)).status).toBe(400);
      expect((await addLine(token, priceListId, style.id, -5)).status).toBe(400);
    });

    it('updates and removes draft lines with audit logs', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id, { unitPrice: 100 });
      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      const lineId = detail.body.data.lines[0].id as string;

      const updated = await request(app)
        .patch(`/price-lists/${priceListId}/lines/${lineId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ unitPrice: 150.25 });
      expect(updated.status).toBe(200);
      expect(updated.body.data.lines[0].unitPrice).toBe(150.25);

      const updateAudit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_LINE_UPDATED', entityId: priceListId },
      });
      expect(updateAudit!.metadata).toMatchObject({
        before: { unitPrice: 100 },
        after: { unitPrice: 150.25 },
      });

      const removed = await request(app)
        .delete(`/price-lists/${priceListId}/lines/${lineId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(removed.status).toBe(200);
      expect(removed.body.data.lines).toHaveLength(0);

      const removeAudit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_LINE_REMOVED', entityId: priceListId },
      });
      expect(removeAudit).not.toBeNull();
    });

    it('returns 404 for a line belonging to a different price list', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const first = await createDraftWithLine(token, dist.id);
      const second = await createDraft(token, { distributorId: dist.id, name: 'Other' });
      const firstDetail = await request(app)
        .get(`/price-lists/${first.priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      const lineId = firstDetail.body.data.lines[0].id as string;

      const res = await request(app)
        .patch(`/price-lists/${second.body.data.id}/lines/${lineId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ unitPrice: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /price-lists/:id — draft metadata', () => {
    it('updates draft metadata and records before/after audit metadata', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const createRes = await createDraft(token, { distributorId: dist.id, effectiveFrom: '2026-01-01' });
      const priceListId = createRes.body.data.id as string;

      const res = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed', effectiveFrom: '2026-02-01', effectiveTo: '2026-12-31' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed');
      expect(res.body.data.effectiveFrom).toBe('2026-02-01');
      expect(res.body.data.effectiveTo).toBe('2026-12-31');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_UPDATED', entityId: priceListId },
      });
      expect(audit!.metadata).toMatchObject({
        before: { name: 'FY Price List', effectiveFrom: '2026-01-01' },
        after: { name: 'Renamed', effectiveFrom: '2026-02-01' },
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
  });

  describe('activation lifecycle', () => {
    it('activates a valid draft and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id);

      const res = await activate(token, priceListId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PRICE_LIST_ACTIVATED', entityId: priceListId },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ effectiveFrom: '2026-01-01' });
    });

    it('rejects activating an empty price list', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const createRes = await createDraft(token, { distributorId: dist.id, effectiveFrom: '2026-01-01' });

      const res = await activate(token, createRes.body.data.id);
      expect(res.status).toBe(400);
    });

    it('rejects activation without an effective-from date', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id, { effectiveFrom: null });

      const res = await activate(token, priceListId);
      expect(res.status).toBe(400);
    });

    it('rejects activation when a line style has become inactive', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(token, dist.id);
      await prisma.style.update({ where: { id: styleId }, data: { status: 'INACTIVE' } });

      const res = await activate(token, priceListId);
      expect(res.status).toBe(400);
    });

    it('rejects activation for an inactive distributor', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id);
      await prisma.distributor.update({ where: { id: dist.id }, data: { status: 'INACTIVE' } });

      const res = await activate(token, priceListId);
      expect(res.status).toBe(400);
    });

    it('rejects invalid status transitions', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id);

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
      const { priceListId } = await createDraftWithLine(token, dist.id);
      await activate(token, priceListId);
      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      const lineId = detail.body.data.lines[0].id as string;
      const otherStyle = await createStyle();

      const metadata = await request(app)
        .patch(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope' });
      expect(metadata.status).toBe(400);

      expect((await addLine(token, priceListId, otherStyle.id, 10)).status).toBe(400);

      const lineUpdate = await request(app)
        .patch(`/price-lists/${priceListId}/lines/${lineId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ unitPrice: 1 });
      expect(lineUpdate.status).toBe(400);

      const lineRemove = await request(app)
        .delete(`/price-lists/${priceListId}/lines/${lineId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(lineRemove.status).toBe(400);
    });

    it('retires an ACTIVE list, keeps it readable, and records an audit log', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(token, dist.id, { unitPrice: 321.5 });
      await activate(token, priceListId);

      const res = await request(app)
        .post(`/price-lists/${priceListId}/actions/retire`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('EXPIRED');

      // Historical list stays readable with prices and dates untouched
      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.lines[0].unitPrice).toBe(321.5);
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

      const first = await createDraftWithLine(token, dist.id, {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });
      expect((await activate(token, first.priceListId)).status).toBe(200);

      const second = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-06-01' });
      const res = await activate(token, second.priceListId);
      expect(res.status).toBe(409);
    });

    it('allows overlapping periods for different distributors', async () => {
      const token = await adminToken();
      const distA = await createTestDistributor();
      const distB = await createTestDistributor();

      const a = await createDraftWithLine(token, distA.id);
      const b = await createDraftWithLine(token, distB.id);

      expect((await activate(token, a.priceListId)).status).toBe(200);
      expect((await activate(token, b.priceListId)).status).toBe(200);
    });

    it('ends an open-ended predecessor the day before the replacement takes effect', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const first = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, first.priceListId);

      const second = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-07-01' });
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

      const first = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, first.priceListId);

      const second = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });
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
            effectiveFrom: new Date('2026-06-01'),
            status: 'ACTIVE',
          },
        }),
      ).rejects.toThrowError(/price_lists_no_overlapping_active_periods|exclusion/i);
    });

    it('serializes concurrent activations — exactly one wins', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();

      const a = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });
      const b = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });

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

      const a = await createDraftWithLine(token, distA.id, {
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
      expect(byDistributor.body.data[0].lineCount).toBe(1);

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

      const older = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-01-01' });
      await activate(token, older.priceListId);
      const newer = await createDraftWithLine(token, dist.id, { effectiveFrom: '2026-07-01' });
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

  describe('GET /price-lists/lookup — deterministic price lookup', () => {
    it('returns the applicable price with source identifiers', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(token, dist.id, { unitPrice: 499.75 });
      await activate(token, priceListId);

      const res = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId, date: '2026-05-15' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.unitPrice).toBe(499.75);
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.priceListId).toBe(priceListId);
      expect(res.body.data.priceListLineId).toBeTruthy();
      expect(res.body.data.effectiveFrom).toBe('2026-01-01');
    });

    it('resolves the correct historical price after supersession', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const style = await createStyle();

      const first = await createDraft(token, { distributorId: dist.id, effectiveFrom: '2026-01-01' });
      await addLine(token, first.body.data.id, style.id, 100);
      await activate(token, first.body.data.id);

      const second = await createDraft(token, { distributorId: dist.id, effectiveFrom: '2026-07-01' });
      await addLine(token, second.body.data.id, style.id, 120);
      await activate(token, second.body.data.id);

      const before = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId: style.id, date: '2026-06-30' })
        .set('Authorization', `Bearer ${token}`);
      expect(before.body.data).toMatchObject({ found: true, unitPrice: 100 });

      const after = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId: style.id, date: '2026-07-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.data).toMatchObject({ found: true, unitPrice: 120 });
    });

    it('returns a clear not-found result when no price applies', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(token, dist.id, {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      });
      await activate(token, priceListId);
      const unpricedStyle = await createStyle();

      const outsidePeriod = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId, date: '2026-07-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(outsidePeriod.status).toBe(200);
      expect(outsidePeriod.body.data).toEqual({ found: false, reason: 'NO_ACTIVE_PRICE_LIST' });

      const notPriced = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId: unpricedStyle.id, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(notPriced.body.data).toEqual({ found: false, reason: 'STYLE_NOT_PRICED' });
    });

    it('does not fall back to another distributor price list', async () => {
      const token = await adminToken();
      const priced = await createTestDistributor();
      const unpriced = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(token, priced.id);
      await activate(token, priceListId);

      const res = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: unpriced.id, styleId, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.data).toEqual({ found: false, reason: 'NO_ACTIVE_PRICE_LIST' });
    });

    it('rejects lookups for inactive distributors and styles', async () => {
      const token = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(token, dist.id);
      await activate(token, priceListId);

      await prisma.distributor.update({ where: { id: dist.id }, data: { status: 'INACTIVE' } });
      const inactiveDist = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(inactiveDist.status).toBe(400);

      await prisma.distributor.update({ where: { id: dist.id }, data: { status: 'ACTIVE' } });
      await prisma.style.update({ where: { id: styleId }, data: { status: 'DISCONTINUED' } });
      const inactiveStyle = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: dist.id, styleId, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(inactiveStyle.status).toBe(400);
    });
  });

  describe('distributor-user isolation', () => {
    it('scopes list, detail, history and lookup to the mapped distributor and ACTIVE lists', async () => {
      const admin = await adminToken();
      const own = await createTestDistributor();
      const other = await createTestDistributor();

      const ownActive = await createDraftWithLine(admin, own.id, { unitPrice: 111 });
      await activate(admin, ownActive.priceListId);
      const ownDraft = await createDraft(admin, { distributorId: own.id, name: 'Own draft' });
      const otherActive = await createDraftWithLine(admin, other.id);
      await activate(admin, otherActive.priceListId);

      const token = await distributorUserToken(own.id);

      // List: only own ACTIVE list, even when asking for another distributor
      const list = await request(app).get('/price-lists').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(ownActive.priceListId);

      const listOther = await request(app)
        .get('/price-lists')
        .query({ distributorId: other.id, status: 'DRAFT' })
        .set('Authorization', `Bearer ${token}`);
      expect(listOther.body.data).toHaveLength(1);
      expect(listOther.body.data[0].id).toBe(ownActive.priceListId);

      // Detail: own ACTIVE readable; own DRAFT and other distributor's list are not
      expect(
        (await request(app).get(`/price-lists/${ownActive.priceListId}`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(200);
      expect(
        (await request(app).get(`/price-lists/${ownDraft.body.data.id}`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
      expect(
        (await request(app).get(`/price-lists/${otherActive.priceListId}`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);

      // History: own returns only ACTIVE; other distributor is forbidden
      const history = await request(app)
        .get(`/price-lists/distributors/${own.id}/history`)
        .set('Authorization', `Bearer ${token}`);
      expect(history.status).toBe(200);
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0].id).toBe(ownActive.priceListId);
      expect(
        (
          await request(app)
            .get(`/price-lists/distributors/${other.id}/history`)
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(403);

      // Lookup: own works, other distributor is forbidden
      const ownLookup = await request(app)
        .get('/price-lists/lookup')
        .query({ distributorId: own.id, styleId: ownActive.styleId, date: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(ownLookup.status).toBe(200);
      expect(ownLookup.body.data.unitPrice).toBe(111);

      expect(
        (
          await request(app)
            .get('/price-lists/lookup')
            .query({ distributorId: other.id, styleId: otherActive.styleId, date: '2026-03-01' })
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(403);
    });

    it('blocks distributor users from every mutation endpoint', async () => {
      const admin = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId, styleId } = await createDraftWithLine(admin, dist.id);
      const detail = await request(app)
        .get(`/price-lists/${priceListId}`)
        .set('Authorization', `Bearer ${admin}`);
      const lineId = detail.body.data.lines[0].id as string;
      const token = await distributorUserToken(dist.id);
      const auth = { Authorization: `Bearer ${token}` };

      expect((await request(app).post('/price-lists').set(auth).send({ distributorId: dist.id, name: 'X' })).status).toBe(403);
      expect((await request(app).patch(`/price-lists/${priceListId}`).set(auth).send({ name: 'X' })).status).toBe(403);
      expect((await request(app).post(`/price-lists/${priceListId}/lines`).set(auth).send({ styleId, unitPrice: 10 })).status).toBe(403);
      expect((await request(app).patch(`/price-lists/${priceListId}/lines/${lineId}`).set(auth).send({ unitPrice: 10 })).status).toBe(403);
      expect((await request(app).delete(`/price-lists/${priceListId}/lines/${lineId}`).set(auth)).status).toBe(403);
      expect((await request(app).post(`/price-lists/${priceListId}/actions/activate`).set(auth)).status).toBe(403);
      expect((await request(app).post(`/price-lists/${priceListId}/actions/retire`).set(auth)).status).toBe(403);
    });

    it('allows read-only roles to view but not mutate', async () => {
      const admin = await adminToken();
      const dist = await createTestDistributor();
      const { priceListId } = await createDraftWithLine(admin, dist.id);

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
      expect(mutate.status).toBe(403);
    });
  });
});
