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
 * Roles that may explicitly mark a Job Order PRODUCTION_COMPLETE while
 * planned quantity/Final QA coverage is still short (deliberate stop/accept
 * of short production). This is a Merchandising business decision, not a
 * Factory production action — deliberately narrower than
 * JOB_ORDER_PRODUCTION_MUTATION_ROLES (which includes FACTORY_USER for
 * ordinary stage/prepared-quantity work). ADMIN keeps the same override
 * standing it holds everywhere else in this codebase.
 */
export const JOB_ORDER_MANUAL_PRODUCTION_COMPLETE_ROLES = [
  'ADMIN',
  'MERCHANDISER',
] as const satisfies readonly Role[];

export function canMarkJobOrderProductionComplete(user: RoleHolder): boolean {
  return hasAnyRole(user, JOB_ORDER_MANUAL_PRODUCTION_COMPLETE_ROLES);
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
 * The subset of FACTORY_DISPATCH_VIEW_ROLES that is scoped to a single mapped
 * Factory (via getSoleFactoryId) rather than reading broadly. FACTORY_USER is
 * currently the sole such role.
 */
export const FACTORY_DISPATCH_FACTORY_SCOPED_ROLES = ['FACTORY_USER'] as const satisfies readonly Role[];

/**
 * Roles within FACTORY_DISPATCH_VIEW_ROLES that read broadly across Factories
 * rather than being scoped to a single mapped Factory (UXAUTH-004). Derived
 * from FACTORY_DISPATCH_VIEW_ROLES rather than restated, so this cannot
 * silently drift from it the way the UXAUTH-003/004 route/service mismatch
 * did — ADMIN, MERCHANDISER and SENIOR_MANAGEMENT are broad readers today;
 * FACTORY_USER is the sole Factory-scoped exception (see
 * FACTORY_DISPATCH_FACTORY_SCOPED_ROLES). Read scope is independent of
 * mutation scope — see FACTORY_DISPATCH_MUTATION_ROLES above, which is not
 * affected by this list and additively includes FACTORY_USER regardless of
 * any other role a given account also holds.
 */
export const FACTORY_DISPATCH_BROAD_READ_ROLES = FACTORY_DISPATCH_VIEW_ROLES.filter(
  (role) => !FACTORY_DISPATCH_FACTORY_SCOPED_ROLES.includes(role as 'FACTORY_USER'),
) as Array<Exclude<(typeof FACTORY_DISPATCH_VIEW_ROLES)[number], 'FACTORY_USER'>>;

export function canReadFactoryDispatchBroadly(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_DISPATCH_BROAD_READ_ROLES);
}

/**
 * Packing Audit (carton inspection sign-off) is a separate authority from
 * packing itself — QA_USER is the sole confirming role (segregation of
 * duties: FACTORY_USER packs, QA_USER audits). ADMIN may VIEW audit state
 * but does NOT get a compatibility bypass to confirm audits — unlike most
 * other mutation lists in this file, ADMIN is deliberately absent here.
 * QA_USER is not factory-scoped for this action (see PACKING_AUDIT_VIEW_ROLES
 * doc comment) — it mirrors the existing, already-unscoped Job-Order-QA
 * inspection workflow rather than introducing a new per-role factory-mapping
 * capability.
 */
export const PACKING_AUDIT_MUTATION_ROLES = ['QA_USER'] as const satisfies readonly Role[];

export function canConfirmPackingAudit(user: RoleHolder): boolean {
  return hasAnyRole(user, PACKING_AUDIT_MUTATION_ROLES);
}

/**
 * Roles that may reach the narrow /packing-audit/... discovery surface
 * (queue + carton detail + history) — QA_USER (the confirming role) and
 * ADMIN (oversight only, no confirm right — see PACKING_AUDIT_MUTATION_ROLES).
 * Deliberately NOT the broader Dispatch-Order-view audience
 * (FACTORY_USER/MERCHANDISER/SENIOR_MANAGEMENT): those roles already see a
 * carton's audit state through the main Packing List projection, gated by
 * DISPATCH_ORDER_VIEW_ROLES instead — this constant exists only for the
 * QA-specific discovery endpoints, not as a general "can see audit info"
 * flag, so it stays exactly as narrow as those endpoints' real audience.
 * QA_USER is intentionally cross-factory here (see
 * PACKING_AUDIT_MUTATION_ROLES doc comment).
 */
export const PACKING_AUDIT_VIEW_ROLES = ['ADMIN', 'QA_USER'] as const satisfies readonly Role[];

export function canViewPackingAudit(user: RoleHolder): boolean {
  return hasAnyRole(user, PACKING_AUDIT_VIEW_ROLES);
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

/**
 * Roles that may view a Factory Invoice — the ERVE-generated payable
 * document snapshotted from a finalized Factory Packing List. Deliberately
 * narrower than most fulfillment view lists: only FACTORY_USER (scoped to
 * its own mapped Factory, service-enforced) and ACCOUNTANT have a confirmed
 * operational need, plus ADMIN's usual oversight standing. MERCHANDISER and
 * SENIOR_MANAGEMENT are NOT included — unlike Invoice Handoff, no existing
 * financial-document read convention establishes that they need this view;
 * add them only against an explicit later requirement.
 */
export const FACTORY_INVOICE_VIEW_ROLES = ['ADMIN', 'ACCOUNTANT', 'FACTORY_USER'] as const satisfies readonly Role[];

export function canViewFactoryInvoice(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_INVOICE_VIEW_ROLES);
}

/**
 * FACTORY_USER-only — the mapped Factory's formal, one-way confirmation of a
 * generated invoice. ADMIN is deliberately EXCLUDED (unlike most mutation
 * lists in this file): mirrors PACKING_AUDIT_MUTATION_ROLES's precedent of
 * not giving ADMIN a compatibility bypass for a role-specific sign-off, per
 * an explicit business instruction not to auto-grant ADMIN Factory-confirm
 * powers merely because ADMIN is broad elsewhere.
 */
export const FACTORY_INVOICE_CONFIRM_ROLES = ['FACTORY_USER'] as const satisfies readonly Role[];

export function canConfirmFactoryInvoice(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_INVOICE_CONFIRM_ROLES);
}

/**
 * ACCOUNTANT-only — editing a Factory Invoice's financial fields (unit rate,
 * GST amount, remarks) once FACTORY_USER has confirmed it, and finalizing it.
 * ADMIN is deliberately EXCLUDED, same reasoning as
 * FACTORY_INVOICE_CONFIRM_ROLES above — this is Accounts' financial
 * authority, not a general administrative one.
 */
export const FACTORY_INVOICE_FINANCIAL_ROLES = ['ACCOUNTANT'] as const satisfies readonly Role[];

export function canManageFactoryInvoiceFinancials(user: RoleHolder): boolean {
  return hasAnyRole(user, FACTORY_INVOICE_FINANCIAL_ROLES);
}
