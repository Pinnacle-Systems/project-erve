# Carton QR delivery (ISS-087)

Approved scope: one stable QR in each existing carton contents label; no-login,
carton-scoped immutable evidence; read-only Dispatch progress. No changes to
Dispatch recording, distributor receipt, stock, financial or E-Way Bill behavior.

Implementation sequence:

1. Credential security, additive schema, lifecycle and transactional API.
2. Existing PDF integration, public mobile confirmation and Dispatch evidence panel.
3. Focused tests, rasterized QR decoding, authorization regressions and review.
4. Commit, push and create one PR; stop without inspecting CI, merging or deploying.

Review focus: stable reprints after key rotation; stale/retired/deleted cartons;
revocation versus submission races; duplicate retries after uncertain outcomes;
public disclosure and session independence; totals independent of pagination.

## Activation and operations

Feature defaults off. Apply the additive migration before releasing the API;
release web/API together while disabled, then configure and enable the feature.
Never activate against an unmigrated database. Physical Dispatch stays non-blocking.

Set these API-only values in the deployment secret store:

- `CARTON_DELIVERY_ENABLED=true` (otherwise all existing labels remain QR-free).
- `CARTON_DELIVERY_PUBLIC_ORIGIN=https://<permanent-public-host>`: HTTPS origin only,
  no path, query, fragment or user information. Serve `/delivery/carton` from this origin.
- `CARTON_DELIVERY_ACTIVE_KEY=v1` and `CARTON_DELIVERY_KEYS`: a JSON object mapping
  versions to canonical base64-encoded random 32-byte AES keys. Generate secrets
  securely outside source control; never use the test fixtures' keys in production.
- `CARTON_DELIVERY_VALIDITY_DAYS=180` (accepted range 1–3650).
- Existing `VITE_API_URL` must reach the API, normally `/api` in production.

Enabled startup fails closed if origin/key configuration is missing or invalid.
Disabled startup requires no QR secrets and reads no QR tables for label preparation.
Label preparation must receive an explicit enabled/disabled result; failures never
fall back to printing a QR-free or placeholder label. Print and Download still use
the same contents document. No QR step is added to physical Dispatch recording.

Keep the canonical host and route working for the lifetime of attached labels.
Retain old encryption key versions for reprints, backups and recovery. Adding a
new active version changes encryption for new credentials only; it does not rotate
existing QRs. Missing old keys prevent reprinting rather than generating a new token.
Tokens are SHA-256 indexed and AES-256-GCM encrypted with carton ID as AAD.

No pre-Dispatch countdown exists. Expiry starts from persisted `dispatchedAt`, not
the operator-entered Dispatch calendar date. Normal reprints preserve tokens and
do not extend validity. ADMIN/MERCHANDISER can extend expiry with an audit reason;
revoked tokens cannot be extended. Reissue revokes the prior credential and requires
explicit acknowledgement that attached **contents labels** must be replaced using
the same Print/Download actions. For an already-expired Dispatch, explicit reissue
records an audited extension to now + configured validity; otherwise the original
Dispatch-based deadline remains. Initial issuance for an already-expired historical
shipment fails closed; an authorized explicit reissue (expectedTokenId=null) can
create a usable credential. No historical evidence is inferred or backfilled.

Credential administration is in the Dispatch evidence panel. Its narrow API is
`POST /carton-delivery/credentials/:cartonId` with `action`, `reason`, and
`expectedTokenId`; extend adds `extendedUntil`, reissue adds
`acknowledgeReplacement=true`. The same API supports exceptional pre-Dispatch
credential management. A stale token ID is rejected. Reissuing never clears evidence.

The bearer capability proves possession of that carton's QR, not a verified person's
identity. Anyone with a copy can submit for that carton only. Recipient names are
self-declared. Immutable evidence and server timestamps must not be represented as
distributor-authenticated Style × Size receipt or financial acceptance.

## Public security and operations

