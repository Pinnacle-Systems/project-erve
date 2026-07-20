import { createId } from '@erve/shared';
import type { AuthUser } from '@erve/types';
import { env } from '../../config/env.js';
import { HttpError } from '../../errors/http-error.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../auth/jwt.js';
import { hashToken } from '../../auth/token-hash.js';
import { toCurrentUser, type CurrentUser } from '../../auth/current-user.js';
import {
  createRefreshSessionRecord,
  findRefreshSessionById,
  revokeAllRefreshSessionsForUser,
  revokeRefreshSessionById,
  revokeRefreshSessionByToken,
  rotateRefreshSessionToken,
} from './refresh-session.repository.js';

const INVALID_REFRESH_SESSION_MESSAGE = 'Invalid or expired refresh session';

export interface RefreshSessionExpiry {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

interface RefreshSessionState {
  revokedAt: Date | null;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function calculateRefreshSessionExpiry(now = new Date()): RefreshSessionExpiry {
  return {
    idleExpiresAt: addMinutes(now, env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES),
    absoluteExpiresAt: addHours(now, env.JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS),
  };
}

export function calculateNextIdleExpiry(absoluteExpiresAt: Date, now = new Date()): Date {
  const nextIdleExpiry = addMinutes(now, env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES);
  return nextIdleExpiry < absoluteExpiresAt ? nextIdleExpiry : absoluteExpiresAt;
}

export function isRefreshSessionExpired(session: RefreshSessionState, now = new Date()): boolean {
  const idleExpiresAt = addMinutes(session.lastUsedAt, env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES);
  return Boolean(
    session.revokedAt ||
    idleExpiresAt.getTime() < now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime(),
  );
}

function signSessionRefreshToken(userId: string, sessionId: string, authVersion: number): string {
  return signRefreshToken({ sub: userId, sessionId, tokenId: createId(), authVersion });
}

export async function createRefreshSession(
  userId: string,
  authVersion: number,
  now = new Date(),
): Promise<string> {
  const sessionId = createId();
  const refreshToken = signSessionRefreshToken(userId, sessionId, authVersion);
  const expiry = calculateRefreshSessionExpiry(now);

  await createRefreshSessionRecord({
    id: sessionId,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    now,
    idleExpiresAt: expiry.idleExpiresAt,
    absoluteExpiresAt: expiry.absoluteExpiresAt,
  });

  return refreshToken;
}

export async function refreshSession(
  refreshToken: string,
  now = new Date(),
): Promise<RefreshTokenResponse> {
  let payload: ReturnType<typeof verifyRefreshToken>;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  if (typeof payload.authVersion !== 'number') {
    // Tokens issued before authVersion existed carry no claim at all —
    // treated as invalid rather than silently trusted at the current version.
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  const currentRefreshTokenHash = hashToken(refreshToken);
  const session = await findRefreshSessionById(payload.sessionId);

  if (!session) {
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  if (
    session.userId !== payload.sub ||
    session.refreshTokenHash !== currentRefreshTokenHash ||
    isRefreshSessionExpired(session, now)
  ) {
    if (session) {
      await revokeRefreshSessionById(session.id, now);
    }
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  const currentUser = toCurrentUser(session.user);

  // A stale authVersion means the credential was reset since this token was
  // issued — the session's own revokedAt is already set by that reset in the
  // normal case, but this check also fails closed for any path that bumps
  // the version without (yet) revoking every session.
  if (currentUser.status !== 'ACTIVE' || currentUser.authVersion !== payload.authVersion) {
    await revokeRefreshSessionById(session.id, now);
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  const nextRefreshToken = signSessionRefreshToken(
    currentUser.id,
    session.id,
    currentUser.authVersion,
  );
  const rotated = await rotateRefreshSessionToken({
    sessionId: session.id,
    currentRefreshTokenHash,
    nextRefreshTokenHash: hashToken(nextRefreshToken),
    now,
    idleExpiresAt: calculateNextIdleExpiry(session.absoluteExpiresAt, now),
  });

  if (!rotated) {
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  return {
    accessToken: signAccessToken({
      sub: currentUser.id,
      roles: currentUser.roles,
      authVersion: currentUser.authVersion,
    }),
    refreshToken: nextRefreshToken,
  };
}

export async function revokeRefreshSession(refreshToken: string, now = new Date()): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await revokeRefreshSessionByToken(payload.sessionId, hashToken(refreshToken), now);
  } catch {
    // Logout is intentionally idempotent and does not reveal token validity.
  }
}

// Used on deactivation/suspension and password reset so a signed-out state
// takes effect immediately rather than waiting for idle/absolute expiry.
export async function revokeAllSessionsForUser(userId: string, now = new Date()): Promise<void> {
  await revokeAllRefreshSessionsForUser(userId, now);
}

export function issueTokenResponse(currentUser: CurrentUser, refreshToken: string): TokenResponse {
  return {
    accessToken: signAccessToken({
      sub: currentUser.id,
      roles: currentUser.roles,
      authVersion: currentUser.authVersion,
    }),
    refreshToken,
    user: {
      id: currentUser.id,
      email: currentUser.email,
      mobile: currentUser.mobile,
      name: currentUser.name,
      roles: currentUser.roles,
    },
  };
}
