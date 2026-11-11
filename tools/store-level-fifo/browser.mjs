import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
import { fifoBrowserTarget } from './safety.mjs';

// ISS-089 / ISS-092 browser review against a disposable fifo_browser_test database.
// Reproduce with TEST_DATABASE_URL=postgresql://.../fifo_browser_test (and a different DATABASE_URL):
//   node tools/store-level-fifo/browser.mjs
const root = resolve(import.meta.dirname, '../..');
const target = fifoBrowserTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const output = await mkdtemp(join(tmpdir(), 'erve-fifo-browser-'));
const appUrl = 'http://127.0.0.1:5197';
const apiUrl = 'http://127.0.0.1:4197';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/fifo_guard',
  TEST_DATABASE_URL: target,
  JWT_ACCESS_SECRET: 'fifo-disposable-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'fifo-disposable-refresh-secret-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '1h',
  FILE_STORAGE_DIR: join(output, 'uploads'),
  FIFO_FIXTURES: join(output, 'fixtures.json'),
  HOST: '127.0.0.1',
  PORT: '4197',
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
};
const children = [];
function launch(binary, args, name, cwd = root, overrides = {}) {
  const child = spawn(binary, args, { cwd, env: { ...env, ...overrides }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(join(output, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let n = 0; n < 600; n++) {
    assert.equal(child.exitCode, null, `Server exited; see ${output}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Readiness timeout; see ${output}`);
}

let browser;
try {
  const seed = launch(process.execPath, [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'tools/store-level-fifo/fixtures.mts'], 'fixtures');
  const code = await new Promise((ok, fail) => {
    seed.once('exit', ok);
    seed.once('error', fail);
  });
  assert.equal(code, 0, `Fixture setup failed; see ${output}`);
  const fixture = JSON.parse(await readFile(env.FIFO_FIXTURES, 'utf8'));
  const api = launch(process.execPath, [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], 'api', resolve(root, 'apps/api'), { DATABASE_URL: target });
  const web = launch(process.execPath, [resolve(root, 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5197', '--strictPort'], 'web', resolve(root, 'apps/web'));
  await Promise.all([ready(`${apiUrl}/health`, api), ready(appUrl, web)]);
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(chrome, 'Chromium required');
  const chromeProcess = launch(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9297', `--user-data-dir=${join(output, 'chrome-profile')}`, 'about:blank'],
    'chrome',
  );
  await ready('http://127.0.0.1:9297/json/version', chromeProcess);
  browser = await CdpDriver.connect({ endpoint: 'http://127.0.0.1:9297', appUrl, output, repositoryRoot: root });

  const login = async (role) => {
    await browser.command('Network.clearBrowserCookies');
    await browser.viewport(1440, 1000);
    await browser.navigateTo('/login');
    await browser.evaluate('try { localStorage.clear(); sessionStorage.clear(); } catch {}');
    await browser.navigateTo('/login');
    await browser.waitFor('!!document.querySelector("#identifier")');
    await browser.fill('#identifier', fixture.emails[role]);
    await browser.fill('#password', fixture.password);
    await browser.clickButton('Sign in');
    await browser.waitFor('location.pathname !== "/login"');
  };

  const overflow = () =>
    browser.evaluate(`(() => {
      const d = document.querySelector('[role=dialog]');
      const r = d && d.getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        dialogFits: d ? r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 : null,
        dialogOverflowX: d ? d.scrollWidth > d.clientWidth + 1 : null };
    })()`);

  async function openStore(name) {
    await browser.navigateTo('/fulfillment/retail-store-inventory');
    await browser.waitFor('document.body.textContent.includes("Beta Plaza")');
    await browser.evaluate(`(() => { for (const b of document.querySelectorAll('section[aria-label^="Retail Store"] h3 button[aria-expanded="false"]')) b.click(); })()`);
    await browser.waitFor('document.querySelectorAll("section[aria-label^=\\"Retail Store\\"] h3 button[aria-expanded=\\"false\\"]").length === 0');
    await browser.stabilize();
    return `section[aria-label^="Retail Store ${name}"]`;
  }
  const clickAction = async (storeSelector, label) => {
    await browser.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${storeSelector} button[aria-label^="${label}"]`)}); if (!b) throw Error('action missing: ${label}'); b.scrollIntoView({ block: 'center' }); b.click(); })()`);
    await browser.waitFor('!!document.querySelector("[role=dialog] form") && !document.querySelector("[role=dialog]").textContent.includes("Checking")');
    await browser.stabilize();
  };
  const setQuantity = async (value) => {
    await browser.evaluate(`(() => { const i = document.querySelector('[role=dialog] form input'); i.focus(); })()`);
    await browser.fill('[role=dialog] form input', String(value));
    await browser.evaluate(`(() => { const i = document.querySelector('[role=dialog] form input'); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); })()`);
    await browser.stabilize();
  };
  const submit = async (text) => {
    await browser.evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button[type=submit]')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); b.click(); })()`);
  };
  const closeDialog = async () => {
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await delay(300);
    await browser.waitFor('!document.querySelector("[role=dialog]")');
  };

  const results = [];
  const record = (entry) => {
    results.push(entry);
    return entry;
  };

  // The Admin (not a Distributor) must not see the actions at all.
  await login('admin');
  await openStore('Alpha');
  const adminActions = await browser.evaluate('document.querySelectorAll("[data-testid=store-fifo-actions], button[aria-label^=\\"Report sold\\"]").length');
  assert.equal(adminActions, 0, 'Admin must not be offered Store-level actions');
  record({ role: 'admin', actions: adminActions });

  await login('distributor');
  for (const width of [1440, 375]) {
    await browser.viewport(width, 1000, width === 375);
    const alpha = await openStore('Alpha');
    const beta = 'section[aria-label^="Retail Store Beta"]';
    const sale = width === 1440 ? { store: alpha, size: 'M', qty: 75 } : { store: alpha, size: 'L', qty: 8 };
    const ret = width === 1440 ? { store: alpha, size: 'M', qty: 10 } : { store: beta, size: 'M', qty: 6 };

    // ---- Report sold ----
    await clickAction(sale.store, `Report sold, size ${sale.size}`);
    const open = record({ width, step: 'sale-open', ...(await overflow()) });
    assert.ok(open.scrollWidth <= width, `page overflows at ${width}`);
    assert.ok(open.dialogFits && !open.dialogOverflowX, `sale dialog overflows at ${width}`);
    const available = await browser.evaluate('document.querySelector("[data-testid=store-fifo-available]")?.textContent');
    await browser.captureEvidence({ caseId: `fifo-sale-${width}`, step: 'open', expected: 'Store, Style, Size, available quantity and date shown; no Dispatch field', observed: `available=${available}` });
    const dialogText = await browser.evaluate('document.querySelector("[role=dialog]").textContent');
    assert.ok(!/select dispatch|dispatch id/i.test(dialogText), 'Distributor must not be asked for a Dispatch');

    // Validation: over the available quantity keeps the entry and blocks the request.
    await setQuantity(Number(available) + 50);
    const over = await browser.evaluate('({ text: document.querySelector("[role=dialog]").textContent, value: document.querySelector("[role=dialog] form input").value })');
    assert.ok(over.text.includes('available on'), 'validation message missing');
    assert.equal(over.value, String(Number(available) + 50), 'entered quantity must be kept');
    await browser.captureEvidence({ caseId: `fifo-sale-${width}`, step: 'validation', expected: 'Validation error shown; entered quantity kept', observed: over.text.slice(0, 200) });

    await setQuantity(sale.qty);
    await submit('Report sold');
    await browser.waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Sales Report recorded")');
    await browser.stabilize();
    const confirmation = await browser.evaluate(`(() => { const d = document.querySelector('[role=dialog]');
      return { items: [...d.querySelectorAll('ul[aria-label="Allocation by Dispatch"] li')].map(li => li.textContent), link: d.querySelector('a[href*="/distributor-sales-reports/"]')?.getAttribute('href') }; })()`);
    record({ width, step: 'sale-confirm', confirmation, ...(await overflow()) });
    assert.ok(confirmation.link, 'link to the Sales Report missing');
    if (width === 1440) {
      // 75 across the older (60) then newer (40) Dispatch: A=60 first, B=15.
      assert.equal(confirmation.items.length, 2);
      assert.ok(confirmation.items[0].endsWith('60') && confirmation.items[1].endsWith('15'), JSON.stringify(confirmation.items));
    }
    await browser.captureEvidence({ caseId: `fifo-sale-${width}`, step: 'confirmation', expected: 'Confirmation with source split and a link to the Sales Report', observed: JSON.stringify(confirmation) });

    // ISS-092: the linked Sales Report shows a valid submission date.
    await browser.evaluate(`document.querySelector('[role=dialog] a[href*="/distributor-sales-reports/"]').click()`);
    await browser.waitFor('location.pathname.startsWith("/fulfillment/distributor-sales-reports/") && document.body.textContent.includes("Submitted At")');
    await browser.stabilize();
    const detail = await browser.evaluate('({ text: document.body.textContent, scrollWidth: document.documentElement.scrollWidth })');
    assert.ok(!detail.text.includes('Invalid Date'), 'Sales Report detail shows "Invalid Date"');
    assert.ok(detail.scrollWidth <= width, `sales report detail overflows at ${width}`);
    record({ width, step: 'sales-report-detail', invalidDate: false });
    await browser.captureEvidence({ caseId: `fifo-sales-report-${width}`, step: 'detail', expected: 'Valid Submitted At, no "Invalid Date"', observed: 'ok', fullPage: true });

    // ---- Request return ----
    await openStore(ret.store === beta ? 'Beta' : 'Alpha');
    await clickAction(ret.store, `Request return, size ${ret.size}`);
    await setQuantity(ret.qty);
    await submit('Request return');
    await browser.waitFor('document.querySelector("[role=dialog] form")?.textContent.includes("A return reason is required")');
    await browser.captureEvidence({ caseId: `fifo-return-${width}`, step: 'validation', expected: 'Reason required; quantity kept', observed: 'reason error' });
    await browser.fill('[role=dialog] form input[placeholder^="e.g."]', 'End of season unsold stock');
    await submit('Request return');
    await browser.waitFor('document.querySelector("[role=dialog]")?.textContent.includes("Return request submitted")');
    await browser.stabilize();
    const retConfirm = await browser.evaluate(`(() => { const d = document.querySelector('[role=dialog]');
      return { items: [...d.querySelectorAll('ul[aria-label="Allocation by Dispatch"] li')].map(li => li.textContent), link: d.querySelector('a[href*="/distributor-returns/"]')?.getAttribute('href') }; })()`);
    record({ width, step: 'return-confirm', retConfirm, ...(await overflow()) });
    assert.ok(retConfirm.link, 'link to the Return missing');
    await browser.captureEvidence({ caseId: `fifo-return-${width}`, step: 'confirmation', expected: 'Return submitted with source split and link', observed: JSON.stringify(retConfirm) });
    await closeDialog();

    // The grid reflects the postings (sold/pending increased) and the page never overflows.
    await browser.waitFor('document.body.textContent.includes("Beta Plaza")');
    const grid = await browser.evaluate('({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth })');
    assert.ok(grid.scrollWidth <= width, `inventory page overflows at ${width}`);
    await browser.captureEvidence({ caseId: `fifo-grid-${width}`, step: 'after', expected: 'Grid refreshed, actions row visible, no page overflow', observed: JSON.stringify(grid), fullPage: true });
  }

  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.save?.();
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await browser?.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
