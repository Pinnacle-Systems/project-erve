# ISS-023 Phase 3E — Browser responsiveness and release verification

## Result

The complete ERVE packing-list PDF pipeline runs successfully in a dedicated browser module worker. The public generator now starts one worker per action and returns the same `Promise<Blob>` contract. The Phase 3D renderer, ten-carton batching, pagination, merge and global page stamping remain unchanged.

On this machine, the largest observed main-thread timer gap fell from **2,958.1 ms to 39.7 ms** across three runs of the same 12-carton × 15-Style × 10-Size fixture. Median generation time increased from 4.080 s to 4.943 s. This change prioritizes application responsiveness; the measurements are observations in Chrome, not browser-wide guarantees.

Native print-preview acceptance remains manual UAT. No commits, pushes, deployment or issue updates were performed.

## Feasibility evidence before implementation

The isolated proof imported the complete existing generator, rather than substituting a Node renderer or testing only `pdf-lib`. It ran React-PDF layout/rendering, shared matrices and pagination, logo data, sequential batches, merging and page-number stamping in an actual browser worker. Both `window` and `document` were absent there.

The first development proof failed with `window is not defined` in Vite's injected React Fast Refresh code. A standard production Vite application build succeeded without runtime shims. Development also succeeded using the React plugin's supported `exclude` option for PDF modules while retaining its `node_modules` exclusion. A pure numeric subpath avoids the primitives barrel's UI dependency graph. No package implementation, React-PDF internals or runtime dependency was modified.

The isolated production heavy proof completed in 5.202 s with a 29.7 ms maximum UI timer gap. The development heavy proof completed in 4.760 s with a 130.7 ms gap, including cold development dependencies. Both established feasibility before application integration. An earlier library-mode build preserved `process.env` and failed; that mode is not the application build or the implementation.

The actual application production output subsequently loaded its hashed facade and worker bundle in headless Chrome 149.0.7827.55 and generated the heavy PDF in 3.923 s. Its 251,832-byte, 14-page output passed the standalone content and geometry validator. After the final workspace build, a fresh browser page loaded the rebuilt facade `generateErvePackingListDetailPdf-Cslg--Xx.js` and worker `ervePackingListDetail.worker-CNSo1k7_.js` again, generating a 251,832-byte PDF in 4.910 s; all content and geometry checks passed again. These production smoke timings are separate from the controlled comparison. This verifies browser loading beyond Vitest mocks.

Vite's documented [module worker constructor and bundling APIs](https://vite.dev/guide/features.html#web-workers) are used directly. Production worker output uses ES modules. No worker loader dependency, main-thread fallback or undocumented renderer access is used.

## Implementation and scope

Phase 3E changes, relative to the already dirty Phase 3D workspace:

| File | Change |
| --- | --- |
| `apps/web/src/pages/fulfillment/pdf/erve-packing-list/generateErvePackingListDetailPdf.tsx` | Small worker client; validates final Blob, propagates errors, clears handlers and terminates the worker in `finally`. |
| `apps/web/src/pages/fulfillment/pdf/erve-packing-list/renderErvePackingListDetailPdf.tsx` | Existing Phase 3D generator extracted with the same function body. |
| `apps/web/src/pages/fulfillment/pdf/erve-packing-list/ervePackingListDetail.worker.ts` | Runs the complete renderer once and posts its final Blob or error. |
| `apps/web/src/pages/fulfillment/pdf/erve-packing-list/ervePackingListDetailWorkerTypes.ts` | Typed request and response messages. |
| `apps/web/src/pages/fulfillment/pdf/erve-packing-list/generateErvePackingListDetailPdf.worker.test.ts` | Ten tests covering success, failures, invalid responses, retry and cleanup. |
| Existing generator unit/fidelity test files | Import the extracted renderer to retain direct batching and PDF-content regression coverage. |
| `apps/web/src/lib/pdf/core/PdfStyleSizeMatrix.tsx` | Import unchanged numeric helper through a pure subpath. |
| `packages/primitives/package.json` | Export that existing numeric module as `./numeric`. |
| `apps/web/vite.config.ts` | Supported React plugin exclusions and ES worker output. PDF modules use normal module reload instead of React Fast Refresh in development. |
| `apps/web/src/pages/dashboard/ManagementDashboardPage.test.tsx` | Await the real lazy chart import before mounting, preventing an import from outliving test-environment teardown. |
| This report | Measurements, verification and remaining UAT. |

