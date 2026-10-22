# ISS-023 Phase 3D: ERVE consolidated packing-list PDF

Implementation date: 21 October 2026. Historical review state at the end of Phase 3D: implementation ready for review; native print-preview, browser responsiveness and complete full-web-suite verification remained outstanding. No commit, push, deployment, production access, or issue update was performed in Phase 3D.

The subsequent [Phase 3E report](iss-023-phase3e-browser-responsiveness.md) records dedicated Web Worker execution, resolution of the observed main-thread blocking on the tested fixture, and completion of the full web regression suite. Native Print preview remains pending manual release UAT. The measurements and observations below describe Phase 3D before that worker implementation.

## Implementation

Phase 3D production files, before the Phase 3E worker extraction. The rendering pipeline described below now lives in `renderErvePackingListDetailPdf.tsx` in the same ERVE directory; `generateErvePackingListDetailPdf.tsx` is now the worker client:

- `apps/web/src/pages/fulfillment/pdf/erve-packing-list/generateErvePackingListDetailPdf.tsx`: build the existing view model once; slice cartons in source order into batches of at most ten; await each independent render and page copy before the next render. One explicit empty batch handles zero cartons. Only return a Blob after all rendering, merging, stamping, and serialization succeed. Render/load/copy/save failures reject the action; zero-page batches are rejected.
- `apps/web/src/pages/fulfillment/pdf/erve-packing-list/ErvePackingListDetailDocument.tsx`: explicit first/last flags, identity/destination/generation metadata at the beginning, packing-list identity in the branded header on every page/batch, continuation label, global totals and summary only at the end. Both matrices explicitly use ten columns per group. A static footer retains the original separator/reserve.
- `apps/web/src/lib/pdf/core/PdfStyleSizeMatrix.tsx`: optional `flattenForPagination`, default false. ERVE alone opts in, replacing each inner group wrapper View with a React Fragment while retaining the outer matrix View; individual rows/headers/totals stay atomic and cartons/groups remain able to span pages. All shared defaults, including eight-column grouping, remain unchanged.
- `apps/web/package.json` and `pnpm-lock.yaml`: production dependency `pdf-lib ^1.17.1`, resolved to 1.17.1, plus its standard-fonts/upng/pako/tslib dependencies. PDF code remains behind the existing user-action dynamic import.

Public pdf-lib `PDFDocument.create/load/copyPages`, `embedFont`, `drawText`, and `save` APIs copy pages in order and stamp `Page X of Y` after the final count is known. Helvetica 8pt, #777777, horizontally centered, baseline 18.099987pt matches the Phase 3C measured footer. The existing 40pt landscape bottom reserve is retained. No installed renderer code or experimental pagination option is used.

The initial selected pipeline alone did **not** pass the broader source fixture. Unique per-carton factories/DOs lengthened identity metadata enough to make carton 9 start near the page end. PDF extraction reproduced squeezed rows below the reserve and an omitted matrix tail. Read-only inspection of the installed stable paginator identified its empty nested-View split fallback: when the first nested header cannot fit, the complete group can be placed into the current page fragment. A heading presence guard did not solve it. Flattening the inner group container removed that fallback boundary; the same fixture then passed. This is why the shared optional prop is necessary rather than simply copying the Phase 3C harness. An initial version flattened both matrix/group wrappers; the final version retains the outer matrix boundary to minimize layout changes.

New regression/support files in that ERVE directory:

- `generateErvePackingListDetailPdf.test.tsx`: batch boundaries/order/sequential rendering and rejection paths.
- `generateErvePackingListDetailPdf.fidelity.test.tsx`: complete rendered-document reconciliation and geometry.
- `ErvePackingListDetailDocument.values.test.tsx`: actual null/zero/missing-cell presentation and totals.
- `ervePackingListPdf.test-utils.ts`: deterministic synthetic source records.
- `verifyErvePackingListPdf.test-utils.ts`: independent source-to-rendered cell/total/name/order/provenance/footer/coordinate checks.

## Performance

Phase 3C investigation and experiment source were reviewed before editing. Its recommended stable candidate achieved 14.690s to 3.509s, 26 to 14 pages, and 485.2 to 291.8 MiB at 12 × 15 × 10; all fifteen recommended-candidate repeat PDFs passed the bounded fidelity checks. Instrumentation/dependency mutations and global experimental configuration were not adapted into production.

Production measurements use the same five synthetic source records from Phase 3C, three fresh sequential Node children per case, a 30-second per-child deadline, and complete generation through merging, footer stamping, serialization, Blob creation and bytes readiness. Imports, source synthesis, evidence writes, parsing and browser interactions are excluded. Builds/tests and other task-owned CPU-intensive work were not run during measurements. Existing servers remained running; ambient machine load was not controlled. Medians and high-water process RSS are reported, not browser memory or universal timing promises.

