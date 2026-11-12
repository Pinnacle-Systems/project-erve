# AW26 post-dispatch verification tooling

Scripts that prepare AW26 test data from the original sources and drive the post-dispatch workflow against a **disposable** database. They contain no customer data. Everything they generate goes to an external workspace (`AW26_WORKSPACE`) and must never be committed.

## Safety

- The API database must have a standalone `test` marker in its name (`requireSafeTestDatabaseUrl`), e.g. `erve_rebuild_aw26_test`. Scripts refuse otherwise.
- `client.mjs` refuses any non-loopback API URL.
- Browser scripts use raw CDP (Node 24 `fetch`/`WebSocket`), a separate Chrome profile, and the existing `tools/pr8/cdp-driver.mjs`.

## Order

1. Start a new PostgreSQL, run `prisma migrate deploy`, then `roles:bootstrap`, `admin:bootstrap`, `financial-year:bootstrap`, `quality:bootstrap` (see `docs/DISPOSABLE_MASTER_REBUILD.md`). Start the API and web servers. Enable QR delivery with an HTTPS origin and a generated key for step 7.
2. Download current templates into `01-current-import-templates/` with `GET /master-imports/:kind/template` and `GET /styles/bulk-import/template`.
3. `python -I extract_aw26_sources.py --sources <dir> --workspace <dir>` (needs `openpyxl`, `pymupdf`): selects AW26 records, reconciles sources, structures addresses, writes reports.
4. `cd apps/api && npx tsx ../../tools/aw26-post-dispatch-verification/build-import-workbooks.mts`: fills the current templates and embeds the Dashboard images.
5. `node import-masters.mjs <preflight|execute> <kind> <file> <label>` for each file in the order Season, Size, HSN, Factory, Distributor, Retail Store, Style. Rerun to prove idempotency.
6. `npx tsx verify-import.mts`: compares the database against the sources.
7. `stage1` to `stage6` (`npx tsx`): production, dispatch, delivery and receipt, reconciliation, inventory and FIFO, security, conservation and invoices. Results append to `matrix.json`.
8. `browser-1` to `browser-4`: screenshots and PDFs through CDP.

Environment: `AW26_WORKSPACE`, `AW26_SOURCES`, `AW26_API` (default `http://127.0.0.1:4080`), `AW26_WEB` (default `http://127.0.0.1:5190`). Fixture accounts get random passwords stored only in the workspace.

TEST ONLY inputs: Distributor Purchase Mode, 50% MRP price lists, the Basics placeholder Store, the seller registration, carrier, vehicle and LR values, carton weights.
