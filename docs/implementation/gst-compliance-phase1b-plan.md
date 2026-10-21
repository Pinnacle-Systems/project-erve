# GST Compliance Phase 1B implementation plan

Goal: explicit, credit-safe GSTIN verification following the supplied Phase 1B specification.
Spec: `gst-compliance-phase1b-design.md` plus the user's consolidated Phase 1B request, which takes precedence.

Architecture: a backend-only replaceable adapter, append-only PostgreSQL evidence,
durable single-use confirmation intents and cross-instance operation claims. Existing
settings and resource authorization remain authoritative. Reusable React panels read
cache independently of explicit execution. No save handler invokes verification.

Initial execution: inline, no commits/push/PR/deployment. The follow-up review request
authorizes commit, push and a Draft PR; merge and deployment remain prohibited.
The user's explicit incremental
implementation instruction authorizes this plan; no additional design approval is needed.

- [x] Audit origin/main, merged PRs, dirty checkout, docs, conventions and provider contract.
- [x] Define safe shared DTOs and Prisma evidence/intent/claim persistence; generate migration SQL offline.
- [x] Write adapter tests, observe failure, implement single-call transport/normalization and Demo markers.
- [x] Write orchestration tests, observe failure, implement cache, confirmation, gates and durable coordination.
- [x] Add authenticated resource-scoped read/history/prepare/execute routes and default-OFF Live guard.
- [x] Write result UI tests, observe failure, implement reusable panel, confirmation and period display.
- [x] Integrate saved-master forms/details; unsaved forms show post-save guidance; destination reads only.
- [x] Run unit tests, typechecks, relevant regression suites and lint; review scope/security.
- [x] Run authorized isolated DB/browser checks if available, otherwise record NOT RUN precisely.
- [x] Write completion report with evidence and limitations; inspect final diff and original checkout.

Review focus: settings changed after confirmation; ambiguous upstream outcomes;
duplicate submission; old GSTIN response after editing; unavailable filing fields.
Tests must pin these behaviors. Unknown dispatched outcomes retain a persistent claim
until operator reconciliation; elapsed time alone never authorizes a duplicate call.

Repository conflict resolved by current request: old design suggests save-triggered
verification; this phase only offers explicit verification after save. ACCOUNTANT-only
standalone lookup is available in settings; master access is not broadened. Seller
Live initiation therefore requires both ACCOUNTANT and existing ADMIN access.

Database plan: additive tables/indexes only; no existing record rewrites. No migration
or database-writing suite may run without a verified, authorized disposable Phase 1B
target. Phase 1A QA database is expressly excluded.
