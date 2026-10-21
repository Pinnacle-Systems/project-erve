# GST Compliance Phase 1B design

Historical Phase 1A design notes below. The authorized Phase 1B implementation is
documented in [gst-compliance-phase1b.md](gst-compliance-phase1b.md). The consolidated
Phase 1B request supersedes save-triggered verification: saving never invokes a
lookup. Current verification and database approval evidence is in the Phase 1B report.

Phase 1A implements configuration only. It contains no provider adapter, lookup
endpoint, verification evidence, cache, statutory documents or operation journal.
Nothing on the settings page executes a paid or government operation.

## Boundaries

Keep domain orchestration in `apps/api/src/modules/gst-compliance` and provider
HTTP mechanics in `apps/api/src/integrations/gst`. Use `packages/types` for safe
business DTOs and `@erve/shared` for format validation and explicit capabilities.

The following are design contracts, not exported or executable Phase 1A APIs:

- `GstComplianceSettingsService`: resolve effective values, runtime capabilities
  and scope. Current API is application-scoped. Later seller-scoped resolution
  must define inheritance, separate optimistic versions and audit identity.
- `GstProvider`: capability-specific verification contract accepting an explicit
  requested level and execution mode, returning normalized identity, government
  status, optional profile, provenance, partial-data indicators and credit data.
- `GstinApiProvider`: sole owner of vendor URLs, response fields, authentication,
  sandbox identity substitution and provider errors. No provider details in UI.
- `GstinVerificationService.verifyGstin(gstin, level)`: authorize actor and
  workflow, resolve settings, validate input, enforce mode/runtime authorization,
  resolve sufficient cache, deduplicate pending requests, invoke one operation,
  sanitize/persist evidence, return safe business data. Settings read permission
  does not grant a chargeable verification permission.
- `GstinVerificationRepository`: append-only evidence, exact GSTIN/entity revision
  associations and coverage-aware cache selection. Do not implement tables until
  the Phase 1B persistence design is approved.
- `GstProviderOperationService`: future durable request intent, fingerprint,
  idempotency, outcome and reconciliation, especially before statutory generation.
- `EWayBillService`: later eligibility/readiness, manual assignments, generation,
  correction, government operations and history; no Phase 1A behavior.

Existing service/repository separation permits a provider to be replaced without
changing forms, business statuses or controller contracts. Future e-invoice
operations reuse secrets, transport, sanitized errors and durable operations;
they must have separate capabilities and government execution authorization.

## Provider endpoint selection and credit contract

Official reference: https://www.gstinapi.in/docs
Product/setup reference: https://www.gstinapi.in/e-way-bill-api

The approved Phase 1B scope contains only these two lookup operations:

| Level | Single request | Estimated successful uncached live cost |
| --- | --- | --- |
| BASIC | `GET /v1/gstin/{gstin}` — registration verification | 1 credit |
| COMPLETE | `GET /v1/gstin/{gstin}/complete` — bundled registration verification, filing frequency, latest GSTR-1 filed period and latest GSTR-3B filed period | 2 credits |

COMPLETE must never run BASIC first or chain individual filing requests. Recheck
the official contract, enabled account capabilities and charging before building
the adapter. These estimates are not charges or credit debits. Save actual usage
only when explicitly reported; remaining balance alone does not prove per-request
cost, particularly with concurrent calls. Never expose provider account balance
or credentials to roles without an approved business need.

## Execution safeguards

DEMO verification sends only `00AAAAA0000A1ZT`, regardless of the real GSTIN in
the business form. Store original and normalized requested identity separately
from the identity actually sent and returned. Reject unexpected identity/mode
responses. Label sample data explicitly. A demo success cannot verify the real
business GSTIN; no failed-demo fallback to live exists.

LIVE uses the requested GSTIN only after checking current feature flag,
server authorization, actor/workflow permissions, input and cache policy.
Recheck at execution, not just enqueue time. Settings activation authorization
is not sufficient for statutory filing. Future government filing needs an
additional independent deployment authorization, plus explicit confirmation.
Switching modes changes no evidence or statutory records and never promotes
demo data. Reads and failed attempts do not rewrite prior successful evidence.

Use predictable approved triggers: saving a new/changed GSTIN and explicit
Verify/Recheck. Confirm chargeability and deduplicate save/recheck interactions.
No keystroke/render/navigation/list-fetch/accordion-triggered calls. No automatic
background verification jobs. Flag OFF prevents all new verification calls.

Use header-based credentials stored server-side, bounded response size, TLS,
timeouts, rate limits and allowlisted logging. Map authentication/credit/rate
limit/upstream failures to safe operational errors; never label them an invalid
registration. Raw response details and credentials must not escape the adapter.

## Evidence and cache design

Record requested/original GSTIN, normalized requested GSTIN, actual lookup
identity, BASIC/COMPLETE coverage, DEMO/LIVE mode, government status, legal/trade
names, taxpayer type, profile fields, filed-through periods, partial/unavailable
indicators, retrieved/expiry timestamps, actor, provider/result reference,
sanitized response, reported usage and remaining balance where available.

Persist BASIC and COMPLETE evidence/cache records in the database; do not rely
on process memory as the cache of record. Propose a configurable freshness
duration with a 7-day default for both levels, resolved server-side. Store
retrievedAt/expiresAt and the applicable freshness policy so cache decisions are
auditable. This is Phase 1B design only; no cache table or freshness setting is
added to Phase 1A.

