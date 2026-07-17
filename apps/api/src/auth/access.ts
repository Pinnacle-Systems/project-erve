import { hasRole, hasAnyRole } from '@erve/shared';
import { HttpError } from '../errors/http-error.js';
import type { CurrentUser } from './current-user.js';

export { hasRole, hasAnyRole };

// A distributor-scoped user must be mapped to exactly one distributor. Zero
// mappings means the account is not provisioned yet; more than one is invalid
// data (the system enforces one distributor per distributor user), so access
// fails closed instead of letting mapping order decide what the user can see.
export function getSoleDistributorId(user: CurrentUser): string {
  if (user.distributorIds.length === 0) {
    throw HttpError.forbidden('No distributor is mapped to your account');
  }
  if (user.distributorIds.length > 1) {
    throw HttpError.internal(
      'Your account is mapped to multiple distributors; ask an administrator to correct the mapping',
    );
  }
  return user.distributorIds[0]!;
}

export function requireDistributorAccess(user: CurrentUser, distributorId: string): void {
  if (hasRole(user, 'ADMIN')) {
    return;
  }

  if (getSoleDistributorId(user) !== distributorId) {
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
