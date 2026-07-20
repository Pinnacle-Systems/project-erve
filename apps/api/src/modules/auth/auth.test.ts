import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { hashToken } from '../../auth/token-hash.js';
import {
  calculateNextIdleExpiry,
  calculateRefreshSessionExpiry,
  isRefreshSessionExpired,
} from './refresh-session.service.js';
import { REFRESH_TOKEN_COOKIE_NAME } from './refresh-cookie.js';
import {
  resetDatabase,
  createTestUser,
  createTestDistributor,
  createTestFactory,
} from '../../test/helpers.js';

const app = createApp();

function getSetCookieHeaders(res: Response): string[] {
  const header = res.headers['set-cookie'];

  if (!header) {
    return [];
  }

  return Array.isArray(header) ? header : [header];
}

function getRefreshTokenFromSetCookie(res: Response): string {
  const cookie = getSetCookieHeaders(res).find((value) =>
    value.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
  );

  if (!cookie) {
    throw new Error('Missing refresh token cookie');
  }

  const nameAndValue = cookie.split(';')[0];
  const value = nameAndValue?.slice(`${REFRESH_TOKEN_COOKIE_NAME}=`.length);

  if (!value) {
    throw new Error('Missing refresh token cookie value');
  }

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

describe('refresh session helpers', () => {
  it('calculates idle and absolute expiry from the configured defaults', () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const expiry = calculateRefreshSessionExpiry(now);

    expect(expiry.idleExpiresAt).toEqual(new Date('2026-06-30T10:20:00.000Z'));
    expect(expiry.absoluteExpiresAt).toEqual(new Date('2026-06-30T18:00:00.000Z'));
  });

  it('caps sliding idle expiry at the absolute expiry', () => {
    const now = new Date('2026-06-30T17:50:00.000Z');
    const absoluteExpiresAt = new Date('2026-06-30T18:00:00.000Z');

    expect(calculateNextIdleExpiry(absoluteExpiresAt, now)).toEqual(absoluteExpiresAt);
  });

  it('treats revoked, idle-expired, and absolute-expired sessions as expired', () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const active = {
      revokedAt: null,
      lastUsedAt: now,
      idleExpiresAt: new Date('2026-06-30T10:01:00.000Z'),
      absoluteExpiresAt: new Date('2026-06-30T11:00:00.000Z'),
    };

    expect(isRefreshSessionExpired(active, now)).toBe(false);
    expect(isRefreshSessionExpired({ ...active, revokedAt: now }, now)).toBe(true);
    expect(
      isRefreshSessionExpired({ ...active, lastUsedAt: new Date('2026-06-30T09:39:59.000Z') }, now),
    ).toBe(true);
    expect(isRefreshSessionExpired({ ...active, absoluteExpiresAt: now }, now)).toBe(true);
  });
});

