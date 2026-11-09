import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
import { a5BrowserTarget } from './safety.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = a5BrowserTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const output = await mkdtemp(join(tmpdir(), 'erve-a5-browser-'));
const appUrl = 'http://127.0.0.1:5195',
  apiUrl = 'http://127.0.0.1:4195';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/a5_guard',
  TEST_DATABASE_URL: target,
  JWT_ACCESS_SECRET: 'a5-disposable-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'a5-disposable-refresh-secret-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '1h',
  FILE_STORAGE_DIR: join(output, 'uploads'),
  A5_FIXTURES: join(output, 'fixtures.json'),
  HOST: '127.0.0.1',
  PORT: '4195',
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
      'tools/post-dispatch-reconciliation/fixtures.mts',
    ],
    'fixtures',
  );
  const code = await new Promise((ok, fail) => {
    seed.once('exit', ok);
    seed.once('error', fail);
  });
  assert.equal(code, 0, `Fixture setup failed; see ${output}`);
  const fixture = JSON.parse(await readFile(env.A5_FIXTURES, 'utf8'));
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
      '5195',
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
      '--remote-debugging-port=9295',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    'chrome',
  );
  await ready('http://127.0.0.1:9295/json/version', chromeProcess);
  browser = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9295',
    appUrl,
    output,
    repositoryRoot: root,
  });
  await browser.viewport(1440, 1000);
  await browser.navigateTo('/login');
  await browser.waitFor('!!document.querySelector("#identifier")');
  await browser.fill('#identifier', fixture.email);
  await browser.fill('#password', fixture.password);
  await browser.clickButton('Sign in');
  try {
    await browser.waitFor('location.pathname !== "/login"');
  } catch (error) {
    await writeFile(
      join(output, 'login-diagnostic.json'),
      JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')),
    );
    throw error;
  }
  const results = [];
  for (const width of [1440, 375]) {
    await browser.viewport(width, 1000, width === 375);
    for (const [name, path, text] of [
      ['queue', '/fulfillment/erve-dispatches/reconciliation', 'Open reconciliation'],
      [
        'detail',
        `/fulfillment/erve-dispatches/${fixture.dispatchId}?tab=reconciliation`,
        'Internal reconciliation review history',
      ],
    ]) {
      await browser.navigateTo(path);
      await browser.waitFor(`document.body.textContent.includes(${JSON.stringify(text)})`);
      await browser.stabilize();
      const result = await browser.evaluate(
        `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,quantityInputs:document.querySelectorAll('[role="tabpanel"][data-state="active"] input[type="number"]').length,hasFollowUp:document.body.textContent.includes('Follow-up required')})`,
      );
      assert.ok(
        result.scrollWidth <= width,
        `${name} overflows at ${width}: ${result.scrollWidth}`,
      );
      assert.equal(result.quantityInputs, 0);
      assert.equal(result.hasFollowUp, true);
      results.push({ name, ...result });
      await browser.captureEvidence({
        caseId: `a5-${name}-${width}`,
        step: 'review',
        expected: 'No page overflow; source evidence and follow-up visible; no quantity editing',
        observed: JSON.stringify(result),
        fullPage: true,
      });
    }
  }
  await browser.fill(
    'textarea',
    'Browser review: investigate distributor shortage; no correction authorized.',
  );
  await browser.clickButton('Record review');
  await browser.waitFor(
    "document.body.textContent.includes('Review recorded. No quantities or financial records changed.')",
  );
  results.push({ reviewSaved: true });
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, results }));
} finally {
  await browser?.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
