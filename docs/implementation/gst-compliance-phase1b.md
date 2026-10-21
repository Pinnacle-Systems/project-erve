# GSTIN verification — Phase 1B

This implementation follows the consolidated Phase 1B request. It adds explicit
GSTIN checks only. Master saving, stock allocation, tax calculations, invoice
snapshots and statutory document lifecycles do not invoke verification.

## Provider contract

Inspected official documentation on 21 October 2026:
https://www.gstinapi.in/docs (Basic, Complete, authentication, errors and free
integration sample sections). No endpoint or pricing discrepancy was found.

The backend adapter makes one `GET /v1/gstin/{gstin}` for BASIC or one
`GET /v1/gstin/{gstin}/complete` for COMPLETE, using `x-api-key`. It follows no
redirects, chains no requests and automatically retries nothing. The documented
successful Live estimates are 1 and 2 credits. Actual usage is stored only from
`credits_charged`; balances never imply per-operation usage.

Demo substitutes `00AAAAA0000A1ZT` in the adapter, checks both envelope and nested
identity, requires `test: true` and `billed_to: "test"`, and rejects a nonzero
explicit charge. The documentation says this sample never consumes credits.
Without a safe key, provider-backed execution remains unverified; mocks are
explicitly identified in QA evidence.

Transport uses a fixed HTTPS origin, no query secrets, a 128 KiB streamed response
limit, a bounded timeout and Zod payload validation. Only allowlisted normalized
fields leave the adapter. Upstream error bodies and keys are never returned or
persisted. Partial Complete responses are accepted without enrichment/retry.

## API contracts

All routes require the existing bearer authentication and existing response
envelopes. Prefix: `/gst-compliance/verification`.

| Operation                   | Route                                         | Behavior                                                                                   |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Minimal workflow projection | `GET /policy`                                 | Enabled/mode/level only; no provider call or settings-page permission                      |
| Current cache               | `GET /?gstin=...&sourceType=...&sourceId=...` | Exact saved GSTIN and source authorization; no provider call                               |
| History                     | `GET /history` with same query                | Up to 50 mode-scoped attempts; no balance or credentials                                   |
| Prepare                     | `POST /prepare`                               | `{target: {gstin, source?: {type,id}}, refresh?: boolean}`; returns RESULT or CONFIRMATION |
| Execute                     | `POST /execute`                               | `{intentId}` only; rechecks actor, identity, settings revision, mode, level and guards     |

Strict input rejects client mode, coverage, costs, arbitrary URLs and force flags.
`refresh` is only a request: the service requires ACCOUNTANT permission and the
appropriate mode guards. A fresh sufficient cache may be returned to an authorized
reader without granting paid-call authority. Prepare never contacts the provider.
Execute requires a server-created single-use intent, expiring after five minutes.
Successful intent replay returns saved cache; failed/uncertain replay cannot call
again. Any settings revision change requires a new confirmation.

Refresh confirmations also retain the evidence id visible when prepared. If
another confirmed operation has already replaced that evidence before execution,
a sufficient fresh result retrieved since confirmation satisfies the pending
refresh. Falling back to older Complete coverage after Basic expires does not
suppress an explicit refresh. A further paid refresh requires a new confirmation
against the newer result. This closes the sequential and simultaneous claim races.

Source types are DISTRIBUTOR, SELLER_REGISTRATION, RETAIL_STORE and DISPATCH_ORDER.
For dispatch, source id is the saved destination id. Its owning order is checked
through existing factory-scoped order authorization. Dispatch execution is denied.

## Permissions

