import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { CdpDriver } from './cdp-driver.mjs';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const runRoot = resolve(process.argv[2]);
const output = join(runRoot, `browser-${process.argv[3] ?? '01'}`);
await assertExternalArtifactRoot(runRoot, repositoryRoots(repositoryRoot));
const config = JSON.parse(await readFile(join(runRoot, 'first-config.json')));
const snapshot = JSON.parse(await readFile(join(runRoot, 'first-rebuild.json'))).snapshot;
const require = createRequire(join(repositoryRoot, 'apps/api/package.json'));
const XLSX = require('xlsx');
const fixtureRoot = join(output, 'fixtures');
await mkdir(fixtureRoot, { recursive: true });
const makeFile = async (kind, rows) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Acceptance');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Explicit worksheet selection required']]),
    'Instructions',
  );
  const file = join(fixtureRoot, `${kind}.xlsx`);
  await writeFile(file, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return file;
};
const address = {
  'Address Line 1': 'PR8 synthetic address',
  City: 'Chennai',
  State: 'Tamil Nadu',
  Country: 'India',
  'Postal Code': '600001',
  'Source Provenance':
    'PR8 explicitly synthetic engineering fixture; no customer commercial assertions',
};
const factoryName = 'PR8 ENGINEERING ONLY FACTORY';
const distributorName = 'PR8 ENGINEERING ONLY DISTRIBUTOR';
const storeName = 'PR8 ENGINEERING ONLY STORE';
const files = {
  factories: await makeFile('factories', [
    { Name: factoryName, ...address, 'Source Key': 'pr8:synthetic:factory' },
    { Name: '', ...address, 'Source Key': 'pr8:synthetic:factory-rejected' },
  ]),
  distributors: await makeFile('distributors', [
    {
      Name: distributorName,
      GSTIN: '33ZZZZZ9999Z1Z9',
      'Purchase Mode': 'OUTRIGHT',
      ...address,
      'Source Key': 'pr8:synthetic:distributor',
    },
    {
      Name: 'PR8 ENGINEERING ONLY UNRESOLVED',
      GSTIN: '33ZZZZZ9998Z1Z9',
      'Purchase Mode': '',
      ...address,
      'Source Key': 'pr8:synthetic:unresolved',
    },
    {
      Name: '',
      GSTIN: '33ZZZZZ9997Z1Z9',
      'Purchase Mode': 'OUTRIGHT',
      ...address,
      'Source Key': 'pr8:synthetic:rejected',
    },
  ]),
  'retail-stores': await makeFile('retail-stores', [
    {
      'Distributor Name': distributorName,
      'Distributor GSTIN': '33ZZZZZ9999Z1Z9',
      'Distributor Purchase Mode': 'OUTRIGHT',
      Name: storeName,
      ...address,
      'Source Key': 'pr8:synthetic:store',
    },
    {
      'Distributor Name': 'PR8 ENGINEERING ONLY UNKNOWN',
      Name: 'PR8 ENGINEERING ONLY UNMATCHED STORE',
      ...address,
      'Source Key': 'pr8:synthetic:unmatched-store',
    },
  ]),
  styles: await makeFile('styles', [
    {
      'Style Number': 'PR8-SYNTHETIC-001',
      'Style Name': 'PR8 ENGINEERING ONLY STYLE',
      'Final MRP': '100',
      'Season Code': snapshot.business.seasons[0].code,
      'Size Codes': snapshot.business.sizes[0].code,
      Barcodes: 'PR8-SYNTHETIC-BARCODE-001',
      'Factory Name Mappings': `${factoryName}:25`,
    },
  ]),
};
const browser = await CdpDriver.connect({
  endpoint: 'http://127.0.0.1:9229',
  appUrl: 'http://127.0.0.1:5188',
  output,
  repositoryRoot,
});
const text = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`;
const capture = (caseId, step, expected, observed = expected) =>
  browser.captureEvidence({ caseId, step, expected, observed });
const persisted = (kind, name) =>
  browser.evaluate(
    `(async () => { const response = await fetch('http://127.0.0.1:4188/' + ${JSON.stringify(kind)} + '?limit=100&search=' + encodeURIComponent(${JSON.stringify(name)}), { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('erve.accessToken') } }); if (!response.ok) throw Error('Persistence query failed'); const data = (await response.json()).data; const rows = Array.isArray(data) ? data : data.items; return rows.filter(row => (row.name ?? row.styleName) === ${JSON.stringify(name)}).map(row => ({ id: row.id, code: row.code, styleNumber: row.styleNumber })); })()`,
  );
const persistenceResults = [];
try {
  const { windowId } = await browser.command('Browser.getWindowForTarget');
  await browser.command('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'maximized' },
  });
  await browser.viewport(1440, 900);
  await browser.navigateTo('/login');
  await browser.waitFor('!!document.querySelector("#identifier")');
  await capture('PR8-SMOKE', 'login', 'Local application renders the login form');
  const actor =
    process.argv[4] === 'merchandiser'
      ? JSON.parse(await readFile(join(config.reportRoot, 'operational-fixture-credentials.json')))
          .MERCHANDISER
      : {
          email: config.adminEmail,
          password: (await readFile(join(runRoot, 'first-password.txt'), 'utf8')).trimEnd(),
        };
  await browser.fill('#identifier', actor.email);
  await browser.fill('#password', actor.password);
  await browser.clickButton('Sign in');
  await browser.waitFor('location.pathname !== "/login"', 60000);
  const identity = await browser.evaluate(
    `(async () => { const response = await fetch('http://127.0.0.1:4188/auth/me', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('erve.accessToken') } }); if (!response.ok) throw Error('Current-user verification failed'); const data = (await response.json()).data; return { id: data.id, roles: data.roles }; })()`,
  );
  const expectedRole = process.argv[4] === 'merchandiser' ? 'MERCHANDISER' : 'ADMIN';
  if (!identity.roles?.includes(expectedRole))
    throw Error('Authenticated browser role does not match the acceptance actor');
  browser.context.actor = { ...identity, expectedRole };
  browser.assertions.push({
    caseId: 'PR8-RBAC',
    description: `Live authenticated actor has ${expectedRole} role`,
    status: 'PASS',
  });
  await capture(
    'PR8-SMOKE',
    'authenticated',
    'Authorized business user authenticated through React login form',
  );
  for (const [index, kind] of ['factories', 'distributors', 'retail-stores'].entries()) {
    const caseId = `PR8-UI-00${index + 1}`;
    await browser.navigateTo(`/master-data/${kind}`);
    const importLabel = {
      factories: 'Import Factories',
      distributors: 'Import Distributors',
      'retail-stores': 'Import Stores',
    }[kind];
    await browser.waitFor(`!!document.querySelector('a[href="/master-data/${kind}/import"]')`);
    await browser.evaluate(
      `document.querySelector('a[href="/master-data/${kind}/import"]').click()`,
    );
    await browser.waitFor('!!document.querySelector("input[type=file]")');
    await capture(caseId, 'initial', `${importLabel} is reachable from its master list`);
    await browser.clickButton('Download template');
    await browser.waitFor(
      `document.querySelector('input[type=file]') && ![...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Download template').disabled`,
    );
    await browser.uploadFile('input[type=file]', files[kind]);
    await browser.waitFor('document.querySelector("select")?.options.length > 1');
    await browser.select('select', 'Acceptance');
    await capture(
      caseId,
      'selected-file',
      'Synthetic XLSX selected with explicit Acceptance worksheet',
    );
    await browser.clickButton('Preview');
    await browser.waitFor(text('Confirm import'), 60000);
    await browser.assert(
      caseId,
      'Preview shows eligible synthetic record',
      `${text('CREATE')} || ${text('SKIP_EXISTING')}`,
    );
    const requiredOutcomes =
      kind === 'factories'
        ? ['REJECTED']
        : kind === 'distributors'
          ? ['NEEDS_REVIEW', 'REJECTED']
          : ['NEEDS_REVIEW'];
    for (const outcome of requiredOutcomes)
      await browser.assert(caseId, `Invalid synthetic row classified ${outcome}`, text(outcome));
    await capture(caseId, 'preview', 'Preview classifications are shown before any writes');
    await browser.clickButton('Download exceptions');
    await browser.waitFor(
      `[...document.querySelectorAll('button')].some(b => b.textContent.trim()==='Confirm import' && !b.disabled)`,
    );
    await browser.clickButton('Confirm import');
    await browser.waitFor(text('Results'), 60000);
    await capture(caseId, 'result', 'Execution results displayed with import history');
    await browser.navigateTo(`/master-data/${kind}`);
    const name = {
      factories: factoryName,
      distributors: distributorName,
      'retail-stores': storeName,
    }[kind];
    await browser.waitFor(text(name), 60000);
    await browser.assert(caseId, 'Record remains visible after navigation', text(name));
    await capture(caseId, 'persisted', 'Imported synthetic master persists on the master list');
    const beforeRerun = await persisted(kind, name);
    if (beforeRerun.length !== 1)
      throw Error(`Expected exactly one persisted synthetic ${kind} record`);
    await browser.navigateTo(`/master-data/${kind}/import`);
    await browser.waitFor(text('View run'));
    await browser.clickButton('View run');
    await browser.waitFor(text('Download run exceptions'));
    await capture(caseId, 'history', 'Persisted run details reopen from history');
    await browser.uploadFile('input[type=file]', files[kind]);
    await browser.waitFor('document.querySelector("select")?.options.length > 1');
    await browser.select('select', 'Acceptance');
    await browser.clickButton('Preview');
    await browser.waitFor(text('SKIP_EXISTING'));
    await capture(
      caseId,
      'rerun-preview',
      'Identical existing synthetic row is classified SKIP_EXISTING',
    );
    await browser.clickButton('Confirm import');
    await browser.waitFor(text('Results'));
    const afterRerun = await persisted(kind, name);
    if (JSON.stringify(beforeRerun) !== JSON.stringify(afterRerun))
      throw Error('Browser rerun allocated another master identity/code');
    persistenceResults.push({ kind, beforeRerun, afterRerun, status: 'PASS' });
    await capture(
      caseId,
      'rerun-result',
      'Identical rerun executed; backend identity/code remained unchanged',
    );
  }
  await browser.navigateTo('/master-data/styles/bulk-import');
  await browser.waitFor('!!document.querySelector("input[type=file]")');
  await capture('PR8-UI-004', 'initial', 'Style workbook import page renders');
  await browser.clickButton('Download template');
  await browser.uploadFile('input[type=file]', files.styles);
  await browser.waitFor('document.querySelector("select")?.options.length > 1');
  await browser.select('select', 'Acceptance');
  await capture(
    'PR8-UI-004',
    'selected-file',
    'Separate synthetic Style workbook and worksheet selected',
  );
  await browser.clickButton('Preview');
  await browser.waitFor(text('Review and confirm'), 60000);
  await capture('PR8-UI-004', 'preview', 'Style preview before confirmation');
  await browser.clickButton('Download exceptions');
  const canImport = await browser.evaluate(
    `![...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Confirm & Import')?.disabled`,
  );
  if (canImport) {
    await browser.clickButton('Confirm & Import');
    await browser.waitFor(text('Results'), 60000);
    await capture('PR8-UI-004', 'result', 'Style import execution result');
  }
  await browser.clickButton('Load history');
  await browser.waitFor(text('Download report'));
  await capture('PR8-UI-004', 'history', 'Persisted Style execution history');
  await browser.navigateTo('/master-data/styles');
  await browser.waitFor(`!!${browser.locator('input[placeholder="Search styles"]')}`);
  await browser.fill('input[placeholder="Search styles"]', 'PR8 ENGINEERING ONLY STYLE');
  await browser.waitFor(text('PR8 ENGINEERING ONLY STYLE'), 60000);
  await capture('PR8-UI-004', 'persisted', 'Synthetic Style persists after navigation');
  const sourceStyle = snapshot.business.styles.find(
    (style) => style.ipName && style.licensor && style.colour,
  );
  if (!sourceStyle) throw Error('Canonical rebuild lacks source-derived IP/Licensor/Colour');
  await browser.fill('input[placeholder="Search styles"]', sourceStyle.styleNumber);
  await browser.waitFor(text(sourceStyle.styleNumber));
  for (const field of ['ipName', 'licensor', 'colour'])
    await browser.assert(
      'PR8-STYLE-METADATA',
      `Source-derived ${field} is displayed`,
      text(sourceStyle[field]),
    );
  await capture(
    'PR8-STYLE-METADATA',
    'source-values',
    'Historical Style displays source IP, Licensor and Colour',
  );
  await browser.fill('input[placeholder="Search styles"]', 'PR8 ENGINEERING ONLY STYLE');
  await browser.waitFor(text('PR8 ENGINEERING ONLY STYLE'));
  const styles = await persisted('styles', 'PR8 ENGINEERING ONLY STYLE');
  if (styles.length !== 1)
    throw Error('Expected exactly one synthetic Style after repeated browser verification');
  persistenceResults.push({ kind: 'styles', records: styles, status: 'PASS' });
  for (const [width, height, mobile] of [
    [1440, 900, false],
    [768, 1024, false],
    [390, 844, true],
  ]) {
    await browser.viewport(width, height, mobile);
    await browser.assert(
      'PR8-RESPONSIVE',
      `Actual viewport ${width}px and no page overflow`,
      `innerWidth === ${width} && document.documentElement.scrollWidth <= ${width} + 1`,
    );
    await capture('PR8-RESPONSIVE', `styles-${width}`, 'Styles list at representative viewport');
  }
  const expectedDownloads = [
    'factories-template.xlsx',
    'factories-exceptions.xlsx',
    'distributors-template.xlsx',
    'distributors-exceptions.xlsx',
    'retail-stores-template.xlsx',
    'retail-stores-exceptions.xlsx',
    'styles.xlsx',
    'style-import-exceptions.xlsx',
  ];
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    let names = [];
    try {
      names = await readdir(join(output, 'downloads'));
    } catch {
      /* download directory not created yet */
    }
    if (expectedDownloads.every((name) => names.includes(name))) break;
    await delay(100);
  }
  const validatedDownloads = [];
  for (const name of expectedDownloads) {
    const bytes = await readFile(join(output, 'downloads', name));
    const book = XLSX.read(bytes, { type: 'buffer' });
    if (!book.SheetNames.length || !book.Sheets[book.SheetNames[0]]['!ref'])
      throw Error(`Downloaded workbook is empty: ${name}`);
    validatedDownloads.push({
      name,
      bytes: bytes.length,
      worksheets: book.SheetNames,
      status: 'PASS',
    });
  }
  if (
    browser.networkFailures.some((failure) => failure.status >= 400 && !failure.canceled) ||
    browser.consoleErrors.length
  )
    throw Error('Unexpected browser application/network failure');
  await writeFile(join(output, 'persistence.json'), JSON.stringify(persistenceResults, null, 2));
  await writeFile(join(output, 'downloads.json'), JSON.stringify(validatedDownloads, null, 2));
  await writeFile(
    join(runRoot, 'browser-latest.json'),
    JSON.stringify({ directory: output, fixtures: fixtureRoot, status: 'PASS' }, null, 2),
  );
} catch (error) {
  browser.assertions.push({
    caseId: 'PR8-BROWSER-RUN',
    status: 'FAIL',
    description: error.message,
    timestamp: new Date().toISOString(),
  });
  try {
    await browser.captureEvidence({
      caseId: 'PR8-BROWSER-RUN',
      step: 'failure',
      expected: 'Automated workflow completes',
      observed: error.message,
      status: 'FAIL',
    });
  } catch {
    /* retain original failure */
  }
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await browser.close();
}
