import { hasRole, hasAnyRole } from '@erve/shared';
import { HttpError } from '../errors/http-error.js';
import type { CurrentUser } from './current-user.js';

export { hasRole, hasAnyRole };

export function requireDistributorAccess(user: CurrentUser, distributorId: string): void {
  if (hasRole(user, 'ADMIN')) {
    return;
  }

  if (!user.distributorIds.includes(distributorId)) {
    throw HttpError.forbidden('You do not have access to this distributor');
  }
}

export function requireFactoryAccess(user: CurrentUser, factoryId: string): void {
  if (hasRole(user, 'ADMIN')) {
    return;
  }

  if (!user.factoryIds.includes(factoryId)) {
    throw HttpError.forbidden('You do not have access to this factory');
  }
}
