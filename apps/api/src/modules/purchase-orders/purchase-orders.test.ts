import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFinancialYear,
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
  return prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-${createId().slice(0, 6)}`,
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
  purchaseMode?: string;
  lines?: unknown[];
}

async function createPO(token: string, payload: POPayload) {
  return request(app)
    .post('/purchase-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      poDate: '2026-06-30',
      purchaseMode: 'OUTRIGHT',
      ...payload,
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('purchase orders API', () => {
  describe('POST /purchase-orders — create', () => {
    it('creates a DRAFT PO successfully', async () => {
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
      expect(res.body.data.status).toBe('DRAFT');
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

    it('allows MERCHANDISER to create POs', async () => {
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

    it('rejects PO without distributorId', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const res = await request(app)
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ poDate: '2026-06-30', purchaseMode: 'OUTRIGHT', lines: [] });

      expect(res.status).toBe(400);
    });

    it('rejects PO without lines', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, { distributorId: dist.id, lines: [] });

      expect(res.status).toBe(400);
    });

    it('rejects invalid purchaseMode', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, {
        distributorId: dist.id,
        purchaseMode: 'INVALID' as 'OUTRIGHT',
        lines: [],
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

    it('keeps existing purchase orders readable after their distributor is deactivated', async () => {
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

    it('rejects duplicate styles in same PO', async () => {
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
          { styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] },
          { styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] },
        ],
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

    it('blocks FACTORY_USER from creating POs', async () => {
      const { token } = await createTestUserAndToken({
        email: 'factory@test.local',
        password: 'pass',
        roles: ['FACTORY_USER'],
      });
      const dist = await createTestDistributor();

      const res = await createPO(token, { distributorId: dist.id });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /purchase-orders/:id/actions/submit', () => {
    it('submits a DRAFT PO', async () => {
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

      const submitRes = await request(app)
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(submitRes.status).toBe(200);
      expect(submitRes.body.data.status).toBe('SUBMITTED');
    });

    it('rejects submit from non-DRAFT status', async () => {
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
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);
      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /purchase-orders/:id/actions/cancel', () => {
    it('cancels a DRAFT PO with no job ordered quantities', async () => {
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

    it('cancels a SUBMITTED PO if no job ordered quantities', async () => {
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
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('rejects cancel if any job_ordered_quantity > 0', async () => {
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

      // Manually set jobOrderedQuantity > 0
      await prisma.distributorPurchaseOrderLineSize.updateMany({
        where: { purchaseOrderLine: { purchaseOrderId: poId } },
        data: { jobOrderedQuantity: 10 },
      });

      const res = await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('access control', () => {
    it('DISTRIBUTOR user cannot access another distributor PO', async () => {
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

      const dist1 = await createTestDistributor({ code: 'D1', name: 'Dist 1' });
      const dist2 = await createTestDistributor({ code: 'D2', name: 'Dist 2' });

      // Link distUser to dist2 only
      await prisma.userDistributor.create({
        data: { id: createId(), userId: distUserId, distributorId: dist2.id },
      });

      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      // Admin creates PO for dist1
      const createRes = await createPO(adminToken, {
        distributorId: dist1.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });
      const poId = createRes.body.data.id;

      // distUser tries to access dist1's PO
      const res = await request(app)
        .get(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${distToken}`);

      expect(res.status).toBe(403);
    });

    it('fails closed for a DISTRIBUTOR user with no distributor mapping', async () => {
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const { token: distToken } = await createTestUserAndToken({
        email: 'dist@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });

      const dist = await createTestDistributor();
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const createRes = await createPO(adminToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      // An unmapped distributor account must see nothing — not every PO.
      const listRes = await request(app)
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${distToken}`);
      const detailRes = await request(app)
        .get(`/purchase-orders/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${distToken}`);
      const createAttempt = await createPO(distToken, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
      });

      expect(listRes.status).toBe(403);
      expect(listRes.body.error.message).toBe('No distributor is mapped to your account');
      expect(detailRes.status).toBe(403);
      expect(createAttempt.status).toBe(403);
    });

    it('ADMIN can view all POs', async () => {
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

    it('MERCHANDISER can view all POs', async () => {
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

    it('FACTORY_USER cannot access POs', async () => {
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
    it('matches poNumber as a case-insensitive substring, e.g. EIPO/26-27/0001', async () => {
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
      expect(poNumberA).toMatch(/^EIPO\/\d{2}-\d{2}\/\d{4}$/);
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
        .query({ search: 'EIPO' })
        .set('Authorization', `Bearer ${token}`);
      expect(substringRes.status).toBe(200);
      const matchedNumbers = substringRes.body.data.items.map(
        (po: { poNumber: string }) => po.poNumber,
      );
      expect(matchedNumbers).toEqual(expect.arrayContaining([poNumberA, poNumberB]));
    });
  });

  describe('PATCH /purchase-orders/:id — draft update', () => {
    it('updates a DRAFT PO', async () => {
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
        .send({ remarks: 'Updated remark', purchaseMode: 'SALE_RETURN' });

      expect(res.status).toBe(200);
      expect(res.body.data.remarks).toBe('Updated remark');
      expect(res.body.data.purchaseMode).toBe('SALE_RETURN');
    });

    it('does not renumber a DRAFT PO when the date edit stays within the same Financial Year', async () => {
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

    it('renumbers a DRAFT PO into the new Financial Year sequence when the date edit crosses the FY boundary, never reusing the vacated serial', async () => {
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

      // A new PO dated back in FY 2026-27 must not reuse the serial the
      // first PO vacated when it moved to FY 2027-28 — DocumentSequence's
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

    it('rejects editing a SUBMITTED PO', async () => {
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
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .patch(`/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remarks: 'Should fail' });

      expect(res.status).toBe(400);
    });
  });

  describe('audit logs', () => {
    it('writes audit logs for create, submit, and cancel', async () => {
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
        .post(`/purchase-orders/${poId}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);
      await request(app)
        .post(`/purchase-orders/${poId}/actions/cancel`)
        .set('Authorization', `Bearer ${token}`);

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'DistributorPurchaseOrder', entityId: poId },
        orderBy: { createdAt: 'asc' },
      });

      const actions = logs.map((l) => l.action);
      expect(actions).toContain('PO_CREATED');
      expect(actions).toContain('PO_SUBMITTED');
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

  describe('GET /purchase-orders/:id/job-order-balance', () => {
    it('returns balance with ordered and job-ordered quantities', async () => {
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
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 100 }] }],
      });
      const poId = createRes.body.data.id;

      const res = await request(app)
        .get(`/purchase-orders/${poId}/job-order-balance`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lines[0].sizes[0].orderedQuantity).toBe(100);
      expect(res.body.data.lines[0].sizes[0].balanceQuantity).toBe(100);
    });
  });

  describe('GET /purchase-orders/:id/fulfilment-summary', () => {
    it('returns fulfilment summary with zero quantities initially', async () => {
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
        .get(`/purchase-orders/${poId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lines[0].totals.ordered).toBe(50);
      expect(res.body.data.lines[0].totals.orderRemaining).toBe(50);
      expect(res.body.data.lines[0].totals.qaReleasedPendingDispatch).toBe(0);
      expect(res.body.data.lines[0].totals.releaseDispatchIntegrityConflict).toBe(false);
      expect(res.body.data.lines[0].sizes[0]).toMatchObject({
        pendingDispatchQuantity: 50,
        orderRemainingQuantity: 50,
        qaReleasedPendingDispatchQuantity: 0,
      });
      expect(res.body.data.lines[0].totals.dispatched).toBe(0);

      await prisma.distributorPurchaseOrderLineSize.update({
        where: { id: createRes.body.data.lines[0].sizes[0].id },
        data: { dispatchedQuantity: 10 },
      });
      const inconsistent = await request(app)
        .get(`/purchase-orders/${poId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(inconsistent.body.data.lines[0].sizes[0]).toMatchObject({
        orderRemainingQuantity: 40,
        qaReleasedPendingDispatchQuantity: 0,
        releaseDispatchDeficitQuantity: 10,
        releaseDispatchIntegrityConflict: true,
      });
      expect(inconsistent.body.data.lines[0].totals).toMatchObject({
        releaseDispatchDeficit: 10,
        releaseDispatchIntegrityConflict: true,
      });
    });
  });
});
