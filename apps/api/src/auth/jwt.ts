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

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
