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

/** Roles that may view Sale Orders (row-level distributor scoping still applies). */
export const SALE_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export function canViewSaleOrders(user: RoleHolder): boolean {
  return hasAnyRole(user, SALE_ORDER_VIEW_ROLES);
}

/** Roles that may create/edit/submit a Sale Order as the requesting distributor. */
export const SALE_ORDER_DISTRIBUTOR_MUTATION_ROLES = [
  'ADMIN',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export function canMutateSaleOrderAsDistributor(user: RoleHolder): boolean {
  return hasAnyRole(user, SALE_ORDER_DISTRIBUTOR_MUTATION_ROLES);
}

/** Roles that may review/approve/reject a submitted Sale Order and see global inventory. */
export const SALE_ORDER_REVIEW_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export function canReviewSaleOrders(user: RoleHolder): boolean {
  return hasAnyRole(user, SALE_ORDER_REVIEW_ROLES);
}
