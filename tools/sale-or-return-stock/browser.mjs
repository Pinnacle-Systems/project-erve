import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
import { sorStockBrowserTarget } from './safety.mjs';

// Real-browser acceptance of the Style-first Sale-or-Return Stock screens against a disposable
// sor_stock_browser_test database (synthetic data only). Reproduce with
//   TEST_DATABASE_URL=postgresql://.../sor_stock_browser_test  (and a different DATABASE_URL)
//   node tools/sale-or-return-stock/browser.mjs
// Evidence (screenshots, results.json) is written to a temp directory outside the repository.
const root = resolve(import.meta.dirname, '../..');
const target = sorStockBrowserTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const output = await mkdtemp(join(tmpdir(), 'erve-sor-stock-browser-'));
const appUrl = 'http://127.0.0.1:5197';
const apiUrl = 'http://127.0.0.1:4197';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/sor_stock_guard',
  TEST_DATABASE_URL: target,
  JWT_ACCESS_SECRET: 'sor-stock-disposable-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'sor-stock-disposable-refresh-secret-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '1h',
  FILE_STORAGE_DIR: join(output, 'uploads'),
  SOR_STOCK_FIXTURES: join(output, 'fixtures.json'),
  HOST: '127.0.0.1',
  PORT: '4197',
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
};
const children = [];
function launch(binary, args, name, cwd = root, overrides = {}) {
  const child = spawn(binary, args, {
    cwd,
    env: { ...env, ...overrides },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

/** Page metrics shared by every screen: page overflow, offenders and internal scrollers. */
const GEOMETRY = `(() => ({
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  offenders: [...document.querySelectorAll('body *')]
    .filter((e) => {
      if (e.getBoundingClientRect().right <= innerWidth + 1) return false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return false;
      }
      return true;
    })
    .slice(0, 8)
    .map((e) => e.tagName + '.' + String(e.className).slice(0, 80) + ' r=' + Math.round(e.getBoundingClientRect().right)),
}))()`;

let browser;
try {
  const seed = launch(
    process.execPath,
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'tools/sale-or-return-stock/fixtures.mts'],
    'fixtures',
  );
  const code = await new Promise((ok, fail) => {
    seed.once('exit', ok);
    seed.once('error', fail);
  });
  assert.equal(code, 0, `Fixture setup failed; see ${output}`);
  const fixture = JSON.parse(await readFile(env.SOR_STOCK_FIXTURES, 'utf8'));
  const api = launch(
    process.execPath,
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'],
    'api',
    resolve(root, 'apps/api'),
    { DATABASE_URL: target },
  );
  const web = launch(
    process.execPath,
    [resolve(root, 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5197', '--strictPort'],
    'web',
    resolve(root, 'apps/web'),
  );
  await Promise.all([ready(`${apiUrl}/health`, api), ready(appUrl, web)]);
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
  assert.ok(chrome, 'Chromium required');
  const chromeProcess = launch(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9297',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    'chrome',
  );
  await ready('http://127.0.0.1:9297/json/version', chromeProcess);
  browser = await CdpDriver.connect({ endpoint: 'http://127.0.0.1:9297', appUrl, output, repositoryRoot: root });

  const results = [];
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
  const stat = (card, label) =>
    `(() => { const c = document.querySelector('[data-testid="stock-style"][aria-label="${card}"]'); const dt = c && [...c.querySelectorAll('dt')].find((d) => d.textContent === '${label}'); return dt ? dt.nextElementSibling.textContent : null; })()`;
  const sourceRows = '[...document.querySelectorAll("[data-testid=stock-source]")].length';

  // Expected quantities (see fixtures.mts): Distributor A Tee = 205 dispatched, Distributor B Tee = 18, Jeans (Outright excluded) = 15.
  const expectations = {
    distributorA: { tee: '205', hood: false, filter: false, submit: true, distributors: 1, sources: 33 },
    accountant: { tee: '223', hood: true, filter: false, submit: false, distributors: 2, sources: 34 },
    merchandiser: { tee: '223', hood: true, filter: true, submit: false, distributors: 2, sources: 34 },
    admin: { tee: '223', hood: true, filter: true, submit: true, distributors: 2, sources: 34 },
  };

  for (const role of Object.keys(expectations)) {
    const want = expectations[role];
    await login(role);
    for (const width of [1440, 375]) {
      await browser.viewport(width, 1000, width === 375);

      // ---- Level 1: one row per Style ------------------------------------------------------
      await browser.navigateTo('/fulfillment/sale-or-return');
      await browser.waitFor('document.querySelectorAll("[data-testid=stock-style]").length >= 2');
      await browser.stabilize();
      const list = await browser.evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-testid="stock-style"]')].map((e) => e.getAttribute('aria-label'));
        const text = document.body.textContent;
        const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
        return {
          role: ${JSON.stringify(role)}, rows,
          filter: !!document.querySelector('input[placeholder="All Distributors"]'),
          notRecorded: text.includes('n/r'),
          approvedNote: text.includes('approved returns awaiting receipt'),
          pendingNote: text.includes('pending return requests'),
          awaitingNote: text.includes('awaiting Distributor receipt evidence'),
          submit: buttons.includes('Report Sold / Request Return by Dispatch'),
          readOnlyLink: buttons.includes('Dispatch-wise positions'),
          geometry: ${GEOMETRY},
        };
      })()`);
      const teeDispatched = await browser.evaluate(stat('TEE-2027', 'Dispatched'));
      assert.ok(list.geometry.scrollWidth <= width, `${role} list overflows at ${width}: ${JSON.stringify(list.geometry.offenders)}`);
      assert.equal(list.rows.filter((r) => r === 'TEE-2027').length, 1, `${role}: Tee must be one consolidated row`);
      assert.ok(list.rows.includes('JEAN-2027'), `${role}: jeans missing`);
      assert.equal(list.rows.includes('HOOD-2027'), want.hood, `${role}: HOOD-2027 visibility`);
      assert.equal(teeDispatched, want.tee, `${role}: Tee dispatched total ${teeDispatched}`);
      assert.equal(await browser.evaluate(stat('JEAN-2027', 'Dispatched')), '15', `${role}: Outright jeans must be excluded`);
      assert.equal(list.filter, want.filter, `${role}: Distributor filter visibility`);
      assert.equal(list.submit, want.submit, `${role}: by-Dispatch submit entry point`);
      assert.equal(list.readOnlyLink, !want.submit, `${role}: read-only Dispatch-wise link`);
      assert.ok(list.notRecorded && list.pendingNote && list.approvedNote && list.awaitingNote, `${role}: evidence notes ${JSON.stringify(list)}`);
      results.push({ screen: 'list', width, ...list, teeDispatched });
      await browser.captureEvidence({
        caseId: `sor-stock-${role}-list-${width}`,
        step: 'review',
        expected: 'One row per Style; stats, n/r and return notes visible; no page overflow',
        observed: JSON.stringify({ rows: list.rows, teeDispatched, scrollWidth: list.geometry.scrollWidth }),
        fullPage: true,
      });

      // ---- Distributor filter and clearing (Merchandiser / Admin) ---------------------------
      if (want.filter) {
        await browser.navigateTo(`/fulfillment/sale-or-return?distributorId=${fixture.distributorAId}`);
        await browser.waitFor('document.querySelectorAll("[data-testid=stock-style]").length >= 1 && !document.body.textContent.includes("Loading")');
        await browser.stabilize();
        const filtered = await browser.evaluate(`(() => ({
          rows: [...document.querySelectorAll('[data-testid="stock-style"]')].map((e) => e.getAttribute('aria-label')),
          clear: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Clear Distributor filter (show all Distributors)'),
          scrollWidth: document.documentElement.scrollWidth,
        }))()`);
        assert.equal(filtered.rows.includes('HOOD-2027'), false, `${role}: filtered to A must hide B-only Style`);
        assert.equal(await browser.evaluate(stat('TEE-2027', 'Dispatched')), '205');
        assert.ok(filtered.clear && filtered.scrollWidth <= width, `${role}: clear button / overflow ${JSON.stringify(filtered)}`);
        await browser.captureEvidence({
          caseId: `sor-stock-${role}-filtered-${width}`,
          step: 'review',
          expected: 'Filtered to Distributor A: B-only Style hidden, Clear Distributor filter offered',
          observed: JSON.stringify(filtered),
          fullPage: false,
        });
        await browser.clickButton('Clear Distributor filter (show all Distributors)');
        await browser.waitFor('document.querySelectorAll("[data-testid=stock-style]").length >= 3');
        assert.equal(await browser.evaluate(stat('TEE-2027', 'Dispatched')), '223', `${role}: clearing restores all-Distributor totals`);
      }

      // ---- Levels 2-4: Style detail ----------------------------------------------------------
      await browser.navigateTo(`/fulfillment/sale-or-return/styles/${fixture.teeStyleId}`);
      await browser.waitFor('!!document.querySelector("table[aria-label=\\"TEE-2027 consolidated stock by size\\"]") && document.querySelectorAll("[data-testid=stock-source]").length > 0');
      await browser.stabilize();
      const detail = await browser.evaluate(`(() => {
        const t = document.querySelector('table[aria-label="TEE-2027 consolidated stock by size"]');
        const text = document.body.textContent;
        const wrap = t.parentElement;
        const src = document.querySelector('table[aria-label="Contributing dispatches"]');
        return {
          role: ${JSON.stringify(role)},
          sizes: [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace('*', '')).slice(1, -1).map((s) => s.replace(/-[a-z0-9]{4}$/i, '')),
          rowLabels: [...t.querySelectorAll('tbody th[scope=row]')].map((th) => th.textContent),
          oneBlock: document.querySelectorAll('table[aria-label$="consolidated stock by size"]').length,
          matrixScrollsInternally: wrap.scrollWidth >= wrap.clientWidth && wrap.getBoundingClientRect().right <= innerWidth + 1,
          sourceScrollsInternally: src.parentElement.getBoundingClientRect().right <= innerWidth + 1,
          distributors: document.querySelectorAll('[data-testid="stock-distributor"]').length,
          sources: ${sourceRows},
          loadMore: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Load more'),
          oldLabel: text.includes('Awaiting Receipt'),
          approvedLabel: text.includes('Approved returns awaiting receipt'),
          notRecorded: text.includes('n/r'),
          image: !!document.querySelector('img'),
          geometry: ${GEOMETRY},
        };
      })()`);
      assert.ok(detail.geometry.scrollWidth <= width, `${role} detail overflows at ${width}: ${JSON.stringify(detail.geometry.offenders)}`);
      assert.deepEqual(detail.sizes, ['S', 'M', 'L', 'XL'], `${role}: native size order`);
      assert.equal(detail.oneBlock, 1);
      assert.ok(detail.matrixScrollsInternally && detail.sourceScrollsInternally, `${role}: wide tables must scroll inside their own container at ${width}`);
      assert.equal(detail.distributors, want.distributors, `${role}: Distributor sections`);
      assert.equal(detail.sources, 25, `${role}: first Dispatch page is 25 of ${want.sources}`);
      assert.ok(detail.loadMore, `${role}: Load more expected`);
      assert.equal(detail.oldLabel, false);
      assert.ok(detail.approvedLabel && detail.notRecorded);
      assert.ok(detail.image, `${role}: Style image expected`);
      results.push({ screen: 'detail', width, ...detail });
      await browser.captureEvidence({
        caseId: `sor-stock-${role}-detail-${width}`,
        step: 'review',
        expected: 'One native Size matrix; Distributor sections; paginated Dispatch table; no page overflow',
        observed: JSON.stringify({ sizes: detail.sizes, distributors: detail.distributors, sources: detail.sources }),
        fullPage: true,
      });

      // Load more: the remaining Dispatches arrive, the totals above are unchanged.
      await browser.clickButton('Load more');
      await browser.waitFor(`${sourceRows} === ${want.sources}`);
      assert.ok(await browser.evaluate('document.body.textContent.includes("(all loaded)")'));

      // Open the first Distributor's Stores (lazy), then filter the Dispatches by that Store.
      // A single Distributor opens by default; otherwise open the first one.
      await browser.evaluate(`(() => { const b = document.querySelector('[data-testid="stock-distributor"] button[aria-expanded]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
      await browser.waitFor('document.querySelectorAll("[data-testid=stock-store]").length >= 1');
      await browser.stabilize();
      const stores = await browser.evaluate(`(() => ({
        stores: [...document.querySelectorAll('[data-testid="stock-store"]')].map((s) => s.textContent.slice(0, 60)),
        scrollWidth: document.documentElement.scrollWidth,
      }))()`);
      assert.ok(stores.scrollWidth <= width, `${role}: store rows overflow at ${width}`);
      await browser.captureEvidence({
        caseId: `sor-stock-${role}-stores-${width}`,
        step: 'review',
        expected: 'Distributor expanded to its Retail Stores without page overflow',
        observed: JSON.stringify(stores),
        fullPage: false,
      });

      // A Size cell drills into that Size's Dispatches and can be cleared.
      await browser.evaluate(`document.querySelector('table[aria-label="TEE-2027 consolidated stock by size"] button[aria-label^="Dispatched, size L"]').click()`);
      await browser.waitFor(`document.body.textContent.includes("Showing dispatches for:") && ${sourceRows} === 1`);
      const drilled = await browser.evaluate(`(() => ({ chip: document.body.textContent.includes('Size L'), rows: ${sourceRows}, scrollWidth: document.documentElement.scrollWidth }))()`);
      assert.ok(drilled.chip && drilled.rows === 1 && drilled.scrollWidth <= width, `${role}: Size drilldown ${JSON.stringify(drilled)}`);
      await browser.clickButton('Show all dispatches');
      // The unfiltered list returns from the query cache (the pages already loaded stay loaded).
      await browser.waitFor(`${sourceRows} >= 25`);

      // ---- The per-Dispatch screen is still there for Report Sold / Request Return --------------
      if (want.submit && role !== 'admin') {
        await browser.navigateTo('/fulfillment/sale-or-return/by-dispatch');
        await browser.waitFor('document.body.textContent.includes("Approved Returns Awaiting Receipt")');
        const legacy = await browser.evaluate(`(() => ({
          title: document.body.textContent.includes('Sale-or-Return Stock by Dispatch'),
          sold: !!document.querySelector('input[aria-label*="sold quantity to report"]'),
          ret: !!document.querySelector('input[aria-label*="goods quantity to return"]'),
          oldLabel: document.body.textContent.includes('Awaiting Receipt') && !document.body.textContent.includes('Approved Returns Awaiting Receipt'),
          scrollWidth: document.documentElement.scrollWidth,
        }))()`);
        assert.ok(legacy.title && legacy.sold && legacy.ret && !legacy.oldLabel, `${role}: by-Dispatch screen ${JSON.stringify(legacy)}`);
        results.push({ screen: 'by-dispatch', role, width, ...legacy });
        await browser.captureEvidence({
          caseId: `sor-stock-${role}-by-dispatch-${width}`,
          step: 'review',
          expected: 'Existing Dispatch-by-Dispatch screen with Report Sold / Request Return inputs and the renamed label',
          observed: JSON.stringify(legacy),
          fullPage: false,
        });
      }
    }
  }

  // ---- Server-side Distributor scope over real HTTP -------------------------------------------
  const apiLogin = async (email) => {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: fixture.password }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).data.accessToken;
  };
  const tokenA = await apiLogin(fixture.emails.distributorA);
  const get = (path, token) => fetch(`${apiUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const checks = [];
  const forbidden = await get(`/sale-or-return-stock/styles?distributorId=${fixture.distributorBId}`, tokenA);
  checks.push({ check: 'Distributor A asking for Distributor B', status: forbidden.status });
  assert.equal(forbidden.status, 403);
  const own = await (await get('/sale-or-return-stock/styles?limit=100', tokenA)).text();
  assert.ok(!own.includes('Review Distributor B') && !own.includes(fixture.distributorBId) && !own.includes('HOOD-2027'), 'no Distributor B data in Distributor A responses');
  checks.push({ check: 'Distributor A list contains nothing of Distributor B', ok: true });
  assert.equal((await get('/sale-or-return-stock/styles', null)).status, 401);
  results.push({ serverScope: checks });

  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, summary: results.map((r) => ({ screen: r.screen, role: r.role, width: r.width })) }));
} finally {
  await browser?.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
