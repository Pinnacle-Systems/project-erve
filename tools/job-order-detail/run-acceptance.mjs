import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';
import { disposableTarget } from './safety.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = disposableTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
const output = await mkdtemp(join(process.env.BATCH1_EVIDENCE_ROOT || tmpdir(), 'erve-batch1-'));
const appUrl = 'http://127.0.0.1:5189',
  apiUrl = 'http://127.0.0.1:4189';
const fixturesPath = join(output, 'fixtures.json');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/batch1_guard',
  TEST_DATABASE_URL: target,
  JWT_ACCESS_SECRET: 'batch1-disposable-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'batch1-disposable-refresh-secret-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '1h',
  BATCH1_FIXTURES: fixturesPath,
  FILE_STORAGE_DIR: join(output, 'uploads'),
  HOST: '127.0.0.1',
  PORT: '4189',
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
};
const children = [];
function launch(args, name, cwd = root, overrides = {}) {
  const child = spawn(process.execPath, args, {
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
  for (let n = 0; n < 1200; n++) {
    if (child.exitCode !== null)
      throw new Error(`Server exited before ready: ${url}; see ${output}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  throw new Error(`Server readiness timed out: ${url}; see ${output}`);
}
async function finished(child) {
  const code = await new Promise((ok, fail) => {
    child.once('exit', ok);
    child.once('error', fail);
  });
  assert.equal(code, 0, `Fixture setup failed; see ${output}`);
}
let driver;
try {
  await finished(
    launch(
      [
        resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'),
        'tools/job-order-detail/fixtures.mts',
      ],
      'fixtures',
    ),
  );
  const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
  const api = launch(
    [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'src/server.ts'],
    'api',
    resolve(root, 'apps/api'),
    { DATABASE_URL: target },
  );
  const web = launch(
    [
      resolve(root, 'apps/web/node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5189',
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
      '--remote-debugging-port=9289',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  children.push(browser);
  await ready('http://127.0.0.1:9289/json/version', browser);
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9289',
    appUrl,
    output,
    repositoryRoot: root,
  });
  await driver.command('Page.bringToFront');
  await driver.command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await driver.command('Page.navigate', { url: `${appUrl}/login` });
  await driver.waitFor(
    `document.readyState === 'complete' && !!document.querySelector('#root')?.firstElementChild`,
    120000,
  );
  let currentRole;
  async function visit(order, role = 'FACTORY_USER', tab = 'overview') {
    if (currentRole !== role) {
      const credentials = {
        identifier: fixtures.actors[role].email,
        password: fixtures.actors[role].password,
      };
      await driver.evaluate(`(async () => {
        const response = await fetch('${apiUrl}/auth/login', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: ${JSON.stringify(JSON.stringify(credentials))}});
        if (!response.ok) throw Error('Synthetic actor login failed');
        const {data} = await response.json(), info = data.session;
        sessionStorage.setItem('erve.accessToken', data.accessToken);
        localStorage.setItem('erve.sessionTiming', JSON.stringify({userId: info.userId, accessExpiresAt: Date.parse(info.accessExpiresAt), idleExpiresAt: Date.parse(info.idleExpiresAt), absoluteExpiresAt: Date.parse(info.absoluteExpiresAt), idleTimeoutMs: info.idleTimeoutSeconds * 1000, clockOffsetMs: Date.parse(info.serverTime) - Date.now()}));
      })()`);
      currentRole = role;
    }
    const previousDocument = await driver.evaluate('performance.timeOrigin');
    await driver.command('Page.navigate', { url: `${appUrl}/job-orders/${order}?tab=${tab}` });
    await driver.waitFor(
      `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && !!document.querySelector('#root')?.firstElementChild`,
      120000,
    );
    await driver.waitFor(
      `!!document.querySelector('.job-order-header') && document.querySelector('h1')?.textContent.includes('BATCH1')`,
    );
    await driver.stabilize();
  }
  async function get(order, role = 'FACTORY_USER') {
    const res = await fetch(`${apiUrl}/job-orders/${order}`, {
      headers: { Authorization: `Bearer ${fixtures.actors[role].token}` },
    });
    assert.equal(res.status, 200);
    return (await res.json()).data;
  }
  // Real app, shell, API, long names and measured content anchors (the thumbnail
  // occupies the leading header gutter; the title is intentionally inset beside it).
  const geometry = [];
  for (const width of [1440, 1280, 1024, 390]) {
    await driver.viewport(width, 1000);
    for (const [order, role] of [
      [fixtures.draft, 'MERCHANDISER'],
      [fixtures.sent, 'FACTORY_USER'],
    ]) {
      await visit(order, role);
      if (role === 'FACTORY_USER') {
        await driver.waitFor(`!!document.querySelector('[role=dialog]')`);
        await driver.clickButton('Review in Production');
        await driver.waitFor(`!document.querySelector('[role=dialog]')`);
        await driver.waitFor(
          `document.querySelector('[role=tab][data-state=active]')?.textContent === 'Production'`,
        );
      }
      for (const tab of ['Overview', 'Production', 'Quality', 'History']) {
        await driver.clickButton(tab);
        await driver.waitFor(
          `document.querySelector('[role=tab][data-state=active]')?.textContent === ${JSON.stringify(tab)}`,
        );
        await driver.assert(
          'ISS019',
          'page is unobscured by dialogs',
          `!document.querySelector('[role=dialog]')`,
        );
        const result = await driver.evaluate(`(() => {
        const header = document.querySelector('.job-order-header');
        const content = header.firstElementChild;
        const tabs = document.querySelector('[role=tablist]');
        const panel = document.querySelector('[role=tabpanel][data-state=active]');
        const box = el => ({left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right});
        const anchors = [box(content), box(tabs.parentElement), box(panel)];
        const operational = header.querySelector('[aria-label="Current Job Order operational state"]');
        const actions = [...header.querySelectorAll('button,a')].filter(el => el.getClientRects().length);
        return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, anchors,
          operationalVisible: operational.getBoundingClientRect().width > 0,
          actions: actions.map(el => ({label: el.textContent.trim(), ...box(el), visible: el.getBoundingClientRect().height > 0})),
          style: header.textContent.includes('deliberately long'),
          factory: header.textContent.includes('manufacturing and finishing'),
          height: header.getBoundingClientRect().height};
      })()`);
        assert.ok(result.style && result.factory);
        for (const box of result.anchors) {
          assert.ok(
            Math.abs(box.left - result.anchors[0].left) <= 1,
            `Left gutters ${JSON.stringify(result)}`,
          );
          assert.ok(
            Math.abs(box.right - result.anchors[0].right) <= 1,
            `Right gutters ${JSON.stringify(result)}`,
          );
        }
        assert.ok(result.scrollWidth <= width + 1, `Document overflow ${JSON.stringify(result)}`);
        assert.ok(result.operationalVisible);
        assert.ok(result.actions.length >= (role === 'FACTORY_USER' ? 4 : 5));
        assert.ok(result.actions.every((a) => a.visible && a.left >= 0 && a.right <= width + 1));
        geometry.push({ role, tab, ...result });
      }
      console.log(`Geometry passed: ${width}px ${role}, four active tabs`);
      await driver.captureEvidence({
        caseId: 'ISS019',
        step: `width-${width}-${role}`,
        expected: 'aligned gutters, no document overflow',
        observed: geometry.at(-1),
      });
    }
  }
  await writeFile(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
  await driver.viewport(1280, 1000);
  // The fallback was exercised above. Now upload only a synthetic solid marker
  // and verify the unchanged authenticated thumbnail + original-image viewer.
  const imageForm = new FormData();
  imageForm.append(
    'image',
    new Blob([Buffer.from(fixtures.marker, 'base64')], { type: 'image/png' }),
    'batch1-synthetic-marker.png',
  );
  const uploaded = await fetch(`${apiUrl}/styles/${fixtures.styleId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fixtures.actors.ADMIN.token}` },
    body: imageForm,
  });
  assert.equal(uploaded.status, 201, 'Synthetic primary Style image uploads');
  for (const role of ['FACTORY_USER', 'QA_USER']) {
    await visit(fixtures.prepared, role);
    await driver.waitFor(`document.querySelector('.job-order-header img')?.naturalWidth === 512`);
    await driver.evaluate(
      `document.querySelector('.job-order-header [aria-label="View style image"]').focus()`,
    );
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
    });
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await driver.waitFor(
      `[...document.querySelectorAll('[role=dialog] img')].some(img => img.naturalWidth === 512)`,
    );
    await driver.captureEvidence({
      caseId: 'ISS002',
      step: `style-viewer-${role}`,
      expected: 'authenticated original 512px synthetic image',
      observed: `opened from keyboard by authorized ${role}`,
    });
    await driver.evaluate(`document.querySelector('[aria-label="Close viewer"]').click()`);
    await driver.waitFor(`!document.querySelector('[role=dialog]')`);
  }
  // The same protected endpoints serve thumbnails and originals. UI visibility
  // never substitutes for authorization of a direct request.
  const image = (await uploaded.json()).data;
  const imagePaths = [
    `/styles/${fixtures.styleId}/images`,
    `/styles/${fixtures.styleId}/images/${image.id}/content`,
  ];
  for (const path of imagePaths) {
    const denied = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${fixtures.unauthorized.token}` },
    });
    assert.equal(denied.status, 403, 'Other Factory cannot request protected Style media directly');
    assert.equal(
      (await fetch(`${apiUrl}${path}`)).status,
      401,
      'Unauthenticated image access is denied',
    );
  }
  for (const role of ['FACTORY_USER', 'QA_USER']) {
    assert.equal(
      (
        await fetch(`${apiUrl}/styles/${fixtures.styleId}`, {
          headers: { Authorization: `Bearer ${fixtures.actors[role].token}` },
        })
      ).status,
      403,
      'Image access does not grant Style Master access',
    );
  }
  for (const width of [1440, 390]) {
    await driver.viewport(width, 1000);
    await visit(fixtures.actions.preproduction, 'QA_USER');
    await driver.assert(
      'ISS005',
      `PP and PPM are parallel at ${width}px`,
      `['Start PP Sample', 'Start PPM'].every(label => [...document.querySelectorAll('[aria-label="Action Required"] button')].some(button => button.textContent === label))`,
    );
    await visit(fixtures.actions.preproduction, 'FACTORY_USER');
    await driver.assert(
      'ISS005',
      'both pre-production gates block factory start',
      `!document.querySelector('[aria-label="Action Required"]')`,
    );
    await visit(fixtures.actions.cutting, 'FACTORY_USER');
    await driver.assert(
      'ISS005',
      'later gate does not hide eligible Cutting',
      `document.querySelector('[aria-label="Action Required"]').textContent.includes('Start Cutting')`,
    );
    await driver.evaluate(
      `[...document.querySelectorAll('[aria-label="Action Required"] button')].find(b => b.textContent === 'Start Cutting').focus()`,
    );
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
    });
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await driver.waitFor(
      `location.search.includes('tab=production') && document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent.includes('Current Stage: Cutting')`,
    );
    await driver.assert(
      'ISS005',
      'responsive action navigation does not overflow',
      'document.documentElement.scrollWidth <= innerWidth + 1',
    );
    for (const [order, allowed] of [
      [fixtures.actions.inlineFail, false],
      [fixtures.actions.inlinePass, true],
    ]) {
      await visit(order, 'FACTORY_USER');
      await driver.assert(
        'ISS005',
        `effective Inline PASS controls Sewing completion: ${allowed}`,
        `[...document.querySelectorAll('[aria-label="Action Required"] button')].some(b => b.textContent === 'Complete Sewing') === ${allowed}`,
      );
    }
    await visit(fixtures.prepared, 'QA_USER');
    await driver.assert(
      'ISS005',
      'no Final batch action without prepared quantity',
      `!document.querySelector('[aria-label="Action Required"]')`,
    );
    await visit(fixtures.actions.qaReady, 'QA_USER');
    await driver.assert(
      'ISS005',
      'Final QA is available before production completes',
      `document.querySelector('[aria-label="Action Required"]')?.textContent.includes('Start Final Inspection')`,
    );
    await driver.clickButton('Start Final Inspection');
    await driver.waitFor(`location.search.includes('tab=quality')`);
    await driver.captureEvidence({
      caseId: 'ISS005',
      step: `qa-navigation-${width}`,
      expected: 'existing Quality tab with prepared Final batch work',
      observed: 'role-scoped navigation at desktop/mobile width',
    });
    await visit(fixtures.actions.cutting, 'SENIOR_MANAGEMENT');
    await driver.assert(
      'ISS005',
      'read-only role receives no action summary',
      `!document.querySelector('[aria-label="Action Required"]')`,
    );
  }
  await driver.viewport(1280, 1000);
  // Persisted snapshots, including explicitly inconsistent legacy evidence.
  await visit(fixtures.missing, 'MERCHANDISER');
  await driver.assert(
    'ISS051',
    'missing recorded Season',
    `document.querySelector('.job-order-header').textContent.includes('No Season snapshot recorded')`,
  );
  await visit(fixtures.conflicting, 'MERCHANDISER');
  await driver.assert(
    'ISS051',
    'both conflicting snapshots exposed',
    `['Inconsistent recorded Season', 'Recorded Summer', 'Recorded Winter'].every(s => document.querySelector('.job-order-header').textContent.includes(s))`,
  );
  // An unconfirmed visit prompts; dismissal has no mutation and fresh navigation prompts.
  await visit(fixtures.sent);
  const confirmationBefore = await get(fixtures.sent);
  async function confirmRequest(body, key) {
    return fetch(`${apiUrl}/job-orders/${fixtures.sent}/actions/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fixtures.actors.FACTORY_USER.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    });
  }
  const confirmBody = {
    expectedVersion: confirmationBefore.version,
    expectedDisclaimerRevision: confirmationBefore.disclaimerRevision,
    acknowledgeDisclaimer: true,
  };
  assert.equal(
    (await confirmRequest({ ...confirmBody, acknowledgeDisclaimer: false }, 'batch1-no-ack'))
      .status,
    400,
  );
  assert.equal(
    (await confirmRequest({ ...confirmBody, expectedVersion: 999 }, 'batch1-stale-version')).status,
    409,
  );
  assert.equal(
    (
      await confirmRequest(
        { ...confirmBody, expectedDisclaimerRevision: 0 },
        'batch1-stale-disclaimer',
      )
    ).status,
    409,
  );
  await driver.waitFor(`!!document.querySelector('[role=dialog]')`);
  await driver.assert(
    'ISS003',
    'acknowledgement required',
    `[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent === 'Confirm Job Order').disabled`,
  );
  await driver.clickButton('Review in Production');
  await driver.waitFor(`!document.querySelector('[role=dialog]')`);
  await driver.waitFor(
    `document.querySelector('[role=tab][data-state=active]')?.textContent === 'Production'`,
  );
  await driver.clickButton('Overview');
  await driver.clickButton('Production');
  await driver.assert(
    'ISS003',
    'dismissal and tabs do not confirm or reprompt',
    `!document.querySelector('[role=dialog]')`,
  );
  assert.equal((await get(fixtures.sent)).status, 'SENT_TO_FACTORY');
  await visit(fixtures.prepared);
  await visit(fixtures.sent);
  await driver.waitFor(`!!document.querySelector('[role=dialog]')`);
  await driver.evaluate(`document.querySelector('#factory-confirmation-acknowledge').click()`);
  await driver.clickButton('Confirm Job Order');
  await driver.waitFor(`!document.querySelector('[role=dialog]')`);
  const confirmed = await get(fixtures.sent);
  assert.equal(confirmed.status, 'CONFIRMED_BY_FACTORY');
  const replay = await confirmRequest(
    confirmBody,
    `${fixtures.sent}:confirm:${confirmationBefore.version}`,
  );
  assert.equal(replay.status, 200, 'Confirmation replay is idempotent');
  assert.equal((await replay.json()).data.version, confirmed.version);
  assert.equal(
    (
      await confirmRequest(
        { ...confirmBody, expectedVersion: 999 },
        `${fixtures.sent}:confirm:${confirmationBefore.version}`,
      )
    ).status,
    409,
  );
  await visit(fixtures.sent);
  await driver.assert(
    'ISS003',
    'persisted confirmation suppresses prompt after reload',
    `!document.querySelector('[role=dialog]')`,
  );
  for (const role of ['QA_USER', 'MERCHANDISER', 'ADMIN', 'ACCOUNTANT']) {
    const response = await fetch(`${apiUrl}/job-orders/${fixtures.sent}/actions/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fixtures.actors[role].token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `batch1-forbidden-${role}`,
      },
      body: JSON.stringify({
        expectedVersion: 1,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      }),
    });
    assert.equal(response.status, 403, `${role} must not confirm`);
  }
  const wrongFactory = await fetch(`${apiUrl}/job-orders/${fixtures.sent}`, {
    headers: { Authorization: `Bearer ${fixtures.unauthorized.token}` },
  });
  assert.equal(wrongFactory.status, 403);
  const preparedRequests = [];
  driver.socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (
      event.method === 'Network.requestWillBeSent' &&
      event.params.request.method === 'POST' &&
      typeof event.params.request.postData === 'string' &&
      event.params.request.url.endsWith('/actions/update-prepared-quantity')
    )
      preparedRequests.push(JSON.parse(event.params.request.postData));
  });
  // Real keyboard insertion replaces the selected initial zero.
  await visit(fixtures.prepared, 'FACTORY_USER', 'production');
  const selector = `input[aria-label="Prepared ${fixtures.sizeCode} quantity"]`;
  const input = `document.querySelector(${JSON.stringify(selector)})`;
  await driver.waitFor(`!!${input}`);
  await driver.evaluate(`${input}.blur()`);
  await driver.evaluate(`${input}.focus()`);
  assert.deepEqual(
    await driver.evaluate(`[${input}.selectionStart, ${input}.selectionEnd]`),
    [0, 1],
  );
  await driver.command('Input.insertText', { text: '10' });
  await driver.assert('ISS020', 'typing replaces zero naturally', `${input}.value === '10'`);
  await driver.fill(selector, '010');
  await driver.evaluate(`${input}.blur()`);
  await driver.assert('ISS020', 'blur canonicalizes', `${input}.value === '10'`);
  await driver.clickButton('Save Prepared Quantity');
  await driver.waitFor(
    `[...document.querySelectorAll('button')].some(b => b.textContent === 'Save Prepared Quantity' && !b.disabled)`,
  );
  // A separate HTTP GET and full navigation cannot be satisfied by React's draft.
  for (let n = 0; n < 50 && (await get(fixtures.prepared)).preparedQuantityTotal !== 10; n++)
    await delay(100);
  assert.equal((await get(fixtures.prepared)).preparedQuantityTotal, 10);
  assert.equal(typeof preparedRequests.at(-1).sizes[0].preparedQuantity, 'number');
  assert.equal(preparedRequests.at(-1).sizes[0].preparedQuantity, 10);
  await visit(fixtures.prepared, 'FACTORY_USER', 'production');
  await driver.waitFor(`${input}?.value === '10'`);
  await driver.captureEvidence({
    caseId: 'ISS020',
    step: 'persisted-reload',
    expected: 10,
    observed: (await get(fixtures.prepared)).preparedQuantityTotal,
  });
  for (const [draft, disabled] of [
    ['', true],
    ['21', true],
    ['0', false],
  ]) {
    await driver.evaluate(`${input}.focus()`);
    await driver.fill(selector, draft);
    await driver.evaluate(`${input}.blur()`);
    await driver.assert(
      'ISS020',
      `draft ${JSON.stringify(draft)} validation`,
      `[...document.querySelectorAll('button')].find(b => b.textContent === 'Save Prepared Quantity').disabled === ${disabled}`,
    );
    assert.equal(await driver.evaluate(`${input}.value`), draft, 'No silent clamp');
  }
  await driver.clickButton('Save Prepared Quantity');
  for (let n = 0; n < 50 && (await get(fixtures.prepared)).preparedQuantityTotal !== 0; n++)
    await delay(100);
  assert.equal((await get(fixtures.prepared)).preparedQuantityTotal, 0);
  assert.equal(driver.consoleErrors.length, 0, 'No browser runtime exceptions');
  console.log(
    `PASS: Batch 1 browser geometry, confirmation and database persistence. Evidence: ${output}`,
  );
} catch (error) {
  if (driver) {
    await driver
      .captureEvidence({
        caseId: 'failure',
        step: 'diagnostic',
        expected: 'acceptance passes',
        observed: error.message,
        status: 'FAIL',
      })
      .catch(() => {});
  }
  throw error;
} finally {
  if (driver) await driver.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill();
  }
  console.log(`Batch 1 evidence directory: ${output}`);
}
