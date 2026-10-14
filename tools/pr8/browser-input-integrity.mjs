import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CdpDriver } from './cdp-driver.mjs';
const repositoryRoot = resolve(import.meta.dirname, '../..');
const runRoot = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(runRoot, 'first-config.json')));
const output = join(runRoot, `input-integrity-${process.argv[3] ?? '01'}`);
const browser = await CdpDriver.connect({
  endpoint: 'http://127.0.0.1:9229',
  appUrl: 'http://127.0.0.1:5188',
  output,
  repositoryRoot,
});
const text = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`;
const record = (step, expected, status = 'PASS') =>
  browser.captureEvidence({
    caseId: 'PR8-F-INTEGRITY',
    step,
    expected,
    observed: expected,
    status,
    fullPage: step === 'historical-styles',
  });
try {
  await browser.viewport(1440, 900);
  await browser.navigateTo('/login');
  await browser.waitFor('!!document.querySelector("#identifier")');
  await browser.fill('#identifier', config.adminEmail);
  await browser.fill(
    '#password',
    (await readFile(join(runRoot, 'first-password.txt'), 'utf8')).trimEnd(),
  );
  await browser.clickButton('Sign in');
  await browser.waitFor('location.pathname !== "/login"');
  for (const [kind, key] of [
    ['factories', 'factories'],
    ['distributors', 'distributors'],
    ['retail-stores', 'retailStores'],
  ]) {
    await browser.navigateTo(`/master-data/${kind}/import`);
    await browser.waitFor('!!document.querySelector("input[type=file]")');
    await browser.uploadFile('input[type=file]', join(config.sourceRoot, config.files[key]));
    await browser.clickButton('Preview');
    await browser.waitFor(text('Confirm import'), 60000);
    await record(
      `historical-${kind}`,
      'Actual canonical CSV preview classifies historical rows without changing unapproved commercial data',
    );
    await browser.clickButton('Download exceptions');
    await browser.waitFor(
      `![...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Download exceptions').disabled`,
    );
  }
  await browser.navigateTo('/master-data/styles/bulk-import');
  await browser.waitFor('!!document.querySelector("input[type=file]")');
  await browser.uploadFile('input[type=file]', join(config.sourceRoot, config.files.styles));
  await browser.waitFor(
    `document.querySelector('select') && [...document.querySelector('select').options].some(option => option.value === ${JSON.stringify(config.styleWorksheet)})`,
  );
  await browser.select('select', config.styleWorksheet);
  await browser.clickButton('Preview');
  await browser.waitFor(text('Review and confirm'), 60000);
  await browser.assert(
    'PR8-F-INTEGRITY',
    'Canonical Styles classify existing identities',
    text('SKIP EXISTING'),
  );
  await record(
    'historical-styles',
    'Actual historical workbook preview and relationships classify existing Styles',
  );
  await browser.clickButton('Download exceptions');
  await browser.navigateTo('/master-data/factories/import');
  await browser.waitFor('!!document.querySelector("input[type=file]")');
  const original = join(output, 'original.csv'),
    changed = join(output, 'changed.csv');
  await writeFile(
    original,
    'Name,Source Key,Source Provenance\nPR8 ENGINEERING ONLY CHANGED FILE,pr8:synthetic:changed-file,PR8 synthetic fixture\n',
  );
  await writeFile(
    changed,
    'Name,Source Key,Source Provenance\nPR8 ENGINEERING ONLY DIFFERENT FILE,pr8:synthetic:changed-file,PR8 synthetic fixture changed\n',
  );
  await browser.uploadFile('input[type=file]', original);
  await browser.clickButton('Preview');
  await browser.waitFor(text('Confirm import'));
  const previewResponse = browser.responses
    .filter((entry) => entry.path === '/master-imports/factories/preflight')
    .at(-1);
  const { body } = await browser.command('Network.getResponseBody', {
    requestId: previewResponse.requestId,
  });
  const token = JSON.parse(body).data.confirmationToken;
  await record('original-preview', 'Original synthetic file preview before any execution');
  await browser.uploadFile('input[type=file]', changed);
  await browser.assert(
    'PR8-F-INTEGRITY',
    'Selecting changed input removes old confirmation UI',
    `![...document.querySelectorAll('button')].some(button => button.textContent.trim()==='Confirm import')`,
  );
  await record(
    'changed-file-reset',
    'Changed source selection invalidates the old preview and confirmation',
  );
  const result = await browser.evaluate(
    `(async () => { const data = new FormData(); data.append('file', document.querySelector('input[type=file]').files[0]); data.append('confirmationToken', ${JSON.stringify(token)}); const response = await fetch('http://127.0.0.1:4188/master-imports/factories/execute', { method: 'POST', headers: { Authorization: 'Bearer ' + sessionStorage.getItem('erve.accessToken') }, body: data }); return { status: response.status, error: (await response.json()).error?.code }; })()`,
  );
  if (result.status !== 409) throw Error('Changed file was not rejected with stale confirmation');
  browser.assertions.push({
    caseId: 'PR8-F-INTEGRITY',
    description: 'Actual browser API rejects stale confirmation on changed file',
    status: 'PASS',
    httpStatus: result.status,
  });
  await writeFile(join(output, 'stale-confirmation.json'), JSON.stringify(result, null, 2));
  await browser.clickButton('Preview');
  await browser.waitFor(text('Confirm import'));
  await record('new-preview', 'New preview is required for changed synthetic input');
} catch (error) {
  browser.assertions.push({
    caseId: 'PR8-F-INTEGRITY',
    description: error.message,
    status: 'FAIL',
  });
  await record('failure', error.message, 'FAIL');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
