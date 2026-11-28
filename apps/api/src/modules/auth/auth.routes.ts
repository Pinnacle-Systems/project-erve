import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { HttpError } from '../../errors/http-error.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  loginSchema,
  mobileRefreshSchema,
  refreshSchema,
  registerTrustedDeviceSchema,
  revokeTrustedDeviceQuerySchema,
  trustedDeviceChallengeSchema,
  trustedDeviceSignInSchema,
} from './auth.validation.js';
import { env } from '../../config/env.js';
import { getMe, login } from './auth.service.js';
import { refreshSession, revokeRefreshSession } from './refresh-session.service.js';
import {
  issueRegistrationChallenge,
  issueSignInChallenge,
  listTrustedDevices,
  registerTrustedDevice,
  revokeTrustedDevice,
  signInWithTrustedDevice,
} from './trusted-device.service.js';
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
      throw HttpError.unauthorized('Invalid or expired refresh session');
    }

    // A failed refresh deliberately does NOT clear the cookie. The browser
    // cookie is shared by every tab, and a failing request may be stale —
    // e.g. it was sent with an older session's token before another tab
    // signed in and received a new cookie. Clearing here would then wipe
    // that newer, valid cookie. A rejected token is already useless (its
    // session is expired or revoked server-side), and /auth/logout still
    // clears the cookie explicitly.
    const { activity } = refreshSchema.parse(req.body);
    const result = await refreshSession(refreshToken, new Date(), { activity });
    const { refreshToken: nextRefreshToken, ...body } = result;
    setRefreshTokenCookie(res, nextRefreshToken);
    res.status(200).json(successResponse(body));
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
    const { refreshToken, activity } = mobileRefreshSchema.parse(req.body);
    const result = await refreshSession(refreshToken, new Date(), { activity: activity ?? true });
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

// ---------------------------------------------------------------------------
// Trusted-device (biometric) sign-in. Independent of refresh sessions: logging
// out never touches these. See trusted-device.service.ts.
// ---------------------------------------------------------------------------

function requestContext(req: { ip?: string | undefined }) {
  return { ip: req.ip ?? 'unknown' };
}

// Registration and management require an ordinary access token. Registration
// additionally requires that the session was started with a password.
authRouter.post(
  '/trusted-devices/challenge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const challenge = await issueRegistrationChallenge(
      req.user!,
      req.authMethod ?? 'pwd',
      requestContext(req),
    );
    res.status(200).json(successResponse(challenge));
  }),
);

authRouter.post(
  '/trusted-devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = registerTrustedDeviceSchema.parse(req.body);
    const result = await registerTrustedDevice(
      req.user!,
      req.authMethod ?? 'pwd',
      input,
      requestContext(req),
    );
    res.status(201).json(successResponse(result));
  }),
);

authRouter.get(
  '/trusted-devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(successResponse({ devices: await listTrustedDevices(req.user!) }));
  }),
);

authRouter.delete(
  '/trusted-devices/:deviceId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { revokeSessions } = revokeTrustedDeviceQuerySchema.parse(req.query);
    await revokeTrustedDevice(
      req.user!,
      String(req.params.deviceId),
      { revokeSessions },
      requestContext(req),
    );
    res.status(200).json(successResponse({}));
  }),
);

authRouter.post(
  '/mobile/trusted-device/challenge',
  asyncHandler(async (req, res) => {
    requireSecureMobileTransport(req);
    const { deviceId } = trustedDeviceChallengeSchema.parse(req.body);
    res.status(200).json(successResponse(await issueSignInChallenge(deviceId, requestContext(req))));
  }),
);

authRouter.post(
  '/mobile/trusted-device/sign-in',
  asyncHandler(async (req, res) => {
    requireSecureMobileTransport(req);
    const input = trustedDeviceSignInSchema.parse(req.body);
    res.status(200).json(successResponse(await signInWithTrustedDevice(input, requestContext(req))));
  }),
);
