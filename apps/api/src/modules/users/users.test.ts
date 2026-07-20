import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { REFRESH_TOKEN_COOKIE_NAME } from '../auth/refresh-cookie.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { signAccessToken, signRefreshToken } from '../../auth/jwt.js';
import {
  resetDatabase,
  createTestUser,
  createTestUserAndToken,
  createTestDistributor,
  createTestFactory,
} from '../../test/helpers.js';

const app = createApp();

function getRefreshTokenFromSetCookie(res: Response): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((value) => value.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`));
  if (!cookie) {
    throw new Error('Missing refresh token cookie');
  }
  const value = cookie.split(';')[0]!.slice(`${REFRESH_TOKEN_COOKIE_NAME}=`.length);
  return decodeURIComponent(value);
}

function refreshCookieHeader(refreshToken: string): string {
  return `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /users', () => {
  it('allows an ADMIN to create a user', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New User',
        email: 'new-user@test.local',
        password: 'new-user-password',
        roles: ['MERCHANDISER'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('new-user@test.local');
    expect(res.body.data.roles).toEqual(['MERCHANDISER']);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects a non-ADMIN caller', async () => {
    const { token } = await createTestUserAndToken({
      email: 'merchandiser@test.local',
      password: 'some-password',
      roles: ['MERCHANDISER'],
    });

    const res = await request(app).post('/users').set('Authorization', `Bearer ${token}`).send({
      name: 'New User',
      email: 'new-user@test.local',
      password: 'new-user-password',
    });

    expect(res.status).toBe(403);
  });

  it('normalizes email on create and rejects a case-different duplicate', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const created = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Mixed Case',
        email: '  Mixed-Case@Test.Local  ',
        password: 'new-user-password',
        roles: ['MERCHANDISER'],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('mixed-case@test.local');

    const duplicate = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Duplicate',
        email: 'MIXED-CASE@TEST.LOCAL',
        password: 'another-password',
        roles: ['MERCHANDISER'],
      });
    expect(duplicate.status).toBe(409);
  });
});

describe('GET /users (role-gated route)', () => {
  it('rejects a caller with insufficient role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'qa@test.local',
      password: 'some-password',
      roles: ['QA_USER'],
    });

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('allows an ADMIN caller and never returns passwordHash', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('POST /users/:id/roles', () => {
  it('allows an ADMIN to assign multiple roles to a user', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'target-password',
      roles: ['MERCHANDISER'],
    });

    await request(app)
      .post(`/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleName: 'QA_USER' })
      .expect(200);

    const res = await request(app)
      .post(`/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleName: 'ACCOUNTANT' });

    expect(res.status).toBe(200);
    expect(res.body.data.roles.sort()).toEqual(['ACCOUNTANT', 'MERCHANDISER', 'QA_USER'].sort());
  });
});

