import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../errors/http-error.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { verifyAccessToken } from './jwt.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from './current-user.js';

declare global {
  // `namespace` is required here for declaration merging with Express's own types
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: CurrentUser;
    }
  }
}

// Verifies the bearer token, then re-loads the user and their roles from
// user_roles on every request — role changes and deactivation take effect
// immediately, without waiting for the token to expire.
export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      next(HttpError.unauthorized('Missing or invalid authorization header'));
      return;
    }

    const token = header.slice('Bearer '.length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      next(HttpError.unauthorized('Invalid or expired token'));
      return;
    }

    const record = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: currentUserSelect,
    });

    if (!record || record.status !== 'ACTIVE') {
      next(HttpError.unauthorized('Invalid or expired token'));
      return;
    }

    req.user = toCurrentUser(record);
    next();
  },
);
