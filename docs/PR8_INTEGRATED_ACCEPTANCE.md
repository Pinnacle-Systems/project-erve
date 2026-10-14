# PR8 integrated acceptance

PR8 uses the PR7 disposable rebuild service and the application's authenticated workflows. All generated evidence, customer-derived rows, media, private credentials and browser profiles stay outside Git. No production or `erve_docs` target is allowed. The historical source and approved correction overlays are read-only.

The reusable browser tooling is `tools/pr8/cdp-driver.mjs`, using Node 24's native WebSocket and standard CDP commands. No browser framework or new dependency is required. Browser scripts select a dedicated tab, use React's native value setter, upload through `DOM.setFileInputFiles`, dispatch actual mouse events, poll observable states, and produce actual PNGs with metadata, assertions, console exceptions and sanitized network results. The test endpoint must already be authorized, local and loopback-only.

## Reproduce

Use an isolated branch/worktree containing the integrated PR7 implementation, Node 24, existing pnpm dependencies and installed Chrome/Edge. Read the source manifest and construct an external `source-config.json` from a verified PR7 configuration. It must identify the original canonical source, its manifest SHA-256 and the verified local PostgreSQL server address. Never reuse an old configuration's target/output ownership as a fresh target.

The local runner reads the API package's private `.env` to locate the existing local PostgreSQL maintenance endpoint; it does not print credentials. Every setup creates a new random PR8 database name and external report/media ownership. Its external-root guard also protects the main repository when invoked from a linked worktree. Commands below use PowerShell; set `$pr8Run` to a new external run directory containing `source-config.json`.

```powershell
node tools/pr8/local-runner.mjs setup $pr8Run first
node tools/pr8/local-runner.mjs setup $pr8Run second
node tools/pr8/local-runner.mjs setup $pr8Run interruption
node tools/pr8/local-runner.mjs rebuild $pr8Run first
node tools/pr8/local-runner.mjs rebuild $pr8Run second
node tools/pr8/local-runner.mjs rebuild $pr8Run interruption
node tools/pr8/compare-rebuilds.mjs $pr8Run
```

Rebuild acceptance executes migrations, system/bootstrap definitions, reference and shared master imports, Style/image imports, semantic snapshots and exact reruns. Interruption injection follows committed Factory and Style/image stages; recovery must match the independently fresh snapshot. Domain integration tests additionally exercise image failure/recovery and ownership refusals.

Launch the API and frontend in separate terminal sessions:

```powershell
node tools/pr8/local-runner.mjs api $pr8Run
node tools/pr8/local-runner.mjs web $pr8Run
```

These bind the API to `127.0.0.1:4188`, frontend to `127.0.0.1:5188`, frontend API URL to the disposable API, and media to the target-owned external directory. Before using CDP, verify those listeners and the process identities. Launch the installed Chrome with a separate external test profile, `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=9229`, `--no-first-run` and `--start-maximized`. Check port availability first; do not attach to an unknown existing debugging session or the normal browser profile. If launch/debugging is denied, record browser acceptance as BLOCKED without a workaround.

```powershell
node tools/pr8/browser-acceptance.mjs $pr8Run 01
node tools/pr8/local-runner.mjs correction $pr8Run
node tools/pr8/local-runner.mjs corrected-rebuild $pr8Run
node tools/pr8/local-runner.mjs operational $pr8Run
node tools/pr8/browser-acceptance.mjs $pr8Run 02 merchandiser
node tools/pr8/browser-input-integrity.mjs $pr8Run 01
node tools/pr8/browser-milestones.mjs $pr8Run 01
node tools/pr8/browser-responsive.mjs $pr8Run 01
```

Browser run suffixes must be new; screenshot filenames are exclusive to retain previous attempts. The first browser run creates separate `PR8 ENGINEERING ONLY` Factory/Distributor/Store/Style records. Synthetic Purchase Mode, GSTIN and pricing belong only to those synthetic identities. The correction scenario starts with an explicitly synthetic unresolved Distributor, rejects old seals/confirmations, applies a traceable correction, and proves conflicting values require review. Its resealed inputs then run through PR7's full rebuild service.

Operational acceptance uses an imported source Style/Factory and the imported synthetic Distributor/Store. Authorized test users perform Order Sheet → Job Order → factory confirmation → PP Sample/PPM → Cutting/Printing/Sewing/Inline → Finishing/prepared quantities/Final QA → Dispatch Order → carton packing/audit → ERVE Packing List → **unnumbered Tax Invoice Draft**. Production completion follows the actual server's quantity/QA rule. CDP inspects persisted records and interacts with Production/Quality/History/Review tabs; it also verifies role rejection at UI and HTTP boundaries. No invoice finalization is executed.

Successful operational HTTP requests are checkpointed atomically. A request that might have committed before its checkpoint causes a fail-closed refusal on retry: reconcile the preserved target before continuing. This tooling does not promise transparent recovery for arbitrary operational mutations. A prior successful operational report is revalidated against the live draft/numbering state.

## Checks and evidence

Create a fourth, separate regression target; integration suites truncate only that target:

```powershell
node tools/pr8/local-runner.mjs setup $pr8Run regression
node tools/pr8/local-runner.mjs tests $pr8Run regression
node --test tools/pr8/*.test.mjs
pnpm -r typecheck
pnpm -r lint
pnpm -r build
pnpm --filter @erve/web test src/pages/master-data/BusinessMasterImportPage.test.tsx src/pages/master-data/StyleBulkImportPage.test.tsx
node tools/pr8/package-evidence.mjs $pr8Run
```

Each packaging run creates a fresh `$pr8Run/evidence-<timestamp>` directory, identified by `$pr8Run/evidence-latest.json`. The enclosing runtime workspace is not a distributable evidence package. An explicit allowlist excludes password files, private user credentials, browser profiles/cookies and other runtime support files. The package contains Markdown, JSON results, CSV acceptance matrix, actual screenshots and sidecars, downloaded/combined exception workbooks, defect/reconciliation reports and a SHA-256 manifest. Preserve failed attempts with their actual statuses.

PR8's final engineering acceptance requires all seven scenarios, the PR7 dependency merged into main, passing CI on the submitted PR8 commit and no blocking defects. Commercial-data readiness and production-cutover authorization remain separate gates. Passing engineering acceptance never authorizes production deployment or invoice issuance.
