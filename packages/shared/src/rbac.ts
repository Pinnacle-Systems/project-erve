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
