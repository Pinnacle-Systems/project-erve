import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.deepEqual(
  [target.hostname, target.port, target.pathname],
  ['127.0.0.1', '55451', '/erve_batch10_lookup10_test'],
);
const fixtures = JSON.parse(
  await readFile(join(root, '.data/lookup10/lookup10-browser-fixtures.json'), 'utf8'),
);
const evidenceRoot =
  process.env.LOOKUP10_BROWSER_EVIDENCE_ROOT ??
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp') : tmpdir());
const output = await mkdtemp(join(evidenceRoot, 'erve-lookup10-browser-'));
const appUrl = 'http://127.0.0.1:5191',
  apiUrl = 'http://127.0.0.1:4191';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: target.toString(),
  HOST: '127.0.0.1',
  PORT: '4191',
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
  JWT_ACCESS_SECRET: 'lookup10-browser-access-secret-000000000',
  JWT_REFRESH_SECRET: 'lookup10-browser-refresh-secret-00000000',
  FILE_STORAGE_DIR: join(output, 'uploads'),
};
const children = [];
function launch(binary, args, name, cwd = root) {
  const child = spawn(binary, args, {
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
  for (let n = 0; n < 900; n++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${url}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  throw new Error(`Readiness timeout: ${url}`);
}
let driver;
try {
  await mkdir(join(output, 'uploads/lookup10'), { recursive: true });
  await writeFile(
    join(output, 'uploads/lookup10/test.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const setup = launch(
    process.execPath,
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'tools/lookup10/prepare-browser.mts'],
    'prepare',
  );
  assert.equal(
    await new Promise((ok) => setup.once('exit', ok)),
    0,
    'Disposable browser actor setup',
  );
  const api = launch(
    process.execPath,
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'],
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
  await Promise.all([ready(`${apiUrl}/health`, api), ready(appUrl, web)]);
  const chrome = [
    process.env.CHROME_BINARY,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  assert.ok(chrome);
  const browser = launch(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9291',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    'browser',
  );
  await ready('http://127.0.0.1:9291/json/version', browser);
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9291',
    appUrl,
    output,
    repositoryRoot: root,
  });
  driver.socket.addEventListener('message', ({ data }) => {
    if (JSON.parse(data).method === 'Page.javascriptDialogOpening') {
      void driver.command('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  await driver.viewport(1280, 1000);
  await driver.navigateTo('/login');
  await driver.evaluate(`(async () => {
    const response = await fetch('${apiUrl}/auth/login', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({identifier:'browser-lookup10@test.local',password:'lookup10-browser-pass'}) });
    if (!response.ok) throw Error('Disposable login failed');
    const {data} = await response.json(), s = data.session;
    sessionStorage.setItem('erve.accessToken', data.accessToken);
    localStorage.setItem('erve.sessionTiming', JSON.stringify({userId:s.userId,accessExpiresAt:Date.parse(s.accessExpiresAt),idleExpiresAt:Date.parse(s.idleExpiresAt),absoluteExpiresAt:Date.parse(s.absoluteExpiresAt),idleTimeoutMs:s.idleTimeoutSeconds*1000,clockOffsetMs:Date.parse(s.serverTime)-Date.now()}));
  })()`);
  // Capture full URLs in memory only; never persist token-bearing headers.
  const requests = [];
  driver.socket.addEventListener('message', ({ data }) => {
    const e = JSON.parse(data);
    if (
      e.method === 'Network.requestWillBeSent' &&
      e.params.request.method === 'GET' &&
      e.params.request.url.startsWith(apiUrl)
    )
      requests.push(new URL(e.params.request.url));
  });
  const find = (label) =>
    `document.getElementById([...document.querySelectorAll('label')].find(l=>l.textContent.replace(/\\s*\\*$/,'').trim()===${JSON.stringify(label)}).htmlFor)`;
  async function openLabel(label) {
    await driver.evaluate(`${find(label)}.click()`);
  }
  async function choose(text) {
    await driver.waitFor(
      `[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes(${JSON.stringify(text)}))`,
    );
    await driver.evaluate(
      `[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes(${JSON.stringify(text)})).click()`,
    );
  }
  async function key(key, shift = false) {
    const virtualKey = { Enter: 13, Tab: 9, Escape: 27 }[key];
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey,
      text: key === 'Enter' ? '\r' : undefined,
      modifiers: shift ? 8 : 0,
    });
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey,
      modifiers: shift ? 8 : 0,
    });
  }
  await driver.navigateTo('/sale-orders/new');
  await driver.waitFor(`document.querySelector('h1')?.textContent==='Create Dispatch Order'`);
  await openLabel('Factory');
  await choose(fixtures.factory.code);
  await driver.clickButton('+ Add Style');
  await openLabel('Style');
  await driver.waitFor(`document.querySelectorAll('[role=option]').length===20`);
  await driver.assert(
    'LOOKUP10',
    'bounded initial browser options',
    `document.querySelectorAll('[role=option]').length===20`,
  );
  await driver.evaluate(`${find('Style')}.focus()`);
  await key('Tab');
  await driver.assert(
    'LOOKUP10',
    'Tab reaches continuation',
    `document.activeElement.textContent==='Load more'`,
  );
  await key('Tab', true);
  await driver.assert(
    'LOOKUP10',
    'Shift Tab returns to Style',
    `document.activeElement===${find('Style')}`,
  );
  await key('Tab');
  await key('Enter');
  await driver.waitFor(`document.querySelectorAll('[role=option]').length===29`);
  await driver.assert(
    'LOOKUP10',
    'final continuation restores textbox focus',
    `document.activeElement===${find('Style')}`,
  );
  await key('Enter');
  await driver.waitFor(`document.body.textContent.includes('10 available')`);
  assert.ok(
    requests
      .filter((u) => u.pathname === '/job-orders/pooled-inventory')
      .every((u) => u.searchParams.has('styleId')),
  );
  await driver.captureEvidence({
    caseId: 'LOOKUP10',
    step: 'create',
    expected: 'bounded lookup, accessible continuation and selected hydration',
    observed: { initialOptions: 20, appendedOptions: 29 },
  });
  // Create a fully committed saved Style and a second Style through the real
  // API; edit must retain both and add back only at the original Factory.
  const orderId = await driver.evaluate(`(async()=>{
    const r=await fetch('${apiUrl}/sale-orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem('erve.accessToken'),'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({factoryId:${JSON.stringify(fixtures.factory.id)},soDate:'2026-06-30',distributors:[{clientKey:'g',distributorId:${JSON.stringify(fixtures.distributorId)},destinations:[{clientKey:'d',addressLine1:'Browser test',city:'Chennai',state:'TN',country:'India'}]}],lines:${JSON.stringify(fixtures.styles.map((s, i) => ({ destinationClientKey: 'd', styleId: s.id, totalQuantity: i === 0 ? 10 : 2 })))}})});
    if(!r.ok) throw Error('Disposable order creation failed'); return (await r.json()).data.id;
  })()`);
  await driver.navigateTo(`/sale-orders/${orderId}/edit`);
  await driver.waitFor(
    `document.body.textContent.includes('10 available') && document.querySelectorAll('input[id$="-total-quantity"]').length===2`,
  );
  await driver.assert(
    'LOOKUP10',
    'saved Style quantities and identity hydrate in edit',
    `[...document.querySelectorAll('input')].some(i=>i.value.includes(${JSON.stringify(fixtures.styles[0].styleNumber)}))`,
  );
  await driver.evaluate(
    `(() => { const i=document.querySelector('input[id$="-total-quantity"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'8'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('focusout',{bubbles:true})); })()`,
  );
  await openLabel('Factory');
  // Both factories were independently seeded; find the other Factory by ID
  // using the real options API, then choose its displayed code.
  const otherCode = await driver.evaluate(
    `(async()=>{ const r=await fetch('${apiUrl}/factories/options',{headers:{Authorization:'Bearer '+sessionStorage.getItem('erve.accessToken')}}); return (await r.json()).data.find(f=>f.id===${JSON.stringify(fixtures.otherFactoryId)}).code; })()`,
  );
  await choose(otherCode);
  await driver.waitFor(`!document.body.textContent.includes('Loading Style availability')`);
  await driver.assert(
    'LOOKUP10',
    'Factory switch preserves edited quantity',
    `document.querySelector('input[id$="-total-quantity"]').value==='8'`,
  );
  const switched = requests.filter(
    (u) =>
      u.pathname === '/job-orders/pooled-inventory' &&
      u.searchParams.get('factoryId') === fixtures.otherFactoryId,
  );
  assert.equal(switched.length, 2);
  assert.ok(
    switched.every(
      (u) => !u.searchParams.has('excludeSaleOrderId') && u.searchParams.has('styleId'),
    ),
  );
  await openLabel('Factory');
  await choose(fixtures.factory.code);
  await driver.waitFor(`document.body.textContent.includes('10 available')`);
  await driver.captureEvidence({
    caseId: 'LOOKUP10',
    step: 'edit-factory-switch',
    expected: 'own-order add-back only at original Factory and retained drafts',
    observed: { selectedStyles: 2, editedQuantity: 8 },
  });
  assert.equal(driver.consoleErrors.length, 0);
  console.log(`PASS: ${driver.assertions.length} browser assertions. Evidence: ${output}`);
} catch (error) {
  if (driver)
    await driver
      .captureEvidence({
        caseId: 'failure',
        step: 'diagnostic',
        expected: 'acceptance passes',
        observed: error.message,
        status: 'FAIL',
      })
      .catch(() => {});
  throw error;
} finally {
  if (driver) {
    await driver.command('Browser.close').catch(() => {});
    await driver.close();
  }
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  }
  console.log(`LOOKUP-10 browser evidence: ${output}`);
}
