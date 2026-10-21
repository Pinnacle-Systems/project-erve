# GST Compliance Phase 1B implementation report

Date: 21 October 2026 (Asia/Calcutta).
Status: IMPLEMENTED; feature, isolated PostgreSQL and Chromium verification completed,
with explicit limitations below. Authorized for commit, push and Draft PR preparation.

## PR #130 correction: source-scoped operation history

The follow-up review identified a real authorization defect missed by the original
audit: authorized master reads used GSTIN/mode-wide operation queries after source
authorization. This correction keeps successful profile cache sharing but restricts
both history and latest-failure queries to the exact authorized source type/id,
normalized GSTIN and integration mode. Other masters and standalone attempts cannot
appear in a linked history or warning. Source-less queries explicitly remain
Accountant-only and span all sources/standalone attempts for that GSTIN/mode.
Accountant-only users still cannot access master-linked history without the existing
master roles. ADMIN alone cannot request the broader source-less view.

Mixed-coverage display now prefers fresh Basic registration over stale Complete
evidence when Complete is selected. It returns `BASIC_ONLY`, uses the Basic evidence's
timestamp/freshness, hides expired filing values and states that fresh Complete
Profile information is unavailable. No profile fields are merged or rewritten.
Complete retrieval still needs an explicit action/confirmation and the two-credit
estimate; Basic never satisfies Complete coverage. Stale Complete evidence remains
in authorized history. There is no new migration or change to claim/credit logic.

Regression evidence records the two source-isolation cases and mixed-coverage
API/UI regressions failing before the correction, then passing afterward:

- API database-free unit suite: **111 passed** (including the additional history
  authentication/paired-source/unknown-scope HTTP contract test).
- PostgreSQL integration tests: **14 passed**, included in the **115-test GST sweep**
  before that final HTTP contract test was added. The unit/integration counts overlap
  that sweep; they are not additional independent totals.
- Relevant frontend settings/panel/master-form tests: **44 passed**.
- Root client tests: **56 passed**.
- Fresh Chromium checks: **21/21 passed**, eight screenshots, 131 sanitized API
  request records, zero console errors; only isolated API/DB and mocked transport.
- Workspace typechecks and lint passed (three pre-existing date-picker hook
  warnings); API/Web builds passed (existing Web chunk-size warning).
  Browser-runner syntax validation and `git diff --check` passed.
- Both Distributor and Retail Store fixtures contain two records sharing one
  GSTIN, separately initiated verification and a standalone Accountant attempt.
  All seven supported roles are tested for permitted and forbidden linked/broader
  history. Fixtures also cover same-id/different-source-type collisions, unrelated
  warning suppression, own-source failures, Demo/Live separation, shared cache reuse,
  unchanged evidence count and released claims. No real provider request is made.
- Independent read-only review found no blocking issue. It did not run tests;
  Seller/Dispatch-specific history matrices were not newly added. Their existing
  source authorization is preserved and the common exact-source predicate applies.

