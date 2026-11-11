import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
import { a6BrowserTarget } from './safety.mjs';

// A6 / ISS-088 browser review against a disposable a6_browser_test database.
// Reproduce with TEST_DATABASE_URL=postgresql://.../a6_browser_test (and a
// different DATABASE_URL) then: node tools/retail-store-inventory/browser.mjs
const root = resolve(import.meta.dirname, '../..');
const target = a6BrowserTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const output = await mkdtemp(join(tmpdir(), 'erve-a6-browser-'));
const appUrl = 'http://127.0.0.1:5196';
const apiUrl = 'http://127.0.0.1:4196';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/a6_guard',
  TEST_DATABASE_URL: target,
  JWT_ACCESS_SECRET: 'a6-disposable-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'a6-disposable-refresh-secret-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '1h',
  FILE_STORAGE_DIR: join(output, 'uploads'),
  A6_FIXTURES: join(output, 'fixtures.json'),
  HOST: '127.0.0.1',
  PORT: '4196',
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
let browser;
try {
  const seed = launch(
    process.execPath,
    [
      resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'),
      'tools/retail-store-inventory/fixtures.mts',
    ],
    'fixtures',
  );
  const code = await new Promise((ok, fail) => {
    seed.once('exit', ok);
    seed.once('error', fail);
  });
  assert.equal(code, 0, `Fixture setup failed; see ${output}`);
  const fixture = JSON.parse(await readFile(env.A6_FIXTURES, 'utf8'));
  const api = launch(
    process.execPath,
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'],
    'api',
    resolve(root, 'apps/api'),
    { DATABASE_URL: target },
  );
  const web = launch(
    process.execPath,
    [
      resolve(root, 'apps/web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5196',
      '--strictPort',
    ],
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
      '--remote-debugging-port=9296',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    'chrome',
  );
  await ready('http://127.0.0.1:9296/json/version', chromeProcess);
  browser = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9296',
    appUrl,
    output,
    repositoryRoot: root,
  });

  const results = [];
  for (const role of ['distributor', 'accountant', 'admin']) {
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

    for (const width of [1440, 375]) {
      await browser.viewport(width, 1000, width === 375);
      await browser.navigateTo('/fulfillment/retail-store-inventory');
      await browser.waitFor('document.body.textContent.includes("Beta Plaza")');
      // Expand every Store so all Style grids are mounted.
      await browser.evaluate(
        `(() => { for (const b of document.querySelectorAll('section[aria-label^="Retail Store"] h3 button[aria-expanded="false"]')) b.click(); })()`,
      );
      await browser.waitFor(
        'document.querySelectorAll("section[aria-label^=\\"Retail Store\\"] h3 button[aria-expanded=\\"false\\"]").length === 0',
      );
      await browser.stabilize();
      // Thumbnails load lazily (near-viewport only) through the authenticated image endpoint.
      await browser.evaluate(
        `document.querySelector('section[aria-label="TEE-2027 Sale-or-Return"]')?.scrollIntoView({ block: 'center' })`,
      );
      await browser
        .waitFor(
          `[...document.querySelectorAll('section[aria-label$="Sale-or-Return"] img')].some(i => i.complete && i.naturalWidth > 0)`,
          15000,
        )
        .catch(() => {});
      // Scroll every Style card into view (one after another) so each lazy thumbnail has loaded or
      // been proven absent: the Tee cards must load, the Jeans cards (no image) must stay placeholders.
      const cardCount = await browser.evaluate(
        `document.querySelectorAll('section[aria-label^="TEE-2027"], section[aria-label^="JEAN-2027"]').length`,
      );
      for (let index = 0; index < cardCount; index++) {
        await browser.evaluate(
          `document.querySelectorAll('section[aria-label^="TEE-2027"], section[aria-label^="JEAN-2027"]')[${index}].scrollIntoView({ block: 'center' })`,
        );
        await delay(700);
      }
      await browser
        .waitFor(
          `[...document.querySelectorAll('section[aria-label^="TEE-2027"]')].every(c => [...c.querySelectorAll('header img')].every(i => i.complete && i.naturalWidth > 0))`,
          15000,
        )
        .catch(() => {});
      const result = await browser.evaluate(`(() => {
        const text = document.body.textContent;
        const tables = [...document.querySelectorAll('table[aria-label$="quantities by size"]')];
        const thumbs = [...document.querySelectorAll('section[aria-label$="Sale-or-Return"] img, section[aria-label$="Outright"] img')];
        const alpha = [...document.querySelectorAll('section[aria-label^="Retail Store"]')].find(s => s.getAttribute('aria-label').includes('Alpha Mall'));
        const tee = alpha && [...alpha.querySelectorAll('table')].find(t => t.getAttribute('aria-label').startsWith('TEE-2027'));
        return {
          role: ${JSON.stringify(role)}, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          stores: document.querySelectorAll('section[aria-label^="Retail Store"]').length,
          tables: tables.length,
          sizeHeadersTee: tee ? [...tee.querySelectorAll('thead th')].map(th => th.textContent.replace('*','')).slice(1, -1).map(t => t.replace(/-[a-z0-9]{4}$/i, '')) : null,
          tablesScrollInternally: tables.every(t => t.parentElement.scrollWidth >= t.parentElement.clientWidth),
          pageOverflowFromTables: tables.some(t => t.parentElement.getBoundingClientRect().right > innerWidth + 1),
          loadedThumbnails: thumbs.filter(i => i.complete && i.naturalWidth > 0).length,
          teeCardImages: [...document.querySelectorAll('section[aria-label^="TEE-2027"]')].map(c => c.querySelectorAll('header img').length),
          jeansCardImages: [...document.querySelectorAll('section[aria-label^="JEAN-2027"]')].map(c => c.querySelectorAll('header img').length),
          jeansPlaceholders: [...document.querySelectorAll('section[aria-label^="JEAN-2027"]')].map(c => c.querySelectorAll('header svg[aria-hidden="true"]').length),
          jeansViewerButtons: document.querySelectorAll('section[aria-label^="JEAN-2027"] button[aria-label="View style image"]').length,
          hasUnmapped: text.includes('Unmapped historical destination'),
          hasAwaiting: text.includes('awaiting Distributor confirmation'),
          hasShortage: text.includes('Shortage 10 pcs'),
          hasLegacy: text.includes('legacy assumed receipt'),
          hasOutrightNote: text.includes('not available for Outright'),
          hasNotRecorded: text.includes('n/r'),
          reportButtons: /Report Sold|Request Return/.test(text),
          offenders: [...document.querySelectorAll('body *')]
            .filter(e => { if (e.getBoundingClientRect().right <= innerWidth + 1) return false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; } return true; })
            .slice(0, 8).map(e => e.tagName + '.' + String(e.className).slice(0, 80) + ' r=' + Math.round(e.getBoundingClientRect().right)),
        };
      })()`);
      if (result.scrollWidth > width) {
        await browser.captureEvidence({
          caseId: `a6-${role}-overflow-${width}`,
          step: 'diagnostic',
          expected: 'no overflow',
          observed: JSON.stringify(result.offenders),
          status: 'FAIL',
          fullPage: false,
        });
        console.log(JSON.stringify({ output, offenders: result.offenders }));
        await browser.navigateTo('/fulfillment/sale-or-return');
        await delay(1500);
        console.log(
          'BASELINE sale-or-return scrollWidth',
          await browser.evaluate('document.documentElement.scrollWidth'),
        );
        await browser.navigateTo('/fulfillment/retail-store-inventory');
      }
      assert.ok(
        result.scrollWidth <= width,
        `${role} overflows at ${width}: ${result.scrollWidth}`,
      );
      assert.equal(
        result.pageOverflowFromTables,
        false,
        `${role}: a grid pushes past the viewport at ${width}`,
      );
      assert.equal(result.tablesScrollInternally, true);
      assert.equal(result.stores, 3);
      assert.equal(
        result.hasUnmapped &&
          result.hasAwaiting &&
          result.hasShortage &&
          result.hasLegacy &&
          result.hasOutrightNote &&
          result.hasNotRecorded,
        true,
        JSON.stringify(result),
      );
      assert.equal(result.reportButtons, false);
      // IMG-25: every inventory viewer sees the Tee's image; the Jeans (no image) show the placeholder only.
      assert.ok(result.loadedThumbnails >= 1, `${role} should see Style thumbnails`);
      assert.ok(
        result.teeCardImages.length >= 1 && result.teeCardImages.every((n) => n === 1),
        `${role}: every Tee card should show its image ${JSON.stringify(result.teeCardImages)}`,
      );
      assert.ok(
        result.jeansCardImages.length >= 1 && result.jeansCardImages.every((n) => n === 0),
        `${role}: Jeans must not render an image ${JSON.stringify(result.jeansCardImages)}`,
      );
      assert.ok(
        result.jeansPlaceholders.every((n) => n >= 1),
        `${role}: Jeans placeholder missing`,
      );
      assert.equal(
        result.jeansViewerButtons,
        0,
        `${role}: a Style without an image must not open a viewer`,
      );
      results.push(result);
      await browser.captureEvidence({
        caseId: `a6-${role}-list-${width}`,
        step: 'review',
        expected: 'No page overflow; native size columns; evidence flags and n/r visible',
        observed: JSON.stringify(result),
        fullPage: true,
      });

      // The thumbnail opens the shared full-resolution viewer (gallery list + authenticated bytes).
      await browser.evaluate(
        `(() => { const b = document.querySelector('section[aria-label^="TEE-2027"] button[aria-label="View style image"]'); b.scrollIntoView({ block: 'center' }); b.click(); })()`,
      );
      await browser.waitFor(
        '[...document.querySelectorAll("[role=dialog] img")].some(i => i.complete && i.naturalWidth > 0)',
        15000,
      );
      await browser.stabilize();
      const viewer = await browser.evaluate(`(() => {
        const d = document.querySelector('[role=dialog]');
        const r = d.getBoundingClientRect();
        return { title: d.textContent.includes('TEE-2027'), fits: r.left >= -1 && r.right <= innerWidth + 1,
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      assert.ok(viewer.fits && !viewer.pageOverflow, `${role}: image viewer overflows at ${width}`);
      await browser.captureEvidence({
        caseId: `img25-${role}-viewer-${width}`,
        step: 'review',
        expected: 'Thumbnail opens the existing image viewer with the Style image loaded',
        observed: JSON.stringify(viewer),
        fullPage: false,
      });
      await browser.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      );
      await browser.waitFor('!document.querySelector("[role=dialog]")', 5000);

      // Drilldown from a real cell.
      await browser.evaluate(
        `document.querySelector('table[aria-label^="TEE-2027"] button[aria-label^="Shipped, size M"]').click()`,
      );
      await browser.waitFor(
        '!!document.querySelector("[role=dialog]") && document.querySelectorAll("[data-testid=inventory-source]").length >= 2',
      );
      await browser.stabilize();
      const dialog = await browser.evaluate(`(() => {
        const d = document.querySelector('[role=dialog]');
        const r = d.getBoundingClientRect();
        return { sources: d.querySelectorAll('[data-testid=inventory-source]').length, text: d.textContent,
          fits: r.left >= -1 && r.right <= innerWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      assert.equal(dialog.sources, 2);
      assert.ok(dialog.fits && !dialog.pageOverflow, `${role}: drilldown overflows at ${width}`);
      assert.ok(
        dialog.text.includes('Awaiting confirmation') &&
          dialog.text.includes('Distributor receipt'),
      );
      await browser.captureEvidence({
        caseId: `a6-${role}-drilldown-${width}`,
        step: 'review',
        expected: 'Both contributing Dispatches listed; receipt, ledger and QR labelled separately',
        observed: JSON.stringify({ sources: dialog.sources, fits: dialog.fits }),
        fullPage: false,
      });
      await browser.evaluate(
        `document.querySelector('[role=dialog] button[aria-label=Close], [role=dialog] [data-radix-dialog-close]')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`,
      );
      await delay(300);
    }
  }
  // Unauthorized image requests are denied over real HTTP: the review Distributor asking for the image
  // of a Style that is on none of its records (gallery list and bytes), and an anonymous caller.
  const login = async (email) => {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: fixture.password }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).data.accessToken;
  };
  const distributorToken = await login(fixture.emails.distributor);
  const accountantToken = await login(fixture.emails.accountant);
  const get = (path, token) =>
    fetch(`${apiUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const { styleId, imageId } = fixture.foreign;
  const denials = [];
  for (const path of [
    `/styles/${styleId}/images`,
    `/styles/${styleId}/images/${imageId}/content`,
  ]) {
    const denied = await get(path, distributorToken);
    denials.push({ role: 'distributor', path, status: denied.status });
    assert.equal(denied.status, 403, `distributor must be denied ${path}`);
    assert.ok(!/image\//.test(denied.headers.get('content-type') ?? ''));
    assert.equal((await get(path, null)).status, 401, `anonymous must be denied ${path}`);
    // The Accountant, by approved policy, may read any Style image.
    assert.equal((await get(path, accountantToken)).status, 200);
  }
  results.push({ unauthorizedImageDenials: denials });
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, results }));
} finally {
  await browser?.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
