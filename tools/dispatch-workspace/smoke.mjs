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
const output = await mkdtemp(join(tmpdir(), 'erve-dispatch-smoke-'));
const screenshots = process.env.DISPATCH_SMOKE_SCREENSHOTS !== '0';
const appUrl = 'http://127.0.0.1:5196';
const apiUrl = 'http://127.0.0.1:4196';
const actor = {
  id: 'smoke-user',
  name: 'Merchandising User',
  email: 'smoke@example.test',
  mobile: null,
  roles: ['ADMIN'],
};
const dispatch = {
  id: 'ed-smoke',
  erveDispatchNumber: 'ED/26-27/0001',
  status: 'DISPATCHED',
  version: 2,
  ervePackingList: { id: 'pl-smoke', ervePackingListNumber: 'EIPL/26-27/0001' },
  saleOrder: null,
  distributor: { id: 'dist', code: 'D1', name: 'Example Distributor' },
  destination: {
    label: 'Example Retail Store',
    storeCode: 'STORE-1',
    addressLine1: '12 Market Road',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600001',
    country: 'India',
  },
  dispatchDate: '2026-11-01T00:00:00Z',
  dispatchedAt: '2026-11-01T10:00:00Z',
  dispatchedBy: actor,
  transporter: 'Example Transport',
  vehicleNumber: 'TN01AB1234',
  lrNumber: null,
  remarks: null,
  lrUpdatedAt: null,
  lrUpdatedBy: null,
  deliveredAt: null,
  deliveredBy: null,
  deliveryConfirmationSource: null,
  deliveryRemarks: null,
  invoiceHandoffs: [],
  saleOrReturnLines: [],
  deliveryLines: [],
  totalQuantity: 35,
  quantityLines: [
    {
      saleOrderLineId: 'line-l',
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      primaryImage: null,
      sizeId: 'l',
      sizeCode: 'L',
      sizeLabel: 'Large',
      sizeSortOrder: 2,
      quantity: 20,
    },
    {
      saleOrderLineId: 'line-s',
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      primaryImage: null,
      sizeId: 's',
      sizeCode: 'S',
      sizeLabel: 'Small',
      sizeSortOrder: 1,
      quantity: 10,
    },
    {
      saleOrderLineId: 'line-xl',
      styleId: 'style-2',
      styleNumber: 'ST-002',
      styleName: 'Printed Shirt',
      primaryImage: null,
      sizeId: 'xl',
      sizeCode: 'XL',
      sizeLabel: 'Extra Large',
      sizeSortOrder: 3,
      quantity: 5,
    },
  ],
};
let posts = 0;
const requests = [];
const api = createServer((req, res) => {
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
  requests.push({ method: req.method, path: req.url });
  let data;
  if (req.url === '/auth/me') data = actor;
  else if (req.url === '/auth/refresh') data = { accessToken: 'dispatch-smoke-token', user: actor };
  else if (req.url === '/erve-dispatches/ed-smoke') data = dispatch;
  else if (req.url === '/erve-packing-lists/pl-smoke')
    data = {
      id: 'pl-smoke',
      ervePackingListNumber: 'EIPL/26-27/0001',
      status: 'FINALIZED',
      dispatch: null,
      distributor: dispatch.distributor,
      destination: dispatch.destination,
      totalQuantity: 35,
      cartonCount: 2,
    };
  else if (req.url === '/erve-dispatches' && req.method === 'POST') {
    posts++;
    data = { id: 'ed-smoke' };
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ success: false, error: { message: 'Not found' } }));
    return;
  }
  res.end(JSON.stringify({ success: true, data }));
});
await new Promise((ok, fail) => {
  api.once('error', fail);
  api.listen(4196, '127.0.0.1', ok);
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
      '5196',
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
    '--remote-debugging-port=9296',
    `--user-data-dir=${join(output, 'chrome-profile')}`,
    'about:blank',
  ]);
  await ready('http://127.0.0.1:9296/json/version', browser);
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9296',
    appUrl,
    output,
    repositoryRoot: root,
  });
  await driver.command('Page.addScriptToEvaluateOnNewDocument', {
    source: "sessionStorage.setItem('erve.accessToken', 'dispatch-smoke-token')",
  });
  await driver.viewport(1280, 900);
  await driver.command('Page.navigate', {
    url: `${appUrl}/fulfillment/erve-dispatches/ed-smoke?source=smoke`,
  });
  await driver.waitFor(
    'document.readyState === "complete" && !!document.querySelector("#root")?.firstElementChild',
    60000,
  );
  await driver.waitFor(
    "document.body.textContent.includes('No active Tax Invoice') && !!document.querySelector('table')",
    30000,
  );
  assert.deepEqual(
    await driver.evaluate("Array.from(document.querySelectorAll('th')).map(el=>el.textContent)"),
    ['Style', 'S', 'L', 'XL', 'Total'],
  );
  assert.equal(
    await driver.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
    true,
  );
  if (screenshots) await driver.captureEvidence({
    caseId: 'dispatch',
    step: 'desktop-overview',
    expected: 'Persistent identity, ordered matrix, totals, absent invoice',
    observed: '1280px overview has no page overflow; Size order S/L/XL and grand total 35',
  });
  await driver.evaluate("document.querySelector('[role=tab][data-state=active]').focus()");
  await driver.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await driver.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await driver.waitFor("location.search.includes('tab=transport-delivery') && document.querySelector('[role=tab][data-state=active]')?.textContent === 'Transport & Delivery'");
  assert.equal(await driver.evaluate("location.search.includes('source=smoke')"), true);
  await driver.viewport(390, 844, true);
  assert.equal(
    await driver.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
    true,
  );
  if (screenshots) await driver.captureEvidence({
    caseId: 'dispatch',
    step: 'narrow-transport',
    expected: 'Responsive tabs and transport controls at narrow width',
    observed: '390px layout has no page overflow; transport and delivery controls remain available',
  });
  await driver.clickButton('Distributor Receipt');
  await driver.waitFor("location.search.includes('tab=distributor-receipt') && document.querySelector('[role=tabpanel][data-state=active]')?.textContent.includes('Separate distributor confirmation is not yet available')");
  assert.equal(
    await driver.evaluate(
      "document.querySelector('[role=tabpanel][data-state=active]').textContent.includes('Separate distributor confirmation is not yet available')",
    ),
    true,
  );
  assert.equal(
    await driver.evaluate(
      "document.querySelectorAll('[role=tabpanel][data-state=active] input:not([readonly])').length",
    ),
    0,
  );
  await driver.navigateTo('/fulfillment/erve-dispatches/new?ervePackingListId=pl-smoke');
  await driver.waitFor("document.body.textContent.includes('Physical Dispatch')");
  assert.equal(posts, 0, 'Loading the recording page must never create a dispatch');
  await driver.evaluate(
    "Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Record Dispatch').click()",
  );
  await driver.waitFor("location.pathname==='/fulfillment/erve-dispatches/ed-smoke'");
  assert.equal(posts, 1);
  await writeFile(
    join(output, 'smoke-result.json'),
    JSON.stringify({ status: 'PASS', screenshots: screenshots ? 2 : 0, requests, posts }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', output, screenshots: screenshots ? 2 : 0, posts }));
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