The worker receives the already authorized packing-list data and generation metadata. It fetches no API records and receives no authentication token. Existing RBAC and DEMO-020 redaction remain at the same boundary; the view model and document were preserved. Intermediate batch PDFs stay inside the worker; only the final immutable Blob returns to the UI. Input data is structured-cloned once per action.

`usePdfAction` remains unchanged. Its synchronous ref guard prevents duplicate actions, its loading state disables the buttons, and its existing error message handles worker rejection. Both Download and Print use the same generator. No schema, API, quantity model, application presentation, Factory Packing Queue behavior or business workflow changed in Phase 3E. The combined Phase 3 PR includes the Create/Detail Style × Size presentation changes from earlier phases.

## Controlled browser comparison

Baseline is the Phase 3D generator saved before extraction, including its batching and pagination fixes. Both paths used the exact existing deterministic 12 × 15 × 10 fixture and fixed PDF generation metadata. The machine uses an Intel Core i7-10510U (4 cores / 8 logical processors), Windows and headless Chrome 149.0.7827.55. Runs were sequential with no competing tests or builds, using foreground pages and explicit browser garbage collection between samples. A 25 ms main-thread timer and `requestAnimationFrame` ran throughout generation; measurement continued briefly after completion to capture the final blocked interval. Each worker action starts a fresh worker, including startup and font work.

| Run | Main-thread generation | Worker generation | Main-thread max timer gap | Worker max timer gap |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4,393.1 ms | 5,165.1 ms | 2,823.0 ms | 38.1 ms |
| 2 | 4,079.9 ms | 4,380.1 ms | 2,958.1 ms | 39.7 ms |
| 3 | 3,350.8 ms | 4,942.8 ms | 2,096.5 ms | 36.7 ms |
| Median | 4,079.9 ms | 4,942.8 ms | 2,823.0 ms | 38.1 ms |

The median maximum gap decreased 98.7%; all worker runs met the 250 ms target on this machine. Animation frames continued: 23–29 frames across baseline generations versus 267–315 during worker generations. Timers and frames provide evidence of main-thread availability; these are not measurements of every possible user interaction.

Chrome's exposed UI JavaScript heap increased by approximately 88–91 MiB during baseline runs versus 15–21 KiB during worker runs. **These UI heap readings exclude the worker heap and are neither total browser memory nor peak memory.** No reliable total/peak worker-memory measurement was obtained; this report makes no claim that total memory decreased.

## PDF fidelity and application actions

All six measured PDFs contain 14 pages and are 251,831–251,832 bytes. Every output passed checks for 1,950 quantity cells, 130 size-column totals, all 12 cartons in order, one complete summary, global quantity/carton totals, provenance, metadata, destination, per-page logo/header, global `Page N of 14` footers, margins and overlap. All six have identical rendered text and coordinates when rounded to 0.01 point. Raw PDF bytes can vary with metadata/compression. The actual production bundle's PDF passed the same validator.

In the local application, the existing authorized two-carton/20-piece record was used without modifying business data:

- Two immediate Download clicks created one worker and one final PDF. Loading was observed and the button re-enabled; the worker terminated.
- A deliberately injected browser-only worker-constructor failure displayed `PDF generation failed. Please try again.` and re-enabled actions. Restoring the constructor allowed Print to succeed and clear the error.
- Download and Print generated complete two-page PDFs, including both cartons, the summary and global totals. Their parsed text and coordinates match except for the fresh generation timestamp. Both workers terminated.
- Print's existing off-screen PDF iframe was added and loaded. The browser's native preview and physical printing were not verified in headless mode.
- A subsequent real Download completed through Chrome's download manager and saved `ERVE-Packing-List-EIPL-26-27-0001.pdf` in the task's artifact download directory. The initial CDP page connection did not apply the download directory to the browser context; using the browser-level CDP endpoint verified the completed file without changing application code.

