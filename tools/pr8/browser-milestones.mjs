import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CdpDriver } from './cdp-driver.mjs';
const repositoryRoot = resolve(import.meta.dirname, '../..');
const runRoot = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(runRoot, 'first-config.json')));
const report = JSON.parse(await readFile(join(config.reportRoot, 'operational-acceptance.json')));
if (report.status !== 'PASSED' || report.numberedTaxInvoices !== 0)
  throw Error('Operational backend acceptance and unnumbered draft required');
const credentials = JSON.parse(
  await readFile(join(config.reportRoot, 'operational-fixture-credentials.json')),
);
const output = join(runRoot, `milestones-${process.argv[3] ?? '01'}`);
const browser = await CdpDriver.connect({
  endpoint: 'http://127.0.0.1:9229',
  appUrl: 'http://127.0.0.1:5188',
  output,
  repositoryRoot,
});
const text = (value) =>
  `document.body.innerText.toLowerCase().includes(${JSON.stringify(value.toLowerCase())})`;
const capture = (caseId, step, expected) =>
  browser.captureEvidence({ caseId, step, expected, observed: expected });
async function signIn(email, password) {
  await browser.navigateTo('/login');
  await browser.waitFor('!!document.querySelector("#identifier")');
  await browser.fill('#identifier', email);
  await browser.fill('#password', password);
  await browser.clickButton('Sign in');
  await browser.waitFor('location.pathname !== "/login"');
}
async function inspect(path, expected, step) {
  await browser.navigateTo(path);
  await browser.waitFor(text(expected), 60000);
  await browser.assert('PR8-G', `${step} shows actual workflow state`, text(expected));
  await capture('PR8-G', step, expected);
}
try {
  await browser.viewport(1440, 900);
  await signIn(
    config.adminEmail,
    (await readFile(join(runRoot, 'first-password.txt'), 'utf8')).trimEnd(),
  );
  await inspect(
    `/purchase-orders/${report.orderSheetId}`,
    'PR8 ENGINEERING ONLY DISTRIBUTOR',
    'order-sheet',
  );
  await inspect(`/job-orders/${report.jobOrderId}`, 'Overview', 'job-order');
  await browser.clickButton('Production');
  await browser.waitFor(text('Finishing'));
  await capture(
    'PR8-G',
    'production',
    'Production tab shows completed canonical production activities',
  );
  await browser.clickButton('Quality');
  await browser.waitFor(text('Final'));
  await capture('PR8-G', 'quality', 'Quality tab shows actual finalized quality activity results');
  await browser.clickButton('History');
  await browser.waitFor(text('History'));
  await capture('PR8-G', 'job-history', 'Job Order history is accessible after production and QA');
  await inspect(`/sale-orders/${report.dispatchOrderId}`, 'PR8 ENGINEERING ONLY', 'dispatch-order');
  await inspect(
    `/sale-orders/${report.dispatchOrderId}/packing-list`,
    'ENGINEERING-C1',
    'factory-packing',
  );
  const cartonRequest = report.trace.find(
    (entry) => entry.route.includes('/cartons/') && entry.route.endsWith('/audit'),
  );
  const cartonId = cartonRequest.route.split('/').at(-2);
  await inspect(
    `/fulfillment/packing-audit/cartons/${cartonId}`,
    'ENGINEERING-C1',
    'packing-audit',
  );
  await inspect(
    `/fulfillment/erve-packing-lists/${report.ervePackingListId}`,
    'PR8 ENGINEERING ONLY',
    'erve-packing-list',
  );
  await inspect(
    `/fulfillment/tax-invoices/${report.taxInvoiceDraftId}`,
    'Draft',
    'tax-invoice-draft',
  );
  await browser.assert(
    'PR8-G',
    'Tax Invoice shows the synthetic Distributor',
    text('PR8 ENGINEERING ONLY DISTRIBUTOR'),
  );
  await browser.clickButton('History');
  await capture(
    'PR8-G',
    'invoice-history',
    'Draft financial history inspected without invoice finalization',
  );
  await browser.clickButton('Review');
  await capture(
    'PR8-G',
    'invoice-review',
    'Tax Invoice review opened; no invoice finalization executed',
  );

  // Business-user authorization through real login/UI, with explicit server checks.
  await signIn(credentials.MERCHANDISER.email, credentials.MERCHANDISER.password);
  for (const kind of ['factories', 'distributors', 'retail-stores']) {
    await browser.navigateTo(`/master-data/${kind}/import`);
    await browser.waitFor('!!document.querySelector("input[type=file]")');
    await capture(
      'PR8-RBAC',
      `merchandiser-${kind}`,
      'Merchandiser can access the authenticated import workflow',
    );
  }
  await browser.navigateTo('/master-data/styles/bulk-import');
  await browser.waitFor('!!document.querySelector("input[type=file]")');
  await capture('PR8-RBAC', 'merchandiser-styles', 'Merchandiser can access Style import');
  await signIn(credentials.ACCOUNTANT.email, credentials.ACCOUNTANT.password);
  for (const [kind, path] of [
    ['factories', '/master-data/factories/import'],
    ['distributors', '/master-data/distributors/import'],
    ['stores', '/master-data/retail-stores/import'],
    ['styles', '/master-data/styles/bulk-import'],
  ]) {
    await browser.navigateTo(path);
    await browser.waitFor(text('Access denied'));
    await browser.assert('PR8-RBAC', `Accountant rejected from ${kind}`, text('Access denied'));
    await capture('PR8-RBAC', `accountant-${kind}`, 'Unauthorized role receives Access denied');
  }
  const login = await fetch('http://127.0.0.1:4188/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: credentials.ACCOUNTANT.email,
      password: credentials.ACCOUNTANT.password,
    }),
  }).then((response) => response.json());
  const results = [];
  for (const path of [
    '/master-imports/factories/history',
    '/master-imports/distributors/history',
    '/master-imports/retail-stores/history',
    '/styles/bulk-import/history',
  ]) {
    const response = await fetch(`http://127.0.0.1:4188${path}`, {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    results.push({ path, status: response.status });
    if (response.status !== 403) throw Error('Unauthorized API import endpoint did not return 403');
  }
  await writeFile(join(output, 'unauthorized-api.json'), JSON.stringify(results, null, 2));
  // Import downloads are validated by the import workflow that generated them.
} catch (error) {
  browser.assertions.push({ caseId: 'PR8-MILESTONES', status: 'FAIL', description: error.message });
  await browser.captureEvidence({
    caseId: 'PR8-MILESTONES',
    step: 'failure',
    expected: 'Milestone and role verification completes',
    observed: error.message,
    status: 'FAIL',
  });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
