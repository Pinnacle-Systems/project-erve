# Batch 1 Tax Invoice experience implementation plan

> Execute inline as the dedicated Invoicing agent, with test-first verification.

**Goal:** deliver INV-007 and INV-008 as sequential verified GitHub PRs.
**Spec:** user-supplied SOP v1.6 Batch 1 authorization, 11 October 2026.
**Baseline:** implementation began at 5749bbe (PR0). Style PR65 has since
merged at 2f133c7; integrate it before publishing PR1.
**Architecture:** existing accounting functions and lifecycle services remain
authoritative. Add invoice-scoped read/review integration, normalized web pages,
then a finalized-snapshot PDF adapter. Reuse the established UI and PDF systems.
**Tech stack:** Express/Prisma/PostgreSQL, React Query, shared ERVE components,
Vitest, React-PDF, installed Chrome/Edge with native-window verification.

## Gates and boundaries

- GitHub authentication/push/merge permissions verified; main has no active
  protection/rulesets/CODEOWNERS/queue. Enforce all three CI jobs regardless.
- Production workflow is manual workflow_dispatch only. Do not dispatch it.
- No Style worktree/shared component implementation edits.
- No production data, EI cutover, GST activation, cancellation or Credit Notes.
- The user explicitly approved the nullable versioned documentSnapshot,
  invoice-owned archival copies and ADMIN/ACCOUNTANT invoice-image reads.
  Existing finalized records stay null; no retrospective archival.
- Native launches are rejected by automatic approval review. The user selected
  provision of a browser-enabled environment; browser acceptance stays pending.

## PR1: INV-007

- [x] Create dedicated worktree and unique local test/browser databases;
      validate database-safety guards before any write-capable verification.
- [x] Add failing API coverage for search/paging, audit, review, source
      eligibility and RBAC. Extend existing immutable/finalization regressions.
- [x] Extract common read-only calculation preparation from finalization
      without changing arithmetic, allocation, transaction/lifecycle locks or
      guards; use it for backend draft review and unchanged finalization.
- [x] Expose invoice-scoped audit and eligible EIPL source reads under the
      existing invoice permissions. Add server-side search before pagination.
- [x] Correct finalized HSN display to use the existing frozen hsnCode.
- [x] Add separate browser invoice contracts and query/mutation integration.
- [x] Add Pattern A queue and Pattern D Review/History detail. Keep Pattern C
      lines and Pattern E decision evidence/totals together. Preserve drafts,
      missing/legacy data, saved overrides, retries and role-specific actions.
- [x] Add the approved versioned presentation snapshots and invoice-owned
      archival media, with honest legacy gaps and no Style permission widening.
- [ ] Verify focused/regression tests, workspace checks and native browser
      behavior at maximized/100% zoom and responsive desktop/narrow widths.
- [ ] Review diff, commit/push, create PR, monitor exact-head CI and reviews,
      guarded squash merge, verify main and clean up only this worktree/branch.

## PR2: INV-008

- [ ] Refresh main/Style dependencies after PR1 merge and cleanup.
- [ ] Reopen/render Inv-103.pdf and compare content/layout directly.
- [ ] Build a pure finalized snapshot adapter, A4 portrait React-PDF document
      and lazy generation integrated with the existing print/download lifecycle.
- [ ] Preserve historical EISO verbatim; print verified current order
      references separately, including multiple source orders and missing data.
- [ ] Group only compatible Style/colour/HSN/MRP/rate/tax lines; keep quantity,
      price and tax calculations unchanged. Retain compact archived Style images.
- [ ] Print frozen seller/bank/parties, HSN/GST summaries, grandTotal, signed
      round-off and issued payable. Amount in words follows the issued total.
- [ ] Conditional exemption declaration uses frozen applicability and FY;
      RCM No is bold. Do not add E-Way capture or infer absent references.
- [ ] Verify one/multi-page PDFs, long fields, images, totals, declarations,
      native print/download, tests and workspace checks.
- [ ] Create PR, exact-head CI/review gate, guarded merge, verify and cleanup.

## Completion

- [ ] Consolidated story/PR/CI/merge/test/visual/safety/cleanup evidence.
- [ ] Read-only Batch 2 audit and bounded cancellation/Credit Note plan;
      numbering, time boundaries and partial-credit round-off remain decisions.

No tracker/Library updates or Batch 2 implementation are authorized here.