Cache identity includes actual lookup GSTIN, mode and data coverage. A fresh
COMPLETE result may satisfy BASIC display; BASIC never satisfies COMPLETE.
Partial COMPLETE registration data can remain useful, with incomplete filing
coverage explicitly preserved. The proposed configurable 7-day freshness,
refresh permission, policy for unavailable/non-active results, deduplication
scope and retention need implementation review before Phase 1B begins.
Mode/level changes trigger no upgrade/refresh. Changing a form GSTIN
invalidates the evidence association without erasing the old record. Ignore a
late response for a former form GSTIN; never display it as evidence for the new
value. Demo evidence must remain logically separated from Live evidence.

## Reusable result UI

Use the existing ERVE form controls, StatusBadge, Panel, disclosure and dialogs.
Preserve the editable GSTIN, master requiredness and Enter-to-next behavior.
Place a compact result beside/below GSTIN in full forms and inline editors.

- OFF: input and local format errors only; no verification placeholder/requirement.
- BASIC: GSTIN, legal/trade name, taxpayer type where present, government status,
  verification timestamp and visible Demo/Live indicator. Statuses distinguish
  active, cancelled, suspended, invalid/not found, unavailable, not verified and
  stale. Never reuse the ERP master's ACTIVE/INACTIVE badge as government status.
- COMPLETE: BASIC content plus collapsed **Return Filing Information**: filing
  frequency, GSTR-1 Filed Through, GSTR-3B Filed Through, Profile Retrieved On,
  Profile Completeness. `2025-08` displays as **August 2025**, a return period,
  not an actual filing date. Invalid/missing periods render unavailable safely.
- `partial: true` produces a nonblocking partial-information message. Null fields
  or names listed in `unavailable` display **Information unavailable**, never
  **Not Filed**. Missing filing data does not erase valid registration status.
- A BASIC cache under COMPLETE preference states that Complete Profile has not
  been retrieved. An authorized explicit action may request it later. Opening
  the disclosure or reading any cached result never performs a request.

## Excluded lookup capabilities

Separate return-filing/return-history APIs and exact filing-date retrieval are
outside the planned scope. Do not plan an additional paid operation, endpoint,
cache, confirmation flow or **View Filing Dates** action for them. COMPLETE
provides filed-through return periods, not actual submission dates. Its bundled
filing fields remain in scope; do not chain extra calls to enrich them.

## Later E-Way Bill and dispatch integration

Prefer a separate statutory-preparation record after consolidated packing-list
and corresponding Tax Invoice finalization, before `recordErveDispatch()`.
Creating a false DISPATCHED row for an identifier is prohibited. Confirm movement
origin, ship-to GSTIN/state/PIN, transport mode/ID, vehicle/type, LR date, distance,
UQC, statutory valuation, document/movement types and effective state/exemption
rules first. Eligibility is more than a threshold and has an undetermined state.

Offer Generate E-Way Bill, Enter Existing E-Way Bill and Decide Later. A pending
legally required bill cannot satisfy clearance. Generation OFF must not disable
manual reference management. Internal replacement does not imply government
cancellation. Retain old assignments, reasons, actor identity and timestamps.

DEMO government requests require `test_mode: true`, synthetic response validation
and separate storage. Unexpected live-looking output is rejected. Synthetic
documents cannot satisfy live clearance or replace live statutory evidence.
Never fall back to Live. LIVE filing requires independent server authorization
and confirmed immutable invoice/movement identity. Persist intent before calling;
unknown outcomes block fresh generation until reconciliation by the original
document identity. A timeout or local save failure must not create a duplicate.

Resolve ERVE/Tally invoice ownership, accountant clearance authority and invoice
cancellation/replacement dependencies before modifying any workflow. Reuse this
foundation for e-invoices later; no IRN or e-invoice implementation now.

## Phase 1B test plan — documentation only

1. One BASIC operation or one COMPLETE bundle; no chained calls and no extra
   return-history invocation.
2. DEMO substitution, actual lookup identity checks, no real-GSTIN transmission,
   no live fallback and no demo evidence promoted to Live.
3. Flag OFF, runtime authorization revoked, actor permissions and predictable
   chargeable triggers, including delayed/background execution safeguards.
4. Partial COMPLETE and null/unavailable filing data preserve registration status;
   return periods display month/year without being called submission dates.
5. Database-backed BASIC/COMPLETE cache persistence across process restarts,
   default 7-day expiry, configured freshness boundaries, coverage selection,
   mode partitioning, explicit
   recheck, concurrent request deduplication and changed-GSTIN/late-result races.
6. No requests from renders, read-only interactions, opening Return Filing
   Information, settings changes or navigation.
7. Estimated versus reported credits, insufficient credits, auth failures, rate
   limits, malformed payloads, timeouts and safe redaction.
8. Evidence append-only history, actor/provenance, error handling and policy for
   unavailable/non-active results. Provider contract fixtures are mocked locally;
   real endpoint tests require separately approved safe credentials/environment.

## Remaining approvals

Phase 1A migration deployment; explicit Live settings authorization; Phase 1B
implementation; chargeable workflow role matrix; configurable freshness,
retention/blocking policy; seller-scope behavior; later statutory
preparation, rule matrix and government filing authorization. No phase advances
automatically.
