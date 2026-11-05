// E-Way Bill browser acceptance (Track B / B5).
//
// Drives the real React application in headless Chromium against the real API,
// real authorization, real B2B services and real Prisma persistence. The only
// double is the E-Way Bill provider, which lives inside the QA API process and
// keeps a call journal. Nothing here can reach GSTINAPI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Page, launchChrome, log, until } from './cdp.mjs';
const { fetch } = globalThis;

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const APP = required('EWAY_ACCEPTANCE_APP_URL'); // e.g. http://localhost:5178
const API = required('EWAY_ACCEPTANCE_API_URL'); // as the browser reaches it
const API_NODE = required('EWAY_ACCEPTANCE_API_NODE_URL'); // as this process reaches it
const CONTROL = required('EWAY_ACCEPTANCE_CONTROL_URL');
const CONTROL_TOKEN = required('EWAY_ACCEPTANCE_CONTROL_TOKEN');
const CHROME = required('EWAY_ACCEPTANCE_CHROME_BINARY');
const CHROME_PORT = Number(process.env.EWAY_ACCEPTANCE_CHROME_PORT ?? 9333);
const OUT = path.resolve(process.env.EWAY_ACCEPTANCE_OUTPUT ?? '.artifacts/eway-bill-acceptance');
const EVIDENCE = path.join(OUT, 'evidence');
const ONLY = (process.env.EWAY_ACCEPTANCE_ONLY ?? '').split(',').filter(Boolean);
const WIDTHS = [1440, 768, 375];
const TEST_NUMBER = 'TEST-100000000001';
const LIVE_NUMBER = '123456789012';
const ALL_ROLES = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'ACCOUNTANT',
  'DISTRIBUTOR',
  'SENIOR_MANAGEMENT',
  'TRANSPORTER',
];

const fixtures = JSON.parse(await fs.readFile(required('EWAY_ACCEPTANCE_FIXTURE_PATH'), 'utf8'));
const inv = fixtures.invoices;
// Evidence from an earlier run must never be mistaken for this run's.
await fs.rm(EVIDENCE, { recursive: true, force: true });
await fs.mkdir(EVIDENCE, { recursive: true });

