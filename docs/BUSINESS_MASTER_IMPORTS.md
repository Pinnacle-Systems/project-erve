# Business master imports

Factories, Distributors and Retail Stores use the same create-only planner and executor for authenticated HTTP uploads and technical orchestration. Only an active ADMIN or MERCHANDISER can preview, execute, download templates/exceptions or inspect history. The executor checks live authorization again inside each logical record transaction.

The `/master-imports/:kind` API accepts `factories`, `distributors` and `retail-stores`. GET `template` downloads an XLSX template. POST `worksheets`, `preflight`, `exceptions` and `execute` accept multipart field `file`; XLSX requires an explicit `worksheet`. Execute additionally requires the preview's `confirmationToken`. GET `history`, `history/:runId` and `history/:runId/exceptions` expose recorded outcomes and correction-ready downloads.

CSV and XLSX uploads are limited to 25 MB, 10,000 data rows and 64 columns. Physical row numbers, original headers and source values survive validation. Cached Excel errors remain exceptions even when every cell in a row is an error. Templates and exception downloads contain literal text cells, including values that resemble formulas. Oversized evidence remains in run JSON; XLSX exports point to that detail because Excel limits text-cell length.

Preview writes no master, code counter, audit, history or source mapping. Its signed confirmation binds actor, content checksum, worksheet and the original CREATE rows for 15 minutes. A previously skipped record becoming eligible for creation requires another preview. An originally approved CREATE becoming an exact SKIP remains safe for retries. Input changes cannot reuse the confirmation.

Valid independent rows continue while other rows are REJECTED, NEEDS_REVIEW or FAILED. Each new master, generated code, audit, source mapping and successful row result commits in one transaction through the existing domain create service. Duplicate checks run again under the allocator transaction lock. Exact existing masters are never updated; their source binding and skip result commit together after locking and rechecking the record. One business identity has one authoritative source key; another supplied key requires review. A bound key cannot silently create a different master.

Distributor Purchase Mode must be explicitly OUTRIGHT or SALE_RETURN. Missing classifications remain NEEDS_REVIEW. Store parent matching requires exactly one active Distributor matching the supplied name/GSTIN and optional Purchase Mode. Store identity includes its parent and full address, so equal names at different addresses remain independent.

Migration `20261014000000_business_master_imports` adds run, row-result and source-mapping tables. It does not change existing master identities or import historical transactions.

Actual canonical historical-source acceptance on a verified, newly created local disposable database produced four Factories, zero Distributors and zero Retail Stores. The identical rerun skipped all four Factories without allocating another code. Distributor results were 16 NEEDS_REVIEW and two REJECTED; Store results were 28 NEEDS_REVIEW and four REJECTED. Missing classifications/parents and invalid supplied values remain customer correction work, not fabricated commercial data. Customer artifacts and source reports stay outside this repository.
