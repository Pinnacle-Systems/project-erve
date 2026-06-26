import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@erve/types';
import { hasRole } from '@erve/shared';
import { HttpError } from './error-handler.js';

export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }

    if (!hasRole(req.user.role, allowed)) {
      next(new HttpError(403, 'FORBIDDEN', 'You do not have permission to access this resource'));
      return;
    }

    next();
  };
}