// ---- control port and API clients ---------------------------------------
async function control(method, route, body) {
  const response = await fetch(`${CONTROL}${route}`, {
    method,
    headers: { 'x-qa-control-token': CONTROL_TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `control ${method} ${route}`);
  return response.json();
}
const state = () => control('GET', '/state');
const evidenceFor = (invoice) => control('GET', `/db/invoice/${invoice.id}`);
const generateCalls = async (invoice) =>
  (await state()).journal.filter((entry) => entry.kind === 'generate' && (!invoice || entry.documentNumber === invoice.invoiceNumber));

async function apiLogin(role) {
  const actor = fixtures.actors[role];
  const response = await fetch(`${API_NODE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: actor.email, password: actor.password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `API login for ${role}`);
  return payload.data.accessToken;
}
async function api(token, method, route, body) {
  const response = await fetch(`${API_NODE}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // not JSON
  }
  return { status: response.status, body: payload };
}
const ewayPath = (invoice, suffix = '') => `/tax-invoices/${invoice.id}/eway-bill${suffix}`;

// ---- reporting ----------------------------------------------------------
const report = {
  title: 'E-Way Bill browser acceptance (Track B / B5)',
  startedAt: new Date().toISOString(),
  browserSizes: WIDTHS,
  mockedProvider: true,
  scenarios: [],
  screenshots: [],
  summary: {},
};
let current = null;
const check = (name, condition, detail = '') => {
  current.assertions.push({ name, pass: Boolean(condition), ...(detail ? { detail: String(detail).slice(0, 400) } : {}) });
  if (!condition) throw new Error(`Assertion failed: ${name}${detail ? ` — ${detail}` : ''}`);
};
const equal = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
// Dialogs are fixed to the viewport, so they are captured as the user sees them, not full-page.
const shot = async (page, name, options = { fullPage: !name.includes('dialog') }) => {
  const file = await page.screenshot(name, options);
  report.screenshots.push(file);
  current?.screenshots.push(file);
  return file;
};

// ---- browser helpers ----------------------------------------------------
const chrome = await launchChrome({ binary: CHROME, port: CHROME_PORT });
const page = new Page(chrome.webSocketUrl, EVIDENCE);
await page.init();

async function login(role) {
  const actor = fixtures.actors[role];
  await page.goto(`${APP}/login`);
  await page.evaluate(
    `(async () => { const token = sessionStorage.getItem('erve.accessToken'); if (token) { try { await fetch(${JSON.stringify(API)} + '/auth/logout', {method:'POST', credentials:'include', headers:{Authorization:'Bearer ' + token}}); } catch {} } sessionStorage.clear(); localStorage.clear(); })()`,
  );
  await page.goto(`${APP}/login`, 'Email or mobile number');
  await page.fill('Email or mobile number', actor.email);
  await page.fill('Password', actor.password);
  await page.click('Sign in');
  await until(() => page.evaluate("Boolean(sessionStorage.getItem('erve.accessToken'))"), `sign-in as ${role}`);
}

const invoiceUrl = (invoice) => `${APP}/fulfillment/tax-invoices/${invoice.id}`;
const LOADING = ['Loading E-Way Bill status', 'Loading movement information', 'Loading generation preview', 'Loading E-Way Bill history'];
const ewayTabSelected = () =>
  page.evaluate("[...document.querySelectorAll('[role=tab]')].some(n => n.textContent.trim() === 'E-Way Bill' && n.getAttribute('aria-selected') === 'true')");
async function waitEwayLoaded() {
  await until(async () => {
    // A reload can remount the invoice page once the session settles; keep the tab selected.
    if ((await page.evaluate("document.querySelector('[role=tab]') !== null")) && !(await ewayTabSelected())) {
      await page.click('E-Way Bill');
      return false;
    }
    const text = await page.text();
    return text.includes('Existing E-Way Bill and history') && !LOADING.some((item) => text.includes(item));
  }, 'E-Way Bill tab loaded');
}
// The invoice page can re-render while its data settles, so keep selecting until the tab is active.
async function selectEwayTab() {
  await until(async () => {
    const selected = await page.evaluate("[...document.querySelectorAll('[role=tab]')].some(n => n.textContent.trim() === 'E-Way Bill' && n.getAttribute('aria-selected') === 'true')");
    if (!selected) await page.click('E-Way Bill');
    return selected;
  }, 'E-Way Bill tab selected');
}
async function openEway(invoice, { ready = true } = {}) {
  await page.goto(invoiceUrl(invoice), invoice.invoiceNumber ?? 'Draft');
  await selectEwayTab();
  if (ready) await waitEwayLoaded();
}
const button = (label, root = 'document') =>
  page.evaluate(
    `(() => { const scope = ${root === 'document' ? 'document' : `document.querySelector(${JSON.stringify(root)})`}; const node = [...(scope ?? document).querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(label)}); return node ? {exists: true, disabled: node.disabled} : {exists: false, disabled: null}; })()`,
  );
const buttonExists = async (label) => (await button(label)).exists;
const buttonEnabled = async (label) => {
  const state_ = await button(label);
  return state_.exists && !state_.disabled;
};
const waitForEnabled = (label, root = 'document') =>
  until(async () => {
    const state_ = await button(label, root);
    return state_.exists && !state_.disabled;
  }, `${label} enabled`);

const MOVEMENT = {
  mode: 'Road',
  vehicle: 'TN01AB1234',
  vehicleType: 'Regular',
  distance: '0',
  shipTo: 'Billed party',
  dispatchFrom: 'Supplier registered premises',
};
async function captureMovementUi() {
  await page.select('Transport mode', MOVEMENT.mode);
  await page.fill('Vehicle number', MOVEMENT.vehicle);
  await page.select('Vehicle type', MOVEMENT.vehicleType);
  await page.fill('Approximate distance (km)', MOVEMENT.distance);
  await page.select('Ship-to', MOVEMENT.shipTo);
  await page.select('Dispatch-from', MOVEMENT.dispatchFrom);
  await waitForEnabled('Save movement information');
  await page.click('Save movement information');
  await page.waitForText('Movement information saved.');
  await page.waitForText('Request ready');
}
async function generateUi() {
  await waitForEnabled('Generate Demo E-Way Bill');
  await page.click('Generate Demo E-Way Bill');
  await page.waitForText('Generate a Demo E-Way Bill?');
  await page.clickSelector('#eway-ack-applicability');
  await waitForEnabled('Confirm Demo generation', '[role=dialog]');
  await page.click('Confirm Demo generation', '[role=dialog]');
}
const demoOn = (value) => control('POST', '/demo-authorized', { value });
const setMode = (mode) => control('POST', '/mode', { mode });

const LAYOUT_PROBE = `(() => {
  const root = document.querySelector('[role=tabpanel][data-state=active]') ?? document.body;
  const clientWidth = document.documentElement.clientWidth;
  const visible = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
  const controls = [...root.querySelectorAll('input, textarea, button, [role=combobox], [role=switch], [role=checkbox]')].filter(visible);
  const nameOf = (n) => (n.getAttribute('aria-label') || (n.labels && n.labels[0] ? n.labels[0].textContent : '') || n.textContent || n.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
  const unnamed = controls.filter((n) => !nameOf(n) && !n.getAttribute('aria-labelledby')).map((n) => n.outerHTML.slice(0, 100));
  const clipped = controls.filter((n) => { const r = n.getBoundingClientRect(); return r.right > clientWidth + 1 || r.left < -1; }).map(nameOf);
  const tiny = controls.filter((n) => { const r = n.getBoundingClientRect(); return r.width < 8 || r.height < 8; }).map(nameOf);
  const overlaps = [];
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 2 && h > 2) overlaps.push([nameOf(a), nameOf(b)]);
  }
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth, unnamed, clipped, tiny, overlaps };
})()`;
const SECTION_TITLES = ['E-Way Bill status', 'Movement information', 'Generation preview', 'Existing E-Way Bill and history'];
async function assertLayout(tag, width) {
  const probe = await page.evaluate(LAYOUT_PROBE);
  check(`${tag} ${width}px: no horizontal page overflow`, probe.scrollWidth <= probe.clientWidth + 1, `scrollWidth ${probe.scrollWidth} > ${probe.clientWidth}`);
  check(`${tag} ${width}px: no clipped controls`, probe.clipped.length === 0, probe.clipped.join(', '));
  check(`${tag} ${width}px: no overlapping controls`, probe.overlaps.length === 0, JSON.stringify(probe.overlaps));
  check(`${tag} ${width}px: every control has an accessible name`, probe.unnamed.length === 0, probe.unnamed.join(' | '));
  check(`${tag} ${width}px: no collapsed controls`, probe.tiny.length === 0, probe.tiny.join(', '));
}
async function assertDialogFits(tag, width) {
  const box = await page.evaluate(
    `(() => { const d = document.querySelector('[role=dialog]'); if (!d) return null; const r = d.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight}; })()`,
  );
  check(`${tag} ${width}px: dialog is present`, box);
  check(
    `${tag} ${width}px: dialog fits the viewport`,
    box.left >= -1 && box.right <= box.vw + 1 && box.top >= -1 && box.bottom <= box.vh + 1,
    JSON.stringify(box),
  );
}
const setWidth = (width) => page.setViewport(width, width === 375 ? 800 : 1000);

// ---- scenario runner ----------------------------------------------------
async function scenario(id, title, work) {
  if (ONLY.length > 0 && !ONLY.includes(id)) return;
  current = { id, title, status: 'running', assertions: [], screenshots: [] };
  report.scenarios.push(current);
  const started = Date.now();
  log(`${id}: ${title}`);
  try {
    await work();
    current.status = 'passed';
  } catch (error) {
    current.status = 'failed';
    current.error = error instanceof Error ? error.message : String(error);
    log(`  FAILED: ${current.error}`);
    try {
      await shot(page, `FAILED-${id}`);
    } catch {
      // the browser may be gone
    }
  } finally {
    current.durationMs = Date.now() - started;
    await setWidth(1440).catch(() => {});
    await control('POST', '/read-faults', { suffixes: [] }).catch(() => {});
    await control('POST', '/read-gate/release').catch(() => {});
  }
}

// =========================================================================
// 0. Environment proof
// =========================================================================
await scenario('S0', 'Harness environment is isolated and starts unauthorized', async () => {
  const initial = await state();
  check('provider is the injected mock', initial.mocked === true);
  check('provider journal starts empty', initial.journal.length === 0);
  check('server Demo authorization starts OFF', initial.demoAuthorized === false);
  check('no external request has been attempted', initial.blockedExternalRequests.length === 0);
  const totals = await control('GET', '/db/ewaybill-totals');
  equal('no E-Way Bill records exist before the run', totals, { bills: 0, attempts: 0, liveBills: 0 });
  check('twelve synthetic invoices were prepared', Object.keys(inv).length === 12);
  equal('every prepared invoice but the draft is FINALIZED', Object.entries(inv).filter(([, v]) => v.status !== 'FINALIZED').map(([k]) => k), ['draft']);
});

// Physical dispatch exists independently of any E-Way Bill: two invoices are
// dispatched BEFORE any E-Way Bill operation so we can prove the module never
// touches ErveDispatch afterwards.
let dispatchBaseline = [];
await scenario('S1', 'Physical dispatch proceeds with no E-Way Bill (and is later untouched)', async () => {
  const merchandiser = await apiLogin('MERCHANDISER');
  for (const name of ['dispatch', 'duplicate']) {
    const readiness = await api(await apiLogin('ACCOUNTANT'), 'GET', `/tax-invoices/${inv[name].id}/eway-bill-readiness`);
    equal(`${name}: no E-Way Bill of any kind is recorded`, [readiness.body.data.linkage.ewayBill, readiness.body.data.linkage.syntheticRecords.demoBill], [null, null]);
    const dispatched = await api(merchandiser, 'POST', '/erve-dispatches', {
      ervePackingListId: inv[name].eiplId,
      dispatchDate: '2026-11-04',
    });
    equal(`${name}: Erve Dispatch is created without an E-Way Bill`, dispatched.status, 201);
  }
  dispatchBaseline = await control('GET', '/db/dispatches');
  equal('two Erve Dispatches exist', dispatchBaseline.length, 2);
  equal('no E-Way Bill row was created by dispatching', (await control('GET', '/db/ewaybill-totals')).bills, 0);
});

// =========================================================================
// 1. GST Compliance Settings
// =========================================================================
await scenario('S2', 'GST Compliance Settings gate Demo generation', async () => {
  await login('ACCOUNTANT');
  await page.goto(`${APP}/gst-compliance/settings`, 'GST Compliance Settings');
  await page.waitForText('Enable E-Way Bill Generation');
  const eway = () => page.evaluate("(() => { const s = document.querySelector('#gst-eway-enabled'); return {disabled: s.disabled, checked: s.getAttribute('aria-checked') ?? String(s.checked)}; })()");
  equal('switch is disabled while the server is not authorized', (await eway()).disabled, true);
  check('the reason is explained', await page.hasText('Demo E-Way Bill generation is not authorized on this server'));
  check('Live Mode is unavailable', await page.evaluate("document.querySelector('#gst-live-mode').disabled === true || document.querySelector('#gst-live-mode').getAttribute('aria-disabled') === 'true'"));
  check('Live unavailability is explained', await page.hasText('Live Mode is unavailable until server-side production authorization is enabled.'));
  await shot(page, 'settings-server-not-authorized-1440');

  // The same gate on the invoice itself: Demo generation is not offered.
  await openEway(inv.layout);
  check('invoice preview reports Demo generation Not available', await page.hasText('Not available'));
  equal('Generate Demo E-Way Bill is disabled', (await button('Generate Demo E-Way Bill')).disabled, true);

  // Authorize on the server; the Accountant can now enable Demo generation.
  await demoOn(true);
  await page.goto(`${APP}/gst-compliance/settings`, 'Enable E-Way Bill Generation');
  await until(async () => (await eway()).disabled === false, 'switch enabled after server authorization');
  check('Demo-only wording is shown', await page.hasText('Demo mode only: generates synthetic test E-Way Bills. Live E-Way Bill filing is not available.'));
  const before = await state();
  await page.clickSelector('#gst-eway-enabled');
  await waitForEnabled('Save changes');
  await page.click('Save changes');
  await page.waitForText('Settings saved.');
  equal('saving settings made no provider call', (await state()).journal.length, before.journal.length);
  await page.reload('Enable E-Way Bill Generation');
  await until(async () => (await eway()).checked === 'true', 'enabled setting survives reload');
  const row = await control('GET', '/db/settings');
  equal('database holds Demo mode with generation enabled', [row.integrationMode, row.ewayBillGenerationEnabled], ['DEMO', true]);
  await shot(page, 'settings-enabled-1440');

  // Live cannot be activated: the server refuses even a direct request.
  const token = await apiLogin('ACCOUNTANT');
  const settings = await api(token, 'GET', '/gst-compliance/settings');
  const live = await api(token, 'PATCH', '/gst-compliance/settings', {
    integrationMode: 'LIVE',
    onlineGstinVerificationEnabled: settings.body.data.onlineGstinVerificationEnabled,
    gstinVerificationLevel: settings.body.data.gstinVerificationLevel,
    ewayBillGenerationEnabled: true,
    expectedVersion: settings.body.data.version,
    confirmLiveActivation: true,
  });
  check('direct Live activation is refused by the server', live.status >= 400 && live.status < 500, `status ${live.status}`);
  equal('the stored mode is still DEMO', (await control('GET', '/db/settings')).integrationMode, 'DEMO');

  // An enabled setting can always be switched off, even after the server
  // authorization is withdrawn.
  await demoOn(false);
  await page.reload('Enable E-Way Bill Generation');
  await until(async () => (await eway()).checked === 'true' && (await eway()).disabled === false, 'enabled switch stays operable without authorization');
  await page.clickSelector('#gst-eway-enabled');
  await waitForEnabled('Save changes');
  await page.click('Save changes');
  await page.waitForText('Settings saved.');
  await page.reload('Enable E-Way Bill Generation');
  await until(async () => (await eway()).checked === 'false', 'disabled setting survives reload');
  equal('database now holds generation disabled', (await control('GET', '/db/settings')).ewayBillGenerationEnabled, false);

  // Restore the intended starting point for the rest of the run.
  await demoOn(true);
  await page.reload('Enable E-Way Bill Generation');
  await until(async () => (await eway()).disabled === false, 'switch operable again');
  await page.clickSelector('#gst-eway-enabled');
  await waitForEnabled('Save changes');
  await page.click('Save changes');
  await page.waitForText('Settings saved.');
  equal('generation is enabled for the scenarios that follow', (await control('GET', '/db/settings')).ewayBillGenerationEnabled, true);
  equal('settings never called the provider', (await state()).journal.length, 0);
});

// =========================================================================
// 2. Accountant workflow
// =========================================================================
await scenario('S3', 'Accountant: tab, empty states, movement capture, persistence, zero distance', async () => {
  await login('ACCOUNTANT');
  await page.goto(invoiceUrl(inv.happy), inv.happy.invoiceNumber);
  for (const tab of ['Review', 'History', 'E-Way Bill']) {
    check(`tab "${tab}" is present`, await page.evaluate(`[...document.querySelectorAll('[role=tab]')].some(n => n.textContent.trim() === ${JSON.stringify(tab)})`));
  }
  // Existing tabs still work.
  await page.click('History');
  await page.click('Review');
  check('Review tab still renders the invoice', await page.hasText('Seller and parties'));
  await selectEwayTab();
  await waitEwayLoaded();
  for (const title of SECTION_TITLES) check(`section "${title}" renders`, await page.hasText(title));
  check('initial invoice status is Finalized', await page.hasText('Finalized'));
  check('movement empty state', await page.hasText('No movement information saved yet.'));
  check('bill empty state', await page.hasText('No E-Way Bill is recorded for this invoice.'));
  check('attempt empty state', await page.hasText('No generation attempts yet.'));
  check('statutory verification is not claimed', await page.hasText('No provider-verified E-Way Bill on record'));
  equal('Generate is disabled before any movement is captured', (await button('Generate Demo E-Way Bill')).disabled, true);
  await shot(page, 'accountant-initial-1440');

  await captureMovementUi();
  equal('database holds movement version 1', (await evidenceFor(inv.happy)).movement.version, 1);
  equal('zero distance is stored as 0, not null', (await evidenceFor(inv.happy)).movement.approximateDistanceKm, 0);

  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  equal('vehicle number persists', await page.value('Vehicle number'), MOVEMENT.vehicle);
  equal('zero distance persists and is shown as 0', await page.value('Approximate distance (km)'), '0');
  equal('transport mode persists', await page.selectedText('Transport mode'), MOVEMENT.mode);
  equal('ship-to persists', await page.selectedText('Ship-to'), MOVEMENT.shipTo);
  check('movement version is displayed', await page.hasText('Version 1'));

  // Preview shows document identity, classification and readiness.
  check('preview shows the document identity', await page.hasText(`INV ${inv.happy.invoiceNumber} ·`));
  check('preview shows the classification', await page.hasText('Regular · Ship-to: Billed party · Dispatch-from: Supplier registered premises'));
  check('preview shows readiness', await page.hasText('Request ready'));
  check('preview shows the item count', /Items\s+1(?!\d)/.test(await page.text()));
  check('Live is stated as unavailable', await page.hasText('Live (statutory) E-Way Bill generation is not available in ERVE India.'));
  await shot(page, 'accountant-movement-saved-1440');

  // Unsaved edits survive tab switching and failed history refreshes.
  await page.fill('Vehicle number', 'TN09ZZ9999');
  await page.click('History');
  await page.click('E-Way Bill');
  equal('unsaved edit survives switching tabs', await page.value('Vehicle number'), 'TN09ZZ9999');
  await control('POST', '/read-faults', { suffixes: ['/eway-bill/attempts'] });
  // A reconnect makes TanStack Query refetch stale reads (window-focus refetch is disabled app-wide).
  await page.evaluate("window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online'))");
  await page.waitForText('could not be verified, so movement information cannot be edited. Your unsaved changes are kept.');
  equal('unsaved edit survives a failed history refresh', await page.value('Vehicle number'), 'TN09ZZ9999');
  equal('Save is not offered while status is unverified', await buttonExists('Save movement information'), false);
  check('a retry is offered', await buttonExists('Retry loading status'));
  await control('POST', '/read-faults', { suffixes: [] });
  await page.click('Retry loading status');
  await waitForEnabled('Save movement information');
  equal('edit is still intact after recovery', await page.value('Vehicle number'), 'TN09ZZ9999');
  equal('nothing was saved by the failed refresh', (await evidenceFor(inv.happy)).movement.vehicleNumber, MOVEMENT.vehicle);
});

await scenario('S4', 'Accountant: Demo generation, warning, acknowledgement, reload persistence', async () => {
  await login('ACCOUNTANT');
  await openEway(inv.happy);
  check('Demo generation is now Available', await page.hasText('Available'));
  await waitForEnabled('Generate Demo E-Way Bill');
  await page.click('Generate Demo E-Way Bill');
  await page.waitForText('Generate a Demo E-Way Bill?');
  for (const sentence of ['The resulting E-Way Bill is synthetic.', 'It has no statutory validity.', 'It is not a government filing.']) {
    check(`dialog warns: ${sentence}`, await page.hasText(sentence));
  }
  check('applicability acknowledgement is required', await page.hasText('Applicability has not been automatically determined, and I have determined it myself.'));
  equal('confirm is disabled until acknowledged', (await button('Confirm Demo generation', '[role=dialog]')).disabled, true);
  await shot(page, 'generate-dialog-1440');
  await page.clickSelector('#eway-ack-applicability');
  await waitForEnabled('Confirm Demo generation', '[role=dialog]');
  const before = (await generateCalls(inv.happy)).length;
  await page.click('Confirm Demo generation', '[role=dialog]');
  await page.waitForText('Demo E-Way Bill — Test only');
  check('the synthetic number is shown', await page.hasText(TEST_NUMBER));
  check('result is described as synthetic, not statutory', await page.hasText('This is a synthetic test record. It has no statutory validity and is not a government filing.'));
  equal('exactly one mock provider call was made', (await generateCalls(inv.happy)).length - before, 1);
  await shot(page, 'generated-1440');

  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  check('the bill persists after a reload', await page.hasText(TEST_NUMBER));
  check('the bill is labelled Demo E-Way Bill — Test only', await page.hasText('Demo E-Way Bill — Test only'));
  check('the attempt is recorded', await page.hasText('Demo E-Way Bill recorded'));
  check('statutory verification is still not claimed', await page.hasText('No provider-verified E-Way Bill on record'));
  equal('"Provider verified" is never shown', await page.hasText('Provider verified'), false);
  equal('a second Demo bill is refused in the UI', (await button('Generate Demo E-Way Bill')).disabled, true);
  check('the reason is shown', await page.hasText('A Demo E-Way Bill already exists for this invoice.'));
  const db = await evidenceFor(inv.happy);
  equal('one bill in the database', db.bills.length, 1);
  equal('bill is DEMO / PROVIDER_GENERATED / SYNTHETIC_DEMO, never verified', [db.bills[0].integrationMode, db.bills[0].source, db.bills[0].verificationStatus, db.bills[0].verifiedAt], ['DEMO', 'PROVIDER_GENERATED', 'SYNTHETIC_DEMO', null]);
  equal('attempt is SUCCEEDED', db.attempts.map((a) => a.outcome), ['SUCCEEDED']);
  for (const action of ['EWAY_BILL_MOVEMENT_UPDATED', 'EWAY_BILL_DEMO_ATTEMPT_PREPARED', 'EWAY_BILL_DEMO_ATTEMPT_DISPATCHED', 'EWAY_BILL_DEMO_ATTEMPT_SUCCEEDED']) {
    check(`audit trail has ${action}`, db.auditActions.includes(action));
  }
  const readiness = await api(await apiLogin('ACCOUNTANT'), 'GET', `/tax-invoices/${inv.happy.id}/eway-bill-readiness`);
  equal('a Demo bill never satisfies statutory clearance', readiness.body.data.linkage.satisfiesStatutoryClearance, false);
  await shot(page, 'history-with-demo-bill-1440');

  // Another invoice may carry the very same synthetic number.
  await openEway(inv.sameNumber);
  await captureMovementUi();
  await generateUi();
  await page.waitForText('Demo E-Way Bill — Test only');
  const numbers = [(await evidenceFor(inv.happy)).bills[0].ewayBillNumber, (await evidenceFor(inv.sameNumber)).bills[0].ewayBillNumber];
  equal('the same synthetic number is permitted on two invoices', numbers, [TEST_NUMBER, TEST_NUMBER]);
});

// =========================================================================
// 3. Failure and recovery
// =========================================================================
await scenario('S5', 'Definitive rejection: REJECTED attempt, no bill, then a corrected retry', async () => {
  await login('ACCOUNTANT');
  await openEway(inv.reject);
  await captureMovementUi();
  await setMode('reject');
  await generateUi();
  await page.waitForText('Rejected by provider');
  const db = await evidenceFor(inv.reject);
  equal('attempt is REJECTED', db.attempts.map((a) => a.outcome), ['REJECTED']);
  equal('no bill exists', db.bills.length, 0);
  check('no statutory or Demo bill is claimed', !(await page.hasText('Demo E-Way Bill — Test only')));
  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  check('a rejected attempt does not block another one', await buttonEnabled('Generate Demo E-Way Bill'));
  await setMode('success');
  await generateUi();
  await page.waitForText('Demo E-Way Bill — Test only');
  equal('attempts are REJECTED then SUCCEEDED', (await evidenceFor(inv.reject)).attempts.map((a) => a.outcome), ['REJECTED', 'SUCCEEDED']);
  equal('two provider calls for this invoice', (await generateCalls(inv.reject)).length, 2);
});

await scenario('S6', 'Provider timeout: open UNCERTAIN attempt, refresh failure keeps generation disabled, audited closure', async () => {
  await login('ACCOUNTANT');
  await openEway(inv.timeout);
  await captureMovementUi();
  await setMode('timeout');
  // Status reads fail from here on, so the post-request refresh cannot confirm anything.
  await control('POST', '/read-faults', { suffixes: ['/eway-bill/attempts', '/eway-bill/generation-preview', '/eway-bill-readiness'] });
  await generateUi();
  await page.waitForText('Generation outcome unknown');
  check('the UI says do not retry', await page.hasText('Do not retry.'));
  await page.waitForText('Latest status could not be confirmed');
  equal('Generate stays disabled when the refresh failed', (await button('Generate Demo E-Way Bill')).disabled, true);
  const callsAfterRequest = (await generateCalls(inv.timeout)).length;
  equal('exactly one provider call', callsAfterRequest, 1);
  let db = await evidenceFor(inv.timeout);
  equal('attempt is UNCERTAIN', db.attempts.map((a) => a.outcome), ['UNCERTAIN']);
  equal('no bill was created', db.bills.length, 0);

  const token = await apiLogin('ACCOUNTANT');
  const retry = await api(token, 'POST', ewayPath(inv.timeout, '/generate'), { expectedMovementVersion: 1, acknowledgeApplicabilityUndetermined: true });
  equal('backend refuses another request while the attempt is open', retry.status, 409);
  equal('no second provider call', (await generateCalls(inv.timeout)).length, callsAfterRequest);

  // A browser refresh while status reads still fail.
  await page.reload();
  await until(async () => {
    if (!(await ewayTabSelected())) {
      if (await page.evaluate("document.querySelector('[role=tab]') !== null")) await page.click('E-Way Bill');
      return false;
    }
    return (await page.hasText('Unable to load generation preview')) || (await page.hasText('could not be verified'));
  }, 'faulted status visible');
  check('generation cannot be started from a faulted page', !(await buttonEnabled('Generate Demo E-Way Bill')));
  await shot(page, 'status-read-failure-1440');

  // Reads recover: the backend's open attempt still blocks.
  await control('POST', '/read-faults', { suffixes: [] });
  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  check('fresh status shows the unfinished attempt', await page.hasText('Needs review by a person.'));
  check('status panel counts the unresolved attempt', await page.hasText('1 unfinished request'));
  equal('Generate is disabled by the open attempt', (await button('Generate Demo E-Way Bill')).disabled, true);
  check('the reason is explained', await page.hasText('An earlier request is unfinished.'));
  equal('movement editing is blocked while the attempt is open', await buttonExists('Save movement information'), false);
  const blocked = await api(token, 'POST', ewayPath(inv.timeout, '/generate'), { expectedMovementVersion: 1, acknowledgeApplicabilityUndetermined: true });
  equal('backend still blocks after the browser refresh', blocked.status, 409);
  equal('provider was not called again', (await generateCalls(inv.timeout)).length, callsAfterRequest);

  // Manual closure: dialog geometry at every size, then an audited close.
  await page.click('Close Demo Attempt');
  await page.waitForText('Close this Demo attempt?');
  for (const width of WIDTHS) {
    await setWidth(width);
    await assertDialogFits('close dialog', width);
    await shot(page, `close-attempt-dialog-${width}`);
  }
  await setWidth(1440);
  equal('closure needs a reason', (await button('Confirm closure', '[role=dialog]')).disabled, true);
  await page.fill('Reason', 'short');
  equal('a too-short reason is refused', (await button('Confirm closure', '[role=dialog]')).disabled, true);
  await page.fill('Reason', 'Acceptance run: synthetic timeout, nothing real was filed');
  await waitForEnabled('Confirm closure', '[role=dialog]');
  await page.click('Confirm closure', '[role=dialog]');
  await page.waitForText('Demo attempt closed. Nothing was retried.');
  db = await evidenceFor(inv.timeout);
  equal('attempt is CLOSED', db.attempts.map((a) => a.outcome), ['CLOSED']);
  check('closure is attributed and reasoned', db.attempts[0].resolvedById && db.attempts[0].resolutionReason === 'Acceptance run: synthetic timeout, nothing real was filed');
  check('closure is audited', db.auditActions.includes('EWAY_BILL_DEMO_ATTEMPT_CLOSED'));
  equal('no bill appeared', db.bills.length, 0);
  check('the UI shows who closed it and why', await page.hasText('Closed by Acceptance ACCOUNTANT'));
  equal('closing did not trigger a retry', (await generateCalls(inv.timeout)).length, callsAfterRequest);
  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  equal('still no automatic retry after a reload', (await generateCalls(inv.timeout)).length, callsAfterRequest);
  check('closure released the invoice for another test', await buttonEnabled('Generate Demo E-Way Bill'));
});

await scenario('S7', 'Ambiguous response: attempt stays open and no statutory claim is made', async () => {
  await login('ACCOUNTANT');
  await openEway(inv.ambiguous);
  await captureMovementUi();
  await setMode('ambiguous');
  await generateUi();
  await page.waitForText('Generation outcome unknown');
  const db = await evidenceFor(inv.ambiguous);
  equal('attempt is UNCERTAIN', db.attempts.map((a) => a.outcome), ['UNCERTAIN']);
  equal('failure code records the non-synthetic reply', db.attempts[0].failureCode, 'NOT_SYNTHETIC_RESPONSE');
  equal('no bill was recorded', db.bills.length, 0);
  equal('no Demo bill is displayed', await page.hasText('Demo E-Way Bill — Test only'), false);
  const readiness = await api(await apiLogin('ACCOUNTANT'), 'GET', `/tax-invoices/${inv.ambiguous.id}/eway-bill-readiness`);
  equal('no statutory clearance is claimed', readiness.body.data.linkage.satisfiesStatutoryClearance, false);
  equal('generation is blocked by the open attempt', (await button('Generate Demo E-Way Bill')).disabled, true);
  await setMode('success');
});

await scenario('S8', 'Duplicate submission makes exactly one provider call', async () => {
  await login('ACCOUNTANT');
  await openEway(inv.duplicate);
  await captureMovementUi();
  await setMode('hold'); // the provider answers only when released
  await waitForEnabled('Generate Demo E-Way Bill');
  await page.click('Generate Demo E-Way Bill');
  await page.waitForText('Generate a Demo E-Way Bill?');
  await page.clickSelector('#eway-ack-applicability');
  await waitForEnabled('Confirm Demo generation', '[role=dialog]');
  // Two rapid clicks on the same confirm button.
  await page.click('Confirm Demo generation', '[role=dialog]');
  await page.click('Confirm Demo generation', '[role=dialog]').catch(() => {}); // the button is busy or gone: that is the point
  await until(async () => (await state()).heldRequests === 1, 'request held inside the provider');
  const token = await apiLogin('ACCOUNTANT');
  const raced = await Promise.all([
    api(token, 'POST', ewayPath(inv.duplicate, '/generate'), { expectedMovementVersion: 1, acknowledgeApplicabilityUndetermined: true }),
    api(token, 'POST', ewayPath(inv.duplicate, '/generate'), { expectedMovementVersion: 1, acknowledgeApplicabilityUndetermined: true }),
  ]);
  equal('concurrent direct submissions are refused with 409', raced.map((r) => r.status), [409, 409]);
  equal('only one request reached the provider', (await generateCalls(inv.duplicate)).length, 1);
  await control('POST', '/release', { outcome: 'success' });
  await page.waitForText('Demo E-Way Bill — Test only');
  await setMode('success');
  const db = await evidenceFor(inv.duplicate);
  equal('exactly one bill', db.bills.length, 1);
  equal('exactly one attempt', db.attempts.length, 1);
  equal('still exactly one provider call', (await generateCalls(inv.duplicate)).length, 1);
});

// =========================================================================
// 4. External E-Way Bill linking
// =========================================================================
await scenario('S9', 'Linking an external number: validation, UNVERIFIED_REFERENCE, no lookup', async () => {
  const accountant = await apiLogin('ACCOUNTANT');
  const callsBefore = (await state()).journal.length;
  for (const bad of ['12345678901', '1234567890123', '12345678901A', TEST_NUMBER, 'TEST-123456789012', '']) {
    const refused = await api(accountant, 'POST', ewayPath(inv.link, '/link'), { ewayBillNumber: bad });
    check(`"${bad}" is rejected`, refused.status === 400, `status ${refused.status}`);
  }
  equal('rejected numbers left no record', (await evidenceFor(inv.link)).bills.length, 0);
  for (const role of ['ADMIN', 'MERCHANDISER']) {
    const denied = await api(await apiLogin(role), 'POST', ewayPath(inv.link, '/link'), { ewayBillNumber: LIVE_NUMBER });
    equal(`${role} cannot link`, denied.status, 403);
  }
  equal('unauthorized links left no record', (await evidenceFor(inv.link)).bills.length, 0);

  await login('ACCOUNTANT');
  await openEway(inv.link);
  await page.click('Link Existing E-Way Bill');
  await page.waitForText('Link an existing E-Way Bill');
  await page.fill('E-Way Bill number', '12345678901');
  check('inline validation explains the 12-digit rule', await page.hasText('An E-Way Bill number is exactly 12 digits.'));
  equal('submit is disabled for an invalid number', (await button('Link as unverified reference', '[role=dialog]')).disabled, true);
  await page.fill('E-Way Bill number', LIVE_NUMBER);
  equal('submit is disabled until the number is confirmed', (await button('Link as unverified reference', '[role=dialog]')).disabled, true);
  check('the dialog says the number is not verified', await page.hasText('ERVE India has not verified this number.'));
  await page.clickSelector('#eway-link-confirm');
  await waitForEnabled('Link as unverified reference', '[role=dialog]');
  await shot(page, 'link-dialog-1440');
  await page.click('Link as unverified reference', '[role=dialog]');
  await page.waitForText('Linked as an unverified reference');
  await page.reload();
  await selectEwayTab();
  await waitEwayLoaded();
  check('linked number persists after reload', await page.hasText(LIVE_NUMBER));
  check('badge reads "Existing E-Way Bill — Not verified"', await page.hasText('Existing E-Way Bill — Not verified'));
  equal('"Provider verified" is never shown for a link', await page.hasText('Provider verified'), false);
  check('statutory verification is not claimed', await page.hasText('No provider-verified E-Way Bill on record'));
  equal('a second link is not offered', (await button('Link Existing E-Way Bill')).disabled, true);
  await shot(page, 'linked-reference-1440');
  const db = await evidenceFor(inv.link);
  equal('stored as LIVE / EXTERNALLY_LINKED / UNVERIFIED_REFERENCE, never verified', [db.bills[0].integrationMode, db.bills[0].source, db.bills[0].verificationStatus, db.bills[0].verifiedAt], ['LIVE', 'EXTERNALLY_LINKED', 'UNVERIFIED_REFERENCE', null]);
  check('link is audited', db.auditActions.includes('EWAY_BILL_REFERENCE_LINKED'));
  const readiness = await api(accountant, 'GET', `/tax-invoices/${inv.link.id}/eway-bill-readiness`);
  equal('a manual link never satisfies statutory clearance', readiness.body.data.linkage.satisfiesStatutoryClearance, false);

  // A Live number already recorded cannot be linked to another invoice.
  const duplicate = await api(accountant, 'POST', ewayPath(inv.linkDuplicate, '/link'), { ewayBillNumber: LIVE_NUMBER });
  equal('duplicate Live number is rejected by the API', duplicate.status, 409);
  await openEway(inv.linkDuplicate);
  await page.click('Link Existing E-Way Bill');
  await page.waitForText('Link an existing E-Way Bill');
  await page.fill('E-Way Bill number', LIVE_NUMBER);
  await page.clickSelector('#eway-link-confirm');
  await waitForEnabled('Link as unverified reference', '[role=dialog]');
  await page.click('Link as unverified reference', '[role=dialog]');
  await page.waitForText('already recorded');
  equal('duplicate left no record on the second invoice', (await evidenceFor(inv.linkDuplicate)).bills.length, 0);
  await shot(page, 'link-duplicate-error-1440');
  equal('no provider call or lookup happened while linking', (await state()).journal.length, callsBefore);
});

// =========================================================================
// 5. Authorization
// =========================================================================
await scenario('S10', 'ADMIN is read-only in the browser and at the API', async () => {
  await login('ADMIN');
  await openEway(inv.ambiguous);
  for (const title of SECTION_TITLES) check(`ADMIN sees section "${title}"`, await page.hasText(title));
  check('ADMIN sees the unfinished attempt', await page.hasText('Generation outcome unknown'));
  for (const label of ['Save movement information', 'Generate Demo E-Way Bill', 'Link Existing E-Way Bill', 'Close Demo Attempt']) {
    equal(`ADMIN has no "${label}" control`, await buttonExists(label), false);
  }
  check('ADMIN is told the view is read-only', await page.hasText('View only — an Accountant performs E-Way Bill operations.'));
  const fieldsDisabled = await page.evaluate("[...document.querySelectorAll('[role=tabpanel][data-state=active] input, [role=tabpanel][data-state=active] [role=combobox]')].every(n => n.disabled || n.getAttribute('aria-disabled') === 'true' || n.readOnly)");
  check('ADMIN cannot edit movement fields', fieldsDisabled);
  await shot(page, 'admin-read-only-1440');

  const admin = await apiLogin('ADMIN');
  const before = [await evidenceFor(inv.ambiguous), await control('GET', '/db/ewaybill-totals'), (await state()).journal.length];
  for (const suffix of ['/movement', '/generation-preview', '/attempts']) {
    equal(`ADMIN may read ${suffix}`, (await api(admin, 'GET', ewayPath(inv.ambiguous, suffix))).status, 200);
  }
  equal('ADMIN may read readiness', (await api(admin, 'GET', `/tax-invoices/${inv.ambiguous.id}/eway-bill-readiness`)).status, 200);
  const attemptId = (await evidenceFor(inv.ambiguous)).attempts[0].id;
  const mutations = [
    ['PUT', ewayPath(inv.ambiguous, '/movement'), { expectedVersion: 1, transportMode: 'ROAD' }],
    ['POST', ewayPath(inv.ambiguous, '/generate'), { expectedMovementVersion: 1 }],
    ['POST', ewayPath(inv.ambiguous, `/attempts/${attemptId}/close-demo`), { expectedOutcome: 'UNCERTAIN', reason: 'Administrator attempting a closure' }],
    ['POST', ewayPath(inv.ambiguous, '/link'), { ewayBillNumber: '999999999999' }],
  ];
  for (const [method, route, body] of mutations) {
    equal(`ADMIN ${method} ${route.split('/eway-bill')[1]} is forbidden`, (await api(admin, method, route, body)).status, 403);
  }
  const after = [await evidenceFor(inv.ambiguous), await control('GET', '/db/ewaybill-totals'), (await state()).journal.length];
  equal('ADMIN requests changed nothing', after, before);
});

await scenario('S11', 'Other roles: no tab, no E-Way Bill requests, every operation refused', async () => {
  const others = ALL_ROLES.filter((role) => role !== 'ADMIN' && role !== 'ACCOUNTANT');
  const before = [await evidenceFor(inv.ambiguous), await control('GET', '/db/ewaybill-totals'), (await state()).journal.length];
  const attemptId = (await evidenceFor(inv.ambiguous)).attempts[0].id;
  const routes = [
    ['GET', `/tax-invoices/${inv.ambiguous.id}/eway-bill-readiness`],
    ['GET', ewayPath(inv.ambiguous, '/movement')],
    ['GET', ewayPath(inv.ambiguous, '/generation-preview')],
    ['GET', ewayPath(inv.ambiguous, '/attempts')],
    ['PUT', ewayPath(inv.ambiguous, '/movement'), { expectedVersion: 1 }],
    ['POST', ewayPath(inv.ambiguous, '/generate'), { expectedMovementVersion: 1 }],
    ['POST', ewayPath(inv.ambiguous, `/attempts/${attemptId}/close-demo`), { expectedOutcome: 'UNCERTAIN', reason: 'Not an accountant at all' }],
    ['POST', ewayPath(inv.ambiguous, '/link'), { ewayBillNumber: '888888888888' }],
  ];
  for (const role of others) {
    const token = await apiLogin(role);
    const statuses = [];
    for (const [method, route, body] of routes) statuses.push((await api(token, method, route, body)).status);
    equal(`${role}: all ${routes.length} operations are 403`, statuses, routes.map(() => 403));
  }
  for (const [method, route, body] of routes) {
    equal(`unauthenticated ${method} ${route.split('/tax-invoices/')[1]} is 401`, (await api(null, method, route, body)).status, 401);
  }
  const after = [await evidenceFor(inv.ambiguous), await control('GET', '/db/ewaybill-totals'), (await state()).journal.length];
  equal('refused requests changed nothing', after, before);

  // In the browser: a role without Tax Invoice access never reaches the tab,
  // and its session makes no E-Way Bill request.
  await login('MERCHANDISER');
  const since = page.requests.length;
  await page.goto(invoiceUrl(inv.ambiguous));
  await until(async () => page.evaluate("location.pathname === '/forbidden' || document.body.innerText.length > 0 && !document.body.innerText.includes('Loading')"), 'forbidden page settled');
  equal('the page is not the Tax Invoice', await page.hasText(inv.ambiguous.invoiceNumber), false);
  equal('there is no E-Way Bill tab', await page.evaluate("[...document.querySelectorAll('[role=tab]')].some(n => n.textContent.trim() === 'E-Way Bill')"), false);
  const apiRequests = (fragment) => page.requestsSince(since, fragment).filter((request) => request.url.startsWith(API));
  equal('the session made zero E-Way Bill API requests', apiRequests('eway-bill').length, 0);
  equal('the session never requested the Tax Invoice API', apiRequests('/tax-invoices/').length, 0);
  await shot(page, 'other-role-forbidden-1440');
});

// =========================================================================
// 6. Non-blocking business behaviour
// =========================================================================
await scenario('S12', 'E-Way Bill never blocks invoice finalization or physical dispatch', async () => {
  const accountant = await apiLogin('ACCOUNTANT');
  const open = (await state()) && (await evidenceFor(inv.ambiguous)).attempts.filter((a) => a.outcome === 'UNCERTAIN').length;
  check('an unfinished E-Way Bill attempt exists elsewhere', open === 1);
  await login('ACCOUNTANT');
  await openEway(inv.draft);
  check('a draft invoice is told generation needs a finalized invoice', await page.hasText('Demo generation needs a finalized Tax Invoice.'));
  equal('no E-Way Bill row exists for the draft', (await evidenceFor(inv.draft)).bills.length + (await evidenceFor(inv.draft)).attempts.length, 0);
  const finalized = await api(accountant, 'POST', `/tax-invoices/${inv.draft.id}/actions/finalize`, {});
  equal('the draft finalizes with no E-Way Bill and an unrelated attempt open', finalized.status, 200);
  equal('the invoice is FINALIZED', finalized.body.data.status, 'FINALIZED');
  equal('finalizing created no E-Way Bill records', (await evidenceFor(inv.draft)).bills.length + (await evidenceFor(inv.draft)).attempts.length, 0);

  // Physical dispatch (S1) already succeeded for an invoice with no E-Way Bill.
  const dispatched = await control('GET', '/db/dispatches');
  check('the invoice without any E-Way Bill was dispatched', dispatched.some((row) => row.ervePackingListId === inv.dispatch.eiplId));
  equal('that invoice has no E-Way Bill record', (await evidenceFor(inv.dispatch)).bills.length, 0);
});

// =========================================================================
// 7. Responsive layout, loading and error states
// =========================================================================
await scenario('S13', 'Responsive layout at 1440, 768 and 375 px; dialogs; loading, empty and error states', async () => {
  await login('ACCOUNTANT');
  for (const width of WIDTHS) {
    await setWidth(width);
    await openEway(inv.layout);
    for (const title of SECTION_TITLES) check(`${width}px: section "${title}" renders`, await page.hasText(title));
    check(`${width}px: empty states are visible`, (await page.hasText('No movement information saved yet.')) && (await page.hasText('No generation attempts yet.')));
    await assertLayout('empty tab', width);
    await shot(page, `layout-empty-${width}`);

    // Fill the movement without saving: the dense state must still lay out.
    await page.select('Transport mode', 'Road');
    await page.fill('Vehicle number', 'TN01AB1234');
    await page.select('Vehicle type', 'Regular');
    await page.fill('Approximate distance (km)', '0');
    await page.select('Ship-to', 'Billed party');
    await page.select('Dispatch-from', 'Different dispatch location');
    await page.waitForText('Dispatch-from address');
    await assertLayout('different dispatch location', width);
    await shot(page, `layout-dispatch-from-address-${width}`);

    // Link dialog.
    await page.click('Link Existing E-Way Bill');
    await page.waitForText('Link an existing E-Way Bill');
    await assertDialogFits('link dialog', width);
    await shot(page, `layout-link-dialog-${width}`);
    await page.pressEscape();
    await until(() => page.evaluate("!document.querySelector('[role=dialog]')"), 'link dialog closed');
  }
  await setWidth(1440);

  // Persist a complete movement on the layout invoice so the Demo dialog and
  // ready state can be measured at every size.
  await openEway(inv.layout);
  await captureMovementUi();
  for (const width of WIDTHS) {
    await setWidth(width);
    await openEway(inv.layout);
    await assertLayout('ready tab', width);
    await shot(page, `layout-ready-${width}`);
    await waitForEnabled('Generate Demo E-Way Bill');
    await page.click('Generate Demo E-Way Bill');
    await page.waitForText('Generate a Demo E-Way Bill?');
    await page.clickSelector('#eway-ack-applicability');
    await assertDialogFits('generate dialog', width);
    await shot(page, `layout-generate-dialog-${width}`);
    await page.click('Cancel', '[role=dialog]');
    await until(() => page.evaluate("!document.querySelector('[role=dialog]')"), 'generate dialog closed');
  }

  // Populated history with a Demo bill, and an unverified reference.
  for (const [name, invoice] of [['demo-bill', inv.happy], ['linked-reference', inv.link]]) {
    for (const width of WIDTHS) {
      await setWidth(width);
      await openEway(invoice);
      await assertLayout(name, width);
      await shot(page, `layout-${name}-${width}`);
    }
  }
  await setWidth(1440);

  // Loading state: hold the movement read open, observe, release.
  await control('POST', '/read-gate', { suffixes: ['/eway-bill/movement'] });
  await page.goto(invoiceUrl(inv.layout), inv.layout.invoiceNumber);
  await selectEwayTab();
  await page.waitForText('Loading movement information');
  await shot(page, 'state-loading-1440', { fullPage: false });
  await control('POST', '/read-gate/release');
  await waitEwayLoaded();

  // Error state: movement read fails, retry recovers.
  await control('POST', '/read-faults', { suffixes: ['/eway-bill/movement', '/eway-bill/attempts'] });
  await page.reload();
  await until(async () => {
    if (!(await ewayTabSelected())) {
      if (await page.evaluate("document.querySelector('[role=tab]') !== null")) await page.click('E-Way Bill');
      return false;
    }
    const text = await page.text();
    return text.includes('Unable to load movement information') && text.includes('Unable to load E-Way Bill history');
  }, 'error states for movement and history');
  check('retry controls are offered', await buttonExists('Retry'));
  for (const width of WIDTHS) {
    await setWidth(width);
    const probe = await page.evaluate(LAYOUT_PROBE);
    check(`error state ${width}px: no horizontal overflow`, probe.scrollWidth <= probe.clientWidth + 1, `scrollWidth ${probe.scrollWidth} > ${probe.clientWidth}`);
    await shot(page, `state-error-${width}`);
  }
  await setWidth(1440);
  await control('POST', '/read-faults', { suffixes: [] });
  await page.evaluate("[...document.querySelectorAll('button')].filter(n => n.textContent.trim() === 'Retry').forEach(n => n.click())");
  await waitEwayLoaded();
  check('the tab recovers after retry', await page.hasText('Existing E-Way Bill and history'));
  check('Tax Invoice Review tab still works after all of this', await (async () => { await page.click('Review'); return page.hasText('Seller and parties'); })());
});

// =========================================================================
// 8. Final invariants
// =========================================================================
await scenario('S14', 'Whole-run invariants: mock only, no Live, dispatch untouched', async () => {
  const final = await state();
  const lookups = final.journal.filter((entry) => entry.kind === 'lookup');
  equal('the provider was never asked to look anything up', lookups.length, 0);
  equal('no external network request was attempted', final.blockedExternalRequests, []);
  const totals = await control('GET', '/db/ewaybill-totals');
  equal('only the one hand-entered reference is LIVE', totals.liveBills, 1);
  const dispatchAfter = await control('GET', '/db/dispatches');
  equal('Erve Dispatches are exactly as before any E-Way Bill operation', dispatchAfter, dispatchBaseline);
  const settings = await control('GET', '/db/settings');
  equal('integration mode is still DEMO', settings.integrationMode, 'DEMO');
  equal('no page raised an uncaught exception', page.consoleErrors, []);
  const bills = [];
  for (const invoice of Object.values(inv)) bills.push(...(await evidenceFor(invoice)).bills);
  equal('no bill is provider-verified', bills.filter((bill) => bill.verificationStatus === 'PROVIDER_VERIFIED').length, 0);
});

// ---- write the report ---------------------------------------------------
const finalState = await state();
const failed = report.scenarios.filter((item) => item.status !== 'passed');
report.finishedAt = new Date().toISOString();
report.summary = {
  scenarios: report.scenarios.length,
  passed: report.scenarios.length - failed.length,
  failed: failed.length,
  assertions: report.scenarios.reduce((sum, item) => sum + item.assertions.length, 0),
  providerCalls: {
    total: finalState.journal.length,
    generate: finalState.journal.filter((entry) => entry.kind === 'generate').length,
    lookup: finalState.journal.filter((entry) => entry.kind === 'lookup').length,
    allServedByInjectedMock: finalState.mocked === true,
    blockedExternalRequests: finalState.blockedExternalRequests.length,
    journal: finalState.journal,
  },
  screenshots: report.screenshots.length,
};
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));
const lines = [
  `# ${report.title}`,
  '',
  `Result: **${failed.length === 0 ? 'PASS' : 'FAIL'}** — ${report.summary.passed}/${report.summary.scenarios} scenarios, ${report.summary.assertions} assertions.`,
  `Provider: injected mock only. ${report.summary.providerCalls.generate} generate calls, ${report.summary.providerCalls.lookup} lookups, ${report.summary.providerCalls.blockedExternalRequests} blocked external requests.`,
  `Browser sizes: ${WIDTHS.join(', ')} px. Screenshots: ${report.summary.screenshots}.`,
  '',
  ...report.scenarios.map((item) => `- ${item.status === 'passed' ? 'PASS' : 'FAIL'} ${item.id} — ${item.title} (${item.assertions.length} assertions)${item.error ? ` — ${item.error}` : ''}`),
  '',
];
await fs.writeFile(path.join(OUT, 'results.md'), lines.join('\n'));
console.log(lines.join('\n'));

page.close();
await chrome.close();
process.exit(failed.length === 0 ? 0 : 1);
