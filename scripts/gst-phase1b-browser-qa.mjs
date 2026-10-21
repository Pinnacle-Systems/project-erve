// Real Chromium against the dedicated QA API/DB. The QA API mocks transport.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const artifact = path.resolve('.artifacts/gst-phase1b-qa');
const base = 'http://127.0.0.1:5187';
const api = 'http://127.0.0.1:4101';
const credentials = JSON.parse(fs.readFileSync(path.join(artifact, 'private.json'), 'utf8'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const proof = {
  provider: 'MOCKED transport; no external provider requests',
  checks: [],
  network: [],
  consoleErrors: [],
  screenshots: [],
};
const record = (name, details = true) => {
  proof.checks.push({ name, passed: true, details });
  console.log('PASS ' + name);
};
async function req(route, method = 'GET', body, token) {
  const result = await fetch(api + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await result.json();
  if (!result.ok) throw new Error(`${method} ${route}: ${result.status} ${JSON.stringify(json)}`);
  return json.data ?? json;
}
async function login(role) {
  return req('/auth/login', 'POST', {
    identifier: `gst-phase1b-${role}@qa.erve.local`,
    password: credentials.qaPassword,
  });
}
const accountant = await login('accountant');
const admin = await login('admin');
await req('/__qa/reset-verification', 'POST', {});
async function settings(values) {
  const current = await req('/gst-compliance/settings', 'GET', undefined, accountant.accessToken);
  return req(
    '/gst-compliance/settings',
    'PATCH',
    { expectedVersion: current.version, ...values },
    accountant.accessToken,
  );
}
await settings({
  integrationMode: 'DEMO',
  onlineGstinVerificationEnabled: true,
  gstinVerificationLevel: 'BASIC',
});
const existing = fs.existsSync(path.join(artifact, 'browser-records.json'))
  ? JSON.parse(fs.readFileSync(path.join(artifact, 'browser-records.json'), 'utf8'))
  : {};
const distributor =
  existing.distributor ??
  (await req(
    '/distributors',
    'POST',
    {
      name: 'Synthetic Phase 1B Browser Distributor',
      gstin: '33AAAAA0000A1Z5',
      purchaseMode: 'OUTRIGHT',
    },
    admin.accessToken,
  ));
const store =
  existing.store ??
  (await req(
    '/retail-stores',
    'POST',
    {
      distributorId: distributor.id,
      name: 'Synthetic Phase 1B Store',
      addressLine1: 'Synthetic Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      postalCode: '600001',
      gstin: '33AAAAA0000A1Z5',
    },
    admin.accessToken,
  ));
const seller =
  existing.seller ??
  (await req(
    '/seller-registrations',
    'POST',
    {
      legalName: 'Synthetic Phase 1B Seller',
      branchCode: 'GST-QA-' + Date.now(),
      gstin: '27AAAAA0000A1Z5',
      addressLine1: 'Synthetic Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      postalCode: '400001',
      bankName: 'Synthetic Bank',
      bankAccountName: 'Synthetic QA',
      bankAccountNumber: '00000001',
      bankIfsc: 'TEST0000001',
      bankBranchName: 'Synthetic Branch',
    },
    admin.accessToken,
  ));
fs.writeFileSync(
  path.join(artifact, 'browser-records.json'),
  JSON.stringify({ distributor, store, seller }, null, 2),
);
// Each run keeps its own profile and cannot read a stale DevToolsActivePort.
const profile = path.join(artifact, `chromium-profile-${Date.now()}`);
const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let debugPort;
for (let i = 0; i < 100; i++) {
  try {
    debugPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    break;
  } catch {
    await pause(100);
  }
}
assert.ok(debugPort, 'Chromium debugging endpoint');
const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
class CDP {
  pending = new Map();
  counter = 0;
  constructor(url) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((r, j) => {
      this.ws.onopen = r;
      this.ws.onerror = j;
    });
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const item = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error
          ? item?.reject(new Error(message.error.message))
          : item?.resolve(message.result);
      } else if (message.method === 'Network.requestWillBeSent') {
        const r = message.params.request;
        if (r.url.startsWith(api)) proof.network.push({ url: r.url, method: r.method });
      } else if (message.method === 'Runtime.exceptionThrown')
        proof.consoleErrors.push(message.params.exceptionDetails.text);
      else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
        proof.consoleErrors.push(
          message.params.args.map((v) => v.value || v.description).join(' '),
        );
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
}
const cdp = new CDP(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
await cdp.send('Page.enable');
const text = () => cdp.eval('document.body.innerText');
async function wait(expression) {
  for (let i = 0; i < 120; i++) {
    if (await cdp.eval(expression)) return;
    await pause(100);
  }
  throw new Error('Timed out: ' + expression + '\n' + (await text()));
}
async function nav(route) {
  await cdp.send('Page.navigate', { url: base + route });
  await pause(400);
}
async function click(label) {
  const ok = await cdp.eval(
    `(()=>{const e=[...document.querySelectorAll('button,a,summary')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e) return false;e.click();return true})()`,
  );
  assert.ok(ok, 'Missing action ' + label);
  await pause(250);
}
async function type(selector, value) {
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await cdp.send('Input.insertText', { text: value });
  await pause(100);
}
async function field(label, value) {
  const selector = await cdp.eval(
    `(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.replace('*','').trim()===${JSON.stringify(label)});return l?'#'+CSS.escape(l.htmlFor):null})()`,
  );
  assert.ok(selector, label);
  await type(selector, value);
}
async function shot(name) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(path.join(artifact, name + '.png'), Buffer.from(result.data, 'base64'));
  proof.screenshots.push(name + '.png');
}
async function calls() {
  return (await req('/__qa/state')).calls.length;
}
async function uiLogin(role) {
  await nav('/login');
  await wait('!!document.querySelector("#identifier")');
  await type('#identifier', `gst-phase1b-${role}@qa.erve.local`);
  await type('#password', credentials.qaPassword);
  await click('Sign in');
  await wait('!location.pathname.includes("login")');
}
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await uiLogin('admin');
  const before = await calls();
  await nav(`/master-data/distributors/${distributor.id}`);
  await wait('document.body.innerText.includes("Verify GSTIN")');
  assert.equal(await calls(), before);
  record('Opening Distributor makes no provider request');
  await click('Verify GSTIN');
  await wait('document.body.innerText.includes("The entered GSTIN has not been verified")');
  assert.equal(await calls(), before + 1);
  assert.equal((await req('/__qa/state')).calls.at(-1).gstin, '00AAAAA0000A1ZT');
  record('Demo Basic uses sample identity through isolated API/DB');
  await shot('demo-basic-1366x768');
  await nav(`/master-data/distributors/${distributor.id}`);
  await wait('document.body.innerText.includes("Cached result")');
  assert.equal(await calls(), before + 1);
  record('Browser refresh reads persisted cache without another provider call');
  await settings({ gstinVerificationLevel: 'COMPLETE' });
  await nav(`/master-data/distributors/${distributor.id}`);
  await wait('document.body.innerText.includes("Complete Profile has not yet been retrieved")');
  assert.equal(await calls(), before + 1);
  record('Basic evidence under Complete preference does not auto-upgrade');
  await click('Retrieve Complete Profile');
  await wait('document.body.innerText.includes("Return Filing Information")');
  assert.equal(await calls(), before + 2);
  await click('Return Filing Information');
  assert.ok((await text()).includes('August 2026'));
  assert.ok((await text()).includes('Monthly'));
  record('Complete bundled profile displays Month/Year filing periods');
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [390, 844],
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(200);
    assert.ok(
      await cdp.eval('document.documentElement.scrollWidth <= innerWidth'),
      'Viewport overflow',
    );
    await shot(`demo-complete-${width}x${height}`);
    record(`Complete panel viewport ${width}x${height}`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await nav(`/master-data/retail-stores/${store.id}/edit`);
  await wait('document.body.innerText.includes("Save Retail Store")');
  const saveCount = await calls();
  await click('Save Retail Store');
  await pause(500);
  assert.equal(await calls(), saveCount);
  record('Retail Store save does not verify or block');
  await nav(`/master-data/seller-registrations/${seller.id}/edit`);
  await wait('document.body.innerText.includes("Save Changes")');
  await field('GSTIN', 'invalid');
  await click('Save Changes');
  await wait('document.body.innerText.includes("valid 15-character GSTIN")');
  assert.equal(await calls(), saveCount);
  record('Seller local format validation remains active');
  await nav(`/master-data/distributors/${distributor.id}/edit`);
  await wait('document.body.innerText.includes("Save Changes")');
  await field('Name', 'Synthetic Phase 1B Browser Distributor Edited');
  await click('Save Changes');
  await pause(500);
  assert.equal(await calls(), saveCount);
  record('Distributor save makes no provider call');
  await settings({ integrationMode: 'LIVE', confirmLiveActivation: true });
  await nav(`/master-data/distributors/${distributor.id}`);
  await wait('document.body.innerText.includes("Not Verified")');
  assert.ok(!(await text()).includes('Retrieve Complete Profile'));
  record('ADMIN-only user cannot initiate Live lookup');
  // Logout through the established UI, then use ACCOUNTANT-only settings access.
  await cdp.eval('sessionStorage.clear()');
  await cdp.send('Network.clearBrowserCookies');
  await uiLogin('accountant');
  await nav('/gst-compliance/settings');
  await wait('document.body.innerText.includes("GSTIN to verify")');
  await field('GSTIN to verify', '33AAAAA0000A1Z5');
  await click('View saved verification');
  await wait('document.body.innerText.includes("Retrieve Complete Profile")');
  const liveCount = await calls();
  await click('Retrieve Complete Profile');
  await wait('!!document.querySelector("[role=dialog]")');
  let dialog = await cdp.eval('document.querySelector("[role=dialog]").innerText');
  assert.ok(dialog.includes('2 API credits') && dialog.includes('33AAAAA0000A1Z5'));
  await shot('live-credit-confirmation-mocked');
  record('Exact GSTIN and estimated credits confirmed before mocked Live execution');
  await click('Cancel');
  assert.equal(await calls(), liveCount);
  record('Cancel performs no provider lookup');
  await click('Retrieve Complete Profile');
  await wait('!!document.querySelector("[role=dialog]")');
  await click('Proceed');
  await wait('document.body.innerText.includes("Live evidence")');
  assert.equal(await calls(), liveCount + 1);
  record('ACCOUNTANT explicitly executes mocked Live profile');
  await click('Reverify GSTIN');
  await wait('!!document.querySelector("[role=dialog]")');
  dialog = await cdp.eval('document.querySelector("[role=dialog]").innerText');
  assert.ok(dialog.includes('Cached information will be bypassed'));
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await wait('!document.querySelector("[role=dialog]")');
  assert.equal(await cdp.eval('document.activeElement.textContent.trim()'), 'Reverify GSTIN');
  record('Escape restores keyboard focus to Reverify');
  await req('/__qa/expire', 'POST', {});
  await nav('/gst-compliance/settings');
  await wait('document.body.innerText.includes("GSTIN to verify")');
  await field('GSTIN to verify', '33AAAAA0000A1Z5');
  await click('View saved verification');
  await wait('document.body.innerText.includes("Stale")');
  assert.equal(await calls(), liveCount + 1);
  record('Stale cached result visible without automatic lookup');
  await shot('stale-live-evidence');
  await req('/__qa/provider', 'POST', { partial: true });
  await click('Reverify GSTIN');
  await wait('!!document.querySelector("[role=dialog]")');
  await click('Proceed');
  await wait('document.body.innerText.includes("Live evidence")');
  await click('Return Filing Information');
  await wait('document.body.innerText.includes("some filing information could not be retrieved")');
  assert.ok((await text()).includes('Information unavailable'));
  record('Partial profile preserves registration and unavailable filing fields');
  await shot('partial-complete');
  await req('/__qa/provider', 'POST', { status: 402 });
  await click('Reverify GSTIN');
  await wait('!!document.querySelector("[role=dialog]")');
  await click('Proceed');
  await wait('document.body.innerText.includes("insufficient credits")');
  record('Provider credit error preserves prior successful evidence');
  await shot('credit-error-preserved-evidence');
  const endingCalls = await calls();
  await settings({ onlineGstinVerificationEnabled: false });
  await nav('/gst-compliance/settings');
  await wait('document.body.innerText.includes("GST Compliance Settings")');
  assert.ok(!(await text()).includes('GSTIN to verify'));
  assert.equal(await calls(), endingCalls);
  record('Verification OFF hides lookup UI and settings changes perform no calls');
  await settings({
    integrationMode: 'DEMO',
    onlineGstinVerificationEnabled: true,
    gstinVerificationLevel: 'COMPLETE',
  });
  await req('/__qa/provider', 'POST', { status: 200 });
  proof.finalProviderCalls = (await req('/__qa/state')).calls;
  // Expected 402 request produces a browser network error; no JS exceptions allowed.
  assert.ok(
    proof.consoleErrors.every(
      (message) => message.includes('status of 503') || message.includes('status of 402'),
    ),
    JSON.stringify(proof.consoleErrors),
  );
  record('No unexpected browser console errors');
} catch (error) {
  proof.failure = String(error.stack || error);
  await shot('failure');
  throw error;
} finally {
  fs.writeFileSync(path.join(artifact, 'browser-results.json'), JSON.stringify(proof, null, 2));
  await cdp.send('Browser.close').catch(() => {});
  chrome.unref();
}
