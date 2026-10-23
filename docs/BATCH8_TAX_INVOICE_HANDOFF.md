# Batch 8 Tax Invoice presentation handoff

Base: `origin/main` at `3b2406cc0946d6e2614795b7173d10e002629c3c` (fresh fetch at implementation start).
Branch: `fix/batch8-tax-invoice-presentation`.
Remote recheck before handoff: main advanced to `88f0e2f005d4181edbde6d7a003dfda9072bc75d` through PR #162. Only four user-mapping files changed; no Tax Invoice overlap. Batch 8 retains its original isolated base.

Isolated worktree: `C:/Users/kalay/workspace/erve-batch8-tax-invoice`.

## Final scope

- ISS-026: compact `Source lines (N)` link-style button inside the Style cell; remove the separate Review column. Preserve the expanded source grid, individual override callback, reason/actor/time, mutation payloads, history and role/status gates. Unique region ID and Style-specific accessible names.
- ISS-030: a pure shared selector chooses component labels/fields from backend response treatment. Carry treatment unchanged into the PDF model; select PDF totals and HSN columns. INTRA displays CGST/SGST, INTER displays IGST, unresolved displays an unavailable notice. Applicable zero remains visible; missing amounts remain unavailable. No component rate/amount calculation added.
- ISS-031: verification only. Existing draft heading, explicit unallocated number, source packing-list labels, issued/cancelled EI identity and draft PDF rejection remain unchanged.
- ISS-037: aligned Image/Style/Size/Qty/HSN-GST/MRP/Rate/Taxable columns; 32-point contained thumbnail in every group. Long identity, multiline identity/colour/Sizes and large Size collections flow at full width without duplicate financial entries. Last ordinary Style stays with totals.

The user's later explicit instruction, after supplying the current `Inv-103.pdf`, was to use **Style name instead of description** and prioritize an image on every Style line. This supersedes the initial description-retention requirement. The description remains unchanged in data/model; PDF rendering intentionally omits it. Style code, name, colour and Size quantities remain. Existing missing-image fallback remains for unavailable archives; no current-master lookup or fabricated replacement image was introduced.

No API, schema, financial computation, numbering, grouping, override dialog/payload, image preparation/ownership or shared pagination production code changed. No database access, migration, deployment, issue update or merge.

## Changed files

Production (relative to `apps/web/src/pages/fulfillment/`):

- `TaxInvoiceLines.tsx`
- `TaxInvoiceTotals.tsx`
- `tax-invoice-gst-presentation.ts` (new)
- `pdf/tax-invoice/buildTaxInvoiceViewModel.ts`
- `pdf/tax-invoice/TaxInvoiceDocument.tsx`

Tests:

- `TaxInvoiceDetailPage.test.tsx`
- `TaxInvoiceLines.test.tsx`
- `TaxInvoiceTotals.test.tsx`
- `tax-invoice-gst-presentation.test.ts` (new)
- `pdf/tax-invoice/TaxInvoiceDocument.test.tsx`
- `pdf/tax-invoice/TaxInvoicePresentation.test.tsx` (new)

Documentation: this handoff.

## Focused validation

Run from repository root; no API/database tests are needed for this production diff.

Existing identity baseline: **53 tests passed**, before production changes:

```powershell
pnpm --filter @erve/web exec vitest run src/pages/fulfillment/TaxInvoiceDetailPage.test.tsx src/pages/fulfillment/TaxInvoiceListPage.test.tsx src/pages/fulfillment/pdf/tax-invoice/buildTaxInvoiceViewModel.test.ts
```

Final focused regression selection: **119 tests passed across 11 files**:

```powershell
$env:BATCH8_PDF_EVIDENCE_DIR = "$PWD/.artifacts/batch8/after"
pnpm --filter @erve/web exec vitest run src/pages/fulfillment/tax-invoice-gst-presentation.test.ts src/pages/fulfillment/TaxInvoiceTotals.test.tsx src/pages/fulfillment/TaxInvoiceLines.test.tsx src/pages/fulfillment/TaxInvoiceOverrideDialog.test.tsx src/pages/fulfillment/TaxInvoiceDetailPage.test.tsx src/pages/fulfillment/TaxInvoiceListPage.test.tsx src/pages/fulfillment/tax-invoice-line-groups.test.ts src/pages/fulfillment/pdf/tax-invoice/buildTaxInvoiceViewModel.test.ts src/pages/fulfillment/pdf/tax-invoice/prepareTaxInvoicePdfData.test.ts src/pages/fulfillment/pdf/tax-invoice/TaxInvoiceDocument.test.tsx src/pages/fulfillment/pdf/tax-invoice/TaxInvoicePresentation.test.tsx
```

Checks:

```powershell
pnpm --filter @erve/web run typecheck
pnpm --filter @erve/web run lint
pnpm --filter @erve/web run build
```

Typecheck, lint and build passed (exit0); final outcomes are recorded in the PR and local `.artifacts/batch8/check-results.json`. Build retains the existing large-chunk advisory.

