import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';

export const REFRESH_TOKEN_COOKIE_NAME = 'erve_refresh_token';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Deliberately "/", not an Express-internal path like "/auth". The
    // browser/Capacitor WebView only ever sees the *public* request path,
    // which differs by how this API is reached:
    //   - local dev: the web app calls this Express app directly
    //     (VITE_API_URL=http://localhost:4000), so the public path is
    //     "/auth/refresh" — matches this Express router's own mount point.
    //   - production: Nginx exposes the API under "/api/" and strips that
    //     prefix before proxying (see deployment/nginx/erve.vhost.example.conf),
    //     so the public path is "/api/auth/refresh" — does NOT match
    //     "/auth", which would silently stop the browser from ever
    //     sending this cookie back on refresh/logout.
    // "/" is correct in both cases and needs no environment-specific
    // configuration or Nginx cookie-path rewriting to keep in sync.
    path: '/',
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