Results are recorded in `.artifacts/iss023-phase3d/performance.jsonl`; complete PDF content/geometry results are in the corresponding `*.validation.json` files. The baseline reference is the retained Phase 3C experiment, not repeated profiling. The prohibited 80 × 15 × 10 case was not run.

| Cartons × styles × sizes | Baseline seconds | Final seconds | Pages, baseline → final | Peak RSS MiB, baseline → final | Phase 3C candidate seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12 × 5 × 6 | 2.145 | 1.066 | 6 → 7 | 227.8 → 179.4 | 1.306 |
| 12 × 15 × 6 | 5.312 | 2.708 | 14 → 14 | 309.1 → 273.8 | 2.411 |
| 12 × 5 × 10 | 3.657 | 1.448 | 12 → 7 | 286.8 → 187.7 | 1.848 |
| 12 × 15 × 10 | 14.690 | 3.864 | 26 → 14 | 485.2 → 293.1 | 3.509 |
| 20 × 5 × 6 (incomplete baseline) | 3.217 | 1.400 | 9 → 10 | 277.5 → 224.6 | 1.820 |

The final heavy-case median is 73.7% below the complete baseline. Compared with the historical candidate, the final six-size and ten-size 15-style medians are 12.3% and 10.1% slower respectively. Their sample ranges overlap: final 12 × 15 × 6 was 2.378–2.851s versus candidate 2.288–2.664s; final 12 × 15 × 10 was 3.036–3.915s versus candidate 3.307–3.721s. Do not interpret these historical comparisons as a controlled same-session A/B guarantee.

An implementation-specific bounded check investigated the initially slower six-size run. Removing both wrapper levels had an initial 3.421s median; later alternating controls were also variable (3.517–5.520s for that version, 3.489–4.849s with the original wrappers). The final implementation removes only the inner group boundary required by the observed split fallback, retains the outer matrix View, and passes the same content regression. All initial measurements/control output are retained rather than discarded; final table values come from the final code's fifteen fresh runs.

The 20 × 5 × 6 baseline is incomplete: it omitted carton 14's final style row and column totals. Its timing is shown only for historical context; production correctness/timing are assessed separately and no valid like-for-like speedup is claimed for it.

## Fidelity

Source structure checks are distinct from the release gate, which parses real production PDF output using PDF.js. Tests check each expected carton and order, each style/size cell, row totals, column totals and matrix grand totals, full style names, size ordering/group boundaries, carton factory/DO/factory-dispatch/weight provenance, one consolidated summary, one global carton/piece total line, branded headers/logos, globally sequential page footers, horizontal bounds, footer reserve and same-baseline overlap. Matching document totals alone does not pass these checks.

The dataset covers 0, 1, 4, 10, 11, 12, 20 and 21 cartons; all ten requested C/S/Z combinations; size counts 1–11; sparse cells and zero values; null/zero/missing presentation via direct document view-model input; long style names; multiple factory/DO provenance; redaction across batches; a 75-style/11-size single carton; and its multipage summary. The 20-carton failing source is retained as a permanent rendered regression. All fifteen optimized benchmark PDFs also passed the Phase 3C content/geometry validator (including all quantities/totals, identity, generation metadata and destination fields): 14,370 carton/summary cell keys and 1,626 size-column totals were checked across those outputs, plus row/grand totals.

Large fixture cases can be enabled with `ERVE_PDF_STRESS=1`. Ordinary focused runs retain batch boundaries and the known content-loss reproducer. Synthetic data contains distinct per-carton/style/size quantities, so swapped or repeated cells cannot hide behind a shared document total.

## Regression and browser verification

These results record the verification state at the end of Phase 3D. The subsequent completed automated checks and browser responsiveness verification are recorded in the Phase 3E report linked above.

- Final ERVE/shared-matrix focused run: **83 tests passed in 10 files**, with `ERVE_PDF_STRESS=1`, after retaining the outer matrix View. This includes all requested heavy rendered datasets and null/zero/missing presentation.
- Sequential fulfillment/shared-PDF/Job Order regression run: **671 tests passed in 95 files**. It exercised Factory Packing List, Factory Packing Queue, Dispatch Order, other fulfillment PDFs and the shared PDF framework. This broad run preceded the final refinement that retained the outer matrix View; the final 83-test run revalidated its affected opt-in path.
- Root `pnpm test`: **56 client tests passed in four files**.
- Root `pnpm typecheck`, `pnpm lint`, and `pnpm build`: all **exit 0**. Root lint reported three existing hook-dependency warnings in `packages/primitives/src/components/date-picker.tsx`.
- After the final Phase 3D code refinement, web `typecheck`, `lint`, and production `build` were rerun sequentially and all **exited 0**. That Phase 3D production build warned about large chunks; its ERVE generator lazy chunk was approximately 426 kB / 178 kB gzip, separate from the existing React-PDF chunk. These bundle-size measurements precede the Phase 3E worker extraction.
- `git diff --check`: passed. Existing-change integrity comparison: seven pre-existing file diffs unchanged; the eighth, the ERVE document, intentionally extended.

