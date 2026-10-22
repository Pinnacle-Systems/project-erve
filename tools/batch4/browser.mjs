import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
const root = resolve(import.meta.dirname, '../..');
const output = process.env.BATCH4_BROWSER_EVIDENCE_DIR ? resolve(process.env.BATCH4_BROWSER_EVIDENCE_DIR) : await mkdtemp(join(tmpdir(), 'erve-batch4-browser-'));
await mkdir(output, { recursive: true });
const appUrl = 'http://127.0.0.1:5194';
const children = [];
let driver;
async function ready(url) {
  for (let n = 0; n < 300; n++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error(`Not ready: ${url}`);
}
try {
  const web = spawn(
    process.execPath,
    [
      resolve(root, 'apps/web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5194',
      '--strictPort',
    ],
    { cwd: resolve(root, 'apps/web'), windowsHide: true, stdio: 'ignore' },
  );
  children.push(web);
  await ready(appUrl);
  const chrome = [
    process.env.CHROME_BINARY,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
  ].find((p) => p && existsSync(p));
  assert.ok(chrome);
  children.push(
    spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=9294',
        `--user-data-dir=${join(output, 'profile')}`,
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' },
    ),
  );
  await ready('http://127.0.0.1:9294/json/version');
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9294',
    appUrl,
    output,
    repositoryRoot: root,
  });
  const results = [];
  for (const workflow of [
    'PP Sample',
    'Pre-Production Meeting',
    'Inline Inspection',
    'Final Inspection',
  ]) {
    for (const width of [1440, 1280, 1024, 390]) {
      await driver.viewport(width, 960, width === 390);
      await driver.command('Page.navigate', {
        url: `${appUrl}/src/test-support/batch4.html?workflow=${encodeURIComponent(workflow)}`,
      });
      await driver.waitFor(
        `document.querySelectorAll('h1').length === 1 && document.body.innerText.includes('Basic Tee')`,
        60000,
      );
      const metrics = await driver.evaluate(`(() => {
        const header = document.querySelector('[data-quality-execution-header]');
        const bounds = header.getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, headerHeight: bounds.height, thumbnailWidth: header.querySelector('[aria-label="View style image"]')?.parentElement.getBoundingClientRect().width ?? 0, headings: document.querySelectorAll('h1').length, provenanceAbsent: !/Distributor Alpha|EIOS-|Private Planner|Downstream availability/.test(document.body.innerText), authored: ${JSON.stringify(workflow)} === 'PP Sample' || document.body.innerText.includes('Supplier'), pdfActions: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Download PDF')) };
      })()`);
      assert.equal(metrics.headings, 1);
      assert.equal(metrics.thumbnailWidth, 80, 'Compact primary QA thumbnail');
      assert.ok(metrics.scrollWidth <= metrics.width + 1, JSON.stringify(metrics));
      assert.ok(metrics.provenanceAbsent);
      assert.ok(metrics.authored);
      assert.ok(metrics.pdfActions);
      assert.ok(metrics.headerHeight < (width === 390 ? 260 : 170), JSON.stringify(metrics));
      await driver.waitFor(
        `document.querySelector('[data-quality-execution-header] img')?.naturalWidth > 0`,
      );
      await driver.evaluate(`document.querySelector('[aria-label="View style image"]').click()`);
      await driver.waitFor(`!!document.querySelector('[role=dialog] img')?.naturalWidth`);
      await driver.command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
      });
      await driver.waitFor(`!document.querySelector('[role=dialog]')`);
      await driver.captureEvidence({
        caseId: workflow.replaceAll(' ', '-'),
        step: String(width),
        expected:
          'One compact identity; authored fields and actions; no overflow or derived provenance',
        observed: metrics,
      });
      results.push({ workflow, ...metrics });
    }
  }
  for (const workflow of [
    'PP Sample',
    'Pre-Production Meeting',
    'Inline Inspection',
    'Final Inspection',
  ]) {
    await driver.command('Page.navigate', {
      url: `${appUrl}/src/test-support/batch4.html?workflow=${encodeURIComponent(workflow)}&state=finalized&role=MERCHANDISER`,
    });
    await driver.waitFor(
      `document.querySelector('h1') && document.body.innerText.includes('FINALIZED')`,
      60000,
    );
    assert.equal(
      await driver.evaluate(
        `!![...document.querySelectorAll('button')].find(b => ['Save draft', 'Finalize', 'Save size form'].includes(b.textContent))`,
      ),
      false,
    );
    assert.equal(
      await driver.evaluate(
        `/Distributor Alpha|EIOS-|Private Planner/.test(document.body.innerText)`,
      ),
      false,
    );
  }
  let downloadCount = 0;
  for (const workflow of ['PP Sample', 'Pre-Production Meeting', 'Inline Inspection', 'Final Inspection']) {
    await driver.command('Page.navigate', { url: `${appUrl}/src/test-support/batch4.html?workflow=${encodeURIComponent(workflow)}&state=finalized` });
    await driver.waitFor(`document.querySelector('h1') && document.body.innerText.includes('FINALIZED')`, 60000);
    await driver.clickButton('Download PDF');
    let files = [];
    for (let n = 0; n < 300; n++) {
      files = (await readdir(join(output, 'downloads')).catch(() => [])).filter(name => name.endsWith('.pdf'));
      if (files.length > downloadCount) break;
      await delay(100);
    }
    assert.equal(files.length, downloadCount + 1, `Actual ${workflow} PDF download`);
    for (const file of files) assert.equal((await readFile(join(output, 'downloads', file))).subarray(0, 5).toString(), '%PDF-');
    downloadCount = files.length;
    const authorizedImages = await driver.evaluate(`window.batch4Requests.filter(request => request.path.endsWith('/content')).every(request => request.authenticated)`);
    assert.ok(authorizedImages, 'Style images use authenticated API client');
  }
  assert.equal(driver.consoleErrors.length, 0, JSON.stringify(driver.consoleErrors));
  await writeFile(join(output, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({ output, cases: results.length, historicalReadonlyCases: 4,
      downloads: downloadCount, results }, null, 2),
  );
} finally {
  if (driver) await driver.close();
  for (const child of children.reverse()) child.kill();
}
