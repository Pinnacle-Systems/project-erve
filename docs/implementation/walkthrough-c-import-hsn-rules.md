# PR-C — ISS-071 and ISS-073

Scope: generic master-import template guidance and optional HSN GST Rule Set association. Baseline: 9e0401d16413b07845e314fbea80a77179a94095. Branch: fix/walkthrough-c-import-hsn-rules.

## Behavior

All six generic master templates retain an empty data worksheet and now include an Instructions worksheet containing field guidance and examples. The worksheet list excludes Instructions, explicit selection is rejected by the parser, and the generated instruction marker prevents a renamed sheet or its CSV export from becoming records. Existing Style template instructions are unchanged. Legacy CSV/XLSX headers and explicit source-key/provenance support remain accepted.

HSN templates include optional `GST Rule Set Code`. Blank or absent values preserve legacy behavior and never clear an existing assignment. Nonblank codes resolve against existing rule sets using normalized text; missing, inactive or ambiguous codes produce row errors. Normalized-code ambiguity is rejected even when one conflicting record is inactive; the importer does not guess an association. Assignment requires ADMIN or ACCOUNTANT during preview and execution. The existing HSN creation service persists the resolved ID and audit metadata. Execution repeats planning, retains signed checksum/fingerprint confirmation, and revalidates the current actor and rule reference within the creation or existing-record transaction. Existing HSN differences remain review cases; no automatic updates occur.

## Safety and validation

Tests use only the freshly created `erve-walk-c-pg` disposable database `erve_walk_c_test` on loopback port 55460. Its identity was checked before committed migrations were initialized. No existing database, migration dataset or deployed environment is used. No schema or migration changes are included.

Regression coverage includes each template, legacy inputs, instruction-sheet exclusion and renamed/CSV instructions, leading-zero HSN codes, finance role restrictions, active/missing/inactive/ambiguous rule references, preview-to-execute changes, transaction rollback on authority/reference changes, audit, retry, existing HSN assignment preservation, and existing importer/API/HSN edit behavior.

Initial regression failures were observed before implementation: seven parser cases, one Instructions selector case and three HSN association/authorization/reference cases. Current completed checks:

- Generic/reference parser tests: 23 passed (`.artifacts/parser-final.txt`).
- Importer/reference service, importer API routes and HSN API: 65 passed (`.artifacts/api-tests.txt`).
- Import UI and HSN registered navigation/edit hydration: 37 passed (`.artifacts/web-final.txt`), including full row-error text wrapping.
- Final reference-service regression run: 27 passed (`.artifacts/reference-final.txt`), including execute-time authority/reference changes and transaction rollback.
- API and web typecheck, lint and production build completed without diagnostics (`.artifacts/api-typecheck-final.txt`, `.artifacts/api-lint.txt`, `.artifacts/api-build.txt`, `.artifacts/web-typecheck.txt`, `.artifacts/web-lint.txt`, `.artifacts/web-build.txt`).
- `git diff --check` reported no whitespace errors.

Headless Chrome acceptance passed all 12 assertions at 1440, 1280 and 1024 CSS-pixel widths, including Instructions exclusion, readable full row errors, retry state, HSN edit-assignment preservation and finance permission behavior. Evidence: `C:/Users/kalay/workspace/project-erve-artifacts/walkthrough-20261026/pr-c-browser/run-1792998078211/assertions.json`. The console error list is empty; the only recorded network miss is the local favicon (404). This browser run uses synthetic API responses, supplements the real-database API tests and does not exercise a deployed application.

## Boundaries

ISS-072, GST formula rules, historical snapshots, migrations, production data and unrelated workflows remain outside scope. No CI queries/logs, final independent review, merge or deployment were performed. Final independent review belongs to the user.
