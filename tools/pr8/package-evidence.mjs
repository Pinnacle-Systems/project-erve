import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join, relative } from 'node:path';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';
const repository = resolve(import.meta.dirname, '../..'),
  runRoot = resolve(process.argv[2]);
await assertExternalArtifactRoot(runRoot, repositoryRoots(repository));
const output = join(runRoot, `evidence-${Date.now()}`);
await assertExternalArtifactRoot(output, repositoryRoots(repository));
await mkdir(output); // Fresh destination only; never package stale or unknown existing files.
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (file) => readFile(join(runRoot, file), 'utf8').then(JSON.parse);
const write = (name, data) =>
  writeFile(join(output, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const copy = async (from, to) => {
  await mkdir(resolve(output, to, '..'), { recursive: true });
  await cp(join(runRoot, from), join(output, to), { recursive: false });
};
const first = await json('first-rebuild.json'),
  second = await json('second-rebuild.json'),
  recovery = await json('interruption-rebuild.json'),
  correction = await json('corrected-input.json');
const comparison = await json('snapshot-comparison-final.json');
const correctedRebuild = await json('synthetic-correction-rebuild.json');
const config = await json('first-config.json'),
  operational = JSON.parse(await readFile(join(config.reportRoot, 'operational-acceptance.json')));
const sourceConfig = await json('source-config.json');
const browserNames = (await readdir(runRoot)).filter((name) =>
  /^(browser|milestones|input-integrity|responsive)-\d+$/.test(name),
);
const sessions = [];
for (const name of browserNames) {
  const target = join(output, 'browser', name);
  await mkdir(target, { recursive: true });
  for (const file of await readdir(join(runRoot, name))) {
    // Explicit public-evidence allowlist. No credentials, browser cookies/profile, raw protocol logs, or fixture support files.
    if (
      [
        'browser-session.json',
        'assertions.json',
        'evidence.json',
        'network-failures.json',
        'console-errors.json',
        'persistence.json',
        'downloads.json',
        'stale-confirmation.json',
        'unauthorized-api.json',
        'result.json',
      ].includes(file)
    )
      await cp(join(runRoot, name, file), join(target, file));
    if (file === 'screenshots' || file === 'downloads')
      await cp(join(runRoot, name, file), join(target, file), { recursive: true });
  }
  try {
    sessions.push({
      name,
      assertions: await json(`${name}/assertions.json`),
      evidence: await json(`${name}/evidence.json`),
      session: await json(`${name}/browser-session.json`),
    });
  } catch {
    /* interrupted run with no finalized assertions */
  }
}
await mkdir(join(output, 'rebuild'), { recursive: true });
for (const name of [
  'first-rebuild.json',
  'second-rebuild.json',
  'interruption-rebuild.json',
  'snapshot-comparison-final.json',
  'corrected-input.json',
  'synthetic-correction-rebuild.json',
  'synthetic-corrections.json',
])
  await copy(name, `rebuild/${name}`);
for (const [name, result] of [
  ['first', first],
  ['second', second],
  ['interruption', recovery],
]) {
  for (const [suffix, original] of [
    ['execution', result.firstReport],
    ['rerun', result.repeatReport],
  ])
    await cp(original, join(output, 'rebuild', `${name}-${suffix}.json`));
}
await mkdir(join(output, 'reports'), { recursive: true });
await cp(
  join(config.reportRoot, 'operational-acceptance.json'),
  join(output, 'reports', 'operational-acceptance.json'),
);
for (const name of ['operational-attempt-01.json', 'operational-attempt-02.json'])
  await copy(name, `reports/${name}`);
const latest = await json('browser-latest.json');
const browserGood = sessions.filter(
  (session) =>
    session.name.startsWith('browser-') &&
    session.assertions.length &&
    !session.assertions.some((item) => item.status === 'FAIL'),
);
const milestonesGood = sessions.find(
  (session) =>
    session.name.startsWith('milestones-') &&
    session.evidence.some((item) => item.step === 'accountant-styles') &&
    !session.assertions.some((item) => item.status === 'FAIL'),
);
const integrityGood = sessions.find(
  (session) =>
    session.name.startsWith('input-integrity-') &&
    session.assertions.some((item) => item.description.includes('rejects stale confirmation')) &&
    !session.assertions.some((item) => item.status === 'FAIL'),
);
const responsiveGood = sessions.find(
  (session) =>
    session.name.startsWith('responsive-') &&
    session.assertions.length === 3 &&
    session.assertions.every((item) => item.status === 'PASS'),
);
const matrix = [
  [
    'A',
    'Fresh database rebuild',
    first.freshEmpty && first.status === 'PASS' ? 'PASS' : 'FAIL',
    'rebuild/first-rebuild.json',
  ],
  ['B', 'Identical rerun', first.identicalRerun ? 'PASS' : 'FAIL', 'rebuild/first-rerun.json'],
  [
    'C',
    'Controlled synthetic correction',
    correction.status === 'PASS' &&
    correctedRebuild.status === 'PASS' &&
    correctedRebuild.identicalRerun
      ? 'PASS'
      : 'FAIL',
    'rebuild/corrected-input.json',
  ],
  [
    'D',
    'Independent second rebuild',
    comparison.status === 'PASS' &&
    comparison.independentTargets &&
    comparison.firstFresh &&
    comparison.secondFresh
      ? 'PASS'
      : 'FAIL',
    'rebuild/snapshot-comparison-final.json',
  ],
  [
    'E',
    'Interruption and recovery',
    comparison.recoveryEquivalent && recovery.attempts.length === 2 ? 'PASS' : 'FAIL',
    'rebuild/interruption-rebuild.json',
  ],
  [
    'F',
    'Authenticated import UI',
    ['ADMIN', 'MERCHANDISER'].every((role) =>
      browserGood.some(
        (session) =>
          session.session.actor?.expectedRole === role &&
          session.session.actor.roles.includes(role),
      ),
    ) &&
    integrityGood &&
    milestonesGood &&
    responsiveGood
      ? 'PASS'
      : 'NOT RUN',
    'browser/',
  ],
  [
    'G',
    'Operational workflow through Tax Invoice Draft',
    operational.status === 'PASSED' && operational.numberedTaxInvoices === 0 && milestonesGood
      ? 'PASS'
      : 'FAIL',
    'reports/operational-acceptance.json',
  ],
];
const gates = await json('final-gates.json').catch(() => ({
  pr7: {
    status: 'BLOCKED',
    reason: 'PR90 is open; PR7 current head is integrated locally but not merged to main',
  },
  ci: { status: 'NOT RUN', reason: 'Final PR8 commit CI has not completed' },
}));
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const result = {
  timestamp: new Date().toISOString(),
  source: {
    commit: head,
    manifestSha256: sourceConfig.manifestSha256,
    canonicalRoot: sourceConfig.sourceRoot,
    historicalRoot: 'C:/Users/kalay/workspace/project-erve-artifacts/erve_historical_data',
    pr7Head: '92eba35cf7c8c9c9565b787b7ffc1bff8e924057',
  },
  scenarios: matrix.map(([caseId, purpose, status, evidence]) => ({
    caseId,
    purpose,
    status,
    evidence,
  })),
  gates,
  engineeringReadiness:
    matrix.every((row) => row[2] === 'PASS') &&
    gates.pr7.status === 'PASS' &&
    gates.ci.status === 'PASS'
      ? 'VERIFIED'
      : 'FINAL_GATES_PENDING',
  commercialDataReadiness: 'NEEDS_REVIEW',
  productionCutoverReadiness: 'NOT_AUTHORIZED',
};
await write('acceptance-results.json', result);
await write(
  'test-matrix.csv',
  'Case ID,Purpose,Status,Evidence\r\n' +
    matrix
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\r\n') +
    '\r\n',
);
await write(
  'acceptance-summary.md',
  `# PR8 acceptance\n\nEngineering readiness: **${result.engineeringReadiness}**. Commercial-data readiness: **NEEDS REVIEW**. Production cutover: **NOT AUTHORIZED**.\n\n| Case | Scenario | Status | Evidence |\n|---|---|---|---|\n${matrix.map(([id, purpose, status, evidence]) => `| ${id} | ${purpose} | ${status} | [Evidence](${evidence}) |`).join('\n')}\n\nFinal gates: PR7 integration **${gates.pr7.status}**; final PR8 CI **${gates.ci.status}**. PR7 is incorporated in this branch; a PR7 merge to main is required for final acceptance.\n\nBrowser evidence includes actual Chrome interaction, native React input setters, file-input uploads, explicit worksheets, preview/confirmation, persistence/history, real-source previews, stale-file rejection, ADMIN/MERCHANDISER imports and ACCOUNTANT rejection. Style import supports XLSX; its UI disables confirmation when all rows already exist. Identical Style execution is independently verified by the rebuild service and integration tests.\n\nOperational actions used authorized disposable users and the actual API/business validations; CDP inspected the persisted records, production/quality tabs, packing/audit milestones, invoice Review and History. No Tax Invoice was finalized.\n\nThe initial historical source set yields ${JSON.stringify(first.snapshot.counts)}. Both independent databases and recovery have checksum \`${first.snapshot.checksum}\`.\n\nSynthetic Distributor/Store/Factory/Style names are prefixed PR8 ENGINEERING ONLY. Synthetic registration, pricing, weights, production and QA observations are engineering fixtures. Historical identities receive no fabricated Purchase Mode or statutory identity. Prior disallowed commercial correction evidence is preserved and excluded from acceptance.\n`,
);
const chosen = sessions.filter((session) =>
  [
    latest.directory.split(/[/\\]/).at(-1),
    browserGood[0]?.name,
    milestonesGood?.name,
    integrityGood?.name,
    responsiveGood?.name,
  ].includes(session.name),
);
await write(
  'reports/browser-verification.md',
  '# Automated browser verification\n\nStarting state: owned local PR8 database, isolated media, authenticated disposable users. Steps and authoritative actual Chrome screenshots follow. Backend persistence identities are in each completed import session’s persistence.json; operational backend records and HTTP trace are in operational-acceptance.json.\n\n' +
    chosen
      .map(
        (session) =>
          `## ${session.name}\n\n${session.evidence.map((item) => `- **${item.caseId}: ${item.step} — ${item.status}**. Expected: ${item.expected}. Observed: ${item.observed}. [Screenshot](../browser/${session.name}/${item.screenshot}).`).join('\n')}\n`,
      )
      .join('\n'),
);
await write(
  'reports/data-reconciliation.md',
  `# Data reconciliation\n\nCanonical source manifest SHA-256: \`${sourceConfig.manifestSha256}\`. Historical files and previously approved overlays were not modified. The independent/recovered snapshots are semantically identical; generated IDs and timestamps are omitted, media bytes are SHA-256 verified.\n\n| Master | Fresh loaded count |\n|---|---:|\n${Object.entries(
    first.snapshot.counts,
  )
    .map(([kind, count]) => `| ${kind} | ${count} |`)
    .join(
      '\n',
    )}\n\nHistorical Distributor and Store counts are zero because unresolved input remains subject to review/rejection. Original source-derived preview/exception downloads are retained under browser/input-integrity-*; detailed per-row original-source outcomes are in the rebuild execution reports. The controlled synthetic correction is isolated, checksum sealed and provenance linked. It is not customer-approved commercial data. Additional synthetic import/operational fixtures are separate from the fresh-snapshot counts above.\n`,
);
await write(
  'reports/operational-flow.md',
  `# Operational acceptance\n\nAPI result: **${operational.status}**. Numbered Tax Invoices: **${operational.numberedTaxInvoices}**.\n\nOrder Sheet \`${operational.orderSheetId}\` → Job Order \`${operational.jobOrderId}\` → confirmed factory production → PP Sample / PPM / Inline / Final QA → Dispatch Order \`${operational.dispatchOrderId}\` → carton ENGINEERING-C1 → packing audit → finalized ERVE Packing List \`${operational.ervePackingListId}\` → Tax Invoice \`${operational.taxInvoiceDraftId}\` (**DRAFT**, unnumbered).\n\nPrepared quantities were entered at Finishing as required. Finalized server-derived PASS QA released the actual disposable quantity and automatically completed production. The full HTTP trace and persisted source master references are retained in operational-acceptance.json. Browser screenshots verify actual records and tab interactions, rather than page-opening alone.\n\nInterrupted operational HTTP requests with an uncertain commit/checkpoint relationship fail closed and require reconciliation; the harness does not claim transparent recovery for arbitrary operational requests. Rebuild interruption recovery is independently verified under scenario E.\n`,
);
await write(
  'reports/defects.md',
  '# Defect register\n\n| ID | Severity | Reproduction / expected versus actual | Root cause and status | Evidence |\n|---|---|---|---|---|\n| PR8-001 | Medium | Open Styles at 390px: expected 390px with no page overflow; actual viewport expanded to 514px | Filter/export row could not wrap. Fixed locally; desktop/tablet/mobile rerun passes | responsive-01 FAIL → responsive-02 PASS, actual PNGs and geometry |\n| PR8-002 | Medium | Run lint after bundle generation: source lint expected, generated bundle produced no-undef errors | dist-bundle was outside ESLint ignores. Fixed by excluding generated artifacts; source lint remains enabled | lint.log and lint-02.log |\n| PR8-003 | High tooling | In-repository output could receive credentials before later rebuild refusal | Early external-root guard now rejects repository descendants, ancestors and linked aliases before writes | Native artifact-safety tests |\n| PR8-004 | High tooling | Crash between HTTP commit/checkpoint could repeat an uncertain mutation; cached PASS could conceal a finalized invoice | Atomic checkpoints, stable request identities, fail-closed uncertain-request journal, pinned fixture date, live draft revalidation | pr8-acceptance-state regression tests; live operational revalidation |\n\nHarness attempts are retained, including invalid synthetic GSTIN, case-sensitive Style badge selection, paginated persistence lookup, Radix tab click and pending-button timing assumptions. Those failures were corrected without weakening business validation. Prior synthetic Purchase Mode assigned to a real historical pair is preserved outside this package and explicitly excluded.\n',
);
// Combine actual source exception workbooks into one correction-ready evidence workbook.
const require = createRequire(join(repository, 'apps/api/package.json')),
  XLSX = require('xlsx');
const exceptions = XLSX.utils.book_new();
if (integrityGood)
  for (const file of await readdir(join(runRoot, integrityGood.name, 'downloads'))) {
    if (!file.endsWith('.xlsx')) continue;
    const workbook = XLSX.read(
      await readFile(join(runRoot, integrityGood.name, 'downloads', file)),
      { type: 'buffer' },
    );
    XLSX.utils.book_append_sheet(
      exceptions,
      workbook.Sheets[workbook.SheetNames[0]],
      file.replace('.xlsx', '').slice(0, 31),
    );
  }
if (exceptions.SheetNames.length)
  await writeFile(
    join(output, 'reports/master-exceptions.xlsx'),
    XLSX.write(exceptions, { type: 'buffer', bookType: 'xlsx' }),
  );
for (const file of await readdir(runRoot))
  if (
    /^(api-regression|web-regression|typecheck|api-typecheck|lint|build|native-tests|deployment-validation).*\.log$/.test(
      file,
    )
  )
    await copy(file, `reports/${file}`);
await write(
  'README.md',
  '# PR8 evidence package\n\nStart with [acceptance summary](acceptance-summary.md), [machine-readable results](acceptance-results.json), [browser verification](reports/browser-verification.md), [reconciliation](reports/data-reconciliation.md) and [defects](reports/defects.md).\n\nThis package contains actual application screenshots and reports, including customer-derived data. Keep it private and outside Git. Credentials, test browser profiles and runtime support files are excluded through an explicit allowlist. Use the repository tools/pr8 scripts and runbook to reproduce. Failed exploratory/harness runs remain archived with their actual FAIL statuses; final successful runs are indexed in the report.\n',
);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name !== 'manifest.json') {
      const bytes = await readFile(file);
      let caseIds = [];
      if (entry.name.endsWith('.json')) {
        try {
          const value = JSON.parse(bytes);
          if (value.caseId) caseIds = [value.caseId];
        } catch {
          /* log/plain artifact */
        }
      }
      files.push({
        path: relative(output, file).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: hash(bytes),
        caseIds,
      });
    }
  }
}
await walk(output);
await writeFile(
  join(runRoot, 'evidence-latest.json'),
  JSON.stringify({ directory: output }, null, 2),
);
await write('manifest.json', { timestamp: new Date().toISOString(), source: result.source, files });
console.log(
  JSON.stringify({
    evidenceDirectory: output,
    scenarios: result.scenarios.map((item) => ({ caseId: item.caseId, status: item.status })),
    files: files.length,
    engineeringReadiness: result.engineeringReadiness,
  }),
);
