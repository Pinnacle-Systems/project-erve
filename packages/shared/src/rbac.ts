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

/**
 * Dispatch Order Phase 3 (user-facing rename of Sale Order): these three
 * lists are the single source of truth, consolidating what used to be three
 * independently-drifted copies (this file's now-removed
 * SALE_ORDER_VIEW_ROLES/SALE_ORDER_DISTRIBUTOR_MUTATION_ROLES/
 * SALE_ORDER_REVIEW_ROLES, apps/api's inlined route lists, and apps/web's
 * own permissions.ts copy — the API's list included ACCOUNTANT while this
 * file's never did, a real divergence found during the Phase 3 audit).
 * DISTRIBUTOR has no Dispatch Order role at all (no create/view — stock is
 * pooled and allocated by Merchandising, not requested by a Distributor).
 * FACTORY_USER gets read-only list/detail (server-scoped to its own mapped
 * Factory) but not the audit trail, which carries internal
 * correction/allocation metadata it has no operational need for.
 */
export const DISPATCH_ORDER_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewDispatchOrders(user: RoleHolder): boolean {
  return hasAnyRole(user, DISPATCH_ORDER_VIEW_ROLES);
}

export const DISPATCH_ORDER_AUDIT_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewDispatchOrderAudit(user: RoleHolder): boolean {
  return hasAnyRole(user, DISPATCH_ORDER_AUDIT_VIEW_ROLES);
}

/** Roles that may create/edit a Dispatch Order (creation is the sole allocation point — no separate review/approve step exists). */
export const DISPATCH_ORDER_MUTATION_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export function canMutateDispatchOrders(user: RoleHolder): boolean {
  return hasAnyRole(user, DISPATCH_ORDER_MUTATION_ROLES);
}

/**
 * Roles that may create/finalize Factory Dispatch packing/cartons for their
 * own mapped Factory. FACTORY_USER is the authoritative packing actor (its
 * scope is further narrowed at the service layer to its own single mapped
 * Factory via getSoleFactoryId — this list only says which roles may act at
 * all). ADMIN keeps the same emergency-override standing it holds everywhere
 * else in this codebase; MERCHANDISER deliberately does NOT gain packing
 * rights — see FACTORY_DISPATCH_VIEW_ROLES below for its follow-up/view-only
 * standing.
 */
export const FACTORY_DISPATCH_MUTATION_ROLES = ['ADMIN', 'FACTORY_USER'] as const satisfies readonly Role[];

export function canMutateFactoryDispatch(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_DISPATCH_MUTATION_ROLES);
}

/** Roles that may view Factory Dispatch records (row-level Factory/Sale Order scoping still applies). */
export const FACTORY_DISPATCH_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];

export function canViewFactoryDispatch(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_DISPATCH_VIEW_ROLES);
}

/**
 * Roles that may consolidate finalized Factory Dispatches into an Erve
 * Packing List and record/update the resulting Erve Dispatch (LR/transport
 * fallback update included). There is no dedicated warehouse role in the
 * original role set (see the fulfillment audit) — per scope, Merchandiser is
 * the named fallback actor alongside Admin.
 */
export const ERVE_DISPATCH_MUTATION_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export function canMutateErveDispatch(user: RoleHolder): boolean {
  return hasAnyRole(user, ERVE_DISPATCH_MUTATION_ROLES);
}

/**
 * Roles that may view an Erve Packing List's consolidated contents —
 * deliberately narrower than FACTORY_DISPATCH_VIEW_ROLES: it can span
 * MULTIPLE Factories' dispatches at once, so FACTORY_USER must not see it
 * (Factory responsibility ends at its own Factory Dispatch/handoff stage —
 * a Factory learning about another Factory's contribution here would be
 * exactly the cross-Factory leak the packing queue scoping is meant to
 * prevent). DISTRIBUTOR/ACCOUNTANT are excluded for the same reason
 * Sale Order full provenance excludes them (see canViewAllSaleOrders).
 */
export const ERVE_PACKING_LIST_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
] as const satisfies readonly Role[];

export function canViewErvePackingList(user: RoleHolder): boolean {
  return hasAnyRole(user, ERVE_PACKING_LIST_VIEW_ROLES);
}

/** Roles that may view Erve Packing Lists / Erve Dispatch history (row-level Sale Order/Distributor scoping still applies). */
export const ERVE_DISPATCH_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewErveDispatch(user: RoleHolder): boolean {
  return hasAnyRole(user, ERVE_DISPATCH_VIEW_ROLES);
}

/**
 * Roles that may view an invoice handoff — either source type (an OUTRIGHT
 * Dispatch line or a SALE_RETURN Distributor Sales Report line). Row-level
 * Distributor scoping still applies, and DISTRIBUTOR gets a redacted field
 * set — see toInvoiceHandoffView. Mirrors ERVE_DISPATCH_VIEW_ROLES exactly:
 * whoever may see a Dispatch may see whether/how it has been invoiced.
 */
