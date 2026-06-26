import type { Role } from '@erve/types';

export function hasRole(userRole: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(userRole);
}