describe('POST /users/:id/distributors', () => {
  it('allows an ADMIN to map a user to a distributor', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    const res = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.distributors).toEqual([
      { id: distributor.id, code: distributor.code, name: distributor.name },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects duplicate mappings and mappings to inactive distributors', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const active = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });
    const inactive = await createTestDistributor({
      code: 'D-002',
      name: 'Dormant Distribution',
      status: 'INACTIVE',
    });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: active.id })
      .expect(200);

    const duplicate = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: active.id });
    const inactiveRes = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: inactive.id });

    expect(duplicate.status).toBe(409);
    expect(inactiveRes.status).toBe(400);
    expect(inactiveRes.body.error.message).toBe('Cannot map a user to an inactive distributor');
  });

  it('rejects mapping a user who does not have the DISTRIBUTOR role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: merchId } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    const res = await request(app)
      .post(`/users/${merchId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      'Only users with the DISTRIBUTOR role can be mapped to a distributor',
    );
  });

  it('rejects a second distributor until the existing mapping is removed', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const first = await createTestDistributor({ code: 'D-001', name: 'First Distribution' });
    const second = await createTestDistributor({ code: 'D-002', name: 'Second Distribution' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: first.id })
      .expect(200);

    const conflicting = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: second.id });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.message).toBe(
      'User is already mapped to a different distributor',
    );

    await request(app)
      .delete(`/users/${targetId}/distributors/${first.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const remapped = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: second.id });

    expect(remapped.status).toBe(200);
    expect(remapped.body.data.distributors).toEqual([
      { id: second.id, code: 'D-002', name: 'Second Distribution' },
    ]);

    const addedLogs = await prisma.auditLog.findMany({
      where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId },
      orderBy: { createdAt: 'asc' },
    });
    expect(addedLogs.map((log) => log.metadata)).toEqual([
      { distributorId: first.id },
      { distributorId: second.id },
    ]);
  });

  it('never yields more than one mapping under concurrent assignment attempts', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributors = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        createTestDistributor({ code: `D-00${n}`, name: `Distribution ${n}` }),
      ),
    );

    const responses = await Promise.all(
      distributors.map((distributor) =>
        request(app)
          .post(`/users/${targetId}/distributors`)
          .set('Authorization', `Bearer ${token}`)
          .send({ distributorId: distributor.id }),
      ),
    );

    const succeeded = responses.filter((res) => res.status === 200);
    const conflicted = responses.filter((res) => res.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(distributors.length - 1);

    const mappings = await prisma.userDistributor.count({ where: { userId: targetId } });
    expect(mappings).toBe(1);

    const addedLogs = await prisma.auditLog.count({
      where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId },
    });
    expect(addedLogs).toBe(1);
  });

  it('is backed by a database constraint that rejects a second mapping row inserted directly', async () => {
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const first = await createTestDistributor({ code: 'D-001', name: 'First Distribution' });
    const second = await createTestDistributor({ code: 'D-002', name: 'Second Distribution' });

    await prisma.userDistributor.create({
      data: { id: createId(), userId: targetId, distributorId: first.id },
    });

    await expect(
      prisma.userDistributor.create({
        data: { id: createId(), userId: targetId, distributorId: second.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('removes a distributor mapping and records audit logs for both directions', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id })
      .expect(200);

    const removed = await request(app)
      .delete(`/users/${targetId}/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`);
    const removedAgain = await request(app)
      .delete(`/users/${targetId}/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(200);
    expect(removed.body.data.distributors).toEqual([]);
    expect(removedAgain.status).toBe(404);

    const [added, deleted] = await Promise.all([
      prisma.auditLog.findFirst({
        where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId },
      }),
      prisma.auditLog.findFirst({
        where: { action: 'DISTRIBUTOR_MAPPING_REMOVED', entityId: targetId },
      }),
    ]);
    expect(added?.metadata).toEqual({ distributorId: distributor.id });
    expect(deleted?.metadata).toEqual({ distributorId: distributor.id });
  });
});

describe('POST /users/:id/factories', () => {
  it('allows an ADMIN to map a user to a factory', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'factory-user@test.local',
      password: 'target-password',
      roles: ['FACTORY_USER'],
    });
    const factory = await createTestFactory({ code: 'F-001', name: 'Acme Factory' });

    const res = await request(app)
      .post(`/users/${targetId}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.factories).toEqual([
      { id: factory.id, code: factory.code, name: factory.name },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('enforces role, active account, active factory, duplicates, removal, and audit rows', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId } = await createTestUserAndToken({
      email: 'factory-user@test.local',
      password: 'target-password',
      roles: ['FACTORY_USER'],
    });
    const { userId: wrongRoleId } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'target-password',
      roles: ['MERCHANDISER'],
    });
    const { userId: inactiveId } = await createTestUserAndToken({
      email: 'inactive@test.local',
      password: 'target-password',
      roles: ['FACTORY_USER'],
    });
    await prisma.user.update({ where: { id: inactiveId }, data: { status: 'INACTIVE' } });
    const factory = await createTestFactory({ code: 'F-001', name: 'Acme Factory' });
    const post = (targetId: string) =>
      request(app)
        .post(`/users/${targetId}/factories`)
        .set('Authorization', `Bearer ${token}`)
        .send({ factoryId: factory.id });

    await post(wrongRoleId).expect(400);
    await post(inactiveId).expect(400);
    await post(userId).expect(200);
    await post(userId).expect(409);
    const removed = await request(app)
      .delete(`/users/${userId}/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);

    await prisma.factory.update({ where: { id: factory.id }, data: { status: 'INACTIVE' } });
    await post(userId).expect(400);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: userId },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['FACTORY_MAPPING_ADDED', 'FACTORY_MAPPING_REMOVED']),
    );
  });
});

describe('GET /users (search/status/role filters)', () => {
  it('filters by search, status, and role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    await createTestUserAndToken({
      email: 'merch-active@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });
    const { userId: inactiveId } = await createTestUserAndToken({
      email: 'merch-inactive@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
      status: 'INACTIVE',
    });

    const byRole = await request(app)
      .get('/users')
      .query({ role: 'MERCHANDISER' })
      .set('Authorization', `Bearer ${token}`);
    expect(byRole.body.data.map((u: { email: string }) => u.email).sort()).toEqual(
      ['merch-active@test.local', 'merch-inactive@test.local'].sort(),
    );

    const byStatus = await request(app)
      .get('/users')
      .query({ status: 'INACTIVE' })
      .set('Authorization', `Bearer ${token}`);
    expect(byStatus.body.data.map((u: { id: string }) => u.id)).toEqual([inactiveId]);

    const bySearch = await request(app)
      .get('/users')
      .query({ search: 'merch-active' })
      .set('Authorization', `Bearer ${token}`);
    expect(bySearch.body.data.map((u: { email: string }) => u.email)).toEqual([
      'merch-active@test.local',
    ]);
  });
});

describe('PATCH /users/:id (profile edit)', () => {
  it('updates name and email, normalizes email, and audits the change', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'old-email@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });

    const res = await request(app)
      .patch(`/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name', email: 'NEW-EMAIL@Test.local' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.email).toBe('new-email@test.local');

    const log = await prisma.auditLog.findFirst({ where: { action: 'USER_PROFILE_UPDATED' } });
    expect(log?.metadata).toMatchObject({
      name: { from: 'Test User', to: 'Updated Name' },
      email: { from: 'old-email@test.local', to: 'new-email@test.local' },
    });
  });

  it('rejects a duplicate email', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    await createTestUserAndToken({ email: 'taken@test.local', password: 'password', roles: [] });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: [],
    });

    const res = await request(app)
      .patch(`/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'taken@test.local' });

    expect(res.status).toBe(409);
  });

  it('rejects updating to a case-equivalent existing email', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    await createTestUserAndToken({ email: 'taken@test.local', password: 'password', roles: [] });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: [],
    });

    const res = await request(app)
      .patch(`/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'TAKEN@Test.Local' });

    expect(res.status).toBe(409);
  });
});

