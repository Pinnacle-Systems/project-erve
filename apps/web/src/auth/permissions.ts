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

// FACTORY_USER sees their own factory's name/details through assigned Job
// Orders (already embedded there), not by browsing the Factory master module.
export const FACTORY_VIEW_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

// The Distributor master detail API scopes a DISTRIBUTOR caller to their own
// mapped distributor only, so backend read access stays intentionally
// unaffected by this list — but the master browsing/maintenance screen
// itself (this module's nav + route gate) is not exposed to that role.
export const DISTRIBUTOR_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
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

// DISTRIBUTOR has no access to the Price List master module — a
// distributor's own commercial price, if ever shown, must come from an
// embedded field on an authorized transaction, not from browsing Price Lists.
export const PRICE_LIST_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

// ACCOUNTANT is an explicit business exception: finance may need to
// cross-check, validate, or correct agreed commercial pricing.
export const PRICE_LIST_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

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

export const JOB_ORDER_NAVIGATION_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'FACTORY_USER',
  'QA_USER',
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

// ACCOUNTANT is a read-only financial-review addition: it can see the Sale
// Order list/detail/audit trail (this list) but is deliberately absent from
// SALE_ORDER_DISTRIBUTOR_MANAGE_ROLES and SALE_ORDER_APPROVE_ROLES below, so
// it never gets Create/Edit/Submit/Review/Approve/Reject/Cancel/sourcing.
export const SALE_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export const SALE_ORDER_DISTRIBUTOR_MANAGE_ROLES = [
  'ADMIN',
  'DISTRIBUTOR',
] as const satisfies readonly Role[];

export const SALE_ORDER_APPROVE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

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

export const canViewSaleOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, SALE_ORDER_VIEW_ROLES);

export const canManageSaleOrdersAsDistributor = (user: AuthUser | null | undefined) =>
  hasRole(user, SALE_ORDER_DISTRIBUTOR_MANAGE_ROLES);

export const canApproveSaleOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, SALE_ORDER_APPROVE_ROLES);

export const canViewSaleOrderInventory = canApproveSaleOrders;