The exact isolated container/database/volume/loopback target below was reverified.
Its prior data was saved as ignored `history-review-preserved.dump` before testing,
then restored before local Chromium checks. No other database was used, no migration
was applied and no schema changed. Artifacts, private configuration and browser
profiles remain ignored. Actual provider-backed Demo execution remains unverified.
After the fresh browser run, the retained database has 93 applied migrations,
4 successful evidence records, 7 operations and zero claims (`history-final-state.json`).
The original local whole-backend sweep remains interrupted; GitHub CI is tracked
separately and must not be confused with that incomplete local run.
See [PR #130](https://github.com/Pinnacle-Systems/project-erve/pull/130) for CI results
on the pushed correction commit. No merge or deployment is authorized.

Correction file inventory (12 files):

- `apps/api/src/modules/gst-compliance/gstin-verification.access.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.integration.test.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.repository.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.routes.unit.test.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.service.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.unit.test.ts`
- `apps/web/src/pages/gst-compliance/GstinVerificationPanel.test.tsx`
- `apps/web/src/pages/gst-compliance/GstinVerificationPanel.tsx`
- `docs/implementation/gst-compliance-phase1b-report.md`
- `docs/implementation/gst-compliance-phase1b.md`
- `packages/types/src/gstin-verification.ts`
- `scripts/gst-phase1b-browser-qa.mjs` (updated assertion for the corrected message)

## Baseline and preservation

- Original baseline:
  `163425f59c3a7646f9cb4f77fc2678bf9755eaed`.
- Review preparation fetched latest `origin/main` and fast-forwarded to
  `fa9f10f69c4c5f78b51a0eaafd27752fda44ab60` (Factory Invoice PR #129).
  Both baseline and latest main are ancestors; Factory Invoice changes are excluded
  from the Phase 1B PR diff. The separate original checkout remains untouched.
- PR #127 MERGED: `42e7f24c81dcaaa83ec28f2ad38a34171cdf3e05`,
  20 October 2026 at 16:26:58 UTC.
- PR #128 MERGED: baseline above, 20 October 2026 at 21:44:48 UTC.
- Branch: `feature/gst-compliance-phase1b`.
- Worktree: `C:\Users\kalay\workspace\erve-gst-phase1b`.
- Original checkout `project-erve` initially contained 12 uncommitted Factory
  Invoice files on `feature/iss-010-025-factory-invoice-presentation`; this task
  left them untouched. At final read-only inspection that checkout was clean and
  had independently advanced to `7f65a17` (Factory Invoice work). No changes to
  other branches/worktrees were made by this Phase 1B task.
- The user's follow-up authorizes a reviewed Phase 1B commit, push and Draft PR.
  Merge, deployment, production migration and real paid calls remain prohibited.

Read all four requested Phase 1A/1B documents and inspected settings/repository,
authentication, audit, RBAC, Prisma, fixtures and form conventions before coding.
The old design's save-trigger suggestion is superseded by the user's current
explicit-only rule. Seller/master access is preserved: ACCOUNTANT-only users use
standalone verification; seller-linked Live initiation needs existing ADMIN access
as well as ACCOUNTANT. No permissions were broadened for paid calls.

## Delivery classification

| Item                                                          | Classification | Evidence / limit                                                                                    |
| ------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| Generic provider contract and backend adapter                 | IMPLEMENTED    | Fixed-origin, bounded transport; no frontend secrets                                                |
| Basic/Complete endpoint selection                             | VERIFIED       | Mocked transport tests assert one exact endpoint per miss                                           |
| Free Demo substitution and marker validation                  | VERIFIED       | Mocked adapter/integration tests; real business identity never sent in Demo                         |
| Actual provider-backed Demo execution                         | NOT VERIFIED   | No safe provider key configured; no response invented                                               |
| Independent default-OFF Live execution guard                  | VERIFIED       | Settings authorization alone does not grant lookup execution                                        |
| Explicit actions and credit confirmation                      | IMPLEMENTED    | Actor/identity/mode/level/settings revision bound durable intent                                    |
| PostgreSQL evidence, cache and operation claims               | VERIFIED       | Focused isolated PostgreSQL tests                                                                   |
| Cache coverage, mode separation and partial responses         | VERIFIED       | Real database, mocked provider transport                                                            |
| Cross-instance/concurrent operation coordination              | VERIFIED       | Two app instances share durable claim; uncertain claim survives recreation/expired review timestamp |
| Sequential refresh confirmation coalescing                    | VERIFIED       | Unit and real PostgreSQL regressions; older fallback does not suppress refresh                      |
| Reusable results and form integration                         | IMPLEMENTED    | Same component across approved workflows                                                            |
| Browser acceptance                                            | VERIFIED       | 21/21 mocked-provider Chromium checks; existing page layout limitation below                        |
| E-Way Bills, invoices, tax logic, automatic/bulk verification | DEFERRED       | Strict exclusions; no implementation                                                                |
| Production migration/deployment and Phase 1B PR               | DEFERRED       | Separate approval required                                                                          |
| Retention and self-service uncertainty reconciliation         | OPEN DECISION  | Evidence retained; manual operator reconciliation only                                              |

## Provider contract and charging

Official source inspected: https://www.gstinapi.in/docs, including Basic verification,
Complete Profile, authentication, error codes and free sample integration sections.
The documented endpoints and successful Live estimates match the approved contract:
Basic uses one `GET /v1/gstin/{gstin}` (estimate 1 credit); Complete uses one
`GET /v1/gstin/{gstin}/complete` (estimate 2 credits). Complete uses `profile`, while
Basic uses `data`. No Basic-before-Complete, return history, filing preference or
additional enrichment request exists.

Authentication is `x-api-key`. Official sample markers are `test: true` and
`billed_to: "test"` with identity `00AAAAA0000A1ZT`; the docs say these samples
never consume credits. Demo checks these markers and rejects unexpected identity,
ambiguous billing or explicit nonzero charges. There is no Demo-to-Live fallback.
Live rejects sample state-code 00. Actual usage comes only from explicit
`credits_charged`; account balance never determines actual usage by subtraction.

Documented definitive non-charge errors, including the explicitly safe-to-retry
502, release a claim; the application still performs no automatic retry. Network,
timeout, unknown HTTP failure, malformed/identity/billing ambiguity and local
post-dispatch uncertainty hold the operation for review. Provider errors never
become successful registration evidence or raw user-facing vendor messages.

## Database, authorization and migration results

The user explicitly approved a new disposable environment, then specified its exact
container/database and preservation requirements. Existing environments were not
reused. Pre-creation container and volume checks both reported absent.

| Property             | Verified target                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Container            | `erve-gst-phase1b-qa-pg`                                           |
| Container ID         | `ced017f5f1aad61e4841a5ed8edd1b2ffbac6aecf0af62db69b0d41efbbbb317` |
| Database             | `erve_gst_phase1b_qa`                                              |
| New dedicated volume | `erve_gst_phase1b_qa_data`                                         |
| Port                 | `127.0.0.1:55433` → container `5432/tcp`                           |
| Database owner       | `gstphase1b` (synthetic local QA identity)                         |
| Engine               | PostgreSQL 18.4, locally available `postgres:18` image             |
| Migration result     | All 93 migrations applied successfully; no unfinished migrations   |

Container id, volume mount and loopback mapping were inspected, and
`current_database()`/`current_user` were queried before migrations. The exact target
was verified again before the second additive migration. Neither
`erve_gst_phase1a_qa` nor any production, development or shared database was accessed
or modified by this work. Original migration files remain unchanged.

New migrations:

1. `20261021120000_gstin_verification`: three additive tables, unique operation/
   claim keys, lookup/history/rate indexes, restrictive evidence/claim references.
2. `20261021121000_gstin_confirmation_cache`: nullable `cache_evidence_id` on the new
   operation table, closing the sequential double-refresh confirmation race.

`GstVerificationEvidence` holds successful normalized allowlisted profile JSON plus
identity, coverage, mode, actor-associated operation, billing and expiry provenance.
`GstVerificationOperation` holds durable intent and successful/failed/uncertain/cache
outcome history. `GstVerificationClaim` coordinates replicas. There is no process-local
authoritative cache and no transaction spanning HTTP. Existing master/invoice rows
and historical GSTIN snapshots are not rewritten.

The isolated QA configuration validates exact database name, owner, loopback host,
port and explicit `GST_PHASE1B_QA_AUTHORIZED=true`, rejecting all other targets and
URL options. The existing standard test-database safety guard is unchanged.
Synthetic fixtures may reset this new database only. Local QA credentials have
current-user-only ACLs and are excluded from Git and this report.

## API and permission matrix

Authenticated prefix `/gst-compliance/verification`:

- `GET /policy`: minimal enabled/mode/level projection.
- `GET /`: current cache, with GSTIN and optional exact source type/id.
- `GET /history`: up to 50 permitted mode-scoped attempt records.
- `POST /prepare`: strict target/refresh request; returns sufficient cached RESULT
  or a five-minute server-created CONFIRMATION without contacting the provider.
- `POST /execute`: accepts only an actor-bound intent id; all gates are rechecked.

Business DTOs are in `packages/types/src/gstin-verification.ts`. Errors follow the
existing envelope. Unknown mode/cost/coverage/proxy fields are rejected. Balances,
keys and upstream error bodies are absent from response DTOs.

| Role/workflow                     | Read                                        | Demo  | Chargeable Live / force refresh          |
| --------------------------------- | ------------------------------------------- | ----- | ---------------------------------------- |
| ACCOUNTANT standalone             | Yes                                         | Yes   | Both independent runtime guards required |
| ADMIN on permitted master         | Yes                                         | Yes   | Additional ACCOUNTANT role required      |
| MERCHANDISER on Distributor/Store | Yes                                         | Yes   | Additional ACCOUNTANT role required      |
| SENIOR_MANAGEMENT                 | Established master reads                    | No    | No                                       |
| DISTRIBUTOR                       | Own mapped Distributor only                 | No    | No                                       |
| FACTORY_USER                      | Own factory dispatch destination cache only | No    | No                                       |
| Seller Registration               | ADMIN required                              | ADMIN | ADMIN + ACCOUNTANT                       |

Dispatch order access reuses the existing factory scope check. Dispatch verification
is read-only for all roles. Saved source GSTIN is revalidated before/after slow
execution; changed identities hide the association while preserving old evidence.
Settings writes retain their existing ACCOUNTANT restriction and audit behavior.

## Cache, credit control and recovery

Default BASIC and COMPLETE freshness is 604800 seconds (seven days). Validated
server bounds are 60–2592000 seconds. Retrieval stores the actual effective TTL and
UTC retrieval/expiry timestamps. Fresh Complete satisfies Basic; Basic cannot
satisfy Complete. Demo and Live use separate cache identities. Partial Complete
is cached without retries or invented filing fields. Failed attempts preserve prior
successful evidence. Stale results remain visible and never auto-refresh externally.

Confirmation includes exact GSTIN, mode, effective coverage, estimated cost, fresh
cache state and explicit refresh bypass explanation. The server binds actor,
source, settings revision and action. Intent replay cannot execute twice. The
refresh evidence snapshot coalesces multiple confirmations against the same old
result. A new refresh against the newer evidence needs a new confirmation.

Claim acquisition uses a short PostgreSQL transaction and advisory lock, then
rechecks cache/settings/source before calling once. Rate limits are ten intents per
actor/minute, five execution claims per actor/minute and ten globally/minute.
`reviewAfter` is two minutes and never automatically releases an uncertain claim.
Worker-crash/unknown outcome recovery requires explicit operator reconciliation;
there is no automatic lease takeover, background retry or reconciliation UI.

## UI integrations and filing presentation

The reusable panel uses ERVE Panel/StatusBadge/ValidationMessage/Button/ConfirmDialog
and native disclosure. It is hidden when OFF. Demo sample, Live evidence, cached
result and Stale labels are separate from internal master ACTIVE/INACTIVE status.
Expiry updates work even when a tab remains open, including the maximum 30-day TTL.

Integration points:

- Distributor full create/edit and saved detail.
- Distributor create-only inline editor: save-first guidance, then saved detail.
- Seller Registration create/edit and saved detail.
- Retail Store editor (full/inline) and detail.
- Dispatch creation: read-only permitted Store cache using stable Store id.
- Saved Dispatch destination: read-only cache using exact destination id.
- Accountant settings: standalone explicit lookup, preserving master permissions.

Required/optional GSTIN semantics, ordinary saving, local validation, Enter-to-next,
stock allocation, tax/invoice snapshots and finalization rules are preserved.
Unsaved or changed GSTINs require saving before entity-linked verification; no
association is inferred from text and provider names/addresses are never copied.

Complete adds collapsed Return Filing Information with frequency, GSTR-1/GSTR-3B
Filed Through, Profile Retrieved On and completeness. `2026-08` displays August
2026, never a submission date. Missing/null/explicit unavailable fields display
“Information unavailable”, never “Not Filed”. Partial filing data keeps valid
registration information visible. Basic evidence under Complete preference is
shown with an explicit not-yet-retrieved message and optional authorized action.

## Security and error handling

Server-only key and independent default-OFF Live execution guard are documented in
`apps/api/.env.example`. Provider origin is fixed HTTPS, redirects are disabled,
responses are streamed with a 128 KiB limit, timeout is bounded 1–30 seconds, and
payloads are schema-validated. No new dependency or UI library is introduced.

Invalid format, not found, cancelled/suspended/unknown status, authentication,
insufficient credits, rate limiting, unavailable upstream, timeout/network,
malformed payload, unexpected identity and unexpected Demo billing markers are
separate outcomes. No raw provider errors or credentials are logged by the adapter
or returned to business users. Estimated cost remains distinct from explicit actual
usage. QA uses a local-only wrapper with injected mocked transport; its fixture
routes are absent from production startup.

## Automated verification

Review preparation on latest main (`fa9f10f`):

- Database-free API unit tests: **109 passed**.
- Isolated PostgreSQL GST suite: **112 passed**, including **12 integration tests**.
  The added global rate regression failed against the original 30/min cap, then
  passed with the 10/min cap. It verifies aggregate claims across different actors
  and availability when one dispatch leaves the minute window. No provider HTTP
  request is made by that regression.
- Root client tests: **56 passed**.
- Workspace typechecks, API production build, Web production build and Prisma
  validation passed. The Web build retains its existing large-chunk warning.
- Workspace lint passed with three existing hook dependency warnings in the
  unchanged `packages/primitives/src/components/date-picker.tsx`; zero lint errors.
- The first review Web run completed with **1948 passed / 16 failed / 1964 total**,
  including PDF timeouts, asynchronous assertions and a dashboard worker shutdown
  timeout while other verification jobs ran. This failed run is preserved as
  `review-web.json`; no failure is counted as a pass. The complete two-worker
  rerun passed **1964/1964 tests, zero failures**, without changes to application
  code or timeout thresholds (`review-web-final.json`). This supports resource
  contention as the cause of the first run's failures; it does not erase them.
- Final `git diff --check` and browser-runner syntax validation passed. All 44
  candidate files passed a scan for local private configuration secrets. Git
  ignores local environments, artifacts, database snapshots and browser profiles;
  the dedicated database volume is managed outside the repository.
- Independent read-only code review found no additional blocking defects after
  the rate-limit correction. This review did not reproduce runtime/provider tests.
- The QA browser runner now creates a separate retained profile per run, avoiding
  stale debugging-port reuse. Its initial startup failure is retained in the task
  transcript; the subsequent complete run passed all 21 checks as detailed below.

The [official provider rate-limit documentation](https://www.gstinapi.in/docs),
checked on 21 October 2026, states 10 requests/minute for new accounts until email
verification or purchased credits, then 60/minute per key. The hard-coded aggregate
cap now uses 10, with the existing 5/actor cap. This remains conservative at both
documented tiers. The actual account tier is NOT VERIFIED because no account/key
was used. A dedicated key is an operational prerequisite: traffic from another
application/database sharing that key is outside this limiter. HTTP 429 causes no
automatic retry; wait for the provider reset before a new explicit attempt.

Before review integration tests, the existing isolated QA database was backed up
to ignored `pre-review-database.dump`. Only that positively identified database was
reset by tests, then restored before fresh Chromium QA. Both the prior snapshot
and new review evidence are retained. Current state (`review-database-state.json`):
**93 applied migrations, zero unfinished, 4 evidence records (2 Demo/2 Live mocked),
7 operations (4 SUCCEEDED/1 FAILED/2 PREPARED), zero claims, DEMO/COMPLETE/ON settings**.
The two unused confirmations are expired. Container ID, database, dedicated volume
and loopback port remain unchanged. No other environment was accessed.

Original implementation verification evidence (before updating to latest main):

- API unit suite: **109 passing tests**, database-free, including Phase 1A regressions.
- Final GST module suite on isolated PostgreSQL: **111 passing tests**, including
  all **11 database integration tests**. These suites overlap and are not additive.
- Frontend focused forms/settings/panel suite: 54 passing tests before the added
  long-TTL regression; current panel file has 11 passing tests.
- Root `pnpm test`: 56 client tests passed.
- Final Web suite: **1933 passing tests, zero failures**.
- Separate Dispatch Order form/detail regression run: **18 passing tests**.
- API/Web/types typechecks passed, including final API/Web rechecks.
- Targeted API/Web ESLint and `git diff --check` passed after final edits.
- Final frontend production build passed with a large-chunk warning.

The first broad Web run completed with 1929 passed / 3 failed out of 1932 tests.
Two failures were the unavailable-field and expiry regressions added during that
run and are now fixed with fresh focused passes. The third was the unchanged
ManagementDashboardPage “hides a section entirely…” timeout. Its isolated retest
passed all six tests. The final-code broad Web run passed all **1933 tests**, with
zero failures. Reports are retained separately.

The optional whole-backend sweep was **INTERRUPTED**, not passed, after approximately
40 minutes of serial database fixtures. It was stopped before browser fixture
setup to avoid competing resets and complete the required acceptance work. It did
not produce a final assertion summary; no passing count is claimed. Its process
tree alone was stopped, and the entire GST module suite was then rerun successfully
against the isolated DB. See `api-broad-interrupted.json`. The whole backend suite
is **NOT VERIFIED** as a completed run. Existing PostgreSQL driver concurrency
deprecation warnings appeared during that broad run; new claim-rate queries execute
serially within their short transaction. No test failure is silently counted as a pass.

Machine-readable evidence is under `.artifacts/gst-phase1b-qa/`: API unit, focused
Web, panel, broad suites and dashboard retest reports. Broad suites and browser
fixtures run sequentially against the database so fixture resets do not race QA.

## Real Chromium verification

**21/21 browser assertions passed** again during review preparation, with **eight screenshots**, **145 sanitized API
request records**, and **zero browser console errors**. The runner targeted only
`http://127.0.0.1:5187` and isolated QA API
`http://127.0.0.1:4101`. The QA API uses the real backend adapter with an injected
mock HTTP transport; this is not actual provider-backed verification.

Required viewport checks passed for the GST panel at **1366×768**, **1920×1080** and
**390×844**, with no document horizontal overflow. Checks covered Demo Basic/Complete,
Month/Year filed periods, persisted cache reuse, Basic-under-Complete without automatic
upgrade, explicit Live mock confirmation/cancel, ADMIN denial and ACCOUNTANT initiation,
stale/reverify, partial/error preservation, Retail Store/Distributor saving without
provider calls, Seller local validation, Escape/focus restoration, OFF behavior and
console errors. Existing Enter-to-next behavior is also covered by the automated
form suite; exhaustive physical-device and screen-reader testing was not performed.

Visual inspection: the new GST panel stays contained and compact at all requested
sizes. The existing Distributor detail header/actions overlap at mobile width,
and its existing Mapped Users empty state is tall. Those unchanged elements are
**DEFERRED**, outside this GST feature; the panel viewport checks do not claim that
the entire pre-existing page has no layout issues.

Artifacts in `.artifacts/gst-phase1b-qa/`:

- `browser-results.json`: named checks, network records, console results and request counts.
- `demo-basic-1366x768.png` and `demo-complete-{1366x768,1920x1080,390x844}.png`.
- `live-credit-confirmation-mocked.png`, `stale-live-evidence.png`,
  `partial-complete.png`, `credit-error-preserved-evidence.png`.
- `restart-proof.json`: a real QA API process restart retained the exact same
  fresh evidence id; subsequent read and prepare returned cached RESULT with
  **zero provider requests after restart**. No automatic fixture reset runs at restart.

Browser transport fixtures are synthetic, including Live confirmation scenarios.
Actual provider-backed Demo execution remains NOT VERIFIED.

## Remaining limits and approval boundaries

- Real provider-backed Demo execution is NOT VERIFIED without a configured safe key.
- All Live tests use synthetic identities and mocked transport. No paid Live call
  or statutory request has been made.
- Evidence retention and self-service uncertainty reconciliation remain OPEN
  DECISIONS; no destructive cleanup or automatic retries were added.
- Dispatch verification action is DEFERRED; cached presentation preserves its
  existing creation/allocation workflow.
- Whole-backend regression completion is NOT VERIFIED; the GST module/database
  suite and complete frontend suite passed as detailed above.
- Existing mobile Distributor header/action overlap is DEFERRED; no shared
  PageHeader or unrelated business workflow was changed.
- Container, volume, synthetic DB and evidence are retained for follow-up review.
- Production deployment/migrations, merge and E-Way Bill work remain outside
  authorization. The follow-up authorizes commit, push and Draft PR only.

## Final diff and database state

Phase 1B is prepared on the latest main ancestor cited above. The reviewed change
contains **44 files** (19 modifications and 25 additions relative to main).
No existing migration file changed. Inventory follows below.

Original preserved database snapshot (`final-database-state.json`, backed up before
review tests as `pre-review-database.dump`):

| Item                    | Final state                                                |
| ----------------------- | ---------------------------------------------------------- |
| Container / volume      | Running and retained; identity above unchanged             |
| Migrations              | 93 applied, zero unfinished                                |
| Successful evidence     | 5 records: 3 DEMO, 2 LIVE synthetic mock fixtures          |
| Operation journal       | 8 records: 5 SUCCEEDED, 1 FAILED, 2 PREPARED cancellations |
| Active operation claims | 0                                                          |
| Persisted settings      | DEMO, COMPLETE, verification ON                            |
| Real paid usage         | None; all provider transport was mocked                    |
| QA API / Web            | Retained at 127.0.0.1:4101 / 127.0.0.1:5187                |

The two unused confirmations expire after five minutes and cannot execute after
expiry. Their estimated costs are not actual charges. Synthetic browser identities,
source records, verification history, server logs and screenshots are retained.
Credentials and browser profile stay ignored; private configuration files have
current-user-only ACLs. Final `.env` execution guards remain false; only the separate
local mocked QA entrypoint enables its in-process test guards.

Independent code review identified and verified fixes for Factory cache policy,
live-display expiry, unavailable fields and refresh coalescing. The final expiry/
fallback case also has a passing regression. No material review finding remains
unaddressed. See the technical reference for configuration and recovery policy.

### File inventory

Modified:

- `apps/api/.env.example`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/modules/gst-compliance/gst-compliance-settings.service.ts`
- `apps/api/src/test/helpers.ts`
- `apps/web/src/pages/gst-compliance/GstComplianceSettingsPage.tsx`
- `apps/web/src/pages/master-data/DistributorDetailPage.tsx`
- `apps/web/src/pages/master-data/DistributorEditor.tsx`
- `apps/web/src/pages/master-data/DistributorFormPage.tsx`
- `apps/web/src/pages/master-data/RetailStoreEditor.tsx`
- `apps/web/src/pages/master-data/RetailStorePages.tsx`
- `apps/web/src/pages/master-data/SellerRegistrationDetailPage.tsx`
- `apps/web/src/pages/master-data/SellerRegistrationFormPage.tsx`
- `apps/web/src/pages/sale-orders/SaleOrderDetailPage.tsx`
- `apps/web/src/pages/sale-orders/SaleOrderFormPage.tsx`
- `docs/implementation/gst-compliance-phase1b-design.md`
- `packages/types/src/gst-compliance.ts`
- `packages/types/src/index.ts`

New:

- `apps/api/prisma/migrations/20261021120000_gstin_verification/migration.sql`
- `apps/api/prisma/migrations/20261021121000_gstin_confirmation_cache/migration.sql`
- `apps/api/src/integrations/gst/gst-provider.ts`
- `apps/api/src/integrations/gst/gstin-api.provider.ts`
- `apps/api/src/modules/gst-compliance/gst-provider.unit.test.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.access.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.integration.test.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.repository.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.routes.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.routes.unit.test.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.service.ts`
- `apps/api/src/modules/gst-compliance/gstin-verification.unit.test.ts`
- `apps/api/src/modules/gst-compliance/phase1b-database-safety.unit.test.ts`
- `apps/api/src/test/phase1b-database-safety.ts`
- `apps/api/src/test/phase1b-setup.ts`
- `apps/api/vitest.phase1b.config.ts`
- `apps/web/src/pages/gst-compliance/GstinVerificationPanel.test.tsx`
- `apps/web/src/pages/gst-compliance/GstinVerificationPanel.tsx`
- `docs/implementation/gst-compliance-phase1b-database-qa.md`
- `docs/implementation/gst-compliance-phase1b-plan.md`
- `docs/implementation/gst-compliance-phase1b-report.md`
- `docs/implementation/gst-compliance-phase1b.md`
- `packages/types/src/gstin-verification.ts`
- `scripts/gst-phase1b-browser-qa.mjs`
- `scripts/gst-phase1b-qa-server.mts`
