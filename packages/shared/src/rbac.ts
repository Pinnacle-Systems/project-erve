import type { Role } from '@erve/types';

export interface RoleHolder {
  roles: readonly Role[];
}

export function hasRole(user: RoleHolder, role: Role): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(user: RoleHolder, roles: readonly Role[]): boolean {
  return user.roles.some((role) => roles.includes(role));
}

/** Roles with parity for ordinary QA inspection operations. */
export const QA_OPERATION_ROLES = ['ADMIN', 'QA_USER'] as const satisfies readonly Role[];

export function canPerformQaOperation(user: RoleHolder): boolean {
  return hasAnyRole(user, QA_OPERATION_ROLES);
}