describe('POST /users/:id/reset-password', () => {
  it('resets the password, bumps authVersion, revokes sessions, and audits without leaking secrets', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'old-password',
      roles: ['MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'old-password' });
    const oldAccessToken = login.body.data.accessToken as string;
    const oldRefreshToken = getRefreshTokenFromSetCookie(login);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });

    const res = await request(app)
      .post(`/users/${targetId}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'brand-new-password' });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('brand-new-password');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(after.authVersion).toBe(before.authVersion + 1);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'PASSWORD_RESET', entityId: targetId },
    });
    expect(auditRows).toHaveLength(1);
    const log = auditRows[0]!;
    expect(log.entityId).toBe(targetId);
    const logJson = JSON.stringify(log);
    expect(logJson).not.toContain('brand-new-password');
    expect(logJson).not.toContain('old-password');
    expect(logJson).not.toContain(after.passwordHash);
    expect(logJson).not.toContain(oldAccessToken);
    expect(logJson).not.toContain(oldRefreshToken);

    // Old access token is rejected immediately, before its own expiry.
    const staleAccessTokenAttempt = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${oldAccessToken}`);
    expect(staleAccessTokenAttempt.status).toBe(401);

    // Old refresh token is rejected.
    const staleRefreshAttempt = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(oldRefreshToken));
    expect(staleRefreshAttempt.status).toBe(401);

    // Old password fails, new password succeeds, and the freshly issued
    // access + refresh tokens both carry the new version and work.
    const oldPasswordLogin = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'old-password' });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'brand-new-password' });
    expect(newPasswordLogin.status).toBe(200);
    const newAccessToken = newPasswordLogin.body.data.accessToken as string;
    const newRefreshToken = getRefreshTokenFromSetCookie(newPasswordLogin);

    const meWithNewAccessToken = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${newAccessToken}`);
    expect(meWithNewAccessToken.status).toBe(200);

    const refreshWithNewToken = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(newRefreshToken));
    expect(refreshWithNewToken.status).toBe(200);
  });

  it('rejects an access token with a stale authVersion claim', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    // authVersion: 1 baked into this token, then the account is bumped to 2 —
    // simulates a token issued just before a reset that hasn't expired yet.
    const { userId: targetId, token: staleToken } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });
    await prisma.user.update({ where: { id: targetId }, data: { authVersion: { increment: 1 } } });

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${staleToken}`);
    expect(res.status).toBe(401);

    // Sanity: the admin's own untouched token still works.
    const adminRes = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
  });

  it('rejects an access token with no authVersion claim at all', async () => {
    const { userId } = await createTestUserAndToken({
      email: 'legacy@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });
    // Deliberately mirrors the pre-migration payload shape (no authVersion).
    const legacyToken = signAccessToken({
      sub: userId,
      roles: ['MERCHANDISER'],
    } as unknown as Parameters<typeof signAccessToken>[0]);

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${legacyToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a refresh token with a stale or missing authVersion claim', async () => {
    const userId = await createTestUser({
      email: 'target@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });

    const staleToken = signRefreshToken({
      sub: userId,
      sessionId: createId(),
      tokenId: createId(),
      authVersion: 999,
    });
    const staleRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(staleToken));
    expect(staleRes.status).toBe(401);

    const legacyToken = signRefreshToken({
      sub: userId,
      sessionId: createId(),
      tokenId: createId(),
    } as unknown as Parameters<typeof signRefreshToken>[0]);
    const legacyRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(legacyToken));
    expect(legacyRes.status).toBe(401);
  });

  it('does not increment authVersion when the reset request fails validation', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });

    const res = await request(app)
      .post(`/users/${targetId}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'short' });

    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(after.authVersion).toBe(before.authVersion);
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('preserves a monotonic authVersion under concurrent resets, invalidating all prior tokens', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'original-password',
      roles: ['MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'original-password' });
    const preResetAccessToken = login.body.data.accessToken as string;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });

    const [first, second] = await Promise.all([
      request(app)
        .post(`/users/${targetId}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'password-attempt-one' }),
      request(app)
        .post(`/users/${targetId}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'password-attempt-two' }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(after.authVersion).toBe(before.authVersion + 2);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'PASSWORD_RESET', entityId: targetId },
    });
    expect(auditRows).toHaveLength(2);

    const staleAccessAttempt = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${preResetAccessToken}`);
    expect(staleAccessAttempt.status).toBe(401);

    // Exactly one of the two passwords is the final, committed one.
    const [loginOne, loginTwo] = await Promise.all([
      request(app)
        .post('/auth/login')
        .send({ identifier: 'target@test.local', password: 'password-attempt-one' }),
      request(app)
        .post('/auth/login')
        .send({ identifier: 'target@test.local', password: 'password-attempt-two' }),
    ]);
    const successes = [loginOne, loginTwo].filter((res) => res.status === 200);
    expect(successes).toHaveLength(1);
  });

  it('rolls back the password hash, authVersion, and session revocation when the audit write fails', async () => {
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'original-password',
      roles: ['MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'original-password' });
    const refreshToken = getRefreshTokenFromSetCookie(login);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    const sessionBefore = await prisma.refreshSession.findFirstOrThrow({
      where: { userId: targetId },
    });

    // No mocking: `actorId` is a real foreign key to `users.id`
    // (AuditLog.actor, onDelete: SetNull), so an actor id that doesn't
    // exist in the database makes the audit insert itself fail with a
    // genuine Postgres constraint violation — inside the same transaction
    // as the password/authVersion/session updates — proving real rollback
    // rather than a mocked one (the same approach admin-bootstrap.test.ts
    // uses for its rollback coverage).
    const nonExistentActor: CurrentUser = {
      id: 'nonexistent-actor-id',
      email: 'ghost@test.local',
      mobile: null,
      name: 'Ghost Actor',
      status: 'ACTIVE',
      authVersion: 1,
      roles: ['ADMIN'],
      distributorIds: [],
      factoryIds: [],
    };

    const { resetPassword } = await import('./users.service.js');
    await expect(
      resetPassword(nonExistentActor, targetId, 'would-be-new-password'),
    ).rejects.toThrow();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.authVersion).toBe(before.authVersion);

    const sessionAfter = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: sessionBefore.id },
    });
    expect(sessionAfter.revokedAt).toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'PASSWORD_RESET', entityId: targetId },
    });
    expect(auditRows).toHaveLength(0);

    // The account is otherwise unaffected: the original password still works
    // and the pre-existing refresh token is still valid.
    const loginAfterFailure = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'original-password' });
    expect(loginAfterFailure.status).toBe(200);

    const refreshAfterFailure = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(refreshToken));
    expect(refreshAfterFailure.status).toBe(200);
  });
});

