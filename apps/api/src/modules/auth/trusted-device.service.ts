import { randomBytes } from 'node:crypto';
import { createId } from '@erve/shared';
import { env } from '../../config/env.js';
import { prisma, type Prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { toCurrentUser, currentUserSelect, type CurrentUser } from '../../auth/current-user.js';
import type { AuthenticationMethod } from '../../auth/jwt.js';
import { enforceRateLimit, pruneRateLimitBuckets } from '../../auth/rate-limit.js';
import { createRefreshSession, issueTokenResponse, type TokenResponse } from './refresh-session.service.js';
import {
  buildChallengeMessage,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from './trusted-device-crypto.js';

/**
 * Trusted-device (biometric) sign-in.
 *
 * A phone is authorized once, from a password-established session, by
 * registering the public half of a Keystore key that needs a strong biometric
 * for every signature. Afterwards the phone can start a brand-new session by
 * signing a short-lived, single-use server challenge. The registration is
 * independent of refresh sessions (logging out leaves it alone), has a fixed
 * absolute lifetime, and is revoked by password resets, deactivation, the
 * user, or expiry. No password, refresh token or other bearer secret is kept.
 */

export const DEVICE_AUTHORIZATION_INVALID_MESSAGE =
  'Biometric sign-in is no longer authorized for this device. Sign in with your password.';
const CHALLENGE_INVALID_MESSAGE = 'The sign-in challenge is invalid or has expired. Try again.';

const HOUSEKEEPING_RETENTION_MS = 60 * 60 * 1000;

export interface RequestContext {
  ip: string;
}

export interface TrustedDeviceView {
  id: string;
  label: string;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export interface ChallengeResponse {
  challengeId: string;
  /** The exact text the device must sign. */
  message: string;
  expiresAt: string;
}

export interface TrustedDeviceSignInResponse extends TokenResponse {
  trustedDevice: { id: string; expiresAt: string };
}

type DeviceRecord = Awaited<ReturnType<typeof loadDevice>>;

function toView(device: {
  id: string;
  label: string;
  platform: string;
  appVersion: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
}): TrustedDeviceView {
  return {
    id: device.id,
    label: device.label,
    platform: device.platform,
    appVersion: device.appVersion,
    createdAt: device.createdAt.toISOString(),
    expiresAt: device.expiresAt.toISOString(),
    lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function deviceInvalid(): HttpError {
  return new HttpError(401, 'DEVICE_AUTHORIZATION_INVALID', DEVICE_AUTHORIZATION_INVALID_MESSAGE);
}

function challengeInvalid(): HttpError {
  return new HttpError(400, 'CHALLENGE_INVALID', CHALLENGE_INVALID_MESSAGE);
}

async function loadDevice(deviceId: string) {
  return prisma.trustedDevice.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      userId: true,
      publicKey: true,
      authVersion: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: currentUserSelect },
    },
  });
}

/** Revokes every active device of a user. Runs inside the caller's transaction. */
export async function revokeTrustedDevicesForUser(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  userId: string,
  reason: 'PASSWORD_RESET' | 'USER_DEACTIVATED',
  now: Date,
): Promise<number> {
  const result = await tx.trustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  if (result.count > 0) {
    await recordAuditLog(
      {
        actorId,
        action: 'TRUSTED_DEVICES_REVOKED',
        entityType: 'User',
        entityId: userId,
        metadata: { reason, count: result.count },
      },
      tx,
    );
  }
  return result.count;
}

async function housekeeping(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - HOUSEKEEPING_RETENTION_MS);
  await prisma.trustedDeviceChallenge.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  await pruneRateLimitBuckets(now);
}

