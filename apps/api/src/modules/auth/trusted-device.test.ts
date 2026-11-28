import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { createTestUser, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Stands in for the phone's Keystore key: a P-256 pair that can sign challenges. */
function newDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    sign: (message: string) =>
      sign('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString(
        'base64',
      ),
  };
}
type DeviceKey = ReturnType<typeof newDeviceKey>;

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function passwordLogin(email: string, password = 'pass'): Promise<Session> {
  const res = await request(app).post('/auth/mobile/login').send({ identifier: email, password }).expect(200);
  return {
    userId: res.body.data.user.id,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
}

async function newUserSession(email = 'phone@test.local'): Promise<Session> {
  await createTestUser({ email, password: 'pass', roles: ['FACTORY_USER'] });
  return passwordLogin(email);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function registrationChallenge(accessToken: string) {
  const res = await request(app).post('/auth/trusted-devices/challenge').set(auth(accessToken));
  return res;
}

async function registerDevice(
  accessToken: string,
  key: DeviceKey = newDeviceKey(),
  label = 'Test phone',
): Promise<{ deviceId: string; key: DeviceKey }> {
  const challenge = await registrationChallenge(accessToken);
  expect(challenge.status).toBe(200);
  const res = await request(app)
    .post('/auth/trusted-devices')
    .set(auth(accessToken))
    .send({
      challengeId: challenge.body.data.challengeId,
      publicKey: key.publicKey,
      signature: key.sign(challenge.body.data.message),
      label,
      appVersion: '0.3.0',
    });
  expect(res.status).toBe(201);
  return { deviceId: res.body.data.device.id, key };
}

function signInChallenge(deviceId: string) {
  return request(app).post('/auth/mobile/trusted-device/challenge').send({ deviceId });
}

async function biometricSignIn(deviceId: string, key: DeviceKey) {
  const challenge = await signInChallenge(deviceId);
  expect(challenge.status).toBe(200);
  return request(app)
    .post('/auth/mobile/trusted-device/sign-in')
    .send({
      deviceId,
      challengeId: challenge.body.data.challengeId,
      signature: key.sign(challenge.body.data.message),
    });
}

describe('trusted device registration', () => {
  it('registers only the public key for the authenticated user, with an absolute expiry', async () => {
    const session = await newUserSession();
    const before = Date.now();
    const { deviceId } = await registerDevice(session.accessToken);

    const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.userId).toBe(session.userId);
    expect(device.revokedAt).toBeNull();
    expect(device.authVersion).toBe(1);
    const lifetimeMs = env.TRUSTED_DEVICE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    expect(device.expiresAt.getTime()).toBeGreaterThanOrEqual(before + lifetimeMs - 1000);
    expect(device.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + lifetimeMs + 1000);
    expect(env.TRUSTED_DEVICE_LIFETIME_DAYS).toBe(30);

    const audit = await prisma.auditLog.findMany({ where: { entityId: deviceId } });
    expect(audit.map((row) => row.action)).toEqual(['TRUSTED_DEVICE_REGISTERED']);
    expect(JSON.stringify(audit)).not.toContain('pass');
  });

  it('requires authentication', async () => {
    await request(app).post('/auth/trusted-devices/challenge').expect(401);
    await request(app)
      .post('/auth/trusted-devices')
      .send({ challengeId: 'x', publicKey: 'x', signature: 'x', label: 'x' })
      .expect(401);
    await request(app).get('/auth/trusted-devices').expect(401);
    await request(app).delete('/auth/trusted-devices/abc').expect(401);
  });

  it('accepts a legacy access token that predates the sign-in-method claim as a password session', async () => {
    const { token } = await createTestUserAndToken({
      email: 'legacy@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await registerDevice(token);
  });

  it('refuses to register from a session that biometrics started', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    const signedIn = await biometricSignIn(deviceId, key);
    expect(signedIn.status).toBe(200);

    const res = await registrationChallenge(signedIn.body.data.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_SIGN_IN_REQUIRED');

    // Rotating the session keeps its origin: still not a password session.
    const refreshed = await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: signedIn.body.data.refreshToken })
      .expect(200);
    const again = await registrationChallenge(refreshed.body.data.accessToken);
    expect(again.status).toBe(403);
  });

  it('rejects a signature made with a different key, and burns the challenge', async () => {
    const session = await newUserSession();
    const challenge = (await registrationChallenge(session.accessToken)).body.data;
    const claimed = newDeviceKey();
    const other = newDeviceKey();

    const bad = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(session.accessToken))
      .send({
        challengeId: challenge.challengeId,
        publicKey: claimed.publicKey,
        signature: other.sign(challenge.message),
        label: 'Phone',
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_SIGNATURE');

    const retry = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(session.accessToken))
      .send({
        challengeId: challenge.challengeId,
        publicKey: claimed.publicKey,
        signature: claimed.sign(challenge.message),
        label: 'Phone',
      });
    expect(retry.status).toBe(400);
    expect(retry.body.error.code).toBe('CHALLENGE_INVALID');
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it('rejects keys that are not EC P-256 and garbage input', async () => {
    const session = await newUserSession();
    const challenge = (await registrationChallenge(session.accessToken)).body.data;
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    for (const publicKey of [
      p384.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      'not-base64!!',
      'AAAA',
    ]) {
      const res = await request(app)
        .post('/auth/trusted-devices')
        .set(auth(session.accessToken))
        .send({ challengeId: challenge.challengeId, publicKey, signature: 'AAAA', label: 'Phone' });
      expect(res.status).toBe(400);
    }
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("rejects another user's registration challenge, an expired one and a reused one", async () => {
    const alice = await newUserSession('alice@test.local');
    const bob = await newUserSession('bob@test.local');
    const key = newDeviceKey();

    const aliceChallenge = (await registrationChallenge(alice.accessToken)).body.data;
    const stolen = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(bob.accessToken))
      .send({
        challengeId: aliceChallenge.challengeId,
        publicKey: key.publicKey,
        signature: key.sign(aliceChallenge.message),
        label: 'Phone',
      });
    expect(stolen.status).toBe(400);

    const expired = (await registrationChallenge(alice.accessToken)).body.data;
    await prisma.trustedDeviceChallenge.update({
      where: { id: expired.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const late = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(alice.accessToken))
      .send({
        challengeId: expired.challengeId,
        publicKey: key.publicKey,
        signature: key.sign(expired.message),
        label: 'Phone',
      });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('CHALLENGE_INVALID');

    // The first, untouched challenge still works for its owner, once.
    const ok = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(alice.accessToken))
      .send({
        challengeId: aliceChallenge.challengeId,
        publicKey: key.publicKey,
        signature: key.sign(aliceChallenge.message),
        label: 'Phone',
      });
    expect(ok.status).toBe(201);
    const reuse = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(alice.accessToken))
      .send({
        challengeId: aliceChallenge.challengeId,
        publicKey: newDeviceKey().publicKey,
        signature: key.sign(aliceChallenge.message),
        label: 'Phone',
      });
    expect(reuse.status).toBe(400);
  });

  it('refuses the same key twice and enforces the per-user device cap', async () => {
    const session = await newUserSession();
    const key = newDeviceKey();
    await registerDevice(session.accessToken, key);

    const challenge = (await registrationChallenge(session.accessToken)).body.data;
    const duplicate = await request(app)
      .post('/auth/trusted-devices')
      .set(auth(session.accessToken))
      .send({
        challengeId: challenge.challengeId,
        publicKey: key.publicKey,
        signature: key.sign(challenge.message),
        label: 'Again',
      });
    expect(duplicate.status).toBe(409);

    const original = env.TRUSTED_DEVICE_MAX_ACTIVE_PER_USER;
    (env as { TRUSTED_DEVICE_MAX_ACTIVE_PER_USER: number }).TRUSTED_DEVICE_MAX_ACTIVE_PER_USER = 1;
    try {
      const next = newDeviceKey();
      const capped = (await registrationChallenge(session.accessToken)).body.data;
      const res = await request(app)
        .post('/auth/trusted-devices')
        .set(auth(session.accessToken))
        .send({
          challengeId: capped.challengeId,
          publicKey: next.publicKey,
          signature: next.sign(capped.message),
          label: 'Second',
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DEVICE_LIMIT_REACHED');
    } finally {
      (env as { TRUSTED_DEVICE_MAX_ACTIVE_PER_USER: number }).TRUSTED_DEVICE_MAX_ACTIVE_PER_USER = original;
    }
  });
});

describe('biometric sign-in', () => {
  it('signs in after an explicit logout, repeatedly, with a fresh server session each time', async () => {
    const first = await newUserSession();
    const { deviceId, key } = await registerDevice(first.accessToken);

    let previousRefresh = first.refreshToken;
    const seenSessions = new Set<string>();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      // Explicit logout ends the session...
      await request(app).post('/auth/mobile/logout').send({ refreshToken: previousRefresh }).expect(200);
      const dead = await request(app).post('/auth/mobile/refresh').send({ refreshToken: previousRefresh });
      expect(dead.status).toBe(401);

      // ...but the trusted device is untouched and signs straight back in.
      const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
      expect(device.revokedAt).toBeNull();

      const signedIn = await biometricSignIn(deviceId, key);
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.data.user.id).toBe(first.userId);
      expect(signedIn.body.data.trustedDevice.id).toBe(deviceId);
      expect(signedIn.body.data.session.userId).toBe(first.userId);
      expect(signedIn.body.data.refreshToken).not.toBe(previousRefresh);

      await request(app).get('/auth/me').set(auth(signedIn.body.data.accessToken)).expect(200);
      const refreshed = await request(app)
        .post('/auth/mobile/refresh')
        .send({ refreshToken: signedIn.body.data.refreshToken })
        .expect(200);
      previousRefresh = refreshed.body.data.refreshToken as string;

      const sessions = await prisma.refreshSession.findMany({
        where: { trustedDeviceId: deviceId, revokedAt: null },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.authMethod).toBe('TRUSTED_DEVICE');
      seenSessions.add(sessions[0]!.id);
    }
    expect(seenSessions.size).toBe(3);

    const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.lastUsedAt).not.toBeNull();
    // Use never extends the authorization.
    const registered = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TRUSTED_DEVICE_REGISTERED', entityId: deviceId },
    });
    expect(device.expiresAt.getTime() - registered.createdAt.getTime()).toBeLessThanOrEqual(
      env.TRUSTED_DEVICE_LIFETIME_DAYS * 24 * 60 * 60 * 1000 + 2000,
    );
    const signIns = await prisma.auditLog.count({
      where: { action: 'TRUSTED_DEVICE_SIGN_IN', entityId: deviceId },
    });
    expect(signIns).toBe(3);
  });

  it('signs in after the previous refresh session has expired', async () => {
    const first = await newUserSession();
    const { deviceId, key } = await registerDevice(first.accessToken);
    await prisma.refreshSession.updateMany({
      data: {
        lastUsedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    await request(app).post('/auth/mobile/refresh').send({ refreshToken: first.refreshToken }).expect(401);

    const signedIn = await biometricSignIn(deviceId, key);
    expect(signedIn.status).toBe(200);
    await request(app).get('/auth/me').set(auth(signedIn.body.data.accessToken)).expect(200);
  });

  it('rejects a replayed challenge, including two simultaneous submissions', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);

    const challenge = (await signInChallenge(deviceId)).body.data;
    const body = { deviceId, challengeId: challenge.challengeId, signature: key.sign(challenge.message) };
    const results = await Promise.all([
      request(app).post('/auth/mobile/trusted-device/sign-in').send(body),
      request(app).post('/auth/mobile/trusted-device/sign-in').send(body),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);

    const replay = await request(app).post('/auth/mobile/trusted-device/sign-in').send(body);
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('CHALLENGE_INVALID');
    expect(await prisma.refreshSession.count({ where: { trustedDeviceId: deviceId } })).toBe(1);
  });

  it('rejects an invalid signature and burns that challenge', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    const attacker = newDeviceKey();

    const challenge = (await signInChallenge(deviceId)).body.data;
    const forged = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({ deviceId, challengeId: challenge.challengeId, signature: attacker.sign(challenge.message) });
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('INVALID_SIGNATURE');

    const afterwards = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({ deviceId, challengeId: challenge.challengeId, signature: key.sign(challenge.message) });
    expect(afterwards.status).toBe(400);

    // A signature over some other text, or garbage, is equally useless.
    const next = (await signInChallenge(deviceId)).body.data;
    for (const signature of [key.sign('something else'), 'AAAA', '!!!']) {
      const res = await request(app)
        .post('/auth/mobile/trusted-device/sign-in')
        .send({ deviceId, challengeId: next.challengeId, signature });
      expect([400, 401]).toContain(res.status);
    }
    expect(await prisma.refreshSession.count({ where: { trustedDeviceId: deviceId } })).toBe(0);
    const failures = await prisma.auditLog.count({ where: { action: 'TRUSTED_DEVICE_SIGN_IN_FAILED' } });
    expect(failures).toBeGreaterThan(0);
  });

  it('rejects an expired challenge', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    const challenge = (await signInChallenge(deviceId)).body.data;
    await prisma.trustedDeviceChallenge.update({
      where: { id: challenge.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({ deviceId, challengeId: challenge.challengeId, signature: key.sign(challenge.message) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CHALLENGE_INVALID');
  });

  it('expires challenges after the configured short lifetime', async () => {
    const session = await newUserSession();
    const { deviceId } = await registerDevice(session.accessToken);
    const challenge = (await signInChallenge(deviceId)).body.data;
    const stored = await prisma.trustedDeviceChallenge.findUniqueOrThrow({
      where: { id: challenge.challengeId },
    });
    expect(stored.purpose).toBe('SIGN_IN');
    expect(stored.deviceId).toBe(deviceId);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(
      env.TRUSTED_DEVICE_CHALLENGE_TTL_SECONDS * 1000 + 1000,
    );
    expect(stored.nonce.length).toBeGreaterThanOrEqual(43);
  });

  it('cannot use a challenge or signature across devices or accounts', async () => {
    const alice = await newUserSession('alice@test.local');
    const bob = await newUserSession('bob@test.local');
    const aliceDevice = await registerDevice(alice.accessToken);
    const bobDevice = await registerDevice(bob.accessToken);

    // Bob's key cannot answer a challenge issued for Alice's device.
    const aliceChallenge = (await signInChallenge(aliceDevice.deviceId)).body.data;
    const crossKey = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({
        deviceId: aliceDevice.deviceId,
        challengeId: aliceChallenge.challengeId,
        signature: bobDevice.key.sign(aliceChallenge.message),
      });
    expect(crossKey.status).toBe(401);

    // Alice's challenge presented under Bob's device id is not accepted at all.
    const second = (await signInChallenge(aliceDevice.deviceId)).body.data;
    const crossDevice = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({
        deviceId: bobDevice.deviceId,
        challengeId: second.challengeId,
        signature: bobDevice.key.sign(second.message),
      });
    expect(crossDevice.status).toBe(400);

    // And a registration challenge cannot be turned into a sign-in.
    const registration = (await registrationChallenge(alice.accessToken)).body.data;
    const wrongPurpose = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({
        deviceId: aliceDevice.deviceId,
        challengeId: registration.challengeId,
        signature: aliceDevice.key.sign(registration.message),
      });
    expect(wrongPurpose.status).toBe(400);

    // Each device only ever yields its own account.
    const ok = await biometricSignIn(bobDevice.deviceId, bobDevice.key);
    expect(ok.body.data.user.id).toBe(bob.userId);
  });

  it('answers an unknown device like a revoked one', async () => {
    const res = await signInChallenge(createId());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_AUTHORIZATION_INVALID');
  });

  it('rate limits challenge requests per device', async () => {
    const session = await newUserSession();
    const { deviceId } = await registerDevice(session.accessToken);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await signInChallenge(deviceId)).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('device authorization lifecycle', () => {
  it('stops working once the device is revoked, including challenges already issued', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    const pending = (await signInChallenge(deviceId)).body.data;

    await request(app)
      .delete(`/auth/trusted-devices/${deviceId}`)
      .set(auth(session.accessToken))
      .expect(200);

    const late = await request(app)
      .post('/auth/mobile/trusted-device/sign-in')
      .send({ deviceId, challengeId: pending.challengeId, signature: key.sign(pending.message) });
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('DEVICE_AUTHORIZATION_INVALID');

    const fresh = await signInChallenge(deviceId);
    expect(fresh.status).toBe(401);
    expect(fresh.body.error.code).toBe('DEVICE_AUTHORIZATION_INVALID');
  });

  it('stops working when the lifetime ends, and never before', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    await prisma.trustedDevice.update({
      where: { id: deviceId },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    expect((await biometricSignIn(deviceId, key)).status).toBe(200);

    await prisma.trustedDevice.update({
      where: { id: deviceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await signInChallenge(deviceId);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_AUTHORIZATION_INVALID');
  });

  it('is revoked, with its sessions, by an administrator password reset', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-pass',
      roles: ['ADMIN'],
    });
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);
    const signedIn = await biometricSignIn(deviceId, key);

    await request(app)
      .post(`/users/${session.userId}/reset-password`)
      .set(auth(adminToken))
      .send({ password: 'brand-new-password' })
      .expect(200);

    const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.revokedAt).not.toBeNull();
    expect(device.revokedReason).toBe('PASSWORD_RESET');
    expect(signedIn.status).toBe(200);
    await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: signedIn.body.data.refreshToken })
      .expect(401);
    expect((await signInChallenge(deviceId)).status).toBe(401);
    const audit = await prisma.auditLog.findMany({ where: { action: 'TRUSTED_DEVICES_REVOKED' } });
    expect(audit).toHaveLength(1);
  });

  it('is rejected by the authVersion check even if the row was somehow left active', async () => {
    const session = await newUserSession();
    const { deviceId } = await registerDevice(session.accessToken);
    await prisma.user.update({ where: { id: session.userId }, data: { authVersion: { increment: 1 } } });
    const res = await signInChallenge(deviceId);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_AUTHORIZATION_INVALID');
  });

  it('is revoked when the account is deactivated, and stays revoked after reactivation', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-pass',
      roles: ['ADMIN'],
    });
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);

    await request(app)
      .patch(`/users/${session.userId}/status`)
      .set(auth(adminToken))
      .send({ status: 'INACTIVE' })
      .expect(200);
    const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.revokedReason).toBe('USER_DEACTIVATED');
    expect((await signInChallenge(deviceId)).status).toBe(401);

    await request(app)
      .patch(`/users/${session.userId}/status`)
      .set(auth(adminToken))
      .send({ status: 'ACTIVE' })
      .expect(200);
    const res = await biometricSignIn(deviceId, key).catch(() => null);
    expect(res === null || res.status === 401).toBe(true);
    expect((await signInChallenge(deviceId)).status).toBe(401);
  });

  it('refuses to sign in a deactivated account even if its device row is still active', async () => {
    const session = await newUserSession();
    const { deviceId } = await registerDevice(session.accessToken);
    await prisma.user.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
    expect((await signInChallenge(deviceId)).status).toBe(401);
  });

  it('lists only the caller\'s active devices and scopes revocation to the owner', async () => {
    const alice = await newUserSession('alice@test.local');
    const bob = await newUserSession('bob@test.local');
    const first = await registerDevice(alice.accessToken, newDeviceKey(), 'Alice phone');
    await registerDevice(alice.accessToken, newDeviceKey(), 'Alice tablet');
    const bobs = await registerDevice(bob.accessToken, newDeviceKey(), 'Bob phone');

    const list = await request(app).get('/auth/trusted-devices').set(auth(alice.accessToken)).expect(200);
    expect(list.body.data.devices.map((device: { label: string }) => device.label).sort()).toEqual([
      'Alice phone',
      'Alice tablet',
    ]);
    expect(JSON.stringify(list.body)).not.toContain('publicKey');

    await request(app)
      .delete(`/auth/trusted-devices/${bobs.deviceId}`)
      .set(auth(alice.accessToken))
      .expect(404);
    expect((await signInChallenge(bobs.deviceId)).status).toBe(200);

    await request(app).delete(`/auth/trusted-devices/${first.deviceId}`).set(auth(alice.accessToken)).expect(200);
    await request(app).delete(`/auth/trusted-devices/${first.deviceId}`).set(auth(alice.accessToken)).expect(200);
    const after = await request(app).get('/auth/trusted-devices').set(auth(alice.accessToken)).expect(200);
    expect(after.body.data.devices).toHaveLength(1);
  });

  it('revokes the sessions a device started unless told to keep them', async () => {
    const session = await newUserSession();
    const { deviceId, key } = await registerDevice(session.accessToken);

    const kept = await biometricSignIn(deviceId, key);
    await request(app)
      .delete(`/auth/trusted-devices/${deviceId}?revokeSessions=false`)
      .set(auth(session.accessToken))
      .expect(200);
    await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: kept.body.data.refreshToken })
      .expect(200);

    const second = await registerDevice(session.accessToken);
    const ended = await biometricSignIn(second.deviceId, second.key);
    await request(app)
      .delete(`/auth/trusted-devices/${second.deviceId}`)
      .set(auth(session.accessToken))
      .expect(200);
    await request(app)
      .post('/auth/mobile/refresh')
      .send({ refreshToken: ended.body.data.refreshToken })
      .expect(401);
    const audit = await prisma.auditLog.findMany({ where: { action: 'TRUSTED_DEVICE_REVOKED' } });
    expect(audit).toHaveLength(2);
  });
});
