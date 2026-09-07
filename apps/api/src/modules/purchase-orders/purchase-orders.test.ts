import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFinancialYear,
  createTestJobOrderStub,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { DOCUMENT_PREFIXES } from '../master-data/document-number.util.js';

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

async function createSize(code: string, sortOrder: number) {
  return prisma.size.create({
    data: { id: createId(), code, label: code, sizeType: 'AGE', sortOrder },
  });
}

async function createStyle(overrides?: { status?: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' }) {
  const seasonId = createId();
  // Fixed date, not "now" — keeps this deterministic regardless of when the
  // suite runs, and matches createPO's default poDate's Financial Year
  // (2026-06-30 -> FY 2026-27) so fixtures stay intuitive, even though no
  // PO<->Season FY-consistency rule actually requires this to match.
  const financialYear = await createTestFinancialYear(new Date('2026-06-30'));
  const id = createId();
  return prisma.style.create({
    data: {
      id,
      // Derived from this style's own (already-unique) id — a second,
      // independently-generated createId() sliced to a short prefix can
      // collide when called twice in quick succession, since ULIDs share a
      // time-encoded prefix for IDs minted in the same millisecond.
      styleNumber: `ST-${id.slice(-8)}`,
      styleName: 'Test Style',
      finalMrp: 500,
      status: overrides?.status ?? 'ACTIVE',
      styleSeasons: {
        create: {
          season: {
            create: {
              id: seasonId,
              code: `T-${seasonId.slice(-6)}`,
              name: 'Test Season',
              financialYearId: financialYear.id,
            },
          },
        },
      },
    },
  });
}

async function linkStyleSize(styleId: string, sizeId: string) {
  return prisma.styleSize.create({
    data: { id: createId(), styleId, sizeId },
  });
}

interface POPayload {
  distributorId: string;
  poDate?: string;
  lines?: unknown[];
}

// Order Sheet creation never accepts purchaseMode — it is always derived
// server-side from the selected Distributor.
async function createPO(token: string, payload: POPayload) {
  return request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      poDate: '2026-06-30',
      ...payload,
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Order Sheet (purchase orders) API', () => {
  describe('POST /purchase-orders — create', () => {
    it('creates an Order Sheet that is immediately plannable, with no Draft/Submit step', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 168 }] }],
      });

      expect(res.status).toBe(201);
      // No Draft->Submit workflow: an Order Sheet is immediately eligible
      // for Job Order planning the moment it's created.
      expect(res.body.data.status).toBe('SUBMITTED');
      expect(res.body.data.jobOrderId).toBeNull();
      // \d{4,}, not \d{4} — DOCUMENT_SERIAL_MIN_WIDTH is a floor, not a cap.
      expect(res.body.data.poNumber).toMatch(
        new RegExp(`^${DOCUMENT_PREFIXES.PURCHASE_ORDER}\\/\\d{2}-\\d{2}\\/\\d{4,}$`),
      );
      expect(res.body.data.financialYear.code).toBe('2026-27');
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.totalOrderedQuantity).toBe(168);
      expect(res.body.data.lines[0].seasonSnapshots).toHaveLength(1);
      expect(res.body.data.lines[0].seasonSnapshots[0]).toMatchObject({
        seasonId: expect.any(String),
        code: expect.any(String),
        name: 'Test Season',
        financialYear: '26-27',
      });
    });

    it('derives purchaseMode from the Distributor and ignores any client-supplied value', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor({ purchaseMode: 'SALE_RETURN' });
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await request(app)
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          distributorId: dist.id,
          poDate: '2026-06-30',
          purchaseMode: 'OUTRIGHT', // must be ignored — Distributor is SALE_RETURN
          lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.purchaseMode).toBe('SALE_RETURN');
    });

    it('rejects an inactive size even when its historical style mapping remains active', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);
      await prisma.size.update({ where: { id: size.id }, data: { status: 'INACTIVE' } });

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(400);
      expect(await prisma.styleSize.count({ where: { sizeId: size.id } })).toBe(1);
    });

    it('allows MERCHANDISER to create Order Sheets', async () => {
      const { token } = await createTestUserAndToken({
        email: 'merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(201);
    });

    it('sets merchandiserId to the authenticated Merchandiser who created the Order Sheet', async () => {
      const { userId: merchId, token } = await createTestUserAndToken({
        email: 'merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.merchandiser).toMatchObject({ id: merchId, email: 'merch@test.local' });

      // The read path resolves the same Merchandiser back from the DB, not
      // just an echo of the create response.
      const detail = await request(app)
        .get(`/purchase-orders/${res.body.data.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.body.data.merchandiser).toMatchObject({ id: merchId });
    });

    it('leaves merchandiserId unset when an ADMIN creates the Order Sheet', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.merchandiser).toBeNull();
    });

    it('ignores a client-supplied merchandiserId, preventing an inappropriate role from spoofing the Merchandiser', async () => {
      const { userId: otherMerchId } = await createTestUserAndToken({
        email: 'other-merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin2@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await request(app)
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          distributorId: dist.id,
          merchandiserId: otherMerchId,
          poDate: '2026-06-30',
          lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.merchandiser).toBeNull();
    });

    it('rejects Order Sheet without distributorId', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const res = await request(app)
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ poDate: '2026-06-30', lines: [] });

      expect(res.status).toBe(400);
    });

    it('rejects Order Sheet without lines', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, { distributorId: dist.id, lines: [] });

      expect(res.status).toBe(400);
    });

    it('rejects an Order Sheet with more than one Style line — exactly one Style is required', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const styleA = await createStyle();
      const styleB = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(styleA.id, size.id);
      await linkStyleSize(styleB.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [
          { styleId: styleA.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] },
          { styleId: styleB.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] },
        ],
      });

      expect(res.status).toBe(400);
    });

    it('rejects inactive style', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle({ status: 'INACTIVE' });
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(400);
    });

    it('rejects an inactive distributor', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor({ status: 'INACTIVE' });
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Distributor is not active');
    });

    it('keeps existing Order Sheets readable after their distributor is deactivated', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 25 }] }],
      });
      expect(createRes.status).toBe(201);

      await request(app)
        .patch(`/distributors/${dist.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'INACTIVE' })
        .expect(200);

      const detail = await request(app)
        .get(`/purchase-orders/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${token}`);
      const list = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${token}`);

      expect(detail.status).toBe(200);
      expect(detail.body.data.distributor.id).toBe(dist.id);
      expect(list.status).toBe(200);
      expect(list.body.data.items).toHaveLength(1);
    });

    it('rejects size not valid for style', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      // NOT linking size to style

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(res.status).toBe(400);
    });

    it('rejects zero quantity', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 0 }] }],
      });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate sizes within a line', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await createPO(token, {
        distributorId: dist.id,
        lines: [
          {
            styleId: style.id,
            sizes: [
              { sizeId: size.id, orderedQuantity: 10 },
              { sizeId: size.id, orderedQuantity: 5 },
            ],
          },
        ],
      });

      expect(res.status).toBe(400);
    });

    it('blocks FACTORY_USER from creating Order Sheets', async () => {
      const { token } = await createTestUserAndToken({
        email: 'factory@test.local',
        password: 'pass',
        roles: ['FACTORY_USER'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, { distributorId: dist.id });

      expect(res.status).toBe(403);
    });

    it('blocks DISTRIBUTOR from creating Order Sheets — planning belongs to Merchandising', async () => {
      const { token } = await createTestUserAndToken({
        email: 'dist@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, { distributorId: dist.id });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /purchase-orders/:id/actions/cancel', () => {
    it('cancels an unlocked Order Sheet', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;

      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects cancelling an already-cancelled Order Sheet', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('rejects cancelling an Order Sheet already locked by a Job Order', async () => {
      const { userId, token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;

      // Simulate a Job Order having claimed this Order Sheet.
      const jobOrder = await createTestJobOrderStub({ purchaseOrderId: poId, createdBy: userId });
      await prisma.distributorPurchaseOrder.update({
        where: { id: poId },
        data: { jobOrderId: jobOrder.id },
      });

      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('access control', () => {
    it('DISTRIBUTOR has no Order Sheet access at all — list, detail, or create', async () => {
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const { userId: distUserId, token: distToken } = await createTestUserAndToken({
        email: 'dist@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });

      const dist = await createTestDistributor();
      await prisma.userDistributor.create({
        data: { id: createId(), userId: distUserId, distributorId: dist.id },
      });

      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(adminToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poId = createRes.body.data.id;

      // Even a DISTRIBUTOR mapped to the exact same distributor the Order
      // Sheet belongs to has no access — planning is Merchandising-only.
      const listRes = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${distToken}`);
      const detailRes = await request(app)
        .get(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${distToken}`);
      const createAttempt = await createPO(distToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(listRes.status).toBe(403);
      expect(detailRes.status).toBe(403);
      expect(createAttempt.status).toBe(403);
    });

    it('ADMIN can view all Order Sheets', async () => {
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      await createPO(adminToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      const res = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('MERCHANDISER can view all Order Sheets', async () => {
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const { token: merchToken } = await createTestUserAndToken({
        email: 'merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      await createPO(adminToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      const res = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${merchToken}`);
      expect(res.status).toBe(200);
    });

    it('FACTORY_USER cannot access Order Sheets', async () => {
      const { token } = await createTestUserAndToken({
        email: 'factory@test.local',
        password: 'pass',
        roles: ['FACTORY_USER'],
      });
      const res = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /purchase-orders — search by poNumber', () => {
    it('matches poNumber as a case-insensitive substring, e.g. EIOS/26-27/0001', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const distA = await createTestDistributor();
      const distB = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const poA = await createPO(token, {
        distributorId: distA.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poB = await createPO(token, {
        distributorId: distB.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poNumberA: string = poA.body.data.poNumber;
      const poNumberB: string = poB.body.data.poNumber;
      expect(poNumberA).toMatch(/^EIOS\/\d{2}-\d{2}\/\d{4}$/);
      expect(poNumberA).not.toBe(poNumberB);

      const exactRes = await request(app)
        .get('/purchase-orders')
        .query({ search: poNumberA })
        .set('Authorization', `Bearer ${token}`);
      expect(exactRes.status).toBe(200);
      expect(exactRes.body.data.items.map((po: { poNumber: string }) => po.poNumber)).toEqual([
        poNumberA,
      ]);

      const lowerCaseRes = await request(app)
        .get('/purchase-orders')
        .query({ search: poNumberA.toLowerCase() })
        .set('Authorization', `Bearer ${token}`);
      expect(lowerCaseRes.status).toBe(200);
      expect(lowerCaseRes.body.data.items.map((po: { poNumber: string }) => po.poNumber)).toEqual([
        poNumberA,
      ]);

      const substringRes = await request(app)
        .get('/purchase-orders')
        .query({ search: 'EIOS' })
        .set('Authorization', `Bearer ${token}`);
      expect(substringRes.status).toBe(200);
      const matchedNumbers = substringRes.body.data.items.map(
        (po: { poNumber: string }) => po.poNumber,
      );
      expect(matchedNumbers).toEqual(expect.arrayContaining([poNumberA, poNumberB]));
    });
  });

  describe('GET /purchase-orders — planningState filter', () => {
    it('filters by AVAILABLE / INCLUDED_IN_JOB_ORDER / CANCELLED as real backend conditions', async () => {
      const { userId, token } = await createTestUserAndToken({
        email: 'admin-planning@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const available = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const cancelled = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      await request(app)
        .post(`/purchase-orders/${cancelled.body.data.id}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const included = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const jobOrder = await createTestJobOrderStub({
        purchaseOrderId: included.body.data.id,
        createdBy: userId,
      });
      await prisma.distributorPurchaseOrder.update({
        where: { id: included.body.data.id },
        data: { jobOrderId: jobOrder.id },
      });

      async function idsFor(planningState: string) {
        const res = await request(app)
          .get('/purchase-orders')
          .query({ planningState })
          .set('Authorization', `Bearer ${token}`);
        return res.body.data.items.map((po: { id: string }) => po.id);
      }

      expect(await idsFor('AVAILABLE')).toEqual([available.body.data.id]);
      expect(await idsFor('CANCELLED')).toEqual([cancelled.body.data.id]);
      expect(await idsFor('INCLUDED_IN_JOB_ORDER')).toEqual([included.body.data.id]);
    });
  });

  describe('PATCH /purchase-orders/:id — update while unlocked', () => {
    it('updates an unlocked Order Sheet', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'Updated remark' });

      expect(res.status).toBe(200);
      expect(res.body.data.remarks).toBe('Updated remark');
    });

    it('ignores a client-supplied purchaseMode on update — it stays locked to the Distributor value', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor({ purchaseMode: 'OUTRIGHT' });
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      expect(createRes.body.data.purchaseMode).toBe('OUTRIGHT');

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'changed', purchaseMode: 'SALE_RETURN' });

      expect(res.status).toBe(200);
      expect(res.body.data.purchaseMode).toBe('OUTRIGHT');
    });

    it('does not renumber an Order Sheet when the date edit stays within the same Financial Year', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        poDate: '2026-06-30', // FY 2026-27
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      const originalNumber = createRes.body.data.poNumber;
      const originalFinancialYearId = createRes.body.data.financialYear.id;

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ poDate: '2026-08-15' }); // still FY 2026-27

      expect(res.status).toBe(200);
      expect(res.body.data.poNumber).toBe(originalNumber);
      expect(res.body.data.financialYear.id).toBe(originalFinancialYearId);
    });

    it('renumbers an Order Sheet into the new Financial Year sequence when the date edit crosses the FY boundary, never reusing the vacated serial', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const firstRes = await createPO(token, {
        distributorId: dist.id,
        poDate: '2027-03-31', // FY 2026-27
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const firstPoId = firstRes.body.data.id;
      expect(firstRes.body.data.financialYear.code).toBe('2026-27');

      const crossed = await request(app)
        .patch(`/purchase-orders/${firstPoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ poDate: '2027-04-01' }); // now FY 2027-28

      expect(crossed.status).toBe(200);
      expect(crossed.body.data.financialYear.code).toBe('2027-28');
      expect(crossed.body.data.poNumber).not.toBe(firstRes.body.data.poNumber);

      // A new Order Sheet dated back in FY 2026-27 must not reuse the serial
      // the first one vacated when it moved to FY 2027-28 — DocumentSequence's
      // high-water mark, not MAX(poSerial), drives allocation. These two
      // creates are consecutive within this test, so the serial increment
      // is deterministic regardless of sequence state left by other tests.
      const secondRes = await createPO(token, {
        distributorId: dist.id,
        poDate: '2026-05-01', // FY 2026-27
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const serialOf = (poNumber: string) => parseInt(poNumber.split('/').pop()!, 10);
      expect(secondRes.body.data.financialYear.code).toBe('2026-27');
      expect(secondRes.body.data.poNumber).not.toBe(firstRes.body.data.poNumber);
      expect(serialOf(secondRes.body.data.poNumber)).toBe(serialOf(firstRes.body.data.poNumber) + 1);
    });

    it('ignores a client-supplied merchandiserId on update', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const { userId: otherMerchId } = await createTestUserAndToken({
        email: 'merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      expect(createRes.body.data.merchandiser).toBeNull();

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ merchandiserId: otherMerchId, remarks: 'Updated remark' });

      expect(res.status).toBe(200);
      expect(res.body.data.merchandiser).toBeNull();
      expect(res.body.data.remarks).toBe('Updated remark');
    });

    it('rejects editing an Order Sheet already locked by a Job Order', async () => {
      const { userId, token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      const jobOrder = await createTestJobOrderStub({ purchaseOrderId: poId, createdBy: userId });
      await prisma.distributorPurchaseOrder.update({
        where: { id: poId },
        data: { jobOrderId: jobOrder.id },
      });

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'Should fail' });

      expect(res.status).toBe(400);
    });

    it('rejects editing a cancelled Order Sheet', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 50 }] }],
      });
      const poId = createRes.body.data.id;
      await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'Should fail' });

      expect(res.status).toBe(400);
    });
  });

  describe('audit logs', () => {
    it('writes audit logs for create and cancel — no PO_SUBMITTED, there is no Submit workflow', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poId = createRes.body.data.id;

      await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'DistributorPurchaseOrder', entityId: poId },
        orderBy: { createdAt: 'asc' },
      });

      const actions = logs.map((l) => l.action);
      expect(actions).toContain('PO_CREATED');
      expect(actions).not.toContain('PO_SUBMITTED');
      expect(actions).toContain('PO_CANCELLED');
    });

    it('writes audit log for update', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poId = createRes.body.data.id;

      await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'changed' });

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'DistributorPurchaseOrder', entityId: poId, action: 'PO_UPDATED' },
      });

      expect(logs).toHaveLength(1);
    });
  });

  describe('retired endpoints', () => {
    it('no longer exposes Submit, job-order-balance, or fulfilment-summary', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-retired@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);
      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poId = createRes.body.data.id;

      const submit = await request(app)
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);
      const balance = await request(app)
        .get(`/purchase-orders/${poId}/job-order-balance`)
        .set('Authorization', `Bearer ${token}`);
      const fulfilment = await request(app)
        .get(`/purchase-orders/${poId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`);

      expect(submit.status).toBe(404);
      expect(balance.status).toBe(404);
      expect(fulfilment.status).toBe(404);
    });
  });
});