The attempted entire web suite in Phase 3D did **not** complete. It reported a worker-termination timeout for `ManagementDashboardPage.test.tsx` and a timeout in `JobOrderListDocument.test.tsx` → `renders many rows spanning multiple API and PDF pages without throwing`, while other checks were also running. The task-owned full-suite process tree was stopped and required regression checks were run sequentially. The Job Order test passed in the 671-test regression run. An isolated dashboard rerun passed **six tests** and exited 0, while repeating its worker-termination warning. This historical Phase 3D result does not claim a clean full-web-suite run or classify the warning as fixed at that stage; Phase 3E subsequently completed the suite and corrected the dashboard test lifecycle.

Reproduction (PowerShell, from repository root):

```powershell
$env:ERVE_PDF_STRESS='1'
pnpm --filter @erve/web exec vitest run src/pages/fulfillment/pdf/erve-packing-list src/lib/pdf/core/PdfStyleSizeMatrix --maxWorkers=1
pnpm --filter @erve/web exec vitest run src/pages/fulfillment src/lib/pdf src/pages/job-orders/pdf/JobOrderListDocument.test.tsx --maxWorkers=1
pnpm --filter @erve/web typecheck
pnpm --filter @erve/web lint
pnpm --filter @erve/web build
```

Final focused log: `.artifacts/iss023-phase3d/final-focused.log`; broader regression log: `fulfillment-tests.log`; final web checks: `final-typecheck.log`, `final-lint.log`, `final-build.log`; workspace checks: `root-typecheck.log`, `lint.log`, `build.log`, `root-tests.log`. Exit status files are retained beside them.

The existing safe application server is on `localhost:5173`; its API is development mode on port 4000 with a loopback `erve_docs` database. No business data or schema changes were made. A development administrator opened the real ERVE detail page and used its existing Download and Print buttons.

The actual browser download opens normally in Chrome's PDF viewer, displaying two pages. PDF parsing reconciled both live API cartons, their six carton/summary cells, six column totals, all row/grand totals, factory/DO references, one summary and correct page numbers. Geometry checks passed. Evidence is under `.artifacts/iss023-phase3d/browser-*`, including source snapshot, downloaded PDF, parsed text, validation JSON and viewer screenshot.

Print generated a PDF and loaded the existing 1000×1000 PDF iframe without an application generation error. **Native print preview is unverified**: the connected test Chrome is headless. Automatic approval review rejected launching a separate Chrome for native-preview verification with “blocked by policy.” No print-dialog submission was made.

The final real download action completed in approximately 0.918s after warm loading. Three additional browser generations of synthetic 12 × 15 × 10 completed in 6.900s, 4.860s and 4.796s under concurrent verification load; these are smoke results, not clean benchmarks. A 50ms timer observed maximum gaps of 4.289s, 2.963s and 3.161s. Heap snapshots were approximately 110 MB before, then 157/165/202 MB across runs, falling to 77 MB after an explicit DevTools garbage collection. This establishes transient allocation/reclamation in this smoke run, not peak memory, autonomous GC timing or long-session stability. These Phase 3D runs showed noticeable main-thread pauses. Moving rendering to a worker was not part of the approved Phase 3C pipeline and was not implemented in Phase 3D; it was subsequently implemented and measured in Phase 3E.

## Limits and review

No inexpensive, reliable browser runtime text/geometry reconciliation was established. Production checks batch validity/parseability and propagates errors, but does not parse every rendered cell. Regression parsing gives evidence within the tested envelope, not a universal completeness guarantee.

An individual atomic style row with pathological text height greater than a printable page is not qualified. The large single-carton test demonstrates many-row pagination, not arbitrarily tall rows. Very long identity/destination blocks, enormous quantities/labels, arbitrarily large summaries, and substantially larger documents also need qualification. Batch starts can add blank space/pages and merged resources can increase file size. The final merged PDF and view model must still fit in browser memory.

An independent read-only code review found no Critical or Important implementation defects. Its conditional minor suggestion was to retain the exact heterogeneous reproducer; the permanent 20 × 5 × 6 fixture is that exact reproducer (unique provenance and quantities, with uniform per-carton row counts).

Phase 3D made no changes to web Create/Detail pages, API contracts, quantity calculations, carton membership, lifecycle, RBAC, DEMO-020 view-model redaction, or Factory Packing Queue implementation. Earlier-phase Create/Detail Style × Size presentation changes were already present on entry and remain part of the combined Phase 3 PR. Shared PDF consumers use the unchanged default matrix branch.

Phase 3D Git snapshot: branch `feature/iss-023-p2-operational-style-size`. Eight pre-existing modified files were recorded in `.artifacts/iss023-phase3d/pre-existing.patch`; seven remained byte-equivalent at the diff level and the ERVE document was intentionally extended. Phase 3D changes were left uncommitted and unpushed for review. The subsequent Phase 3E report records the combined working-tree state.