export const INVOICE_HANDOFF_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewInvoiceHandoff(user: RoleHolder): boolean {
  return hasAnyRole(user, INVOICE_HANDOFF_VIEW_ROLES);
}

/**
 * Roles that may record/correct the Tally invoice reference on an invoice
 * handoff (either source type). Deliberately narrow — per the BRD (10.10)
 * this is Accountant's financial-approval responsibility, not Merchandiser's
 * (Merchandiser stays a viewer only, see INVOICE_HANDOFF_VIEW_ROLES) and not
 * a Factory/QA/Distributor action. ADMIN keeps the same override standing it
 * holds everywhere else in this codebase.
 */
export const INVOICE_HANDOFF_MUTATION_ROLES = ['ADMIN', 'ACCOUNTANT'] as const satisfies readonly Role[];

export function canMutateInvoiceHandoff(user: RoleHolder): boolean {
  return hasAnyRole(user, INVOICE_HANDOFF_MUTATION_ROLES);
}

/**
 * Roles that may view a Distributor's Sale-or-Return consignment position
 * (dispatched / reported-sold / remaining-with-Distributor, derived — never
 * an independent mutable record). Same set as INVOICE_HANDOFF_VIEW_ROLES:
 * this is just the pre-invoice view of the same underlying facts.
 */
export const SALE_OR_RETURN_POSITION_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewSaleOrReturnPosition(user: RoleHolder): boolean {
  return hasAnyRole(user, SALE_OR_RETURN_POSITION_VIEW_ROLES);
}

/** Roles that may view Distributor Sales Reports (row-level Distributor scoping still applies). */
export const DISTRIBUTOR_SALES_REPORT_VIEW_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
  'ACCOUNTANT',
] as const satisfies readonly Role[];

export function canViewDistributorSalesReport(user: RoleHolder): boolean {
  return hasAnyRole(user, DISTRIBUTOR_SALES_REPORT_VIEW_ROLES);
}

/**
 * Roles that may submit a Distributor Sales Report. Deliberately just
 * DISTRIBUTOR (for their own goods, service-scoped) + ADMIN override —
 * Merchandiser is NOT included: per scope, reporting sales on a
 * Distributor's behalf is not an assumed Merchandiser responsibility unless
 * the business explicitly asks for it later.
 */
export const DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES = ['ADMIN', 'DISTRIBUTOR'] as const satisfies readonly Role[];

export function canSubmitDistributorSalesReport(user: RoleHolder): boolean {
  return hasAnyRole(user, DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES);
}

/**
 * Roles that may submit (and, while SUBMITTED, cancel) a Distributor Return
 * request for their own goods. Mirrors DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES
 * exactly — same actor, same "for their own distributor only" scoping
 * (service-enforced).
 */
export const DISTRIBUTOR_RETURN_SUBMIT_ROLES = ['ADMIN', 'DISTRIBUTOR'] as const satisfies readonly Role[];

export function canSubmitDistributorReturn(user: RoleHolder): boolean {
  return hasAnyRole(user, DISTRIBUTOR_RETURN_SUBMIT_ROLES);
}

/**
 * Roles that may approve/reject a Distributor Return and record its credit
 * note reference — the BRD's "Finance team approval" (10.13), which maps to
 * Accountant in this role set, exactly like INVOICE_HANDOFF_MUTATION_ROLES.
 * Also gates cancelling a return once it is APPROVED (before receipt, and
 * only while no credit note has been recorded — see
 * distributor-return.service.ts).
 */
export const DISTRIBUTOR_RETURN_APPROVE_ROLES = ['ADMIN', 'ACCOUNTANT'] as const satisfies readonly Role[];

export function canApproveDistributorReturn(user: RoleHolder): boolean {
  return hasAnyRole(user, DISTRIBUTOR_RETURN_APPROVE_ROLES);
}

/**
 * Roles that may record the physical receipt of a Distributor Return —
 * deliberately the same operational actor as ERVE_DISPATCH_MUTATION_ROLES
 * (Merchandiser/Admin), not Accountant: the BRD names Finance as the
 * approver but never as the physical receiver, and per the fulfillment
 * audit there is no dedicated warehouse role, so this reuses the existing
 * "merchandising team" fallback actor instead of inventing one.
 */
export const DISTRIBUTOR_RETURN_RECEIVE_ROLES = ['ADMIN', 'MERCHANDISER'] as const satisfies readonly Role[];

export function canReceiveDistributorReturn(user: RoleHolder): boolean {
  return hasAnyRole(user, DISTRIBUTOR_RETURN_RECEIVE_ROLES);
}
