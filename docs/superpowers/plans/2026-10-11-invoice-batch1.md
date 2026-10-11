# Batch 1 Tax Invoice experience implementation plan

> Execute inline as the dedicated Invoicing agent, with test-first verification.

**Goal:** deliver INV-007 and INV-008 as sequential verified GitHub PRs.
**Spec:** user-supplied SOP v1.6 Batch 1 authorization, 11 October 2026.
**Baseline:** implementation began at 5749bbe (PR0). Style PR65 has since
merged at 2f133c7 and was integrated into PR1 without conflicts.
Separately approved shared viewer positioning dependency PR68 merged at 3e09608
and is integrated; its geometry and full PR CI passed before merge.
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
- Local native launches are rejected by automatic approval review. The user
  selected provision of a browser-enabled environment. Test-only ephemeral CI
  now provides a headful native desktop; verify maximization/zoom and inspect
  canonical captures before accepting it. Browser acceptance remains pending.

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
- [x] Verify focused/regression tests, workspace checks and native browser
      behavior at maximized/100% zoom and responsive desktop/narrow widths.
- [x] Review diff, commit/push, create PR, monitor exact-head CI and reviews,
      guarded squash merge, verify main and clean up only this worktree/branch.

## PR2: INV-008

- [x] Refresh main/Style dependencies after PR1 merge and cleanup.
- [x] Reopen/render Inv-103.pdf and compare content/layout directly.
- [x] Build a pure finalized snapshot adapter, A4 portrait React-PDF document
      and lazy generation integrated with the existing print/download lifecycle.
- [x] Preserve historical EISO verbatim; print verified current order
      references separately, including multiple source orders and missing data.
- [x] Group only compatible Style/colour/HSN/MRP/rate/tax lines; keep quantity,
      price and tax calculations unchanged. Retain compact archived Style images.
- [x] Print frozen seller/bank/parties, HSN/GST summaries, grandTotal, signed
      round-off and issued payable. Amount in words follows the issued total.
- [x] Conditional exemption declaration uses frozen applicability and FY;
      RCM No is bold. Do not add E-Way capture or infer absent references.
- [ ] Verify one/multi-page PDFs, long fields, images, totals, declarations,
      native print/download, tests and workspace checks.
- [ ] Create PR, exact-head CI/review gate, guarded merge, verify and cleanup.

## Completion

- [ ] Consolidated story/PR/CI/merge/test/visual/safety/cleanup evidence.
- [ ] Read-only Batch 2 audit and bounded cancellation/Credit Note plan;
      numbering, time boundaries and partial-credit round-off remain decisions.

No tracker/Library updates or Batch 2 implementation are authorized here.

### INV-008 execution detail

Baseline: PR67 merged at 3955a80, identical to tested e79c72e. Its three mandatory
CI jobs and native browser acceptance passed. Postmerge checks passed 87 API and
21 web tests on the safety-verified invoice test database. Feature worktree and
branch were safely removed; evidence is preserved in ignored main artifacts.

1. Test a pure snapshot adapter and exact decimal presentation/amount-in-words.
   Group only compatible frozen Style/colour/HSN/MRP/rate/GST lines. Aggregate
   already-frozen line amounts only for presentation, preserving source IDs.
   Never resolve current masters or calculate tax/payable inside the PDF.
2. Resolve archived images through the existing authenticated PDF image utility,
   using invoice-owned paths and print-quality options. Honest placeholders cover
   missing images; legacy issued presentation is unavailable, not reconstructed.
3. Render A4 portrait with existing React-PDF/core infrastructure, logo, compact
   per-Style images, size breakdowns, parties, references, frozen financial/HSN
   totals, issued payable words, conditional FY declaration, bold RCM No and bank.
   Split exceptionally long presentation text without dropping content or
   duplicating amounts; inspect one-page and multi-page output directly.
4. Add finalized-only lazy Print/Download actions using shared lifecycle controls.
   Extend native CI fixtures/harness for actual PDF downloads, preview/print,
   image replacement after issue, pagination and backend reconciliation.
5. Run focused/regression/workspace checks, inspect native/PDF evidence, review
   scope, create PR, wait for all latest-head CI, merge, verify main and clean up.

No API/schema, tax policy, shared UI/media or unrelated business-module changes
are planned in PR2. INV-009 retains E-Way capture/cancellation ownership.

Execution evidence (2026-10-12): refreshed against main 1a25294 (Dispatch Order
PR69). Local workspace typecheck/lint/build passed; lint reports only the three
existing shared date-picker warnings. Focused web/PDF lifecycle and invoice
regression: 139 tests passed; client: 56 passed; shared UI: 119 passed. Actual
synthetic A4 PDFs visually inspected: nine Styles/six sizes fit one page;
36 Styles span three pages with repeated table headers; legacy totals remain
original with missing round-off/reference/image data explicit. Native download,
print and archived PNG alpha verification remain an acceptance gate in CI.

Ruling: PNG/WebP archives use an invoice-local lossless converter because the
existing shared PDF resolver emits JPEG and loses transparency. This preserves
issued image fidelity without altering shared media behavior; JPEG still reuses
the shared resolver. Final review is a separate author self-review under the
single-agent workflow, with CI and visual evidence required before merge.

Native run 38182729536 passed actual maximized 1440/1280/1024 browser checks,
real downloads/print preview and PDF reconciliation. The earlier narrow-screen
assertion ran before responsive layout settled; matching the existing 250 ms
settling step passed. Visual review then found unbroken Style identifiers spilling
into descriptions. A PDF word-boundary regression failed on UAT-STYLE-01 (right
90.87 pt, column limit 79 pt). Invoice-local identifier wrapping retained every
character and moved the rendered prefix inside the column (right 55.18 pt).
All 41 focused invoice/PDF tests passed again. Latest-head native/required CI
must rerun after this rendering correction; earlier success cannot authorize merge.