Browser evidence used existing `tools/pr8/cdp-driver.mjs` with an ignored temporary synthetic adapter/harness, not a permanent application runner:

```powershell
node .artifacts/batch8/run-browser.mjs
```

Passed 24 combinations: ACCOUNTANT/ADMIN, DRAFT/FINALIZED/CANCELLED, widths 1440/1280/1024/390. Verified correct identity, no viewport overflow, native Enter expansion/Space collapse, region association, read-only statuses, actual override dialog save/reason/actor, and failed-refresh mutation blocking. Zero console errors. Adapter terminates every API request locally; no application database is contacted. Runtime backend authorization was not retested.

Rendered output and comparison:

```powershell
node tools/batch4/render-pdfs.mjs .artifacts/batch8/after
node .artifacts/batch8/compare.mjs
```

These passed. The first is existing repository tooling; the second is retained ignored local evidence tooling. No new dependency was installed for PDF inspection; Python was not used. The legacy Python verifier was not changed because it was not reused.

The baseline was generated from fresh current-main code before layout changes; additional matched cases use ignored copies of the exact same main document/model. Synthetic fixture inputs are deep-equal before/after. PDF.js checks actual extracted page text, bounds, image paint transforms/aspect ratios, complete quantities and overlaps. Evidence records first/last body content and body spans; all page counts are nonincreasing. Actual PNG renders were inspected.

No full local web/API suite was run. Full suites remain GitHub PR CI responsibility. No CI runs were inspected or polled.

## PDF measurements

A4 remains approximately 595.28 x 841.89 points. Row spacing below is measured between adjacent matching Style headings, not a CSS property.

| Matched fixture                           | Before pages | After pages | Before/after row spacing                            |
| ----------------------------------------- | -----------: | ----------: | --------------------------------------------------- |
| 2 ordinary Styles                         |            1 |           1 | 102.50 ->66.10pt (longer age Size labels)           |
| 9 ordinary Styles, missing-image fallback |            2 |           1 | 92.90 ->38.20pt                                     |
| 9 Styles, nine portrait/landscape images  |            2 |           1 | 95.20 ->38.50pt                                     |
| 14 Styles                                 |            3 |           2 | 102.50 ->66.10pt                                    |
| Cancelled 14 Styles                       |            3 |           2 | 102.50 ->66.10pt                                    |
| 360 Sizes                                 |            2 |           2 | Flowing exception; all quantities retained          |
| Long name/code/colour                     |            1 |           1 | Full-width identity/colour fallback                 |
| Long description                          |            2 |           1 | Description omitted per updated instruction         |
| Former description boundary               |            2 |           1 | Description omitted per updated instruction         |
| Missing image reference                   |            1 |           1 | Explicit existing fallback retained                 |
| Mixed imagery, 2 Styles                   |            1 |           1 | 104.80 ->66.10pt                                    |
| INTRA / unresolved references             |       1 each |      1 each | Correct treatment-specific breakdown/unavailability |

Every row has its image cell. The deterministic nine-image test asserts nine image paint operations and preserved source aspect ratios. A separate private preview extracted all nine thumbnails from the supplied reference (plus its logo) and rendered one A4 page. This preview uses synthetic parties/financial fixture data and is not a live issued invoice. Customer source PDF, images and preview remain local and are excluded from Git.

## Regression evidence and review

Tests cover exact input immutability, persisted monetary strings with distinctive values, tax component selection independent of monetary values, zero/missing/unresolved states, mixed HSN bands, cancelled PDFs, grouping/source membership, pending/error states, source callback identity, override reasons/actor/time, list/detail identity, issued-only PDF construction, archive preparation, full Size tokens, body/image bounds and no duplicate financial entries.

Observed expected RED cases before fixes: old prominent disclosure, inapplicable PDF GST columns, repeated per-Style labels, oversized identity clipping, newline-rich identity clipping, last-Style/totals separation, nine-Style two-page output, and newline-rich Size clipping. Corresponding focused cases passed after changes.

An independent whole-branch review found newline-rich identity clipping; a separate review of the newly authorized compact table found newline-rich Size clipping. Both were reproduced with real PDF tests, corrected locally and included in the final focused run. The final Size fix routes multiline Size/colour data through the full-width flowing fallback. No shared pagination infrastructure was modified. No deferred review findings.

Execution decisions: sibling worktree to preserve other work; local evidence retained; focused suites override skill full-suite defaults; character/token thresholds select safe layout only; multiline text always uses flowing detail placement; latest user instruction controls description omission.

## Remaining acceptance

- Customer confirmation of concise appearance and image prominence at actual A4 print size.
- Real archived-image availability and live invoice print/download confirmation in an authorized environment.
- Customer verification of ISS-031; no live numbering allocation/cutover verification claimed.
- GitHub CI/review/merge authorization and issue reconciliation handled separately.

No merge, deployment, Batch 9 work or unrelated worktree cleanup is included.
