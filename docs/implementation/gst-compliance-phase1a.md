# GST Compliance Phase 1A

Baseline: `129a6e8`, clean checkout on `feature/iss-009-007-010-style-size-packing`.
Implementation branch: `feature/gst-compliance-phase1a`.

## Authorized scope and design

Implement the user's consolidated Phase 1A specification. No provider requests,
verification records, statutory documents, invoice/dispatch changes, migrations
against databases, commits, or pushes. Existing dependencies are sufficient.

Use the existing Express/Zod/Prisma, shared RBAC, React Query and ERVE components.
Settings use an application singleton, version 0 virtual defaults and version 1
on first persisted change. GET has no initialization side effect. A transaction
serializes singleton updates, checks the expected version, persists settings and
records old/new values and actor in AuditLog atomically. No-op updates do not
change version, timestamp or audit history. A scope resolver isolates today's
application scope so future seller-scoped settings need not change consumers.

ACCOUNTANT alone writes. ACCOUNTANT and ADMIN read settings and audit history;
other roles receive no new settings-page access. Future master workflows may
receive a smaller capability projection under their own approved permissions.

LIVE activation requires explicit confirmation and server-only
GST_COMPLIANCE_LIVE_AUTHORIZED=true (default false). This is settings activation
authorization only; it is not authorization for future statutory filing. Reads
report server authorization separately from persisted mode. E-way generation
enablement is rejected regardless of mode. Enabled GSTIN verification remains a
configuration preference only until Phase 1B is approved.

Preserve all GSTIN required/optional semantics and the existing structure regex.
Move normalization and format checks to @erve/shared; leave checksum validation,
master statuses, historical placeholders and invoice snapshots unchanged.

## Implementation sequence

1. Write database-free tests for settings defaults, permissions, strict input,
   version conflicts, atomic audit failure, Live confirmation/authorization,
   unavailable e-way generation, independent preferences and no external calls.
2. Add shared DTOs/RBAC, settings service/repository, Prisma schema and unapplied
   SQL migration. Add safe GET/PATCH and audit endpoints and runtime wiring.
3. Write shared-validator compatibility tests, consolidate all repeated regexes,
   and preserve backend transformations, errors and optional null handling.
4. Write UI tests, implement compact accountant controls and read-only ADMIN
   view, navigation/route gating, loading/error/conflict/save handling and audit.
5. Document Phase 1B contracts, result presentation, caching, credit provenance,
   Demo isolation, filing-date exclusions and future statutory preparation.
6. Run safe unit/HTTP/UI tests, relevant existing regressions, typechecks, lint,
   frontend build and schema validation. Review diff and scope before reporting.

## Verification boundary

Use a separate API unit configuration without test/setup.ts. HTTP tests mock
authentication at the user boundary and use the real router/service against an
in-memory transactional repository. Production repository query behavior is
checked with a database-client double. These do not establish PostgreSQL
integration behavior. Do not load database URLs or run database-backed tests;
there is no positively verified disposable database for this delivery.

Prisma client generation and schema validation are local code operations only;
use a non-routable placeholder URL, not configured database credentials. SQL
migration execution remains a later explicitly approved deployment step.

## Delivery status

All six implementation steps are complete. See
[completion report](gst-compliance-phase1a-report.md) for executed verification,
the full frontend suite's single dashboard timeout (isolated rerun passed),
unexecuted PostgreSQL checks, final file inventory and remaining approvals.
No Phase 1B runtime behavior was implemented. The original delivery was
uncommitted; the user subsequently authorized commit, push and Draft PR creation.
The updated Phase 1B plan limits lookups to BASIC and the COMPLETE bundle, with
database-backed caching and proposed configurable 7-day freshness. Separate
return-filing APIs and exact filing-date retrieval are outside planned scope.
