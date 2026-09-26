import { createId } from '@erve/shared';
import type { AuthUser, SessionInfo } from '@erve/types';
import { env } from '../../config/env.js';
import { HttpError } from '../../errors/http-error.js';
import {
  getAccessTokenExpiry,
  signAccessToken,
  signRefreshToken,
  signRotatedRefreshToken,
  verifyRefreshToken,
} from '../../auth/jwt.js';
import { hashToken } from '../../auth/token-hash.js';
import { toCurrentUser, type CurrentUser } from '../../auth/current-user.js';
import {
  createRefreshSessionRecord,
  findRefreshSessionById,
  revokeAllRefreshSessionsForUser,
  revokeRefreshSessionById,
  rotateRefreshSessionToken,
} from './refresh-session.repository.js';

const INVALID_REFRESH_SESSION_MESSAGE = 'Invalid or expired refresh session';

/**
 * How long after a rotation the immediately previous refresh token is still
 * answered — with the successor the server already issued, never a new one.
 * Covers two legitimate cases that previously revoked the whole session:
 *   - two tabs (or two requests) presenting the same current token at once;
 *   - a rotation whose response/Set-Cookie never reached the client, so the
 *     client retries with the token it still holds.
 * Deliberately narrow: only the single direct predecessor qualifies, only
 * within this window, and only while the session is otherwise valid. Any
 * other stale token is still treated as reuse and revokes the session.
 */
export const REFRESH_ROTATION_GRACE_SECONDS = 60;

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

type RefreshSessionRecord = NonNullable<Awaited<ReturnType<typeof findRefreshSessionById>>>;

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  session: SessionInfo;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  session: SessionInfo;
}

export interface RefreshSessionOptions {
  /**
   * Whether the client observed genuine user activity since its previous
   * renewal. Only then does the idle expiry slide; otherwise the tokens are
   * rotated but the session keeps its existing idle deadline, so background
   * requests alone never keep an unattended session alive. Defaults to true
   * for clients that do not report activity (older web builds, mobile).
   */
  activity?: boolean;
}

