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

/** Roles allowed to mutate the Job Order production workflow. */
export const JOB_ORDER_PRODUCTION_MUTATION_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
] as const satisfies readonly Role[];

export function canMutateJobOrderProduction(user: RoleHolder): boolean {
  return hasAnyRole(user, JOB_ORDER_PRODUCTION_MUTATION_ROLES);
}

/** Roles with parity for ordinary QA inspection operations. */
export const QA_OPERATION_ROLES = ['ADMIN', 'QA_USER'] as const satisfies readonly Role[];

export function canPerformQaOperation(user: RoleHolder): boolean {
  return hasAnyRole(user, QA_OPERATION_ROLES);
}

/**
 * Financial Year reference data (a code + two dates) is low-sensitivity and
 * needed by every role that touches a dated document or Season — not just
 * master-data managers — so it's a dedicated, deliberately broad capability
 * rather than reusing `canManageMasterData`.
 */
export const FINANCIAL_YEAR_READ_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'ACCOUNTANT',
  'DISTRIBUTOR',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];

export function canReadFinancialYears(user: RoleHolder): boolean {
  return hasAnyRole(user, FINANCIAL_YEAR_READ_ROLES);
}
