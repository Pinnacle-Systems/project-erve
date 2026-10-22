# ISS-023 — Factory Packing Queue PDF responsiveness

## Scope and acceptance basis

This work implements the known Queue PDF performance workstream using repository behavior and the user's autonomous-delivery instructions. No original issue-tracker acceptance criteria were available or verified. The following technical criteria are inferred from existing behavior:

- Preserve both existing PDF sections, columns, row order, counts, branding, pagination and page numbering.
- Keep Factory-scoped authorization and both all-page fetches unchanged; never truncate the export to the visible queue page or send authentication clients/tokens to a worker.
- Demonstrate and reduce browser main-thread blocking on a bounded synthetic dataset, with complete rendered-content reconciliation.
- Preserve the existing public generator overloads, Download/Print Blob contract, loading/error behavior and duplicate-action guard.
- Clean up completed/failed workers and reject failures rather than returning partial output.

No schema, API, quantity, queue cursor, RBAC, Factory selection, carton workflow or Queue web presentation changes are included. Canonical Size ordering is a separate dependency for the later Add/Edit Carton quantity picker; it is not required for this renderer-only optimization.

## Evidence and implementation

The baseline renderer blocked the browser's main thread for several seconds. The complete original document was first rendered successfully in an isolated, standard Vite production module worker with no `window` or `document`. This was a browser feasibility test, not a Node compatibility inference. The proof harness lives outside the web package, so its build explicitly resolves that package's existing React dependency; this alias is not part of application configuration.

`generateFactoryPackingQueueListPdf.tsx` retains the existing Factory-scoped, paginated fetches and pure view-model construction on the UI side, then posts the plain view model to one dedicated worker. The unchanged document renders through `renderFactoryPackingQueueListPdf.tsx`. The worker posts only the final immutable PDF Blob or an error; no intermediate PDFs cross threads. There is no batching, PDF merging, new dependency or layout rewrite in this change.

The client handles construction, cloning/posting, runtime/load, message decoding, rendering and malformed-result failures. It clears handlers and terminates the worker in `finally`. Existing `usePdfAction` still supplies loading, the synchronous duplicate-action guard and the user-facing error/retry behavior for Download and Print.

Vite uses its supported module-worker constructor and ES worker format. React Fast Refresh excludes PDF modules while retaining the existing `node_modules` exclusion, avoiding a development-only `window` preamble in worker dependencies. Other application modules retain Fast Refresh; PDF modules use ordinary reload. This matches the configuration independently introduced by Phase 3 PR #142.

## Controlled browser measurements

Windows, Intel Core i7-10510U, headless Chrome 149. The deterministic fixture contains 320 awaiting lines and 160 Factory Dispatches with unique identifiers and quantities. Each run measures rendering through final Blob readiness, a 25 ms UI timer and animation frames, with explicit browser garbage collection between samples and no competing task-owned local tests/builds. Both modes exclude HTTP fetching and view-model construction; those unchanged asynchronous fetches are separately covered by regression tests. These measurements do not promise universal browser performance or lower wall-clock time.

| Run | Baseline render | Worker render | Baseline maximum timer gap | Worker maximum timer gap |
| --- | ---: | ---: | ---: | ---: |
| 1 | 7,620.5 ms | 8,539.9 ms | 6,604.9 ms | 26.6 ms |
| 2 | 8,314.2 ms | 8,244.6 ms | 7,181.6 ms | 27.3 ms |
| 3 | 9,179.4 ms | 8,576.1 ms | 8,156.7 ms | 27.2 ms |

Median rendering time was 8,314.2 ms before and 8,539.9 ms with a fresh worker (2.7% longer). The worst observed main-thread gap fell from 8,156.7 ms to 27.3 ms; all measured worker gaps were below the inferred 250 ms responsiveness target on this machine. Animation callbacks continued: 20–23 frames per baseline run versus 500–519 per worker run. This supports responsiveness rather than a wall-clock speedup claim.

All six outputs are 348,446 bytes and 19 pages, with identical rendered text and coordinates rounded to 0.01 point. Every source field, row membership/order, section count, footer, logo/header, margin and same-baseline overlap check passed. Browser UI heap readings exclude worker allocations; total browser/worker memory and peak memory were not reliably measured.

## Verification

- Test-first worker regression: the original implementation failed ten new lifecycle assertions; the completed implementation passed all 15 generator tests, including existing Factory forwarding and all-page fetch preparation.
- Queue/PDF/shared-action regression: 61 tests passed in seven files with `QUEUE_PDF_STRESS=1`, including complete 320/160 rendered-source reconciliation, empty/one-row cases, source order, quantities, section counts, logo/header, margins and global footers.
- Web production build (including TypeScript checking) passed; existing chunk-size advisories remain.
- Web lint passed with zero errors or warnings.
- The actual web production bundle's `factoryPackingQueueList.worker-xRpbb0SX.js` loaded in Chrome and generated the same complete 320/160, 19-page PDF, with the same normalized text/coordinate hash as all six comparison PDFs. This verification used the actual build output, not Vitest mocks or only the isolated proof build.
- The new public generator was exercised against authorized local API data under the existing permitted development origin. Both all-page fetches carried the selected Factory id. Download and Print each created and terminated one worker and generated identical complete one-page PDFs (zero awaiting rows, one dispatch), with all source fields and geometry validated. The existing download and print helpers received those Blobs; native preview remains unverified.
- A separate production application test origin was rejected by the API's CORS policy. The restriction was retained; no Origin spoofing, browser-security changes or whitelist bypass was used. The public pipeline check above used the already-authorized origin through supported Vite module loading. This does not claim a complete production-page button smoke test at that separate origin.
- Independent read-only source review found no actionable defects. `git diff --check` passed. No shared PDF document or layout implementation changed.

No full Phase 3 benchmark or full web suite was repeated for this independent scoped change. CI results are tracked separately from local focused verification.

## Limits and release UAT

Browser verification covers Chrome only. Pathologically tall atomic rows and exports beyond the measured/tested envelope are not newly qualified. A worker that silently never responds and emits no error has no added timeout/cancellation; the action remains pending until a full page reload or document navigation, while observable success/error paths clean up deterministically.

Native Print preview, pagination inspection and cancel/print cleanup remain manual release UAT in an authorized normal browser. Headless PDF/iframe verification does not satisfy that requirement. No browser-launch restrictions were bypassed and no production deployment was performed.

Synthetic PDFs, browser scripts, metrics and parsed validation outputs are local ignored evidence under `.artifacts/iss023-queue/` in this worktree; shared browser-control scripts and the delivery record are under the original checkout's ignored `.artifacts/iss023-delivery/`. Generated artifacts are excluded from the PR.
