import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestDistributor,
  createTestFactory,
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

    it('sets merchandiserId to the authenticated Merchandiser who created the PO', async () => {
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

    it('leaves merchandiserId unset when an ADMIN creates the PO', async () => {
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
      const { userId: distUserId, token: distToken } = await createTestUserAndToken({
        email: 'dist@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });
      const { userId: otherMerchId } = await createTestUserAndToken({
        email: 'other-merch@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const dist = await createTestDistributor();
      await prisma.userDistributor.create({
        data: { id: createId(), userId: distUserId, distributorId: dist.id },
      });
      const style = await createStyle();
      const size = await createSize('AGE_3', 3);
      await linkStyleSize(style.id, size.id);

      const res = await request(app)
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${distToken}`)
        .send({
          distributorId: dist.id,
          merchandiserId: otherMerchId,
          poDate: '2026-06-30',
          purchaseMode: 'OUTRIGHT',
          lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 10 }] }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.merchandiser).toBeNull();
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
    it('returns zero downstream quantities for a PO with no Job Order yet', async () => {
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
      expect(res.body.data.lines[0].totals).toMatchObject({
        orderedQuantity: 50,
        jobOrderedQuantity: 0,
        preparedQuantity: 0,
        qaReleasedQuantity: 0,
        saleOrderAllocatedQuantity: 0,
        remainingToJobOrderQuantity: 50,
        notPreparedQuantity: 0,
        preparedNotReleasedQuantity: 0,
        releasedUnallocatedQuantity: 0,
      });
    });

    it('reflects a single Job Order through Prepared and QA Released', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-single@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const stock = await createReleasedQaStock({ quantity: 100 });
      // createReleasedQaStock bypasses real Job Order creation, so it never
      // touches jobOrderedQuantity — set it the way the real service would
      // once a Job Order claims this exact quantity from the PO size.
      await prisma.distributorPurchaseOrderLineSize.update({
        where: { id: stock.purchaseOrderLineSizeId },
        data: { jobOrderedQuantity: 100 },
      });

      const res = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const orderedTotal = 100 * 4 + 100; // createReleasedQaStock's own ordered-quantity formula
      expect(res.body.data.lines[0].totals).toMatchObject({
        orderedQuantity: orderedTotal,
        jobOrderedQuantity: 100,
        preparedQuantity: 100,
        qaReleasedQuantity: 100,
        saleOrderAllocatedQuantity: 0,
        remainingToJobOrderQuantity: orderedTotal - 100,
        notPreparedQuantity: 0,
        preparedNotReleasedQuantity: 0,
        releasedUnallocatedQuantity: 100,
      });
    });

    it('aggregates Job Ordered and Prepared quantity across multiple Job Orders against the same PO size, without double-counting', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-multi@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const factory = await createTestFactory();
      const style = await createStyle();
      const size = await createSize('AGE_5', 5);
      await linkStyleSize(style.id, size.id);
      const flow = await prisma.processFlow.create({
        data: {
          id: createId(),
          code: `FLOW-${createId()}`,
          name: 'Fulfilment test flow',
          versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
        },
        include: { versions: true },
      });

      const poRes = await createPO(token, {
        distributorId: dist.id,
        lines: [{ styleId: style.id, sizes: [{ sizeId: size.id, orderedQuantity: 350 }] }],
      });
      await request(app)
        .post(`/purchase-orders/${poRes.body.data.id}/actions/submit`)
        .set('Authorization', `Bearer ${token}`);
      const poLineId = poRes.body.data.lines[0].id;
      const poSizeId = poRes.body.data.lines[0].sizes[0].id;

      async function createJobOrder(quantity: number) {
        return request(app)
          .post('/job-orders')
          .set('Authorization', `Bearer ${token}`)
          .send({
            purchaseOrderId: poRes.body.data.id,
            factoryId: factory.id,
            processFlowVersionId: flow.versions[0]!.id,
            unitPrice: '100.00',
            disclaimerText: 'Terms apply.',
            lines: [{ purchaseOrderLineId: poLineId, sizes: [{ purchaseOrderLineSizeId: poSizeId, quantity }] }],
          })
          .expect(201);
      }

      const jo1 = await createJobOrder(200);
      const jo2 = await createJobOrder(100);

      // Prepared is entered per Job Order, independently — set them to
      // different values to prove the aggregation sums every Job Order's
      // line size, not just the first one created.
      await prisma.jobOrderLineSize.update({
        where: { id: jo1.body.data.lines[0].sizes[0].id },
        data: { preparedQuantity: 150 },
      });
      await prisma.jobOrderLineSize.update({
        where: { id: jo2.body.data.lines[0].sizes[0].id },
        data: { preparedQuantity: 20 },
      });

      const res = await request(app)
        .get(`/purchase-orders/${poRes.body.data.id}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.lines[0].totals).toMatchObject({
        orderedQuantity: 350,
        jobOrderedQuantity: 300,
        preparedQuantity: 170,
        qaReleasedQuantity: 0,
        remainingToJobOrderQuantity: 50,
        notPreparedQuantity: 130,
        preparedNotReleasedQuantity: 170,
      });
    });

    it('does not count a cancelled Final Quality Batch as QA Released', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-cancelled-batch@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const stock = await createReleasedQaStock({ quantity: 70 });
      await prisma.distributorPurchaseOrderLineSize.update({
        where: { id: stock.purchaseOrderLineSizeId },
        data: { jobOrderedQuantity: 100 },
      });
      const actorId = await createTestUserAndToken({
        email: 'qa-actor@test.local',
        password: 'pass',
        roles: ['QA_USER'],
      }).then((r) => r.userId);
      const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: stock.jobOrderId } });
      const finalStage = await prisma.processFlowVersionStage.findFirstOrThrow({
        where: { processFlowVersionId: job.processFlowVersionId, code: 'FINAL' },
      });
      await prisma.finalQualityBatch.create({
        data: {
          id: createId(),
          jobOrderId: stock.jobOrderId,
          processFlowActivityId: finalStage!.id,
          batchNumber: 2,
          physicalQuantity: 30,
          disposition: 'CANCELLED',
          createdById: actorId,
          terminalById: actorId,
          terminalAt: new Date(),
          allocations: { create: { id: createId(), jobOrderLineSizeId: stock.jobOrderLineSizeId, quantity: 30 } },
        },
      });

      const res = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.lines[0].totals.qaReleasedQuantity).toBe(70);
    });

    it('accumulates QA Released quantity across multiple releases on the same Job Order', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-multi-release@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const stock = await createReleasedQaStock({ quantity: 40 });
      const actorId = await createTestUserAndToken({
        email: 'qa-actor-2@test.local',
        password: 'pass',
        roles: ['QA_USER'],
      }).then((r) => r.userId);
      const job = await prisma.jobOrder.findUniqueOrThrow({ where: { id: stock.jobOrderId } });
      const finalStage = await prisma.processFlowVersionStage.findFirstOrThrow({
        where: { processFlowVersionId: job.processFlowVersionId, code: 'FINAL' },
      });
      const formVersion = await prisma.qualityFormVersion.findUniqueOrThrow({
        where: { id: finalStage.qualityFormVersionId! },
      });

      const batchId = createId();
      const executionId = createId();
      const releaseId = createId();
      await prisma.$transaction(async (tx) => {
        await tx.finalQualityBatch.create({
          data: {
            id: batchId,
            jobOrderId: stock.jobOrderId,
            processFlowActivityId: finalStage!.id,
            batchNumber: 2,
            physicalQuantity: 30,
            disposition: 'DRAFT',
            createdById: actorId,
            allocations: { create: { id: createId(), jobOrderLineSizeId: stock.jobOrderLineSizeId, quantity: 30 } },
          },
        });
        await tx.qualityActivityExecution.create({
          data: {
            id: executionId,
            jobOrderId: stock.jobOrderId,
            processFlowActivityId: finalStage!.id,
            qualityFormVersionId: formVersion.id,
            batchNumber: 2,
            inspectedQuantity: 30,
            finalQualityBatchId: batchId,
            status: 'FINALIZED',
            startedById: actorId,
            finalizedById: actorId,
            finalizedAt: new Date(),
            outcome: 'PASS',
          },
        });
        await tx.qaRelease.create({
          data: {
            id: releaseId,
            jobOrderId: stock.jobOrderId,
            sourceQualityExecutionId: executionId,
            finalQualityBatchId: batchId,
            releasedById: actorId,
            lines: {
              create: {
                id: createId(),
                jobOrderLineSizeId: stock.jobOrderLineSizeId,
                purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId,
                quantity: 30,
              },
            },
          },
        });
        await tx.finalQualityBatch.update({
          where: { id: batchId },
          data: { disposition: 'RELEASED', terminalById: actorId, terminalAt: new Date() },
        });
        await tx.distributorPurchaseOrderLineSize.update({
          where: { id: stock.purchaseOrderLineSizeId },
          data: { qaPassedQuantity: { increment: 30 } },
        });
      });

      const res = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.lines[0].totals.qaReleasedQuantity).toBe(70); // 40 (first release) + 30 (this one)
    });

    it('reconciles Sale Order Allocated with a genuine reduced approval: requested 70, approved 40', async () => {
      const stock = await createReleasedQaStock({ quantity: 110 });
      const { userId: distUserId, token: distToken } = await createTestUserAndToken({
        email: 'dist-fulfilment@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });
      await prisma.userDistributor.create({
        data: { id: createId(), userId: distUserId, distributorId: stock.distributorId },
      });
      const { token: merchToken } = await createTestUserAndToken({
        email: 'merch-fulfilment@test.local',
        password: 'pass',
        roles: ['MERCHANDISER'],
      });
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin-so@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });

      const created = await request(app)
        .post('/sale-orders')
        .set('Authorization', `Bearer ${distToken}`)
        .send({
          distributorId: stock.distributorId,
          soDate: '2026-06-30',
          lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 70 }],
        })
        .expect(201);
      const submitted = await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/submit`)
        .set('Authorization', `Bearer ${distToken}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: created.body.data.version })
        .expect(200);
      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/approve`)
        .set('Authorization', `Bearer ${merchToken}`)
        .set('Idempotency-Key', createId())
        .send({
          expectedVersion: submitted.body.data.version,
          lines: [{ saleOrderLineId: submitted.body.data.lines[0].id, approvedQuantity: 40 }],
        })
        .expect(200);

      const res = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.lines[0].totals).toMatchObject({
        qaReleasedQuantity: 110,
        saleOrderAllocatedQuantity: 40,
        releasedUnallocatedQuantity: 70,
      });
    });

    it('excludes a cancelled Sale Order from Sale Order Allocated', async () => {
      const stock = await createReleasedQaStock({ quantity: 50 });
      const { userId: distUserId, token: distToken } = await createTestUserAndToken({
        email: 'dist-cancel@test.local',
        password: 'pass',
        roles: ['DISTRIBUTOR'],
      });
      await prisma.userDistributor.create({
        data: { id: createId(), userId: distUserId, distributorId: stock.distributorId },
      });
      const { token: adminToken } = await createTestUserAndToken({
        email: 'admin-so-cancel@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });

      const created = await request(app)
        .post('/sale-orders')
        .set('Authorization', `Bearer ${distToken}`)
        .send({
          distributorId: stock.distributorId,
          soDate: '2026-06-30',
          lines: [{ purchaseOrderLineSizeId: stock.purchaseOrderLineSizeId, requestedQuantity: 50 }],
        })
        .expect(201);
      const submitted = await request(app)
        .post(`/sale-orders/${created.body.data.id}/actions/submit`)
        .set('Authorization', `Bearer ${distToken}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: created.body.data.version })
        .expect(200);

      const midway = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(midway.body.data.lines[0].totals.saleOrderAllocatedQuantity).toBe(50);

      await request(app)
        .post(`/sale-orders/${submitted.body.data.id}/actions/cancel`)
        .set('Authorization', `Bearer ${distToken}`)
        .send({ expectedVersion: submitted.body.data.version })
        .expect(200);

      const res = await request(app)
        .get(`/purchase-orders/${stock.purchaseOrderId}/fulfilment-summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.data.lines[0].totals.saleOrderAllocatedQuantity).toBe(0);
      expect(res.body.data.lines[0].totals.releasedUnallocatedQuantity).toBe(50);
    });

    it('reconciles size-level totals with the sum of their size lines', async () => {
      const { token } = await createTestUserAndToken({
        email: 'admin-size@test.local',
        password: 'pass',
        roles: ['ADMIN'],
      });
      const dist = await createTestDistributor();
      const style = await createStyle();
      const sizeS = await createSize('AGE_1', 1);
      const sizeM = await createSize('AGE_2', 2);
      await linkStyleSize(style.id, sizeS.id);
      await linkStyleSize(style.id, sizeM.id);

      const createRes = await createPO(token, {
        distributorId: dist.id,
        lines: [
          {
            styleId: style.id,
            sizes: [
              { sizeId: sizeS.id, orderedQuantity: 100 },
              { sizeId: sizeM.id, orderedQuantity: 150 },
            ],
          },
        ],
      });
      const sizeSRow = createRes.body.data.lines[0].sizes.find((s: { sizeId: string }) => s.sizeId === sizeS.id);
      await prisma.distributorPurchaseOrderLineSize.update({
        where: { id: sizeSRow.id },
        data: { jobOrderedQuantity: 80, qaPassedQuantity: 30 },
      });

      const res = await request(app)
        .get(`/purchase-orders/${createRes.body.data.id}/fulfilment-summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { sizes, totals } = res.body.data.lines[0];
      for (const key of Object.keys(totals) as string[]) {
        expect(totals[key]).toBe(
          sizes.reduce((sum: number, s: Record<string, number>) => sum + s[key]!, 0),
        );
      }
      expect(totals.orderedQuantity).toBe(250);
      expect(totals.jobOrderedQuantity).toBe(80);
      expect(totals.qaReleasedQuantity).toBe(30);
    });
  });
});
