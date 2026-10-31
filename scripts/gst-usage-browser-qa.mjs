// Real Chromium against the real web app, with the DB-free GST usage QA harness.
// MOCKED transport only: no database, no external provider request, no credits.
// Run from the repository root after `pnpm install` and `prisma generate`:
//   node scripts/gst-usage-browser-qa.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../tools/pr8/cdp-driver.mjs';

const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(
  join(process.env.GST_USAGE_QA_EVIDENCE_ROOT || tmpdir(), 'erve-gst-usage-'),
);
const appUrl = 'http://127.0.0.1:5191';
const apiUrl = 'http://127.0.0.1:4121';
const chromePort = 9293;
const SYNTHETIC_KEY = 'qa-synthetic-key-never-transmitted';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  GST_USAGE_QA_AUTHORIZED: 'true',
  DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:1/gst_usage_qa_unreachable',
  JWT_ACCESS_SECRET: 'qa-access-secret-at-least-32-characters-long',
  JWT_REFRESH_SECRET: 'qa-refresh-secret-at-least-32-characters-long',
  JWT_ACCESS_EXPIRES_IN: '1h',
  HOST: '127.0.0.1',
  PORT: '4121',
  QA_APP_ORIGIN: appUrl,
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
};
const children = [];
// A stale server from an earlier run would silently supply a polluted journal.
for (const url of [`${apiUrl}/health`, appUrl, `http://127.0.0.1:${chromePort}/json/version`]) {
  const inUse = await fetch(url).then(
    () => true,
    () => false,
  );
  assert.ok(!inUse, `Port already in use (${url}); stop the stale process before running`);
}
// tsx and vite spawn grandchildren; kill the whole tree so nothing outlives the run.
const killTree = (child) => {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
};
function launch(command, args, name, cwd) {
  const child = spawn(command, args, {
    cwd,
    env,
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
  for (let n = 0; n < 1200; n++) {
    if (child.exitCode !== null)
      throw new Error(`Process exited before ready: ${url}; see ${output}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  throw new Error(`Readiness timed out: ${url}; see ${output}`);
}
const proof = {
  transport: 'MOCKED (no database, no external provider)',
  checks: [],
  evidenceDirectory: output,
};
function check(name, condition, details = '') {
  if (!condition) throw new Error(`CHECK FAILED: ${name} ${details}`);
  proof.checks.push({ name, passed: true, details });
  console.log(`PASS ${name}`);
}
const journal = async () => (await fetch(`${apiUrl}/__qa/calls`)).json();
const usageCalls = async () =>
  (await journal()).calls.filter((c) => c.path === '/v1/gstin/stats/me').length;
const setMode = (mode) =>
  fetch(`${apiUrl}/__qa/usage-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });

let driver;
try {
  const server = launch(
    process.execPath,
    [
      resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'),
      resolve(root, 'scripts/gst-usage-browser-qa-server.mts'),
    ],
    'api',
    resolve(root, 'apps/api'),
  );
  const web = launch(
    process.execPath,
    [
      resolve(root, 'apps/web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5191',
      '--strictPort',
    ],
    'web',
    resolve(root, 'apps/web'),
  );
  await Promise.all([ready(`${apiUrl}/health`, server), ready(appUrl, web)]);
  const chrome = [
    process.env.CHROME_BINARY,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
  ].find((p) => p && existsSync(p));
  assert.ok(chrome, 'An installed Chromium browser is required');
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  children.push(browser);
  await ready(`http://127.0.0.1:${chromePort}/json/version`, browser);
  driver = await CdpDriver.connect({
    endpoint: `http://127.0.0.1:${chromePort}`,
    appUrl,
    output,
    repositoryRoot: root,
  });
  await driver.command('Page.bringToFront');
  await driver.command('Emulation.setFocusEmulationEnabled', { enabled: true });
  const pageReady = `document.readyState === 'complete' && !!document.querySelector('#root')?.firstElementChild`;
  await driver.command('Page.navigate', { url: `${appUrl}/login` });
  await driver.waitFor(pageReady, 120000);

  async function signInAs(role) {
    const { accessToken, session } = await (
      await fetch(`${apiUrl}/__qa/token?role=${role}`)
    ).json();
    await driver.evaluate(`(() => {
      sessionStorage.setItem('erve.accessToken', ${JSON.stringify(accessToken)});
      localStorage.setItem('erve.sessionTiming', JSON.stringify(${JSON.stringify(session)}));
    })()`);
    const origin = await driver.evaluate('performance.timeOrigin');
    await driver.command('Page.navigate', { url: `${appUrl}/gst-compliance/settings` });
    await driver.waitFor(`performance.timeOrigin !== ${origin} && ${pageReady}`, 120000);
    await driver.stabilize();
    return accessToken;
  }
  const text = () => driver.evaluate('document.body.innerText');
  const buttonState = (label) =>
    driver.evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(n => n.textContent.includes(${JSON.stringify(label)})); return b ? { disabled: b.disabled } : null; })()`,
    );
  const clickByLabel = (selector, label) =>
    driver.evaluate(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(n => (n.getAttribute('aria-label') === ${JSON.stringify(label)}) || document.querySelector('label[for="' + n.id + '"]')?.textContent.includes(${JSON.stringify(label)})); if (!el) throw Error('Missing ' + ${JSON.stringify(label)}); el.click(); })()`,
    );
  const values = () =>
    driver.evaluate(`[...document.querySelectorAll('dd')].slice(0, 4).map(n => n.textContent)`);
  const waitText = (needle, timeout = 15000) =>
    driver.waitFor(`document.body.innerText.includes(${JSON.stringify(needle)})`, timeout);

  // ---- 1. ACCOUNTANT, desktop: renders, no request on open -------------------------------
  const accountantToken = await signInAs('ACCOUNTANT');
  await driver.viewport(1440, 900);
  await waitText("GSTINAPI — Today's Usage");
  check(
    'Accountant sees the usage section and Refresh button',
    (await text()).includes('Refresh Usage'),
  );
  check(
    'Usage section states it is for the server-configured key',
    (await text()).includes('API key configured on the ERVE server'),
  );
  check(
    'Initial state invites a manual refresh',
    (await text()).includes('Usage has not been retrieved'),
  );
  await delay(1500);
  check(
    'No provider request on page open (idle 1.5s)',
    (await usageCalls()) === 0,
    JSON.stringify({ journal: await journal(), api: driver.responses.map((r) => r.path) }),
  );
  await driver.captureEvidence({
    caseId: 'usage',
    step: 'desktop-initial',
    expected: 'Usage section with no values and no provider call',
    observed: 'Section rendered; zero usage provider calls',
  });

  // ---- 2. Successful refresh -----------------------------------------------------------
  await driver.clickButton('Refresh Usage');
  await waitText('Credits Used Today');
  await driver.waitFor(`document.querySelectorAll('dd').length >= 4`);
  check(
    'Successful refresh shows the four values',
    JSON.stringify(await values()) === JSON.stringify(['42', '40', '2', '40']),
    JSON.stringify(await values()),
  );
  const body = await text();
  for (const label of ['Total Calls', 'Successful', 'Errors', 'Credits Used Today'])
    check(`Label present: ${label}`, body.includes(label));
  check('Timestamp shown after success', body.includes('Retrieved on'));
  const usageSection = body
    .split('Recent settings history')[0]
    .split("GSTINAPI — Today's Usage")[1];
  check('Usage section text located', !!usageSection && usageSection.includes('Total Calls'));
  check(
    'No balance / remaining-credit text',
    !/balance|remaining|available credits|estimated remaining/i.test(usageSection),
  );
  check('Exactly one provider call for one click', (await usageCalls()) === 1);
  await driver.captureEvidence({
    caseId: 'usage',
    step: 'desktop-success',
    expected: 'Four counters, retrieved timestamp, no balance',
    observed: '42/40/2/40 shown',
  });

  // ---- 3. Credential exposure ------------------------------------------------------------
  const exposure = await driver.evaluate(`(() => {
    const key = ${JSON.stringify(SYNTHETIC_KEY)};
    return {
      html: document.documentElement.outerHTML.includes(key),
      session: JSON.stringify({ ...sessionStorage }).includes(key),
      local: JSON.stringify({ ...localStorage }).includes(key),
    };
  })()`);
  check(
    'API key absent from page HTML and browser storage',
    !exposure.html && !exposure.session && !exposure.local,
  );
  const direct = await fetch(`${apiUrl}/gst-compliance/usage`, {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  const directBody = await direct.text();
  check(
    'API response carries no key, balance or header echo',
    !directBody.includes(SYNTHETIC_KEY) && !/balance|remaining|x-api-key/i.test(directBody),
  );
  check('API response is not cacheable', direct.headers.get('cache-control') === 'no-store');
  const origins = [...new Set(driver.responses.map((r) => r.origin))];
  check(
    'Browser only talked to the local app and API',
    origins.every((o) => [appUrl, apiUrl].includes(o)),
    origins.join(','),
  );
  check(
    'No browser request path to the provider',
    !driver.responses.some((r) => /gstinapi\.in/i.test(r.origin)),
  );
  const afterDirect = await usageCalls();

  // ---- 4. Failure keeps last successful values -------------------------------------------
  await setMode('fail502');
  await driver.clickButton('Refresh Usage');
  await driver.waitFor(`!!document.querySelector('[role="alert"]')`);
  const failedText = await text();
  check(
    'Failure shows a safe error',
    failedText.includes('temporarily unavailable') && !/vendor|qa-synthetic/i.test(failedText),
  );
  check(
    'Previous values retained and labelled after failure',
    JSON.stringify(await values()) === JSON.stringify(['42', '40', '2', '40']) &&
      failedText.includes('Last successful retrieval'),
  );
  await driver.captureEvidence({
    caseId: 'usage',
    step: 'desktop-failure',
    expected: 'Error shown; previous counters kept and labelled',
    observed: 'Alert plus Last successful retrieval',
  });

  // ---- 5. Loading state, no overlapping requests ---------------------------------------
  await setMode('slow');
  const before = await usageCalls();
  await driver.clickButton('Refresh Usage');
  await waitText('Retrieving usage');
  check('Refresh disabled while loading', (await buttonState('Refresh Usage')).disabled === true);
  await driver.evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(n => n.textContent.includes('Refresh Usage')); b.click(); b.click(); })()`,
  );
  await driver.captureEvidence({
    caseId: 'usage',
    step: 'desktop-loading',
    expected: 'Loading text and disabled Refresh',
    observed: 'Retrieving usage shown, button disabled',
  });
  await driver.waitFor(`!document.body.innerText.includes('Retrieving usage')`, 15000);
  check('Repeated clicks produced exactly one provider call', (await usageCalls()) === before + 1);

  // ---- 6. Replace on success; keyboard operation ---------------------------------------
  await setMode('ok2');
  await driver.evaluate(`document.activeElement?.blur()`);
  let reached = false;
  for (let n = 0; n < 120 && !reached; n++) {
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    reached = await driver.evaluate(
      `document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent.includes('Refresh Usage')`,
    );
  }
  check('Refresh Usage reachable with Tab', reached);
  const keyed = await usageCalls();
  const enter = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  check(
    'Button focused immediately before Enter',
    await driver.evaluate(
      `document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent.includes('Refresh Usage')`,
    ),
  );
  await driver.command('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter });
  await driver.command('Input.dispatchKeyEvent', {
    type: 'char',
    ...enter,
    text: '\r',
    unmodifiedText: '\r',
  });
  await driver.command('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
  await driver
    .waitFor(
      `JSON.stringify([...document.querySelectorAll('dd')].slice(0,4).map(n => n.textContent)) === '["50","47","3","47"]'`,
      8000,
    )
    .catch(async () => {
      throw new Error(
        `Enter did not refresh: ${JSON.stringify({ calls: await usageCalls(), keyed, active: await driver.evaluate('document.activeElement?.outerHTML?.slice(0, 120)'), values: await values(), keys: await driver.evaluate('window.__qaKeys'), usageResponses: driver.responses.filter((r) => r.path.includes('/gst-compliance/usage')).map((r) => r.status), alert: await driver.evaluate(`document.querySelector('[role="alert"]')?.textContent`), button: await buttonState('Refresh Usage') })}`,
      );
    });
  check(
    'Enter on the focused button refreshes and replaces the counters',
    (await usageCalls()) === keyed + 1,
  );
  check(
    'Error cleared after a successful refresh',
    !(await text()).includes('Last successful retrieval'),
  );
  await setMode('ok');

  // ---- 7. Settings regression; usage not refreshed by settings changes -----------------
  const beforeSettings = await usageCalls();
  await clickByLabel('[role="switch"]', 'Enable Online GSTIN Verification');
  await clickByLabel('[role="radio"]', 'Complete Profile — 2 credits');
  await driver.clickButton('Save changes');
  await waitText('Settings saved.');
  check(
    'GST settings still save and persist the new values',
    (await driver.evaluate(
      `(() => { const on = el => el?.getAttribute('aria-checked') === 'true' || el?.getAttribute('data-state') === 'checked'; const find = (role, label) => [...document.querySelectorAll('[role="' + role + '"]')].find(n => document.querySelector('label[for="' + n.id + '"]')?.textContent.includes(label)); return on(find('switch', 'Enable Online GSTIN Verification')) && on(find('radio', 'Complete Profile')); })()`,
    )) === true,
  );
  check('Saving settings did not call the usage provider', (await usageCalls()) === beforeSettings);

  // ---- 8. Corrected Complete Demo display (observed response fixture) ---------------------
  await driver.waitFor(
    `!!document.querySelector('label') && document.body.innerText.includes('GSTIN to verify')`,
  );
  const inputId = await driver.evaluate(
    `[...document.querySelectorAll('label')].find(l => l.textContent.includes('GSTIN to verify'))?.htmlFor`,
  );
  await driver.fill(`[id="${inputId}"]`, '33AAAAA0000A1Z5');
  await driver.clickButton('View saved verification');
  await driver.clickButton('Retrieve Complete Profile');
  await waitText('GSTINAPI TEST PRIVATE LIMITED');
  await driver.evaluate(`document.querySelector('details summary')?.click()`);
  const demo = await text();
  check(
    'Demo result is labelled as sample',
    demo.includes('Demo Result') &&
      demo.includes('The entered GSTIN has not been verified') &&
      demo.includes('00AAAAA0000A1ZT'),
  );
  check(
    'Complete Demo profile fields shown',
    demo.includes('GSTINAPI SANDBOX') && demo.includes('Monthly'),
  );
  check(
    'Return periods shown as September 2026, not submission dates',
    (demo.match(/September 2026/g) ?? []).length === 2 &&
      demo.includes('return periods, not submission dates'),
  );
  check('Complete Demo not classified as Not Filed', !/Not Filed/.test(demo));
  const lookups = (await journal()).calls.filter(
    (c) => c.path.startsWith('/v1/gstin/') && c.path !== '/v1/gstin/stats/me',
  );
  check(
    'Exactly one Complete lookup, sample identity only',
    lookups.length === 1 && lookups[0].path === '/v1/gstin/00AAAAA0000A1ZT/complete',
    JSON.stringify(lookups),
  );
  check('Usage provider untouched by verification', (await usageCalls()) === beforeSettings);
  await driver.captureEvidence({
    caseId: 'complete',
    step: 'demo-result',
    expected: 'Sample Complete Demo result with September 2026 return periods',
    observed: 'Rendered from the observed response fixture',
  });

  // ---- 9. Mobile layout ------------------------------------------------------------------
  await driver.viewport(390, 844, true);
  // The smallest element holding the heading and the counters is the usage panel itself.
  const usagePanel = `[...document.querySelectorAll('div')].filter(n => n.textContent.includes("GSTINAPI — Today's Usage") && n.textContent.includes('Total Calls')).sort((a, b) => a.textContent.length - b.textContent.length)[0]`;
  await driver.evaluate(`${usagePanel}.scrollIntoView()`);
  const layout = await driver.evaluate(`(() => {
    const dd = [...${usagePanel}.querySelectorAll('dd')].map(n => n.getBoundingClientRect());
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, rows: new Set(dd.map(r => Math.round(r.top))).size, columns: new Set(dd.map(r => Math.round(r.left))).size, inside: dd.every(r => r.right <= innerWidth + 1) };
  })()`);
  check('Mobile: no horizontal overflow', !layout.overflow);
  check(
    'Mobile: four values in a 2-column grid within the viewport',
    layout.columns === 2 && layout.rows === 2 && layout.inside,
    JSON.stringify(layout),
  );
  await driver.captureEvidence({
    caseId: 'usage',
    step: 'mobile',
    expected: 'Two-column grid, no overflow at 390px',
    observed: JSON.stringify(layout),
    fullPage: true,
  });
  await driver.viewport(1440, 900);

  // ---- 10. Authorization: ADMIN and other roles ------------------------------------------
  const deniedBefore = await usageCalls();
  const adminToken = await signInAs('ADMIN');
  await waitText('GST Compliance Settings');
  check('ADMIN does not see the usage section', !(await text()).includes("Today's Usage"));
  const merchToken = (await (await fetch(`${apiUrl}/__qa/token?role=MERCHANDISER`)).json())
    .accessToken;
  const statuses = [];
  for (const token of [adminToken, merchToken, undefined])
    statuses.push(
      (
        await fetch(`${apiUrl}/gst-compliance/usage`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      ).status,
    );
  check(
    'ADMIN 403, MERCHANDISER 403, unauthenticated 401',
    JSON.stringify(statuses) === '[403,403,401]',
    JSON.stringify(statuses),
  );
  check('Denied requests never reached the provider', (await usageCalls()) === deniedBefore);
  // Only the single Complete Demo verification journalled an operation; every usage
  // refresh (success, failure, slow, keyboard) and every denied request created none.
  check(
    'Usage requests created no verification operations',
    (await journal()).operations === 1,
    `operations=${(await journal()).operations}`,
  );
  check(
    'No uncaught page errors',
    driver.consoleErrors.filter((e) => !/Failed to load resource/.test(e.text)).length === 0,
    JSON.stringify(driver.consoleErrors.slice(0, 3)),
  );
  proof.networkFailures = driver.networkFailures;
  proof.afterDirectUsageCalls = afterDirect;
  await writeFile(
    join(output, 'gst-usage-browser-qa-summary.json'),
    JSON.stringify(proof, null, 2),
  );
  console.log(`\nALL ${proof.checks.length} CHECKS PASSED. Evidence: ${output}`);
} catch (error) {
  console.error(error);
  if (driver) {
    try {
      await driver.captureEvidence({
        caseId: 'failure',
        step: 'last-state',
        expected: 'n/a',
        observed: String(error),
        status: 'FAIL',
      });
    } catch {
      /* best effort */
    }
  }
  proof.failure = String(error);
  await writeFile(
    join(output, 'gst-usage-browser-qa-summary.json'),
    JSON.stringify(proof, null, 2),
  ).catch(() => {});
  process.exitCode = 1;
} finally {
  await driver?.close().catch(() => {});
  for (const child of children) killTree(child);
}
