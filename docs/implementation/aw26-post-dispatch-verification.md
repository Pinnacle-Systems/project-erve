# AW26 post-dispatch technical verification (Batch 4)

Base: `origin/main` at `77111c4` (PR #217). Date: 2026-11-12. Engineering companion to [the UAT guide](../AW26_POST_DISPATCH_UAT_GUIDE.md). No customer data, screenshots or credentials are in this repository; the working folder lives outside Git.

## What was run

1. Current templates fetched live: `GET /master-imports/{seasons,sizes,hsns,factories,distributors,retail-stores}/template` and `GET /styles/bulk-import/template`. Business-master importer version `business-master-import-v1`. Every template now has an Instructions worksheet; older generated files are not valid input (no `Financial Year` on Seasons, `Country` added to addresses, `Royalty %` added to Styles, no `Source Key`/`Source Provenance` columns).
2. Fresh AW26 import-ready workbooks built from the original sources into those templates (`tools/aw26-post-dispatch-verification`).
3. Preflight and execute through the real HTTP importers against a new disposable PostgreSQL 16 (`erve_rebuild_aw26b4_test`), then a full rerun.
4. Operational chain driven over HTTP: Order Sheet, Job Order, production, Final QA release, Dispatch Order, packing, audit, Factory Packing List, Erve Packing List, Erve Dispatch, LR, QR evidence, Distributor receipt, reconciliation, Retail Store Inventory, store FIFO sales and returns, Factory Invoice, Tax Invoice draft.
5. Browser pass through raw Chrome DevTools Protocol (no browser framework), PDF downloads rendered and text-checked.

## Source decisions

| Topic                 | Decision                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AW26 Styles           | 15 in the Dashboard, the 2026-10-25 reconciled file and the 2026-10-15 package; all three agree. 11 imported, 4 held (Dashboard MRP differs from the issued Tax Invoice; evidence favours the invoice, master MRP is a business decision). |
| Native sizes          | 3-8 for six Styles and 9-14 for nine; matched against the legacy barcode workbook.                                                                                                                                                         |
| Season Barcode Serial | 3, evidenced by every real AW26 barcode starting with 3.                                                                                                                                                                                   |
| Factory               | Rahaa (all 15 Styles). Mass Knit loaded only as a second Factory for scoping tests.                                                                                                                                                        |
| Distributors          | 12 named in the AW26 dispatch workbook; GSTIN and address cross-checked against the sales registers. One duplicate name spelling rejected.                                                                                                 |
| Purchase Mode         | In no source. Faithful file leaves it blank (12 NEEDS_REVIEW). A TEST ONLY overlay reuses the earlier explicit test assignment (2 Outright, 10 Sale-or-Return).                                                                            |
| Retail Stores         | 32 named stores exist (2 Distributors). 30 imported, 2 queued for review (city spelling differs from address text). One TEST ONLY placeholder added for the Outright Distributor.                                                          |

## Import results

| Master                       | Preflight                         | Execute           | Rerun      |
| ---------------------------- | --------------------------------- | ----------------- | ---------- |
| Season                       | 1 create                          | 1                 | 1 skipped  |
| Size                         | 12 create                         | 12                | 12 skipped |
| HSN                          | 2 create                          | 2                 | 2 skipped  |
| Factory                      | 2 create                          | 2                 | 2 skipped  |
| Distributor (faithful)       | 12 needs review                   | none              | n/a        |
| Distributor (TEST ONLY mode) | 12 create                         | 12                | 12 skipped |
| Retail Store                 | 30 create                         | 30 (+1 TEST ONLY) | 31 skipped |
| Style                        | 11 create, 4 rejected (blank MRP) | 11 completed      | 11 skipped |

Independent database comparison against the sources: 112 of 112 checks pass (Season, Style MRP, size sets, factory price, images byte-equal to the Dashboard, structured addresses, Store GSTIN kept, no non-breaking spaces).

## Quantity views (Style B)

The run keeps three different quantity views apart. They overlap and must not be added together.

| Dispatch     | Shipped | Distributor-attested | Ledger in use | Note                                                                                                 |
| ------------ | ------: | -------------------: | ------------: | ---------------------------------------------------------------------------------------------------- |
| 1 (Store V1) |      12 |                   11 |            11 | Size 9: 1 of 2 received, remark recorded                                                             |
| 4 (Store G1) |      18 |                   17 |            18 | Merchandiser confirmed 18 first; the later receipt of 17 is evidence only (`EVIDENCE_ONLY_EXISTING`) |
| 5 (Store G2) |      12 |         Not recorded |     No ledger | QR evidence only; 12 awaiting receipt evidence                                                       |
| **Total**    |  **42** |               **28** |        **29** | Ledger total counts Dispatch 5 as 0 contribution                                                     |

- 42 shipped = 28 attested + 2 short + 12 awaiting. 29 ledger = 11 + 18.
- The 1-piece difference (28 vs 29) is the Dispatch 4 discrepancy: the earlier ledger is preserved and the difference is recorded, not silently changed.
- Missing evidence (null in the API, "Not recorded" / "n/r" on screen) is distinct from a recorded zero receipt, which this run did not include.
- Style A: 42 produced, shipped, attested and in the ledger.
- The earlier matrix scenario text CONS-2 describes 29 as "ledger received ... 42 - 1 short - 12 awaiting"; the table above is the correct description (the check itself, ledger sum 29, is unchanged).

## Verification matrix

108 pass, 2 fail, 2 blocked (browser and API combined). The failures are the two PDF defects D1 and D2 below. The two blocked rows are Tax Invoice finalization (no HSN, D3) and the Tax Invoice draft PDF, which was not verified.

## Defects and observations

| ID  | Severity   | Finding                                                                                                                                                                                             |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Low        | Factory Packing List PDF prints the Store address without the postal code; the other documents include it.                                                                                          |
| D2  | Low        | Long address words are hyphenated mid-word on the carton label and Erve Dispatch PDF ("Ra-jasthan").                                                                                                |
| D3  | Data       | Tax Invoice finalization is refused (`HSN_NOT_ASSIGNED`): only one importable AW26 Style has an evidenced HSN. Master-data dependency, not a confirmed code defect. The draft PDF was not verified. |
| D4  | Decision   | The system generates Season 3+ barcodes (`3 <LMIX><2-digit size>`); the legacy workbook has the older concatenated form.                                                                            |
| D5  | Limitation | The importer cannot see semantic problems (city spelled two ways); the two queued Stores preflight as CREATE. Human review is the control.                                                          |

Authorization and confidentiality checks (Factory and QA see no Distributor; Distributor sees no Factory; cross-Distributor, cross-Factory, Transporter, Senior Management, Style image access, QR public data) all passed.

## Behaviour worth knowing

- The business date is IST. A receipt made after 18:30 UTC is dated the next day, so a sale reported with the UTC date is refused as "received after the date".
- QR confirmation needs `deliveredAt` as local time with offset matching `offsetMinutes` and `timezone`.
- QR public origin must be HTTPS; the test run substitutes the local host when opening a link.
- A Dispatch Order line is per size; carton lines name the size line, so equal splits are enforced upstream.

## Reproduce

See `tools/aw26-post-dispatch-verification/README.md`.

## Open findings (none resolved by this PR)

- **D1:** Factory Packing List PDF omits the Store postal code.
- **D2:** Carton Label and Erve Dispatch PDFs split some address words mid-word.
- **D3:** Tax Invoice finalization blocked by missing Style HSN evidence (master-data dependency, not a confirmed code defect). The Tax Invoice draft PDF was not verified.
- **D4:** Legacy AW26 barcodes differ from the current generation format.
- Four Styles held back (conflicting MRP evidence).
- Two Retail Stores held back pending address/city clarification.
- Purchase Modes and prices used in the operational scenarios are TEST ONLY.
- Store masters for ten Distributors are not in the supplied sources.
