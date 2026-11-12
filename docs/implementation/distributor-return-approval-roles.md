# Distributor Return — approval responsibilities (correction)

Base: `77111c4` (`origin/main`). Branch: `fix/distributor-return-merchandiser-approval`.

## Business rule

| Action | Role |
|---|---|
| Submit Return Request | Distributor (own goods only; Admin override) |
| Approve / Reject Return | **Merchandiser** (Admin override) |
| Record physical receipt | Merchandiser (Admin override) |
| Record / update Credit Note | **Accountant** (Admin override) |
| Cancel | Unchanged — see below |

Before this correction the implementation gave Approve / Reject **and** the Credit Note to Accountant/Admin ("Finance approval"). Approval is now a Merchandiser responsibility; the Accountant keeps only the financial document.

## Permissions (`packages/shared/src/rbac.ts`)

| Constant | Roles | Gates |
|---|---|---|
| `DISTRIBUTOR_RETURN_SUBMIT_ROLES` | ADMIN, DISTRIBUTOR | Submit; Distributor cancel of own SUBMITTED request |
| `DISTRIBUTOR_RETURN_APPROVE_ROLES` | ADMIN, **MERCHANDISER** | `POST /distributor-returns/:id/approve`, `/reject` |
| `DISTRIBUTOR_RETURN_CREDIT_NOTE_ROLES` (new) | ADMIN, ACCOUNTANT | `POST /distributor-returns/:id/credit-note` |
| `DISTRIBUTOR_RETURN_RECEIVE_ROLES` | ADMIN, MERCHANDISER | `POST /distributor-returns/:id/receive` (unchanged) |
| `DISTRIBUTOR_RETURN_CANCEL_ROLES` (new) | ADMIN, ACCOUNTANT | Operations-side `POST /distributor-returns/:id/cancel` |

Enforcement is layered: the route middleware (`distributor-return.routes.ts`), the service (`distributor-return.service.ts`, which re-checks the same predicates) and the web UI (`apps/web/src/auth/permissions.ts`, `DistributorReturnDetailPage.tsx`).

Unchanged: state transitions, approved-quantity ceilings and all-zero rule, `expectedVersion` optimistic concurrency, advisory locks, audit actions, `computeAvailability()` and every quantity formula. Returns raised through the Store-level FIFO flow (`retail-store-fifo.service.ts`) are ordinary `DistributorReturn` rows and are approved by the same Merchandiser path.

## Cancellation — existing rules, preserved (for review)

Cancellation previously reused the approver list (`canAttemptCancel = SUBMIT ∪ APPROVE`, and `isOps = canApproveDistributorReturn`). Changing the approver list alone would therefore have silently given Merchandisers cancel rights and taken them from Accountants. To avoid that, cancellation now has its own permission, frozen at the pre-correction membership.

| Status | Who may cancel |
|---|---|
| `SUBMITTED` | The submitting Distributor (own goods), **Accountant**, Admin |
| `APPROVED`, no Credit Note | **Accountant**, Admin (a Distributor may not) |
| `APPROVED` with a Credit Note | Nobody — `409` |
| `RECEIVED`, `REJECTED`, `CANCELLED` | Nobody — terminal (`409`) |

Consequences worth a business decision (nothing is decided in this change):

1. The Merchandiser can approve a return but **cannot cancel** it; the Accountant, who can no longer approve, can still cancel an approved return that has no Credit Note.
2. Should Merchandiser be added to `DISTRIBUTOR_RETURN_CANCEL_ROLES`? Should Accountant keep cancelling `SUBMITTED` requests? Either is a one-line change to that constant once decided.

## Web

- The section previously titled **Finance Review** is now **Return Approval** (matrix label "Return approval by Style and Size"). The Style × Size matrix and per-source-line quantity inputs, the approve payload (`expectedVersion`, `lines[{id, approvedQuantity}]`, `approvalRemarks`) and the Reject reason field are unchanged.
- Approve/Reject: Merchandiser and Admin. The **Credit Note** panel (Record / Update): Accountant and Admin. Cancel Return: Distributor (own, SUBMITTED), Accountant, Admin.
- The unrelated A5 reconciliation review action `FINANCE_REVIEW` (post-dispatch reconciliation) is a different feature and is not changed.

## Verification

- API (`distributor-return.test.ts`, disposable PostgreSQL): Merchandiser approve and reject succeed; Accountant and Distributor get `403` and the return is unchanged; Senior Management has no mutation; Admin approves, rejects, records the Credit Note, receives and cancels; Accountant records then updates a Credit Note on APPROVED and RECEIVED returns; Merchandiser, Distributor and Senior Management cannot record one; Merchandiser still cannot cancel, Accountant still can; stale `expectedVersion` still `409`; audit rows written. All pre-existing scenarios (acceptance quantities, partial return vs Credit Note ordering, eligibility, receiving, terminal immutability, concurrency, Distributor scoping) pass with the Merchandiser as approver.
- Web (`DistributorReturnDetailPage.test.tsx`): role matrix for the Return Approval panel, Credit Note panel, physical receipt and Cancel Return.
- Full API/web suites, typecheck, lint and build run in CI.
