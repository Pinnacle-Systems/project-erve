# Walkthrough B: invoice and packing document presentation

Approved scope: ISS-037, ISS-064–070, ISS-076, ISS-077, targeted DEMO-003; preserve ISS-053. Branch `fix/walkthrough-b-document-presentation`, baseline `9e0401d16413b07845e314fbea80a77179a94095`.

## Changes

- Tax Invoice: issued number/date first in details; independently centered title and separate repeated identity line; S.No. per existing displayed financial group; Size/Qty widened from 18% to 24%; comma separators; vertical saved-value totals; E.&O.E. and “No signature required” directly after the existing system-generated note. The existing Authorised Signatory area remains. Long identity/colour/Size fallbacks, archived images, fixed header/column headings and cancellation presentation remain.
- Compact rows use 26pt square image bounds with contain fitting, 2pt vertical padding and compact total-row padding. Nine illustrated Styles still fit A4 portrait. Measured nine-Style row spacing is 32.1pt; the initial 32pt-image implementation measured 38.5pt. The two-Style/six-age-label fixture measures 50.1pt between Style headings, below the previously recorded 102.5pt baseline. Exact labels, punctuation and quantities are retained; continuation details receive no extra serials.
- EIPL list and detail page identity and list PDF prefer the stored destination label, with the existing city/state fallback. Full detail addresses remain. Both PDF view models use exactly **Erve Consolidated Packing List**.
- Packing Audit carton export resolves distinct Style images through shared authenticated `/styles/:styleId/images/:imageId/content` image infrastructure before rendering, keys images by Style UUID, and supplies the shared missing-image placeholder to the existing matrix. Audit history, grouping and quantity associations are unchanged.
- Existing ISS-053 EIPL resolver/worker preparation and image rendering are unchanged. No shared PDF core, Factory Invoice, financial grouping/calculation, saved snapshot/label, numbering, quantity, database or schema changes.

Changed tests cover serial sequencing through 3+ pages and flowing details, centered heading versus a long invoice number, vertical saved totals, declarations, Packing Audit image resolution/deduplication/fallback, actual portrait/landscape image paint operations and quantity preservation. Existing EIPL tests retain image, redaction and pagination coverage; expected heading text is updated. Prettier formats changed files.

## Local verification

- `pnpm install --offline --frozen-lockfile`: passed, all 829 packages reused. A prematurely invoked pnpm test command started another automatic install; that second process was stopped, and tests then used the installed Node entry points directly.
- `node node_modules/vitest/vitest.mjs run src/pages/fulfillment/pdf/tax-invoice src/pages/fulfillment/pdf/erve-packing-list src/pages/fulfillment/pdf/packing-audit --maxWorkers=1` from `apps/web`: **177 passed / 179**, 21 files. Only unchanged large-list EIPL/Audit smoke tests exceeded their existing 8s/10s timers under host contention.
- Isolated rerun of those two tests with `--maxWorkers=1 -t 'renders many rows'`: **2 passed**, 2 files; no timeout or assertion relaxation. The entire 179-test set therefore passed across the suite and isolated rerun; the single aggregate run was not fully green.
- Final targeted serial/long-heading tests: **2 passed**. Garment-image visual generation: **1 passed**.
- Web `tsc --noEmit`, `eslint .`, and production `vite build`: passed. Build reports existing bundle-size/plugin-timing warnings. An initial new test type error (nullable issued number captured by callback) and an ignored browser-fixture lint error were corrected before these final checks.
- Initial RED observations: nine-Style invoice became two pages after stacking totals; compact padding/image bounds restored the existing one-page test. A new serial test initially selected an HSN code as a serial; its coordinate/text selector was corrected. Initial parallel test execution also hit fixed render timeouts; final tests were bounded to one worker.
- No database tests/writes or migrations, CI/status/log queries, merge, deployment or final independent PR review were performed. Self-review only.

## Actual PDF/browser evidence

Evidence is ignored, local to this owned worktree; no historical transaction/legal text was copied into fixtures. Paths below are relative to the worktree root.

- `.artifacts/walkthrough-b/tax/`: generated PDF + parsed coordinate JSON + page PNGs for one-page reference, two-Style, nine-Style with nine images, intra/inter/unresolved GST, cancellation, long identities, long Size lists and multipage cases. `three-pages.pdf` exercises 28 financial groups including flowing identity details; serials are sequential without continuation numbering. Tests verify A4 bounds, text/image coordinates, absence of overlap, preserved values/labels and aspect ratios. Node tests confirm fixed Tax Invoice header and column headings across pages.
- `.artifacts/walkthrough-b/garment-tax/`: actual garment imagery copied only from the image content of historical Inv-103.pdf into otherwise synthetic invoices. Visual inspection of `reference-page-1.png` confirms an identifiable garment silhouette, colour and graphic at 26pt with no crop/stretch. Fine artwork remains small at this 9.2mm thumbnail size; this is a density/legibility tradeoff for independent review. Original image bytes/resolution remain governed by the existing archived-image infrastructure.
- `apps/web/.artifacts/walkthrough-b/audit/images.pdf` and its page PNG: actual PDF shows portrait and landscape Style images, shared placeholder, quantities 7/11/12 and total30. Operator assertions verify the two distinct natural image dimensions and one image per Style row; no image paints for the placeholder.
- `.artifacts/walkthrough-b/browser2/`: synthetic, GET-only Chrome acceptance, list/detail screenshots, `acceptance.json` with authenticated image requests and no console errors, and two actual downloaded PDFs in `downloads/`. Both pages display the stored long retail name; detail retains the full address. Downloaded PDFs show the exact heading, retained matrix imagery/placeholder/quantities and no factory/dispatch provenance on the external detail PDF. The browser fixture rejects every write and never reaches a real API/database. The first physical CDP detail click did not trigger export; explicit DOM click did, and both downloaded PDFs were parsed/rendered for inspection.
- `.artifacts/walkthrough-b/historical/`: rendered external layout references `Inv - 271.pdf` and available `Inv-103.pdf`. Their centered headings, invoice-number-first details, serial table, compact Size entries, vertical totals and footer informed presentation only. **The exact requested `Inv-103(3).pdf` was not found**; the available103 is a substitute reference.

Visual inspection included single-page invoice, multi-page invoice with continuation header/columns, long saved fields, vertical totals/declarations, the Packing Audit image matrix, and both actual browser EIPL PDF downloads.

## Limitations for independent review

The browser EIPL detail download is two pages in this synthetic case. Its continuation matrix column heading repeats, but the document logo/title does not appear on page2. Node EIPL fidelity tests assert repeated document headings and pass. No EIPL document/core/worker rendering code changed in this PR, so this browser-versus-Node discrepancy is recorded rather than expanded into a pagination-infrastructure change. Browser evidence is synthetic and does not establish production-data acceptance. No print-dialog acceptance was performed; Print/Download retain the shared generation functions.

The 26pt Tax Invoice thumbnail density tradeoff, missing exact historical reference, browser continuation header discrepancy, and aggregate-suite timeout observations require candid handoff; this implementation does not claim issue acceptance or closure. No shared-file overlap with PR-A or PR-C is expected; no migration or integration ordering dependency.