No authorized non-headless debug browser was available. A prior automatic approval review rejected launching visible Chrome; no retry or bypass was attempted. Manual UAT must open Print in an authorized normal browser, inspect the complete native preview and pagination, then cancel/print and confirm cleanup. Headless iframe loading does not fulfill that acceptance step.

## Regression verification

The complete web suite passed in nine sequential partitions, using one Vitest worker at a time and `ERVE_PDF_STRESS=1`: **256 files, 2,018 tests passed, zero failures and zero skipped tests**. The discovered-file manifest was reconciled against all reports: no missing or duplicated files. All nine processes exited zero, with no worker-termination warnings. Partition durations ranged from 12.8 s to 162.1 s; the runner bounded each partition at 240 s without widening application-test timeouts.

Included overlapping subsets: all PDF tests (113 files / 676 tests), all fulfillment tests (79 files / 594 tests), and ERVE packing-list PDF tests (9 files / 77 tests). The ten worker-client tests passed after first failing against the original main-thread implementation. Existing fidelity coverage includes redaction, empty and bounded inputs, pagination, batching and global footer checks. These counts are subsets of 2,018, not additional tests.

Final checks ran sequentially after all web partitions completed:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed across the workspace, including web/API/mobile. |
| `pnpm lint` | Passed, zero errors; three existing hook-dependency warnings in `packages/primitives/src/components/date-picker.tsx`. |
| `pnpm build` | Passed across the workspace, including the web production worker; chunk-size advisories remain. |
| `pnpm test` | Client suite passed: 4 files / 56 tests. This root command is separate from the complete web partitions above. |
| `git diff --check` | Passed; Git's local LF/CRLF notices are not whitespace errors. |

The dashboard termination warning reproduced with six passing assertions before the test change. Awaiting the real lazy chart import removed the warning with those assertions still passing. This is a test lifecycle fix; dashboard application code is untouched. Other existing React `act`/router diagnostics are not claimed to have been removed.

The unchanged Job Order many-row PDF test passed in **2.555 s** in the first controlled partition, below its existing 8 s timeout. The earlier 8.44 s failure occurred during concurrent full-suite/build/check load. The controlled result supports resource contention rather than a reproducible PDF regression; no timeout was widened.

An independent read-only review found no actionable defects in worker lifecycle, errors, bundling or preservation of the renderer. A worker that never responds and emits no error has no added timeout/cancellation; successful and failed actions clean up deterministically. Browser execution was verified in Chrome only.

## Evidence and Git state

Local reproducibility evidence is under the ignored `.artifacts/iss023-phase3e/` directory: isolated proofs, original renderer snapshot, benchmark harness and six PDFs, parsed validation results, production proof/PDF, application action checks, browser download events, partition manifest/results/logs and static-check logs. These generated artifacts are not proposed source additions.

The original 18 dirty/untracked files were snapshotted and hashed before implementation. Fourteen are byte-for-byte unchanged. The four intentional changes are the generator facade, the matrix's numeric import, and the two existing generator test imports. The extracted rendering function body exactly matches the saved original. No unrelated prior edits were reverted; the pre-existing lockfile and web package manifest are unchanged from the start of this phase.

Final Git state: branch `feature/iss-023-p2-operational-style-size`, HEAD `36f8536`; **15 modified tracked files, 11 untracked files, nothing staged**. This includes the original Phase 3D work and the Phase 3E files listed above. No commit, push, deployment or issue-tracker update was performed.

Recommendation: the implementation and combined Phase 3 PR diff are ready for review and commit preparation when authorized. Native Print preview UAT remains a release sign-off requirement. There is no remaining worker feasibility, PDF fidelity, regression-suite or production-bundle blocker. Cross-browser responsiveness and total worker memory remain measurement limits, not verified guarantees.