export interface CreatedRefreshSession {
  refreshToken: string;
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
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

/**
 * The idle deadline actually enforced by isRefreshSessionExpired — derived
 * from the last activity and the *current* configuration (so a changed
 * JWT_REFRESH_IDLE_TIMEOUT_MINUTES applies to existing sessions), capped at
 * the absolute expiry.
 */
export function effectiveIdleExpiry(session: { lastUsedAt: Date; absoluteExpiresAt: Date }): Date {
  const idleExpiresAt = addMinutes(session.lastUsedAt, env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES);
  return idleExpiresAt < session.absoluteExpiresAt ? idleExpiresAt : session.absoluteExpiresAt;
}

export function isRefreshSessionExpired(session: RefreshSessionState, now = new Date()): boolean {
  const idleExpiresAt = addMinutes(session.lastUsedAt, env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES);
  return Boolean(
    session.revokedAt ||
    idleExpiresAt.getTime() < now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime(),
  );
}

export function buildSessionInfo(input: {
  userId: string;
  accessToken: string;
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
}): SessionInfo {
  return {
    userId: input.userId,
    serverTime: input.now.toISOString(),
    accessExpiresAt: getAccessTokenExpiry(input.accessToken).toISOString(),
    idleExpiresAt: effectiveIdleExpiry(input).toISOString(),
    absoluteExpiresAt: input.absoluteExpiresAt.toISOString(),
    idleTimeoutSeconds: env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES * 60,
  };
}

function signSessionRefreshToken(userId: string, sessionId: string, authVersion: number): string {
  return signRefreshToken({ sub: userId, sessionId, tokenId: createId(), authVersion });
}

export async function createRefreshSession(
  userId: string,
  authVersion: number,
  now = new Date(),
): Promise<CreatedRefreshSession> {
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

  return { refreshToken, lastUsedAt: now, absoluteExpiresAt: expiry.absoluteExpiresAt };
}

function successorRefreshToken(
  presentedTokenHash: string,
  session: RefreshSessionRecord,
  authVersion: number,
): string {
  return signRotatedRefreshToken({
    previousTokenHash: presentedTokenHash,
    sub: session.userId,
    sessionId: session.id,
    authVersion,
    absoluteExpiresAt: session.absoluteExpiresAt,
  });
}

function isWithinRotationGrace(session: RefreshSessionRecord, now: Date): boolean {
  // updatedAt is written as the rotation instant by rotateRefreshSessionToken.
  const elapsedMs = now.getTime() - session.updatedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= REFRESH_ROTATION_GRACE_SECONDS * 1000;
}

function sessionTokenResponse(
  currentUser: CurrentUser,
  refreshToken: string,
  state: { lastUsedAt: Date; absoluteExpiresAt: Date },
  now: Date,
): RefreshTokenResponse {
  const accessToken = signAccessToken({
    sub: currentUser.id,
    roles: currentUser.roles,
    authVersion: currentUser.authVersion,
  });
  return {
    accessToken,
    refreshToken,
    session: buildSessionInfo({ userId: currentUser.id, accessToken, ...state, now }),
  };
}

export async function refreshSession(
  refreshToken: string,
  now = new Date(),
  { activity = true }: RefreshSessionOptions = {},
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

  const presentedTokenHash = hashToken(refreshToken);
  const session = await findRefreshSessionById(payload.sessionId);

  if (!session) {
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  if (session.userId !== payload.sub || isRefreshSessionExpired(session, now)) {
    await revokeRefreshSessionById(session.id, now);
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

  const successor = successorRefreshToken(presentedTokenHash, session, currentUser.authVersion);
  const successorHash = hashToken(successor);

  if (session.refreshTokenHash !== presentedTokenHash) {
    // Not the current token. The only stale token still honoured is the
    // direct predecessor of the current one, shortly after it was rotated:
    // answer it idempotently with the successor already issued (no DB
    // mutation, so this can never slide the session). Everything else is
    // refresh-token reuse and revokes the session.
    if (session.refreshTokenHash === successorHash && isWithinRotationGrace(session, now)) {
      return sessionTokenResponse(currentUser, successor, session, now);
    }

    await revokeRefreshSessionById(session.id, now);
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  const rotated = await rotateRefreshSessionToken({
    sessionId: session.id,
    currentRefreshTokenHash: presentedTokenHash,
    nextRefreshTokenHash: successorHash,
    now,
    activity: activity
      ? { lastUsedAt: now, idleExpiresAt: calculateNextIdleExpiry(session.absoluteExpiresAt, now) }
      : null,
  });

  if (!rotated) {
    // Lost a race with a concurrent rotation of the same token. Because the
    // successor is deterministic, the winner stored exactly this successor —
    // return it too rather than failing (and never clearing the client's
    // credential). Anything else means the session was revoked meanwhile.
    const latest = await findRefreshSessionById(session.id);
    if (latest && !latest.revokedAt && latest.refreshTokenHash === successorHash) {
      return sessionTokenResponse(currentUser, successor, latest, now);
    }
    throw HttpError.unauthorized(INVALID_REFRESH_SESSION_MESSAGE);
  }

  return sessionTokenResponse(
    currentUser,
    successor,
    {
      lastUsedAt: activity ? now : session.lastUsedAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    },
    now,
  );
}

/**
 * Explicit logout. Revokes the whole session the presented token belongs to
 * — whether it is the current token or the direct predecessor still inside
 * the rotation grace window. The latter matters because a logout can race a
 * refresh: the refresh rotates R1 → R2 while the logout is already in flight
 * carrying R1, and matching only the current hash would then revoke nothing.
 * Revocation is by session id (not by hash), so a rotation landing between
 * the lookup and the update cannot dodge it either. Any other token — stale,
 * forged, or from a different session/user — revokes nothing.
 */
export async function revokeRefreshSession(refreshToken: string, now = new Date()): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    if (typeof payload.authVersion !== 'number') return;

    const session = await findRefreshSessionById(payload.sessionId);
    if (!session || session.revokedAt || session.userId !== payload.sub) return;

    const presentedTokenHash = hashToken(refreshToken);
    const isCurrent = session.refreshTokenHash === presentedTokenHash;
    const isGracePredecessor =
      !isCurrent &&
      session.refreshTokenHash ===
        hashToken(successorRefreshToken(presentedTokenHash, session, payload.authVersion)) &&
      isWithinRotationGrace(session, now);

    if (isCurrent || isGracePredecessor) {
      await revokeRefreshSessionById(session.id, now);
    }
  } catch {
    // Logout is intentionally idempotent and does not reveal token validity.
  }
}

// Used on deactivation/suspension and password reset so a signed-out state
// takes effect immediately rather than waiting for idle/absolute expiry.
export async function revokeAllSessionsForUser(userId: string, now = new Date()): Promise<void> {
  await revokeAllRefreshSessionsForUser(userId, now);
}

export function issueTokenResponse(
  currentUser: CurrentUser,
  created: CreatedRefreshSession,
  now = new Date(),
): TokenResponse {
  const { accessToken, session } = sessionTokenResponse(
    currentUser,
    created.refreshToken,
    created,
    now,
  );
  return {
    accessToken,
    refreshToken: created.refreshToken,
    user: {
      id: currentUser.id,
      email: currentUser.email,
      mobile: currentUser.mobile,
      name: currentUser.name,
      roles: currentUser.roles,
    },
    session,
  };
}
