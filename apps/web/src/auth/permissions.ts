import type { AuthUser } from '@erve/types';
import type { Role } from '@erve/types';
import {
  canMutateJobOrderProduction,
  canUndoJobOrderProductionStage,
  canMutateFactoryDispatch,
  canViewFactoryDispatch,
  canConfirmPackingAudit,
  canViewPackingAudit,
  canMutateErveDispatch,
  canViewErveDispatch,
  canViewErveFactoryProvenance,
  canViewErvePackingList,
  canMutateInvoiceHandoff,
  canViewInvoiceHandoff,
  canViewFactoryInvoice,
  canConfirmFactoryInvoice,
  canManageFactoryInvoiceFinancials,
  canViewSaleOrReturnPosition,
  canViewDistributorSalesReport,
  canSubmitDistributorSalesReport,
  canSubmitDistributorReturn,
  canApproveDistributorReturn,
  canReceiveDistributorReturn,
  canReadFactoryDispatchBroadly,
  canPerformQaOperation,
  canViewReports,
  DISPATCH_ORDER_VIEW_ROLES,
  DISPATCH_ORDER_AUDIT_VIEW_ROLES,
  DISPATCH_ORDER_MUTATION_ROLES,
  DISPATCH_ORDER_FILTER_ROLES,
  JOB_ORDER_FACTORY_FILTER_ROLES,
  REPORT_VIEW_ROLES,
} from '@erve/shared';

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

// ERVE's own GST/legal/bank identity is statutory document master data —
// intentionally ADMIN-only (tighter than the usual master-maintenance gate)
// rather than widened just because invoice users may eventually need to
// read it. Read access can broaden in a later invoice story.
export const SELLER_REGISTRATION_VIEW_ROLES = ['ADMIN'] as const satisfies readonly Role[];
export const SELLER_REGISTRATION_MANAGE_ROLES = ['ADMIN'] as const satisfies readonly Role[];

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

// INV-002, RBAC finalization review: HSN identity (code/description/status)
// is operational master data MERCHANDISER owns, same as Style — so this
// stays broad. GST rule maintenance is statutory tax configuration and is
// deliberately NARROWER (see GST_RULE_SET_MANAGE_ROLES below): HSN_MANAGE_ROLES
// covers identity edits only. The HSN -> GST Rule Set *assignment* is its
// own, narrower permission (HSN_GST_ASSIGNMENT_ROLES) — enforced server-side
// in hsn.service.ts; here it only disables that one field in the HSN form
// for a MERCHANDISER who can otherwise still edit everything else on it.
export const HSN_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
] as const satisfies readonly Role[];
export const HSN_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT'] as const satisfies readonly Role[];
export const HSN_GST_ASSIGNMENT_ROLES = ['ADMIN', 'ACCOUNTANT'] as const satisfies readonly Role[];

// GST rate/version configuration affects statutory tax treatment — finance
// (ADMIN + ACCOUNTANT) only. MERCHANDISER and SENIOR_MANAGEMENT may view
// (every role that can see/edit an HSN can see the rule sets it may
// reference) but never create/version/activate one.
export const GST_RULE_SET_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
] as const satisfies readonly Role[];
export const GST_RULE_SET_MANAGE_ROLES = ['ADMIN', 'ACCOUNTANT'] as const satisfies readonly Role[];

// Order Sheet planning belongs to Merchandising: DISTRIBUTOR has no access at
// all (view or manage) — mirrors DISTRIBUTOR's existing full exclusion from
// Job Orders (JOB_ORDER_VIEW_ROLES/JOB_ORDER_CREATE_ROLES below).
export const PURCHASE_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];

export const PURCHASE_ORDER_MANAGE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
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

// UXAUTH-014: role list now lives in @erve/shared's rbac.ts (the single
// source of truth also used by apps/api's /job-orders/factory-options route
// guard) — re-exported here so this file's own hasRole() wrapper below and
// any existing import sites don't need to change.
export { JOB_ORDER_FACTORY_FILTER_ROLES };

export const QA_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'QA_USER',
] as const satisfies readonly Role[];

// Dispatch Order Phase 3: role lists now live in @erve/shared's rbac.ts (the
// single source of truth also used by apps/api's route guards) — re-exported
// here so AppRoutes.tsx's existing import site doesn't need to change.
export { DISPATCH_ORDER_VIEW_ROLES, DISPATCH_ORDER_AUDIT_VIEW_ROLES, DISPATCH_ORDER_MUTATION_ROLES };

// UXAUTH-015: role list now lives in @erve/shared's rbac.ts (the single
// source of truth also used by apps/api's /sale-orders/factory-options and
// /sale-orders/distributor-options route guards) — re-exported here so this
// file's own hasRole() wrapper below doesn't need to change.
export { DISPATCH_ORDER_FILTER_ROLES };