| Actor/workflow                         | Cache/history                                  | Demo initiation | Live initiation / refresh                   |
| -------------------------------------- | ---------------------------------------------- | --------------- | ------------------------------------------- |
| ACCOUNTANT standalone on GST settings  | Yes                                            | Yes             | Yes, subject to both runtime guards         |
| ADMIN, authorized saved master         | Yes                                            | Yes             | Requires additional ACCOUNTANT role         |
| MERCHANDISER, Distributor/Retail Store | Yes                                            | Yes             | Requires additional ACCOUNTANT role         |
| SENIOR_MANAGEMENT, permitted master    | Yes                                            | No              | No unless separately authorized roles exist |
| DISTRIBUTOR                            | Own mapped Distributor only                    | No              | No                                          |
| FACTORY_USER                           | Own factory's saved dispatch destinations only | No              | No                                          |
| Seller Registration                    | Existing ADMIN access required                 | ADMIN           | Both ADMIN and ACCOUNTANT                   |

No master access is broadened. ACCOUNTANT-only users can use the standalone GSTIN
lookup in their existing settings page. A role permitted to edit a source may
still lack chargeable verification permission. The backend returns capabilities
for the specific source; the browser cannot override them.

## Persistence and cache

`GstVerificationEvidence` stores successful append-only evidence: requested,
normalized, lookup and returned identities, mode/coverage, normalized profile JSON,
retrieval/expiry/TTL policy, estimated and explicit actual credits, billing category
and a unique operation link. Normal application operations do not update/delete it.

`GstVerificationOperation` stores actor, exact source/id/GSTIN snapshot, settings
revision, mode/coverage, explicit refresh intent, estimated credits, lifecycle,
failure code, timing and restricted provider balance. It is the durable intent and
attempt journal. Source association never changes master data. A late result stays
historical if the saved GSTIN changed; the return read rechecks identity.

History and latest-failure warnings are separate from the shared profile cache.
With `sourceType`/`sourceId`, both operation queries require that exact authorized
pair as well as normalized GSTIN and mode. Matching GSTINs on another master or
standalone attempts are not included. Omitting source is an explicit Accountant-only
broader view of all operations for that GSTIN/mode, including source-linked and
standalone attempts. ADMIN alone does not grant that broader view. ACCOUNTANT alone
does not grant master access; linked requests still need existing master roles.
The existing read/history query contract rejects incomplete source pairs and
unknown scope fields. Operation/evidence rows and credit accounting are unchanged.

`GstVerificationClaim` uniquely owns mode + normalized requested GSTIN + coverage
across application instances. Claim and global/actor rate accounting use a short
PostgreSQL advisory-lock transaction. HTTP starts after the transaction commits.
Cache is rechecked after acquiring ownership, followed by another settings and
source check. Partial success, failure and success are separate outcomes.

The latest evidence per coverage is selected, preferring fresh sufficient coverage.
Fresh COMPLETE can satisfy BASIC. BASIC cannot satisfy COMPLETE. Mode partitions
never mix. When COMPLETE is selected but only Basic registration is fresh, show
that Basic evidence as `BASIC_ONLY`, with its own timestamp and without a Stale
badge. State that fresh Complete Profile information is unavailable; do not merge
expired filing values into current registration. Historical Complete remains in
authorized history. Complete retrieval still needs an explicit action/confirmation
and Basic cannot satisfy its cache requirement. If nothing is fresh, prefer stale
sufficient coverage. No additional provider request is made by this display choice.
Expired evidence stays visible as Stale; no silent refresh occurs. The
browser schedules a read-only expiry refresh and labels expired displayed evidence
Stale even when its previous response said Fresh. Editing a GSTIN remounts the
interaction and hides evidence/confirmation for the old value. Changing settings
invalidates read-only UI projections and never invokes verification.

Default TTL is seven days for each coverage, configurable from 60 seconds to 30
days. Timestamps and the effective TTL are saved at retrieval. An environment
change does not rewrite historical expiry. A newer result with a shorter policy
does not extend the latest evidence's life using an older result of that coverage.
Read APIs/history/disclosures never call the provider or consume credits.

## Concurrency and uncertain-outcome recovery

Intents transition PREPARED → DISPATCHED → SUCCEEDED / CACHE_HIT / FAILED /
UNCERTAIN. Claim ownership and dispatch state are committed together. `reviewAfter`
is two minutes after acquisition; it marks a stalled operation for review, not
permission for another request. No database transaction spans provider HTTP.

