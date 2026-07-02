import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';

export const REFRESH_TOKEN_COOKIE_NAME = 'erve_refresh_token';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth',
  };
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions(),
    maxAge: env.JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, refreshCookieOptions());
}

export function getRefreshTokenFromCookie(req: Request): string | undefined {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');

    if (name === REFRESH_TOKEN_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return undefined;
}
