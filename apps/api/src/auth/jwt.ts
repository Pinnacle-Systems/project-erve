import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@erve/types';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  roles: Role[];
  authVersion: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  tokenId: string;
  authVersion: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: `${env.JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS}h` as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

/**
 * Signs the successor of a rotated refresh token deterministically: the same
 * predecessor, session and absolute expiry always produce the byte-identical
 * successor. That lets the server answer a concurrent or retried rotation of
 * the immediately previous token with the token it already issued, instead
 * of treating it as reuse — see refreshSession(). The token id is an HMAC of
 * the predecessor's hash under the refresh secret, so only the server can
 * compute a successor, and `exp` is pinned to the session's absolute expiry
 * (no `iat`) so nothing time-dependent enters the signature.
 */
export function signRotatedRefreshToken(input: {
  previousTokenHash: string;
  sub: string;
  sessionId: string;
  authVersion: number;
  absoluteExpiresAt: Date;
}): string {
  const tokenId = createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(`rotation:${input.previousTokenHash}`)
    .digest('hex');
  const payload = {
    sub: input.sub,
    sessionId: input.sessionId,
    tokenId,
    authVersion: input.authVersion,
    exp: Math.floor(input.absoluteExpiresAt.getTime() / 1000),
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { noTimestamp: true });
}

/** Server-authoritative access-token expiry, read back from a token this server just signed. */
export function getAccessTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) {
    throw new Error('Signed access token has no exp claim');
  }
  return new Date(decoded.exp * 1000);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
