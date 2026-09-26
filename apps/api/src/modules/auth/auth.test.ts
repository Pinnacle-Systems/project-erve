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
  REFRESH_ROTATION_GRACE_SECONDS,
  refreshSession,
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

function clearsRefreshCookie(res: Response): boolean {
  return getSetCookieHeaders(res).some((value) =>
    value.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=;`),
  );
}

/** Moves the session's last rotation instant into the past. */
async function ageLastRotation(sessionId: string, seconds: number): Promise<void> {
  const session = await prisma.refreshSession.findUniqueOrThrow({ where: { id: sessionId } });
  await prisma.refreshSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date(session.updatedAt.getTime() - seconds * 1000) },
  });
}

async function loginForRefreshToken(email: string): Promise<string> {
  await createTestUser({ email, password: 'correct-password', roles: ['ADMIN'] });
  const login = await request(app)
    .post('/auth/login')
    .send({ identifier: email, password: 'correct-password' });
  return getRefreshTokenFromSetCookie(login);
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

    // Outside the rotation grace window the previous token is plain reuse.
    await ageLastRotation(before.id, REFRESH_ROTATION_GRACE_SECONDS + 1);
    const replay = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(firstRefreshToken));
    expect(replay.status).toBe(401);
    await expect(
      prisma.refreshSession.findUniqueOrThrow({ where: { id: before.id } }),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) });
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
    expect(clearsRefreshCookie(res)).toBe(false);
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
    expect(clearsRefreshCookie(res)).toBe(false);
    await expect(
      prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});

describe('refresh rotation races and lost responses', () => {
  it('lets two concurrent refreshes of the same token both succeed with the same successor', async () => {
    const token = await loginForRefreshToken('race@test.local');

    const [first, second] = await Promise.all([
      request(app).post('/auth/refresh').set('Cookie', refreshCookieHeader(token)),
      request(app).post('/auth/refresh').set('Cookie', refreshCookieHeader(token)),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstSuccessor = getRefreshTokenFromSetCookie(first);
    expect(getRefreshTokenFromSetCookie(second)).toBe(firstSuccessor);
    // Neither response — including the one that lost the DB race — clears
    // the cookie the other just set.
    expect(clearsRefreshCookie(first)).toBe(false);
    expect(clearsRefreshCookie(second)).toBe(false);

    const session = await prisma.refreshSession.findFirstOrThrow();
    expect(session.revokedAt).toBeNull();
    expect(session.refreshTokenHash).toBe(hashToken(firstSuccessor));

    // The session survives the race and keeps rotating normally.
    const next = await request(app)
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader(firstSuccessor));
    expect(next.status).toBe(200);
  });

  it('answers a retry of a lost rotation with the already-issued successor, without sliding the session', async () => {
    const token = await loginForRefreshToken('lost@test.local');
    const rotatedAt = new Date(Date.now() + 1000);
    const issued = await refreshSession(token, rotatedAt);
    const afterRotation = await prisma.refreshSession.findFirstOrThrow();

    // The response carrying `issued` never reached the client, which retries
    // with the token it still holds.
    const retryAt = new Date(rotatedAt.getTime() + 30 * 1000);
    const retried = await refreshSession(token, retryAt);

    expect(retried.refreshToken).toBe(issued.refreshToken);
    expect(retried.accessToken).toEqual(expect.any(String));
    const afterRetry = await prisma.refreshSession.findFirstOrThrow();
    expect(afterRetry.revokedAt).toBeNull();
    expect(afterRetry.refreshTokenHash).toBe(afterRotation.refreshTokenHash);
    expect(afterRetry.lastUsedAt).toEqual(afterRotation.lastUsedAt);

    await expect(
      refreshSession(issued.refreshToken, new Date(retryAt.getTime() + 1000)),
    ).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it('rejects and revokes the previous token once the grace window has passed', async () => {
    const token = await loginForRefreshToken('late@test.local');
    const rotatedAt = new Date(Date.now() + 1000);
    await refreshSession(token, rotatedAt);

    const lateRetry = new Date(rotatedAt.getTime() + (REFRESH_ROTATION_GRACE_SECONDS + 1) * 1000);
    await expect(refreshSession(token, lateRetry)).rejects.toMatchObject({ statusCode: 401 });
    await expect(prisma.refreshSession.findFirstOrThrow()).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it('rejects and revokes a token older than the direct predecessor, even inside the window', async () => {
    const r1 = await loginForRefreshToken('old@test.local');
    const t0 = Date.now() + 1000;
    const r2 = await refreshSession(r1, new Date(t0));
    await refreshSession(r2.refreshToken, new Date(t0 + 1000));

    await expect(refreshSession(r1, new Date(t0 + 2000))).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(prisma.refreshSession.findFirstOrThrow()).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it('does not honour the predecessor of a revoked session', async () => {
    const token = await loginForRefreshToken('revoked@test.local');
    const rotatedAt = new Date(Date.now() + 1000);
    await refreshSession(token, rotatedAt);
    await prisma.refreshSession.updateMany({ data: { revokedAt: rotatedAt } });

    await expect(refreshSession(token, new Date(rotatedAt.getTime() + 1000))).rejects.toMatchObject(
      { statusCode: 401 },
    );
  });

  it('does not clear the refresh cookie when a stale refresh request fails', async () => {
    const token = await loginForRefreshToken('stale@test.local');
    const session = await prisma.refreshSession.findFirstOrThrow();
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const res = await request(app).post('/auth/refresh').set('Cookie', refreshCookieHeader(token));

    expect(res.status).toBe(401);
    expect(clearsRefreshCookie(res)).toBe(false);
  });
});

describe('mobile secure refresh exchange', () => {
  it('returns and rotates a refresh credential in the response body without a cookie', async () => {
    await createTestUser({ email: 'mobile@test.local', password: 'pass', roles: ['FACTORY_USER'] });
    const loginResponse = await request(app)
      .post('/auth/mobile/login')
      .send({ identifier: 'mobile@test.local', password: 'pass' })
      .expect(200);
    expect(loginResponse.body.data.refreshToken).toEqual(expect.any(String));
    expect(getSetCookieHeaders(loginResponse)).toHaveLength(0);

    const firstToken = loginResponse.body.data.refreshToken as string;
    const refreshResponse = await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: firstToken })
      .expect(200);
    expect(refreshResponse.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshResponse.body.data.refreshToken).not.toBe(firstToken);

    // A retry inside the rotation grace window (e.g. the response was lost
    // before the native bridge stored it) receives the same successor.
    const retried = await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: firstToken })
      .expect(200);
    expect(retried.body.data.refreshToken).toBe(refreshResponse.body.data.refreshToken);

    const session = await prisma.refreshSession.findFirstOrThrow();
    await ageLastRotation(session.id, REFRESH_ROTATION_GRACE_SECONDS + 1);
    await request(app).post('/auth/mobile/refresh').send({ refreshToken: firstToken }).expect(401);
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
