import type { AuthUser } from '@erve/types';
import type { Role } from '@erve/types';
import { canMutateJobOrderProduction } from '@erve/shared';

export const MASTER_DATA_DASHBOARD_SHORTCUT_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];

export const STYLE_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];
export const STYLE_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export const SIZE_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];
export const SEASON_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export const FACTORY_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
] as const satisfies readonly Role[];

export const DISTRIBUTOR_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export const DISTRIBUTOR_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
] as const satisfies readonly Role[];

export const FACTORY_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export const PROCESS_FLOW_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
] as const satisfies readonly Role[];
export const QUALITY_FORM_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
] as const satisfies readonly Role[];

export const USER_MANAGE_ROLES = ['ADMIN'] as const satisfies readonly Role[];

export const PRICE_LIST_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export const PRICE_LIST_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export const PURCHASE_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export const PURCHASE_ORDER_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export const JOB_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'FACTORY_USER',
  'QA_USER',
] as const satisfies readonly Role[];

/** Roles that receive the general Job Orders navigation destination.
 * QA users retain read-only route access for contextual links, but use QA as
 * their operational entry point.
 */
export const JOB_ORDER_NAVIGATION_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'FACTORY_USER',
] as const satisfies readonly Role[];

export const JOB_ORDER_CREATE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export const JOB_ORDER_FACTORY_FILTER_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'QA_USER',
] as const satisfies readonly Role[];

export const QA_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'QA_USER',
] as const satisfies readonly Role[];

function hasRole(user: AuthUser | null | undefined, roles: readonly Role[]): boolean {
  if (!user) return false;
  return roles.some((role) => user.roles.includes(role));
}

export const canViewMasterDataDashboardShortcut = (user: AuthUser | null | undefined) =>
  hasRole(user, MASTER_DATA_DASHBOARD_SHORTCUT_ROLES);

export const canViewStyles = (user: AuthUser | null | undefined) => hasRole(user, STYLE_VIEW_ROLES);

export const canManageSizes = (user: AuthUser | null | undefined) =>
  hasRole(user, SIZE_MANAGE_ROLES);
export const canManageSeasons = (user: AuthUser | null | undefined) =>
  hasRole(user, SEASON_MANAGE_ROLES);

export const canViewFactories = (user: AuthUser | null | undefined) =>
  hasRole(user, FACTORY_VIEW_ROLES);

export const canManageFactories = (user: AuthUser | null | undefined) =>
  hasRole(user, FACTORY_MANAGE_ROLES);

export const canViewDistributorMaster = (user: AuthUser | null | undefined) =>
  hasRole(user, DISTRIBUTOR_VIEW_ROLES);

export const canManageDistributorMaster = (user: AuthUser | null | undefined) =>
  hasRole(user, DISTRIBUTOR_MANAGE_ROLES);

export const canManageProcessFlows = (user: AuthUser | null | undefined) =>
  hasRole(user, PROCESS_FLOW_MANAGE_ROLES);
export const canManageQualityForms = (user: AuthUser | null | undefined) =>
  hasRole(user, QUALITY_FORM_MANAGE_ROLES);

export const canManageUsers = (user: AuthUser | null | undefined) =>
  hasRole(user, USER_MANAGE_ROLES);

export const canViewPriceLists = (user: AuthUser | null | undefined) =>
  hasRole(user, PRICE_LIST_VIEW_ROLES);

export const canManagePriceLists = (user: AuthUser | null | undefined) =>
  hasRole(user, PRICE_LIST_MANAGE_ROLES);

export const canViewPurchaseOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, PURCHASE_ORDER_VIEW_ROLES);

export const canManagePurchaseOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, PURCHASE_ORDER_MANAGE_ROLES);

export const canViewJobOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, JOB_ORDER_VIEW_ROLES);

export const canNavigateToJobOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, JOB_ORDER_NAVIGATION_ROLES);

export const canCreateJobOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, JOB_ORDER_CREATE_ROLES);

export const canManageJobOrderProduction = (user: AuthUser | null | undefined) =>
  Boolean(user && canMutateJobOrderProduction(user));

export const canFilterJobOrdersByFactory = (user: AuthUser | null | undefined) =>
  hasRole(user, JOB_ORDER_FACTORY_FILTER_ROLES);

export const canViewQa = (user: AuthUser | null | undefined) => hasRole(user, QA_VIEW_ROLES);
