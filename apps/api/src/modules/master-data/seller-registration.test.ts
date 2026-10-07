import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestSellerRegistration,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { resolveSoleActiveSellerRegistration } from './seller-registration.service.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const validPayload = {
  legalName: 'ERVE Apparel Private Limited',
  tradeName: 'ERVE',
  branchCode: 'ERVE-HO',
  gstin: '27aaaaa0000a1z5',
  stateCode: '27',
  addressLine1: '1 Industrial Estate',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
  bankName: 'HDFC Bank',
  bankAccountName: 'ERVE Apparel Private Limited',
  bankAccountNumber: '000111222333',
  bankIfsc: 'hdfc0001234',
  bankBranchName: 'Andheri',
};

async function adminToken() {
  const { token } = await createTestUserAndToken({
    email: 'admin@test.local',
    password: 'admin-password',
    roles: ['ADMIN'],
  });
  return token;
}

describe('Seller Registration API — authorization', () => {
  it('allows ADMIN to create a seller registration', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.branchCode).toBe('ERVE-HO');
    // Normalized: trimmed + uppercased.
    expect(res.body.data.gstin).toBe('27AAAAA0000A1Z5');
    expect(res.body.data.bankIfsc).toBe('HDFC0001234');
  });

  it.each(['MERCHANDISER', 'ACCOUNTANT', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'] as const)(
    'rejects %s from creating a seller registration',
    async (role) => {
      const { token } = await createTestUserAndToken({
        email: `${role.toLowerCase()}@test.local`,
        password: 'test-password',
        roles: [role],
      });
      const res = await request(app)
        .post('/seller-registrations')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);
      expect(res.status).toBe(403);
    },
  );

  it('rejects unauthenticated create', async () => {
    const res = await request(app).post('/seller-registrations').send(validPayload);
    expect(res.status).toBe(401);
  });

  it('rejects non-ADMIN roles from reading seller registrations', async () => {
    const seller = await createTestSellerRegistration();
    const { token } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const listRes = await request(app)
      .get('/seller-registrations')
      .set('Authorization', `Bearer ${token}`);
    const detailRes = await request(app)
      .get(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(403);
    expect(detailRes.status).toBe(403);
  });

  it('rejects non-ADMIN from updating or changing status', async () => {
    const seller = await createTestSellerRegistration();
    const { token } = await createTestUserAndToken({
      email: 'merch2@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const updateRes = await request(app)
      .patch(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Changed' });
    const statusRes = await request(app)
      .patch(`/seller-registrations/${seller.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    expect(updateRes.status).toBe(403);
    expect(statusRes.status).toBe(403);
  });
});

describe('Seller Registration API — validation', () => {
  it('rejects missing required fields', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Only Legal Name' });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only required fields', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, legalName: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed GSTIN', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, gstin: 'not-a-gstin' });
    expect(res.status).toBe(400);
  });

  it('rejects a GSTIN/state-code mismatch', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, gstin: '27AAAAA0000A1Z5', stateCode: '09' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed PIN code', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, postalCode: '12345' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed IFSC code', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, bankIfsc: 'INVALID' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate branch code', async () => {
    const token = await adminToken();
    await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, gstin: '09AAAAA0000A1Z5', stateCode: '09' });
    expect(res.status).toBe(409);
  });

  it('rejects a duplicate GSTIN', async () => {
    const token = await adminToken();
    await createTestSellerRegistration({ gstin: '27AAAAA0000A1Z5' });
    const res = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validPayload, branchCode: 'ERVE-BR2' });
    expect(res.status).toBe(409);
  });

  it('rejects an update payload with no fields', async () => {
    const token = await adminToken();
    const seller = await createTestSellerRegistration();
    const res = await request(app)
      .patch(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unknown field on update (strict schema)', async () => {
    const token = await adminToken();
    const seller = await createTestSellerRegistration();
    const res = await request(app)
      .patch(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Updated Name', notARealField: true });
    expect(res.status).toBe(400);
  });
});

describe('Seller Registration API — CRUD and lifecycle', () => {
  it('updates an existing seller registration', async () => {
    const token = await adminToken();
    const seller = await createTestSellerRegistration();
    const res = await request(app)
      .patch(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Renamed Seller Pvt Ltd', tradeName: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.legalName).toBe('Renamed Seller Pvt Ltd');
    expect(res.body.data.tradeName).toBe('Renamed');
  });

  it('activates and deactivates a seller registration without deleting it', async () => {
    const token = await adminToken();
    const seller = await createTestSellerRegistration();

    const deactivateRes = await request(app)
      .patch(`/seller-registrations/${seller.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.data.status).toBe('INACTIVE');

    const getRes = await request(app)
      .get(`/seller-registrations/${seller.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.status).toBe('INACTIVE');

    const reactivateRes = await request(app)
      .patch(`/seller-registrations/${seller.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.data.status).toBe('ACTIVE');
  });

  it('records audit log entries on create, update and status change', async () => {
    const token = await adminToken();
    const createRes = await request(app)
      .post('/seller-registrations')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);
    const id = createRes.body.data.id as string;

    await request(app)
      .patch(`/seller-registrations/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Updated' });

    await request(app)
      .patch(`/seller-registrations/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'SellerRegistration', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((log) => log.action)).toEqual([
      'SELLER_REGISTRATION_CREATED',
      'SELLER_REGISTRATION_UPDATED',
      'SELLER_REGISTRATION_STATUS_CHANGED',
    ]);
  });

  it('supports multiple seller registrations and lists/searches them', async () => {
    const token = await adminToken();
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', legalName: 'ERVE Head Office' });
    await createTestSellerRegistration({
      branchCode: 'ERVE-SR',
      legalName: 'ERVE Southern Branch',
      gstin: '29BBBBB0000B1Z5',
    });

    const listRes = await request(app)
      .get('/seller-registrations')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(2);

    const searchRes = await request(app)
      .get('/seller-registrations')
      .query({ search: 'Southern' })
      .set('Authorization', `Bearer ${token}`);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data).toHaveLength(1);
    expect(searchRes.body.data[0].branchCode).toBe('ERVE-SR');
  });

  it('returns 404 for an unknown seller registration', async () => {
    const token = await adminToken();
    const res = await request(app)
      .get('/seller-registrations/does-not-exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('Seller Registration — single-active-registration helper (no singleton constraint)', () => {
  it('returns null when there are zero active registrations', async () => {
    expect(await resolveSoleActiveSellerRegistration()).toBeNull();
  });

  it('resolves the sole active registration when exactly one exists', async () => {
    const seller = await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const resolved = await resolveSoleActiveSellerRegistration();
    expect(resolved?.id).toBe(seller.id);
  });

  it('structurally supports multiple active registrations and returns null (ambiguous) rather than picking one', async () => {
    await createTestSellerRegistration({ branchCode: 'ERVE-HO', gstin: '27AAAAA0000A1Z5' });
    await createTestSellerRegistration({ branchCode: 'ERVE-SR', gstin: '29BBBBB0000B1Z5' });
    expect(await resolveSoleActiveSellerRegistration()).toBeNull();
  });

  it('ignores inactive registrations when exactly one active one remains', async () => {
    await createTestSellerRegistration({
      branchCode: 'ERVE-OLD',
      gstin: '09CCCCC0000C1Z5',
      status: 'INACTIVE',
    });
    const active = await createTestSellerRegistration({ branchCode: 'ERVE-HO' });
    const resolved = await resolveSoleActiveSellerRegistration();
    expect(resolved?.id).toBe(active.id);
  });
});
