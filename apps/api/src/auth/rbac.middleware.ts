import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@erve/types';
import { hasRole } from '@erve/shared';
import { HttpError } from '../errors/http-error.js';

// Placeholder: gates a route to a set of roles. Must run after requireAuth
// so req.user is populated.
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(HttpError.unauthorized());
      return;
    }

    if (!hasRole(req.user.role, allowed)) {
      next(HttpError.forbidden());
      return;
    }

    next();
  };
}