function newNonce(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------- registration

export async function issueRegistrationChallenge(
  actor: CurrentUser,
  authMethod: AuthenticationMethod,
  ctx: RequestContext,
  now = new Date(),
): Promise<ChallengeResponse> {
  assertPasswordSession(authMethod);
  await enforceRateLimit({ scope: 'td-reg-challenge-ip', subject: ctx.ip, limit: 30, windowSeconds: 60 }, now);
  await enforceRateLimit({ scope: 'td-reg-challenge-user', subject: actor.id, limit: 20, windowSeconds: 3600 }, now);

  const id = createId();
  const nonce = newNonce();
  const expiresAt = new Date(now.getTime() + env.TRUSTED_DEVICE_CHALLENGE_TTL_SECONDS * 1000);
  await prisma.trustedDeviceChallenge.create({
    data: { id, purpose: 'REGISTRATION', userId: actor.id, deviceId: null, nonce, expiresAt },
  });
  void housekeeping(now).catch(() => undefined);

  return {
    challengeId: id,
    message: buildChallengeMessage({
      purpose: 'REGISTRATION',
      challengeId: id,
      nonce,
      userId: actor.id,
      deviceId: null,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

function assertPasswordSession(authMethod: AuthenticationMethod): void {
  if (authMethod !== 'pwd') {
    // A session that biometrics started must not be able to mint a fresh,
    // longer-lived device authorization: that would let biometric sign-ins
    // renew themselves forever and bypass the device lifetime.
    throw new HttpError(
      403,
      'PASSWORD_SIGN_IN_REQUIRED',
      'Sign in with your password to turn on biometric login.',
    );
  }
}

export interface RegisterDeviceInput {
  challengeId: string;
  publicKey: string;
  signature: string;
  label: string;
  appVersion?: string | undefined;
}

export async function registerTrustedDevice(
  actor: CurrentUser,
  authMethod: AuthenticationMethod,
  input: RegisterDeviceInput,
  ctx: RequestContext,
  now = new Date(),
): Promise<{ device: TrustedDeviceView }> {
  assertPasswordSession(authMethod);
  await enforceRateLimit({ scope: 'td-register-user', subject: actor.id, limit: 20, windowSeconds: 3600 }, now);

  const parsedKey = parseDevicePublicKey(input.publicKey);
  if (!parsedKey) {
    throw HttpError.badRequest('The device public key is not a supported P-256 key');
  }

  // The challenge must belong to this user, be a registration challenge and be
  // unused and unexpired. It is consumed atomically *before* the signature is
  // checked, so a bad signature cannot be retried against the same challenge.
  const challenge = await prisma.trustedDeviceChallenge.findFirst({
    where: { id: input.challengeId, purpose: 'REGISTRATION', userId: actor.id, deviceId: null },
    select: { id: true, nonce: true },
  });
  if (!challenge) throw challengeInvalid();

  const consumed = await prisma.trustedDeviceChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw challengeInvalid();

  const message = buildChallengeMessage({
    purpose: 'REGISTRATION',
    challengeId: challenge.id,
    nonce: challenge.nonce,
    userId: actor.id,
    deviceId: null,
  });
  if (!verifyDeviceSignature(parsedKey.key, message, input.signature)) {
    throw new HttpError(400, 'INVALID_SIGNATURE', 'The device could not prove it holds the key.');
  }

  const deviceId = createId();
  const expiresAt = addDays(now, env.TRUSTED_DEVICE_LIFETIME_DAYS);

  const device = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('trusted_device:' || ${actor.id}, 0))::text`;

    const current = await tx.user.findUnique({
      where: { id: actor.id },
      select: { status: true, authVersion: true },
    });
    if (!current || current.status !== 'ACTIVE' || current.authVersion !== actor.authVersion) {
      throw HttpError.unauthorized('Invalid or expired token');
    }

    const active = await tx.trustedDevice.count({
      where: { userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
    });
    if (active >= env.TRUSTED_DEVICE_MAX_ACTIVE_PER_USER) {
      throw new HttpError(
        409,
        'DEVICE_LIMIT_REACHED',
        'Too many devices are authorized for biometric login. Remove one and try again.',
      );
    }

    const existing = await tx.trustedDevice.findUnique({
      where: { publicKeyFingerprint: parsedKey.fingerprint },
      select: { id: true },
    });
    if (existing) {
      throw HttpError.conflict('This device key is already registered');
    }

    const created = await tx.trustedDevice.create({
      data: {
        id: deviceId,
        userId: actor.id,
        label: input.label,
        appVersion: input.appVersion ?? null,
        publicKey: parsedKey.spki,
        publicKeyFingerprint: parsedKey.fingerprint,
        authVersion: actor.authVersion,
        expiresAt,
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'TRUSTED_DEVICE_REGISTERED',
        entityType: 'TrustedDevice',
        entityId: deviceId,
        metadata: { label: input.label, expiresAt: expiresAt.toISOString(), ip: ctx.ip },
      },
      tx,
    );
    return created;
  });

  return { device: toView(device) };
}

// ----------------------------------------------------------------- management

export async function listTrustedDevices(
  actor: CurrentUser,
  now = new Date(),
): Promise<TrustedDeviceView[]> {
  const devices = await prisma.trustedDevice.findMany({
    where: { userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  return devices.map(toView);
}

export async function revokeTrustedDevice(
  actor: CurrentUser,
  deviceId: string,
  options: { revokeSessions: boolean },
  ctx: RequestContext,
  now = new Date(),
): Promise<void> {
  // Scoped to the caller: another user's device id looks exactly like a missing one.
  const device = await prisma.trustedDevice.findFirst({
    where: { id: deviceId, userId: actor.id },
    select: { id: true, revokedAt: true },
  });
  if (!device) throw HttpError.notFound('Device not found');
  if (device.revokedAt) return; // idempotent

  await prisma.$transaction(async (tx) => {
    const result = await tx.trustedDevice.updateMany({
      where: { id: device.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'USER_REVOKED' },
    });
    if (result.count === 0) return;
    let sessions = 0;
    if (options.revokeSessions) {
      sessions = (
        await tx.refreshSession.updateMany({
          where: { trustedDeviceId: device.id, revokedAt: null },
          data: { revokedAt: now },
        })
      ).count;
    }
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'TRUSTED_DEVICE_REVOKED',
        entityType: 'TrustedDevice',
        entityId: device.id,
        metadata: { reason: 'USER_REVOKED', sessionsRevoked: sessions, ip: ctx.ip },
      },
      tx,
    );
  });
}

// -------------------------------------------------------------------- sign-in

function usable(device: NonNullable<DeviceRecord>, now: Date): boolean {
  return (
    device.revokedAt === null &&
    device.expiresAt.getTime() > now.getTime() &&
    device.user.status === 'ACTIVE' &&
    device.user.authVersion === device.authVersion
  );
}

export async function issueSignInChallenge(
  deviceId: string,
  ctx: RequestContext,
  now = new Date(),
): Promise<ChallengeResponse> {
  await enforceRateLimit({ scope: 'td-challenge-ip', subject: ctx.ip, limit: 60, windowSeconds: 60 }, now);
  await enforceRateLimit({ scope: 'td-challenge-device', subject: deviceId, limit: 10, windowSeconds: 60 }, now);

  const device = await loadDevice(deviceId);
  if (!device || !usable(device, now)) throw deviceInvalid();

  const id = createId();
  const nonce = newNonce();
  const expiresAt = new Date(now.getTime() + env.TRUSTED_DEVICE_CHALLENGE_TTL_SECONDS * 1000);
  await prisma.trustedDeviceChallenge.create({
    data: { id, purpose: 'SIGN_IN', userId: device.userId, deviceId: device.id, nonce, expiresAt },
  });
  void housekeeping(now).catch(() => undefined);

  return {
    challengeId: id,
    message: buildChallengeMessage({
      purpose: 'SIGN_IN',
      challengeId: id,
      nonce,
      userId: device.userId,
      deviceId: device.id,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

export interface SignInInput {
  deviceId: string;
  challengeId: string;
  signature: string;
}

async function auditFailure(
  device: { id: string; userId: string } | null,
  reason: string,
  ctx: RequestContext,
): Promise<void> {
  if (!device) return; // nothing identifiable to attribute, and rate limits bound the noise
  await recordAuditLog({
    actorId: device.userId,
    action: 'TRUSTED_DEVICE_SIGN_IN_FAILED',
    entityType: 'TrustedDevice',
    entityId: device.id,
    metadata: { reason, ip: ctx.ip },
  }).catch(() => undefined);
}

export async function signInWithTrustedDevice(
  input: SignInInput,
  ctx: RequestContext,
  now = new Date(),
): Promise<TrustedDeviceSignInResponse> {
  await enforceRateLimit({ scope: 'td-signin-ip', subject: ctx.ip, limit: 30, windowSeconds: 60 }, now);
  await enforceRateLimit({ scope: 'td-signin-device', subject: input.deviceId, limit: 10, windowSeconds: 60 }, now);

  const device = await loadDevice(input.deviceId);

  // Single use: the challenge is consumed first, and only if it is a SIGN_IN
  // challenge for exactly this device that is still unexpired. Whatever happens
  // next, it can never be presented again.
  const consumed = await prisma.trustedDeviceChallenge.updateMany({
    where: {
      id: input.challengeId,
      purpose: 'SIGN_IN',
      deviceId: input.deviceId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    await auditFailure(device, 'CHALLENGE_INVALID', ctx);
    throw challengeInvalid();
  }

  if (!device || !usable(device, now)) {
    await auditFailure(device, 'DEVICE_NOT_AUTHORIZED', ctx);
    throw deviceInvalid();
  }

  const challenge = await prisma.trustedDeviceChallenge.findUnique({
    where: { id: input.challengeId },
    select: { id: true, nonce: true, userId: true, deviceId: true },
  });
  // The challenge belongs to the device's own user and device (cross-account
  // and cross-device use are impossible by construction; this is the check).
  if (!challenge || challenge.deviceId !== device.id || challenge.userId !== device.userId) {
    await auditFailure(device, 'CHALLENGE_MISMATCH', ctx);
    throw challengeInvalid();
  }

  const publicKey = parseDevicePublicKey(device.publicKey);
  const message = buildChallengeMessage({
    purpose: 'SIGN_IN',
    challengeId: challenge.id,
    nonce: challenge.nonce,
    userId: device.userId,
    deviceId: device.id,
  });
  if (!publicKey || !verifyDeviceSignature(publicKey.key, message, input.signature)) {
    await auditFailure(device, 'INVALID_SIGNATURE', ctx);
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Biometric sign-in could not be verified.');
  }

  const currentUser = toCurrentUser(device.user);
  const created = await createRefreshSession(currentUser.id, currentUser.authVersion, now, {
    trustedDeviceId: device.id,
  });
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: now } });
  await recordAuditLog({
    actorId: currentUser.id,
    action: 'TRUSTED_DEVICE_SIGN_IN',
    entityType: 'TrustedDevice',
    entityId: device.id,
    metadata: { ip: ctx.ip },
  });

  return {
    ...issueTokenResponse(currentUser, created, now),
    trustedDevice: { id: device.id, expiresAt: device.expiresAt.toISOString() },
  };
}
