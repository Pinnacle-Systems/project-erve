import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { HttpError } from '../../errors/http-error.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { loginSchema } from './auth.validation.js';
import { mobileRefreshSchema } from './auth.validation.js';
import { env } from '../../config/env.js';
import { getMe, login } from './auth.service.js';
import { refreshSession, revokeRefreshSession } from './refresh-session.service.js';
import {
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from './refresh-cookie.js';

export const authRouter = Router();

function requireSecureMobileTransport(req: {
  secure: boolean;
  get(name: string): string | undefined;
}): void {
  if (env.NODE_ENV === 'production' && (!req.secure || req.get('Origin') !== 'https://localhost')) {
    throw HttpError.forbidden('Mobile session exchange requires the packaged app over HTTPS');
  }
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const result = await login(identifier, password);
    const { refreshToken, ...body } = result;
    setRefreshTokenCookie(res, refreshToken);
    res.status(200).json(successResponse(body));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshToken = getRefreshTokenFromCookie(req);

    if (!refreshToken) {
      clearRefreshTokenCookie(res);
      throw HttpError.unauthorized('Invalid or expired refresh session');
    }

    try {
      const result = await refreshSession(refreshToken);
      const { refreshToken: nextRefreshToken, accessToken } = result;
      setRefreshTokenCookie(res, nextRefreshToken);
      res.status(200).json(successResponse({ accessToken }));
    } catch (error) {
      clearRefreshTokenCookie(res);
      throw error;
    }
  }),
);

authRouter.post(
  '/mobile/login',
  asyncHandler(async (req, res) => {
    requireSecureMobileTransport(req);
    const { identifier, password } = loginSchema.parse(req.body);
    const result = await login(identifier, password);
    res.status(200).json(successResponse(result));
  }),
);

authRouter.post(
  '/mobile/refresh',
  asyncHandler(async (req, res) => {
    requireSecureMobileTransport(req);
    const { refreshToken } = mobileRefreshSchema.parse(req.body);
    const result = await refreshSession(refreshToken);
    res.status(200).json(successResponse(result));
  }),
);

authRouter.post(
  '/mobile/logout',
  asyncHandler(async (req, res) => {
    requireSecureMobileTransport(req);
    const parsed = mobileRefreshSchema.safeParse(req.body);
    if (parsed.success) await revokeRefreshSession(parsed.data.refreshToken);
    res.status(200).json(successResponse({}));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const refreshToken = getRefreshTokenFromCookie(req);

    if (refreshToken) {
      await revokeRefreshSession(refreshToken);
    }

    clearRefreshTokenCookie(res);
    res.status(200).json(successResponse({}));
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await getMe(req.user!.id);
    res.status(200).json(successResponse(me));
  }),
);
