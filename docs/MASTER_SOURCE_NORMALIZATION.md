# Historical master source normalization

Run `pnpm --filter @erve/api master-data:normalize-sources --source-root <historical-directory> --audit-root <verified-audit-directory> --output-root <external-output-directory>`.
Optional `--corrections <reviewed.json>` and `--season-mapping <verified.json>` preserve reviewed decisions separately from immutable source evidence. Outputs must remain outside Git checkouts and source/audit directories. This command does not connect to a database or import transactions.

Every business table has a CSV and an XLSX companion. Select its explicitly named worksheet when importing XLSX. `styles.xlsx` uses `Styles` and preserves physical image ownership. Normalization produces candidates; unresolved purchase modes, financial years, prices, parents and images require review before commercial loading.

CSV values are unchanged. Rows containing a spreadsheet formula prefix are held out of CSV and recorded as `CSV_FORMULA_RISK`; use the XLSX companion to retain exact literal cell values. XLSX string cells are written as text, never formulas. No apostrophe prefixes are introduced into business values.

Excel limits cell text to 32,767 characters. Larger evidence values are represented by a JSON reference containing a SHA-256 and `reports/oversized-cell-values.json`. That report preserves each complete value under its checksum. `reports/exceptions.json` also retains complete exception evidence. Consumers must preserve the referenced reports with the source manifest.

Reviewed field corrections bind to source checksum, worksheet, physical row, stable source key and previous value. Identity/reference-changing field corrections are refused when they would invalidate related generated records: Factory Name; Distributor Name/GSTIN; Style Number/LMIX/Season/Business Style/Size Codes/Barcodes/Factory mappings; Store parent Name/GSTIN. These require coordinated source re-normalization. Display names, commercial prices, explicit modes, addresses and contacts remain eligible where supported by that entity.

Actual-source acceptance on 14 October 2026 extracted 105 files, 107 Styles, 642 barcode rows, 4 Factory candidates, 18 Distributor candidates, 32 Store candidates and 91 verified images. These are extraction counts, not successful imports. The 1,823 exceptions include 1,722 cached workbook errors, two summary Store-count conflicts, 18 missing Distributor modes, 32 unresolved Store parent modes and four MRP conflicts. Customer records and full reports remain in the external artifacts directory.

The PR6 Style text/image readers parsed all 107 rows and 91 image-owning rows from the real generated workbook with no image ambiguity. Four MRP fields and fifteen Financial Year fields remain blank for review. Business importer persistence and rebuild/browser acceptance belong to the subsequent PRs.