Definitive documented failures (400/401/402/403/404/429/502) release the claim.
The official documentation explicitly calls 502 safe to retry and no-charge;
this adapter still performs no automatic retry. Network/timeout, malformed or
identity/billing-ambiguous success, unknown HTTP failures and local post-dispatch
persistence failures retain the claim. Worker crashes also leave a durable claim.
An expired review timestamp never grants permission to duplicate a request.

Recovery is an operator process, not a new business UI or automatic job. Inspect
the exact operation/source/GSTIN/timestamps and upstream account logs. Preserve
all history. Release a stuck claim only after positively reconciling the outcome
and recording an approved maintenance decision; elapsed time alone is insufficient.
There is no self-service reconciliation endpoint in Phase 1B. A confirmed
successful response lost before persistence cannot be invented or promoted into
evidence. Any later paid operation needs a new explicit Accountant confirmation.

Persistent bounds are ten prepared intents per actor/minute, five execution claims
per actor/minute, and ten execution claims globally/minute. The [provider documentation](https://www.gstinapi.in/docs)
checked on 21 October 2026 documents 10/min for new accounts until email verification
or purchased credits, then 60/min. The conservative cap covers both tiers; the actual
account tier is not verified. This requires a dedicated key: other applications
sharing it are outside this database's accounting. No retry follows a provider 429;
operators must wait for the provider reset before another explicit attempt.
Cache rechecks can conservatively count toward the claim
rate. Client buttons also prevent duplicate submission, but correctness depends
on the database rather than a browser or process-local promise map.

## UI and integration

`GstinVerificationPanel` and `GstinVerificationResult` reuse ERVE components.
OFF hides additional UI. Basic shows government registration, identity, provenance
and timestamp. Complete adds collapsed Return Filing Information. Missing or
explicitly unavailable values read “Information unavailable”; filed-through periods
format as Month/Year. Partial filing information does not hide registration data.
Demo always states that the entered GSTIN has not been verified. Cache and Stale
labels never alter the master's internal ACTIVE/INACTIVE value.

Saved Distributor forms/details, Seller forms/details and Retail Store editors/
details use exact stable record ids. Unsaved full/inline editors offer save-first
guidance; they never attach evidence by matching UI text. Distributor inline editor
is create-only in this repository, so verification is offered on its saved detail.
Dispatch creation uses permitted Retail Store cache when a stable Store id exists;
saved destination details are read-only. No stock-allocation behavior is changed.

Potentially chargeable Live operations show exact GSTIN, level, estimated cost,
fresh-cache state and refresh bypass explanation before execution. Cancel and
Escape do not execute; focus returns to the invoking action. No provider names
appear in ordinary business screens or operational errors.

## Server configuration and verification

See `apps/api/.env.example`. `GST_COMPLIANCE_LIVE_AUTHORIZED` remains the settings
activation guard. `GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED` independently gates
paid execution and defaults OFF. Keys stay server-side and outside settings.

Database-free tests: `pnpm --filter @erve/api exec vitest run --config vitest.unit.config.ts`.
Authorized isolated QA: `GST_PHASE1B_QA_AUTHORIZED=true` plus the exact local
Phase 1B connection, then `vitest run --config vitest.phase1b.config.ts` from API.
The separate guard rejects all other names, owners, hosts, ports and URL options;
the standard test-database guard is unchanged. Never copy QA authorization to a
shared database. See `gst-compliance-phase1b-database-qa.md` and the completion
report for actual migration, automated and Chromium evidence.

`scripts/gst-phase1b-qa-server.mts` is an explicit local QA entrypoint with an injected
mock transport and loopback-only fixture controls. It is not imported by the
production server. `scripts/gst-phase1b-browser-qa.mjs` exercises real Chromium,
the real frontend, authentication, API and the isolated DB; it never calls the
external provider. QA artifacts/credentials are ignored and retained for review.