describe('user deactivation lifecycle', () => {
  it('revokes existing sessions on deactivation and blocks refresh', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'password' });
    const refreshToken = getRefreshTokenFromSetCookie(login);

    await request(app)
      .patch(`/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    const refreshAttempt = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(refreshToken));
    expect(refreshAttempt.status).toBe(401);

    const loginAttempt = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'password' });
    expect(loginAttempt.status).toBe(401);
  });

  it('reactivation restores login access', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'password',
      roles: ['MERCHANDISER'],
      status: 'INACTIVE',
    });

    await request(app)
      .patch(`/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const loginAttempt = await request(app)
      .post('/auth/login')
      .send({ identifier: 'target@test.local', password: 'password' });
    expect(loginAttempt.status).toBe(200);
  });
});

describe('self-lockout and last-admin protections', () => {
  it('blocks an admin from deactivating their own account', async () => {
    const { token, userId } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    await createTestUserAndToken({
      email: 'other-admin@test.local',
      password: 'p',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .patch(`/users/${userId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    expect(res.status).toBe(400);
  });

  it('allows deactivating a co-admin as long as another active admin remains', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: secondAdminId } = await createTestUserAndToken({
      email: 'second-admin@test.local',
      password: 'p',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .patch(`/users/${secondAdminId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    expect(res.status).toBe(200);
  });

  // The HTTP route requires the caller to already be an active ADMIN
  // (requireRoles('ADMIN')), so a caller distinct from the target always
  // keeps the count at >= 2 before the operation — self-lockout is the only
  // reachable path over HTTP. The count-based "last active admin" guard in
  // usersService is defense-in-depth for callers outside that HTTP gate
  // (e.g. internal/service-layer callers), so it's exercised directly here.
  it('service layer: blocks deactivating the sole remaining active administrator', async () => {
    const { userId: soleAdminId } = await createTestUserAndToken({
      email: 'sole-admin@test.local',
      password: 'p',
      roles: ['ADMIN'],
    });
    const syntheticActor: CurrentUser = {
      id: 'synthetic-actor',
      email: 'synthetic@test.local',
      mobile: null,
      name: 'Synthetic Actor',
      status: 'ACTIVE',
      authVersion: 1,
      roles: ['ADMIN'],
      distributorIds: [],
      factoryIds: [],
    };

    const { updateUserStatus } = await import('./users.service.js');
    await expect(updateUserStatus(syntheticActor, soleAdminId, 'INACTIVE')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('service layer: blocks removing ADMIN role from the sole remaining active administrator', async () => {
    const { userId: soleAdminId } = await createTestUserAndToken({
      email: 'sole-admin@test.local',
      password: 'p',
      roles: ['ADMIN', 'MERCHANDISER'],
    });
    const syntheticActor: CurrentUser = {
      id: 'synthetic-actor',
      email: 'synthetic@test.local',
      mobile: null,
      name: 'Synthetic Actor',
      status: 'ACTIVE',
      authVersion: 1,
      roles: ['ADMIN'],
      distributorIds: [],
      factoryIds: [],
    };

    const { removeRole } = await import('./users.service.js');
    await expect(removeRole(syntheticActor, soleAdminId, 'ADMIN')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('blocks an admin from removing their own ADMIN role', async () => {
    const { token, userId } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN', 'MERCHANDISER'],
    });
    await createTestUserAndToken({
      email: 'other-admin@test.local',
      password: 'p',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .delete(`/users/${userId}/roles/ADMIN`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("blocks removing a user's only role", async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'p',
      roles: ['MERCHANDISER'],
    });

    const res = await request(app)
      .delete(`/users/${targetId}/roles/MERCHANDISER`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('blocks removing DISTRIBUTOR/FACTORY_USER roles while a mapping exists, allows it after unmapping', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'p',
      roles: ['DISTRIBUTOR', 'MERCHANDISER'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id })
      .expect(200);

    const blocked = await request(app)
      .delete(`/users/${targetId}/roles/DISTRIBUTOR`)
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(400);

    await request(app)
      .delete(`/users/${targetId}/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const allowed = await request(app)
      .delete(`/users/${targetId}/roles/DISTRIBUTOR`)
      .set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);
  });

  it('blocks removing FACTORY_USER role while a factory mapping exists', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'p',
      roles: ['FACTORY_USER', 'MERCHANDISER'],
    });
    const factory = await createTestFactory({ code: 'F-001', name: 'Acme Factory' });

    await request(app)
      .post(`/users/${targetId}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id })
      .expect(200);

    const blocked = await request(app)
      .delete(`/users/${targetId}/roles/FACTORY_USER`)
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(400);
  });
});
