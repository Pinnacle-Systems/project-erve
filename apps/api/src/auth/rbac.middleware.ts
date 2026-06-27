import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@erve/types';
import { hasAnyRole } from '@erve/shared';
import { HttpError } from '../errors/http-error.js';

// Gates a route to a set of roles. Must run after requireAuth so req.user
// (with roles loaded from user_roles) is populated.
export function requireRoles(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(HttpError.unauthorized());
      return;
    }

    if (!hasAnyRole(req.user, allowed)) {
      next(HttpError.forbidden());
      return;
    }

    next();
  };
}