describe('POST /auth/login', () => {
  it('logs in successfully with correct credentials and returns no passwordHash', async () => {
    await createTestUser({
      email: 'admin@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@test.local', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user.email).toBe('admin@test.local');
    expect(res.body.data.user.roles).toEqual(['ADMIN']);
    expect(getSetCookieHeaders(res).join('\n')).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=`);
    expect(getSetCookieHeaders(res).join('\n')).toContain('HttpOnly');
    expect(getSetCookieHeaders(res).join('\n')).toContain('SameSite=Lax');
    // Path=/ (not the Express-internal "/auth" mount point) is what makes
    // this cookie reachable at both "/auth/refresh" (local dev, direct
    // Express) and "/api/auth/refresh" (production, behind the Nginx
    // "/api/" proxy that strips the prefix) without any environment-
    // specific configuration.
    expect(getSetCookieHeaders(res).join('\n')).toContain('Path=/;');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('creates a persisted refresh session without storing the raw token', async () => {
    const userId = await createTestUser({
      email: 'session@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'session@test.local', password: 'correct-password' });

    const session = await prisma.refreshSession.findFirstOrThrow({ where: { userId } });
    const refreshToken = getRefreshTokenFromSetCookie(res);

    expect(session.refreshTokenHash).toBe(hashToken(refreshToken));
    expect(JSON.stringify(res.body)).not.toContain(refreshToken);
    expect(session.revokedAt).toBeNull();
    expect(session.idleExpiresAt.getTime()).toBeGreaterThan(session.lastUsedAt.getTime());
    expect(session.absoluteExpiresAt.getTime()).toBeGreaterThan(session.idleExpiresAt.getTime());
  });

  it('rejects a wrong password with a generic error', async () => {
    await createTestUser({
      email: 'admin@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@test.local', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it('rejects login for an inactive user with the same generic error', async () => {
    await createTestUser({
      email: 'inactive@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
      status: 'INACTIVE',
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'inactive@test.local', password: 'correct-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('normalizes email case and whitespace the same way as user creation/editing', async () => {
    await createTestUser({
      email: 'canonical@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const uppercase = await request(app)
      .post('/auth/login')
      .send({ identifier: 'CANONICAL@Test.Local', password: 'correct-password' });
    expect(uppercase.status).toBe(200);
    expect(uppercase.body.data.user.email).toBe('canonical@test.local');

    const padded = await request(app)
      .post('/auth/login')
      .send({ identifier: '  canonical@test.local  ', password: 'correct-password' });
    expect(padded.status).toBe(200);

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ identifier: 'CANONICAL@Test.Local', password: 'wrong-password' });
    expect(wrongPassword.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('returns fresh tokens, slides idle expiry, and rejects the rotated token', async () => {
    await createTestUser({
      email: 'refresh@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'refresh@test.local', password: 'correct-password' });
    const firstRefreshToken = getRefreshTokenFromSetCookie(login);
    const before = await prisma.refreshSession.findFirstOrThrow();

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(firstRefreshToken));

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(getSetCookieHeaders(res).join('\n')).toContain('Path=/;');
    const nextRefreshToken = getRefreshTokenFromSetCookie(res);
    expect(nextRefreshToken).not.toBe(firstRefreshToken);

    const after = await prisma.refreshSession.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.refreshTokenHash).toBe(hashToken(nextRefreshToken));
    expect(after.refreshTokenHash).not.toBe(before.refreshTokenHash);
    expect(after.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before.lastUsedAt.getTime());

    const replay = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(firstRefreshToken));
    expect(replay.status).toBe(401);
    expect(getSetCookieHeaders(replay).join('\n')).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=;`);
  });

  it('rejects and revokes an idle-expired refresh session', async () => {
    await createTestUser({
      email: 'idle@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'idle@test.local', password: 'correct-password' });
    const session = await prisma.refreshSession.findFirstOrThrow();
    const past = new Date(Date.now() - 21 * 60 * 1000);

    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { lastUsedAt: past, idleExpiresAt: past },
    });

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(getRefreshTokenFromSetCookie(login)));

    expect(res.status).toBe(401);
    expect(getSetCookieHeaders(res).join('\n')).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=;`);
    await expect(
      prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it('rejects and revokes an absolute-expired refresh session', async () => {
    await createTestUser({
      email: 'absolute@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'absolute@test.local', password: 'correct-password' });
    const session = await prisma.refreshSession.findFirstOrThrow();
    const past = new Date(Date.now() - 60 * 1000);

    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { absoluteExpiresAt: past },
    });

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(getRefreshTokenFromSetCookie(login)));

    expect(res.status).toBe(401);
    expect(getSetCookieHeaders(res).join('\n')).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=;`);
    await expect(
      prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh session', async () => {
    await createTestUser({
      email: 'logout@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'logout@test.local', password: 'correct-password' });

    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', refreshCookieHeader(getRefreshTokenFromSetCookie(login)));

    expect(res.status).toBe(200);
    expect(getSetCookieHeaders(res).join('\n')).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=;`);
    // The clearing cookie must use the same Path=/ as the cookie it clears
    // — a browser only honors Set-Cookie deletion when Path (and Domain)
    // match the original cookie exactly, otherwise the original cookie
    // remains active.
    expect(getSetCookieHeaders(res).join('\n')).toContain('Path=/;');
    await expect(prisma.refreshSession.findFirstOrThrow()).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});

describe('GET /auth/me', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token, with roles from user_roles', async () => {
    await createTestUser({
      email: 'multi-role@test.local',
      password: 'correct-password',
      roles: ['ADMIN', 'MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'multi-role@test.local', password: 'correct-password' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('multi-role@test.local');
    expect(res.body.data.roles.sort()).toEqual(['ADMIN', 'MERCHANDISER'].sort());
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('returns distributor and factory mappings alongside the user', async () => {
    const userId = await createTestUser({
      email: 'mapped-user@test.local',
      password: 'correct-password',
      roles: ['DISTRIBUTOR', 'FACTORY_USER'],
    });
    const distributor = await createTestDistributor({
      code: 'D-002',
      name: 'Northwind Distribution',
    });
    const factory = await createTestFactory({ code: 'F-002', name: 'Northwind Factory' });

    await prisma.userDistributor.create({
      data: { id: createId(), userId, distributorId: distributor.id },
    });
    await prisma.userFactory.create({
      data: { id: createId(), userId, factoryId: factory.id },
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'mapped-user@test.local', password: 'correct-password' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.distributors).toEqual([
      { id: distributor.id, code: distributor.code, name: distributor.name },
    ]);
    expect(res.body.data.factories).toEqual([
      { id: factory.id, code: factory.code, name: factory.name },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});