The fragment is captured into page memory and removed with replaceState. It is
not stored in cookies, browser storage or query caches. Reloading requires rescanning.
The page bypasses AuthProvider, SessionManager and the authenticated application shell.
Its dedicated fetch client omits cookies and auth tokens and never refreshes/retries
automatically. An uncertain submission can be explicitly retried with the same key
and payload. After changing the payload, the server still rejects an already-accepted carton.

Public APIs run before generic JSON parsing, CORS and request logging. They accept
only `X-Carton-Delivery-Token`, strict JSON and no query parameters, with a 12 KiB
body cap. Public responses are no-store/no-referrer and never return recipient
information, content, provenance, addresses or financial data. Unknown errors are
sanitized without logging exception payloads. Do not configure proxy/APM/header/body
logging to capture this capability header or evidence request bodies. The web entry
document has a no-referrer policy. Add no-store and X-Robots-Tag headers for the public
HTML route at the CDN/proxy; preserve the existing SPA fallback.

Persistent PostgreSQL fixed-window limits apply across workers: resolve 120/IP/min
and 60/token/min; confirm 20/IP/min and 10/token/min. Values exceeding the budget
return 429 with Retry-After: 60. IPs/tokens are hashed in limiter keys. The API trusts
one local proxy hop; keep direct upstream access private and preserve real client IPs.
An operations retention job should remove rate buckets older than 24 hours:
`DELETE FROM carton_delivery_rate_buckets WHERE window_start < now() - interval '1 day'`.
Never remove token tombstones or delivery evidence as part of that cleanup.

The migration adds token history, immutable confirmations and rate-limit buckets,
one unrevoked token per carton, one evidence record per carton, restrictive evidence
FKs, nullable token carton FKs for draft deletion, and an evidence UPDATE/DELETE
rejection trigger. The test-only database reset uses TRUNCATE on a guarded disposable
database. Application code has no evidence correction/delete operation.

## Verification and UAT

Focused local commands (no shared database writes):

```text
pnpm --filter @erve/api exec vitest run --config vitest.carton-delivery.config.ts
pnpm --filter @erve/web exec vitest run src/pages/fulfillment/CartonLabelButton.test.tsx src/pages/fulfillment/PackingListPage.test.tsx src/pages/fulfillment/pdf/carton-label src/pages/delivery src/pages/fulfillment/dispatch-workspace/CartonDeliveryPanel.test.tsx src/pages/fulfillment/ErveDispatchWorkspace.test.tsx src/pages/fulfillment/ErveDispatchTransporter.test.tsx
```

Prisma generation/validation are codegen only. PostgreSQL integration cases in
`carton-delivery.integration.test.ts` run under the existing CI safety guard and
disposable test database. They cover simultaneous issuance/confirmations,
revocation races, FK tombstones, immutable evidence and audit rollback. They were
not executed locally because no disposable PostgreSQL runtime was available.

The PDF test rasterizes the actual generated PDF at 300 dpi and independently
decodes its QR with jsQR, including a 35-Style multipage carton and 11 Size columns.
It asserts existing text and confidentiality. Set `CARTON_QR_EVIDENCE_DIR` to retain
the synthetic PDFs and PNGs; no real bearer credentials or business data are used.

UAT before activation: print at 100% scale on the intended printer; scan normal and
multipage labels using Android/iPhone cameras at practical distances; confirm
readable quiet zones, address/Style-image layout, and no clipping. Scan before and
after Dispatch, submit one carton at a time, retry after connectivity loss, rescan
accepted cartons and verify totals plus unchanged Distributor Receipt/status.
Physical devices/printers were unavailable for this implementation session.

## Implementation ledger

- Credential security and service tests were observed failing before implementation,
  then passing; public-route and PDF/mobile tests followed the same sequence.
- Ruling: use two domain tables plus a PostgreSQL limiter table to meet persistent,
  multi-worker limits without introducing Redis. Cost: limiter retention must be operated.
- Ruling: explicit reissue of an expired shipment includes a recorded validity
  extension; ordinary printing never extends it. Cost: operators must replace labels.
- Ruling: PostgreSQL race verification is delegated to the existing CI disposable
  database, as allowed by the request. No local shared database was touched.
