import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@erve/types';
import { verifyAccessToken } from './jwt.js';
import { HttpError } from '../errors/http-error.js';

declare global {
  // `namespace` is required here for declaration merging with Express's own types
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

// Base placeholder: verifies the bearer token and attaches the caller to
// req.user. Feature routes compose this with requireRole for authorization.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(HttpError.unauthorized('Missing or invalid authorization header'));
    return;
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(HttpError.unauthorized('Invalid or expired token'));
  }
}