function hasRole(user: AuthUser | null | undefined, roles: readonly Role[]): boolean {
  if (!user) return false;
  return roles.some((role) => user.roles.includes(role));
}

export const canViewMasterDataDashboardShortcut = (user: AuthUser | null | undefined) =>
  hasRole(user, MASTER_DATA_DASHBOARD_SHORTCUT_ROLES);

// RPT0/RPT2: role list lives in @erve/shared's rbac.ts (the single source of
// truth also used by apps/api's /reports/* route guard) — re-exported here
// so DashboardPage.tsx's role branch doesn't need a separate import.
export { REPORT_VIEW_ROLES };
export const canViewManagementReports = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewReports(user));

export const canViewStyles = (user: AuthUser | null | undefined) => hasRole(user, STYLE_VIEW_ROLES);

// UXAUTH-009: Style mutation gate (Create on the list, Edit on the detail
// page, plus the image-management controls on StyleDetailPage, which already
// checked this exact role set inline). STYLE_VIEW_ROLES above is
// deliberately broader — it additionally includes SENIOR_MANAGEMENT, a
// read-only viewer for Style — so this wrapper exists to keep every Style
// mutation surface (route guard and page CTA) reading from the one shared
// STYLE_MANAGE_ROLES list rather than each re-deriving its own.
export const canManageStyles = (user: AuthUser | null | undefined) =>
  hasRole(user, STYLE_MANAGE_ROLES);

export const canManageSizes = (user: AuthUser | null | undefined) =>
  hasRole(user, SIZE_MANAGE_ROLES);
export const canManageSeasons = (user: AuthUser | null | undefined) =>
  hasRole(user, SEASON_MANAGE_ROLES);

export const canViewFactories = (user: AuthUser | null | undefined) =>
  hasRole(user, FACTORY_VIEW_ROLES);

export const canManageFactories = (user: AuthUser | null | undefined) =>
  hasRole(user, FACTORY_MANAGE_ROLES);

export const canViewSellerRegistrations = (user: AuthUser | null | undefined) =>
  hasRole(user, SELLER_REGISTRATION_VIEW_ROLES);

export const canManageSellerRegistrations = (user: AuthUser | null | undefined) =>
  hasRole(user, SELLER_REGISTRATION_MANAGE_ROLES);

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

export const canViewHsns = (user: AuthUser | null | undefined) => hasRole(user, HSN_VIEW_ROLES);
export const canManageHsns = (user: AuthUser | null | undefined) => hasRole(user, HSN_MANAGE_ROLES);
// The HSN form's GST Rule Set field specifically — narrower than
// canManageHsns, which still lets MERCHANDISER edit everything else on it.
export const canAssignHsnGstRuleSet = (user: AuthUser | null | undefined) =>
  hasRole(user, HSN_GST_ASSIGNMENT_ROLES);

export const canViewGstRuleSets = (user: AuthUser | null | undefined) =>
  hasRole(user, GST_RULE_SET_VIEW_ROLES);
export const canManageGstRuleSets = (user: AuthUser | null | undefined) =>
  hasRole(user, GST_RULE_SET_MANAGE_ROLES);

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

// DEMO-010: whether this user's role may even attempt to undo a completed
// production stage (ADMIN or MERCHANDISER, never FACTORY_USER). The
// MERCHANDISER-only 24-hour window is a separate, time-dependent check made
// directly against user.roles where the Undo action is rendered — this
// wrapper only answers "is this role eligible at all", mirroring the API's
// JOB_ORDER_STAGE_UNDO_ROLES/canUndoJobOrderProductionStage.
export const canUndoProductionStage = (user: AuthUser | null | undefined) =>
  Boolean(user && canUndoJobOrderProductionStage(user));

export const canFilterJobOrdersByFactory = (user: AuthUser | null | undefined) =>
  hasRole(user, JOB_ORDER_FACTORY_FILTER_ROLES);

export const canViewQa = (user: AuthUser | null | undefined) => hasRole(user, QA_VIEW_ROLES);

// UXAUTH-006: generic QualityExecution mutation gate. Reuses @erve/shared's
// QA_OPERATION_ROLES/canPerformQaOperation — the exact same role set the
// API's quality-executions.routes.ts already enforces for every mutation
// (save draft, finalize, evidence add/remove, reinspect/cancel/permanently
// reject a Final batch). QA_VIEW_ROLES above is deliberately broader
// (adds MERCHANDISER/SENIOR_MANAGEMENT, who may read but not mutate) — this
// wrapper exists so the page never re-derives its own role list.
export const canMutateQualityExecution = (user: AuthUser | null | undefined) =>
  Boolean(user && canPerformQaOperation(user));

export const canViewDispatchOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, DISPATCH_ORDER_VIEW_ROLES);

export const canFilterDispatchOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, DISPATCH_ORDER_FILTER_ROLES);

