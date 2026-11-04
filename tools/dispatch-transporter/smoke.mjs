// Focused UI evidence only: mock HTTP responses, no API process or database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = await mkdtemp(join(tmpdir(), 'erve-transporter-smoke-'));
const screenshots = process.env.DISPATCH_SMOKE_SCREENSHOTS !== '0';
const appUrl = 'http://127.0.0.1:5197';
const apiUrl = 'http://127.0.0.1:4197';
const actor = {
  id: 't1',
  name: 'Transporter',
  email: 'transport@example.test',
  mobile: null,
  roles: ['TRANSPORTER'],
};
const transport = {
  id: 'ed-smoke',
  erveDispatchNumber: 'ED/26-27/0001',
  dispatchDate: '2026-11-01',
  status: 'DISPATCHED',
  transporter: 'Example Carrier',
  vehicleNumber: 'TN01AB1234',
  lrNumber: null,
  version: 2,
  lrUpdatedAt: null,
};
const requests = [];
let posts = 0;
const api = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', appUrl);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-session-user-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, apiUrl);
  requests.push({ method: req.method, path: url.pathname });
  let data;
  if (url.pathname === '/auth/me') data = actor;
  else if (url.pathname === '/auth/refresh')
    data = { accessToken: 'dispatch-smoke-token', user: actor };
  else if (url.pathname === '/erve-dispatches/assigned-transport')
    data = { items: [transport], pageInfo: { limit: 25, hasMore: false, nextCursor: null } };
  else if (url.pathname === '/erve-dispatches/ed-smoke/transport') data = transport;
  else if (url.pathname === '/erve-dispatches/ed-smoke/lr' && req.method === 'PATCH') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.expectedVersion, transport.version);
    Object.assign(transport, input, { version: transport.version + 1 });
    delete transport.expectedVersion;
    posts++;
    data = transport;
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ success: false, error: { message: 'Unavailable' } }));
    return;
  }
  res.end(JSON.stringify({ success: true, data }));
});
await new Promise((ok, fail) => {
  api.once('error', fail);
  api.listen(4197, '127.0.0.1', ok);
});
const children = [];
const processLogs = [];
let driver;
function launch(binary, args, env = process.env) {
  const child = spawn(binary, args, {
    cwd: join(root, 'apps/web'),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => processLogs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => processLogs.push(chunk.toString()));
  return child;
}
async function ready(url, child) {
  for (let n = 0; n < 150; n++) {
    assert.equal(child.exitCode, null, 'Smoke process exited before ready');
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  throw new Error('Smoke process readiness timed out');
}
try {
  const web = launch(
    process.execPath,
    [
      join(root, 'apps/web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5197',
      '--strictPort',
    ],
    { ...process.env, VITE_API_URL: apiUrl },
  );
  await ready(appUrl, web);
  const chrome = [
    process.env.CHROME_BINARY,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
  ].find((p) => p && existsSync(p));
  assert.ok(chrome, 'Installed Chromium browser required');
  const browser = launch(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9297',
    `--user-data-dir=${join(output, 'chrome-profile')}`,
    'about:blank',
  ]);
  await ready('http://127.0.0.1:9297/json/version', browser);
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9297',
    appUrl,
    output,
    repositoryRoot: root,
  });
  await driver.command('Page.addScriptToEvaluateOnNewDocument', {
    source: "sessionStorage.setItem('erve.accessToken', 'dispatch-smoke-token')",
  });
  await driver.viewport(1280, 900);
  await driver.command('Page.navigate', { url: `${appUrl}/fulfillment/erve-dispatches` });
  await driver.waitFor(
    'document.readyState === "complete" && !!document.querySelector("#root")?.firstElementChild',
    60000,
  );
  await driver.waitFor(
    "document.body.textContent.includes('Assigned Dispatches') && document.body.textContent.includes('ED/26-27/0001')",
    30000,
  );
  await driver.navigateTo('/fulfillment/erve-dispatches/ed-smoke?tab=distributor-receipt');
  await driver.waitFor(
    "location.search.includes('tab=transport-delivery') && !!document.querySelector('input[name=lrNumber]')",
    30000,
  );
  assert.deepEqual(
    await driver.evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).map(el=>el.textContent)",
    ),
    ['Transport & Delivery'],
  );
  for (const label of [
    'Confirm Delivery',
    'Distributor Receipt',
    'Tax Invoice',
    'Assign Transporter',
    'Download PDF',
  ]) {
    assert.equal(
      await driver.evaluate(`document.body.textContent.includes(${JSON.stringify(label)})`),
      false,
      label,
    );
  }
  await driver.evaluate(
    `(() => { const input = document.querySelector('input[name=lrNumber]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'LR-SMOKE-078'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await driver.clickButton('Save');
  await driver.waitFor("document.body.textContent.includes('Transport information saved')", 10000);
  assert.equal(posts, 1);
  assert.equal(transport.lrNumber, 'LR-SMOKE-078');
  await driver.captureEvidence({
    caseId: 'transporter',
    step: 'assigned-save',
    expected:
      'Assigned transport access, only transport tab, versioned Save and restricted navigation',
    observed:
      'Saved LR-SMOKE-078; full Dispatch API never requested; forbidden tabs and actions absent',
  });
  assert.equal(
    requests.some((item) => item.path === '/erve-dispatches/ed-smoke'),
    false,
  );
  await driver.navigateTo('/fulfillment/erve-dispatches/new');
  await driver.waitFor("location.pathname === '/forbidden'", 10000);
  await writeFile(
    join(output, 'smoke-result.json'),
    JSON.stringify({ status: 'PASS', requests, posts }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', output, screenshots: 1, posts }));
} catch (error) {
  await writeFile(
    join(output, 'failure.json'),
    JSON.stringify(
      {
        message: error.message,
        requests,
        page: driver
          ? await driver
              .evaluate('({href: location.href, body: document.body.innerText})')
              .catch(() => null)
          : null,
      },
      null,
      2,
    ),
  );
  console.error(`Smoke evidence: ${output}`);
  throw error;
} finally {
  await writeFile(join(output, 'process.log'), processLogs.join('').slice(-50000));
  if (driver) await driver.close();
  for (const child of children.reverse()) child.kill();
  await new Promise((ok) => api.close(ok));
}
