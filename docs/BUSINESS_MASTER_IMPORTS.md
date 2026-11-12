# Business master imports

Factories, Distributors, Retail Stores, Seasons, Sizes and HSNs use the same create-only planner and executor for authenticated HTTP uploads and technical orchestration. Only an active ADMIN or MERCHANDISER can preview, execute, download templates/exceptions or inspect history (HSN imports also allow an ACCOUNTANT). The executor checks live authorization again inside each logical record transaction.

The `/master-imports/:kind` API accepts `factories`, `distributors`, `retail-stores`, `seasons`, `sizes` and `hsns`. GET `template` downloads an XLSX template. POST `worksheets`, `preflight`, `exceptions` and `execute` accept multipart field `file`; XLSX requires an explicit `worksheet`. Execute additionally requires the preview's `confirmationToken`. GET `history`, `history/:runId` and `history/:runId/exceptions` expose recorded outcomes and correction-ready downloads.

CSV and XLSX uploads are limited to 25 MB, 10,000 data rows and 64 columns. Physical row numbers, original headers and source values survive validation. Cached Excel errors remain exceptions even when every cell in a row is an error. Templates and exception downloads contain literal text cells, including values that resemble formulas. Oversized evidence remains in run JSON; XLSX exports point to that detail because Excel limits text-cell length.

Preview writes no master, code counter, audit, history or source mapping. Its signed confirmation binds actor, content checksum, worksheet and the original CREATE rows for 15 minutes. A previously skipped record becoming eligible for creation requires another preview. An originally approved CREATE becoming an exact SKIP remains safe for retries. Input changes cannot reuse the confirmation.

Valid independent rows continue while other rows are REJECTED, NEEDS_REVIEW or FAILED. Each new master, generated code, audit, source mapping and successful row result commits in one transaction through the existing domain create service. Duplicate checks run again under the allocator transaction lock. Exact existing masters are never updated; their source binding and skip result commit together after locking and rechecking the record. One business identity has one authoritative source key; another supplied key requires review. A bound key cannot silently create a different master.

Distributor Purchase Mode must be explicitly OUTRIGHT or SALE_RETURN. Missing classifications remain NEEDS_REVIEW. Store parent matching requires exactly one active Distributor matching the supplied name/GSTIN and optional Purchase Mode. Store identity includes its parent and full address, so equal names at different addresses remain independent.

Migration `20261014000000_business_master_imports` adds run, row-result and source-mapping tables. It does not change existing master identities or import historical transactions.

Actual canonical historical-source acceptance on a verified, newly created local disposable database produced four Factories, zero Distributors and zero Retail Stores. The identical rerun skipped all four Factories without allocating another code. Distributor results were 16 NEEDS_REVIEW and two REJECTED; Store results were 28 NEEDS_REVIEW and four REJECTED. Missing classifications/parents and invalid supplied values remain customer correction work, not fabricated commercial data. Customer artifacts and source reports stay outside this repository.

## Current templates (verified 2026-11-12 on `77111c4`)

Download the template from the screen or `GET /master-imports/:kind/template` each time; do not reuse an older generated file.

| Kind | Worksheet | Columns |
| --- | --- | --- |
| seasons | Seasons | Season Code, Season Name, Barcode Serial, Status |
| sizes | Sizes | Size Code, Size Label, Size Type, Sort Order, Status |
| hsns | HSNs | HSN Code, Description, Status, GST Rule Set Code |
| factories | Factories | Name, Address Line 1, Address Line 2, City, State, Country, Postal Code, Contact Person, Phone, Email |
| distributors | Distributors | Name, GSTIN, Purchase Mode, then the same address and contact columns |
| retail-stores | Retail stores | Distributor Name, Distributor GSTIN, Distributor Purchase Mode, Name, address and contact columns, GSTIN |
| styles (`/styles/bulk-import/template`) | Styles | Style Number, Style Name, Final MRP, Season Code, Size Codes, LMIX Number, HSN Code, Barcodes, Factory Name Mappings, Factory Mappings, Description, Category, IP Name, Licensor, Colour, Royalty % |

Every template carries an Instructions worksheet. Season has no Financial Year column. Older files with `Financial Year`, `Source Key` or `Source Provenance` columns, or without `Country`, were built for earlier contracts and must be rebuilt.

Retail Store required fields are Name, Address Line 1, City, State and Postal Code. Put only the street in Address Line 1 and the town, state and PIN in their own columns; the full postal address in one field displays badly on delivery documents.

AW26 acceptance (disposable database, 2026-11-12): all six masters and 11 Styles with images imported, the rerun skipped every record, a Distributor file without Purchase Mode held all 12 rows for review, and Styles with a blank Final MRP were rejected. See [AW26 verification](implementation/aw26-post-dispatch-verification.md).