export const canViewDispatchOrderAudit = (user: AuthUser | null | undefined) =>
  hasRole(user, DISPATCH_ORDER_AUDIT_VIEW_ROLES);

export const canMutateDispatchOrders = (user: AuthUser | null | undefined) =>
  hasRole(user, DISPATCH_ORDER_MUTATION_ROLES);

// ---------------------------------------------------------------------------
// Fulfillment: Factory Packing -> Erve India Consolidation -> Distributor
// Dispatch. Role lists live once in @erve/shared (shared with the API's
// route guards) — these are thin AuthUser-typed wrappers for route/nav gating.
// ---------------------------------------------------------------------------

export const canViewFactoryDispatches = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewFactoryDispatch(user));

// UXAUTH-005: whether the Factory Packing queue page must ask the user to
// pick an explicit Factory context, i.e. whether this account reads broadly
// (ADMIN/MERCHANDISER/SENIOR_MANAGEMENT) rather than being scoped to a single
// mapped Factory (FACTORY_USER). Reuses the exact same shared capability the
// API's resolveActorFactoryScope uses, so Web and API cannot disagree about
// which accounts need the selector (see @erve/shared's rbac.ts).
export const needsFactoryDispatchFactorySelector = (user: AuthUser | null | undefined) =>
  Boolean(user && canReadFactoryDispatchBroadly(user));

export const canMutateFactoryDispatches = (user: AuthUser | null | undefined) =>
  Boolean(user && canMutateFactoryDispatch(user));

export const canConfirmPackingAudits = (user: AuthUser | null | undefined) =>
  Boolean(user && canConfirmPackingAudit(user));

export const canViewPackingAudits = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewPackingAudit(user));

export const canViewErvePackingLists = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewErvePackingList(user));

/** DEMO-020: whether this user's role is authorized to see factory/supplier provenance on an Erve Packing List. */
export const canViewErveFactoryProvenanceField = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewErveFactoryProvenance(user));

export const canMutateErveDispatches = (user: AuthUser | null | undefined) =>
  Boolean(user && canMutateErveDispatch(user));

export const canViewErveDispatches = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewErveDispatch(user));

export const canViewInvoiceHandoffs = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewInvoiceHandoff(user));

export const canMutateInvoiceHandoffs = (user: AuthUser | null | undefined) =>
  Boolean(user && canMutateInvoiceHandoff(user));

export const canViewFactoryInvoices = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewFactoryInvoice(user));

export const canConfirmFactoryInvoices = (user: AuthUser | null | undefined) =>
  Boolean(user && canConfirmFactoryInvoice(user));

export const canEditFactoryInvoiceFinancials = (user: AuthUser | null | undefined) =>
  Boolean(user && canManageFactoryInvoiceFinancials(user));

export const canViewSaleOrReturnPositions = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewSaleOrReturnPosition(user));

// UXAUTH-016: the only role that both reads Sale-or-Return positions broadly
// across every Distributor (isBroadViewer in distributor-sales-report /
// distributor-return .service.ts) AND may submit a Sales Report or Return
// (DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES / DISTRIBUTOR_RETURN_SUBMIT_ROLES)
// is ADMIN — DISTRIBUTOR also submits but is hard-scoped server-side to its
// own single mapped Distributor (getSoleDistributorId), so it never needs to
// choose one. MERCHANDISER/SENIOR_MANAGEMENT/ACCOUNTANT read broadly too but
// cannot submit at all, so their existing unfiltered browsing view is left
// unchanged. Centralized here so the page never derives a submission
// Distributor from row order/first-loaded-row (see
// SaleOrReturnPositionListPage.tsx).
export const SALE_OR_RETURN_POSITION_DISTRIBUTOR_SELECTOR_ROLES = ['ADMIN'] as const satisfies readonly Role[];

export const needsSaleOrReturnPositionDistributorSelector = (user: AuthUser | null | undefined) =>
  hasRole(user, SALE_OR_RETURN_POSITION_DISTRIBUTOR_SELECTOR_ROLES);

export const canViewDistributorSalesReports = (user: AuthUser | null | undefined) =>
  Boolean(user && canViewDistributorSalesReport(user));

export const canSubmitDistributorSalesReports = (user: AuthUser | null | undefined) =>
  Boolean(user && canSubmitDistributorSalesReport(user));

// Distributor Returns share the Sale-or-Return position's view audience
// (canViewSaleOrReturnPositions above) — no separate view wrapper needed.
export const canSubmitDistributorReturns = (user: AuthUser | null | undefined) =>
  Boolean(user && canSubmitDistributorReturn(user));

export const canApproveDistributorReturns = (user: AuthUser | null | undefined) =>
  Boolean(user && canApproveDistributorReturn(user));

export const canReceiveDistributorReturns = (user: AuthUser | null | undefined) =>
  Boolean(user && canReceiveDistributorReturn(user));
