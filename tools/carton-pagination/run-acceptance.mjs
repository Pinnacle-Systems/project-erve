import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.deepEqual(
  [target.hostname, target.port, target.pathname, target.username],
  ['127.0.0.1', '55452', '/erve_batch10_carton_pagination_test', 'cartonpagination'],
);
const fixture = JSON.parse(
  await readFile(join(root, '.data/carton-pagination/browser-fixtures.json'), 'utf8'),
);
const output = await mkdtemp(
  join(
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp') : tmpdir(),
    'erve-carton-pagination-browser-',
  ),
);
const appUrl = 'http://127.0.0.1:5192',
  apiUrl = 'http://127.0.0.1:4192';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: target.toString(),
  HOST: '127.0.0.1',
  PORT: '4192',
  CORS_ORIGIN: appUrl,
  VITE_API_URL: apiUrl,
  JWT_ACCESS_SECRET: 'disposable-carton-pagination-access-secret-only',
  JWT_REFRESH_SECRET: 'disposable-carton-pagination-refresh-secret-only',
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
const requests = [];
const runtimeErrors = [];
let injectedFailure = false;
try {
  const prepare = launch(
    process.execPath,
    [
      resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'),
      'tools/carton-pagination/prepare-browser.mts',
    ],
    'prepare',
  );
  assert.equal(
    await new Promise((resolve) => prepare.once('exit', resolve)),
    0,
    'Disposable browser scenario preparation',
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
      '5192',
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
  ].find((path) => path && existsSync(path));
  assert.ok(chrome, 'Chrome/Edge binary');
  const browser = launch(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9292',
      `--user-data-dir=${join(output, 'chrome-profile')}`,
      'about:blank',
    ],
    'browser',
  );
  await ready('http://127.0.0.1:9292/json/version', browser);
  driver = await CdpDriver.connect({
    endpoint: 'http://127.0.0.1:9292',
    appUrl,
    output,
    repositoryRoot: root,
  });
  driver.socket.addEventListener('message', ({ data }) => {
    if (JSON.parse(data).method === 'Page.javascriptDialogOpening')
      void driver.command('Page.handleJavaScriptDialog', { accept: true });
  });
  driver.socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.method === 'Runtime.exceptionThrown')
      runtimeErrors.push(event.params.exceptionDetails.text);
    if (
      event.method === 'Network.requestWillBeSent' &&
      event.params.request.url.startsWith(`${apiUrl}/erve-packing-lists/eligible-cartons`)
    )
      requests.push(new URL(event.params.request.url));
    if (event.method === 'Fetch.requestPaused') {
      const { requestId, request } = event.params;
      if (!injectedFailure && new URL(request.url).searchParams.has('cursor')) {
        injectedFailure = true;
        void driver.command('Fetch.fulfillRequest', {
          requestId,
          responseCode: 503,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Access-Control-Allow-Origin', value: appUrl },
            { name: 'Access-Control-Allow-Credentials', value: 'true' },
          ],
          body: Buffer.from(
            JSON.stringify({
              success: false,
              error: {
                code: 'TEMPORARILY_UNAVAILABLE',
                message: 'Synthetic continuation failure; retry this search.',
              },
            }),
          ).toString('base64'),
        });
      } else void driver.command('Fetch.continueRequest', { requestId });
    }
  });
  await driver.viewport(1280, 1000);
  await driver.navigateTo('/login');
  await driver.evaluate(`(async () => {
    const response = await fetch('${apiUrl}/auth/login', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({identifier:${JSON.stringify(fixture.email)},password:${JSON.stringify(fixture.password)}}) });
    if (!response.ok) throw Error('Disposable login failed');
    const {data} = await response.json(), s = data.session;
    sessionStorage.setItem('erve.accessToken', data.accessToken);
    localStorage.setItem('erve.sessionTiming', JSON.stringify({userId:s.userId,accessExpiresAt:Date.parse(s.accessExpiresAt),idleExpiresAt:Date.parse(s.idleExpiresAt),absoluteExpiresAt:Date.parse(s.absoluteExpiresAt),idleTimeoutMs:s.idleTimeoutSeconds*1000,clockOffsetMs:Date.parse(s.serverTime)-Date.now()}));
  })()`);
  const selector = (id) => `input[aria-label="Select carton ${id}"]`;
  async function search(value) {
    await driver.waitFor(`!!document.querySelector('input[aria-label="Search eligible cartons"]')`);
    await driver.evaluate(
      `document.querySelector('input[aria-label="Search eligible cartons"]').focus(); document.querySelector('input[aria-label="Search eligible cartons"]').select()`,
    );
    await driver.command('Input.insertText', { text: value });
    await driver.clickButton('Search');
  }
  async function select(id) {
    await driver.waitFor(`!!document.querySelector(${JSON.stringify(selector(id))})`);
    await driver.evaluate(`document.querySelector(${JSON.stringify(selector(id))}).click()`);
  }
  await driver.navigateTo('/fulfillment/erve-packing-lists/new');
  await driver.waitFor(`document.querySelectorAll('input[type="checkbox"]').length === 25`);
  await driver.assert(
    'create-bounded',
    'Create starts with one bounded page',
    `document.querySelectorAll('input[type="checkbox"]').length === 25`,
  );
  await search('BENCH-CTN-11999');
  await select('BENCH-CTN-11999');
  await search('BENCH-CTN-10050');
  await select('BENCH-CTN-10050');
  await driver.assert(
    'create-retained',
    'Search preserves two selected cartons, 16 pieces, two Factories and two Dispatch Orders',
    `(() => {
    const field = label => [...document.querySelectorAll('div')].find(n => n.textContent === label)?.parentElement.textContent;
    return document.querySelector('[aria-label="Selected cartons"]').children.length === 2 && field('Total Pieces') === 'Total Pieces16' && field('Source Factories') === 'Source Factories2' && field('Source Dispatch Orders') === 'Source Dispatch Orders2';
  })()`,
  );
  await driver.clickButton('Create Erve Packing List');
  await driver.waitFor(
    `location.pathname.startsWith('/fulfillment/erve-packing-lists/') && !location.pathname.endsWith('/new') && document.body.textContent.includes('Carton BENCH-CTN-11999') && document.body.textContent.includes('Carton BENCH-CTN-10050')`,
  );
  await driver.assert(
    'create-success',
    'Real Create submits retained cartons from two Dispatch Orders',
    `document.body.textContent.includes('Carton BENCH-CTN-11999') && document.body.textContent.includes('Carton BENCH-CTN-10050')`,
  );
  await driver.captureEvidence({
    caseId: 'create',
    step: 'created',
    expected: 'Both searched cartons consolidated',
    observed: 'Both real carton records displayed',
  });

  await driver.navigateTo(`/fulfillment/erve-packing-lists/${fixture.listId}`);
  await driver.waitFor(`document.body.textContent.includes('Continue searching')`);
  await driver.assert(
    'add-empty-continuation',
    'OPEN Add Cartons offers continuation after an empty 200-candidate batch',
    `document.querySelectorAll('input[type="checkbox"]').length === 0 && document.body.textContent.includes('Continue searching') && !document.body.textContent.includes('Nothing eligible')`,
  );
  await driver.command('Fetch.enable', {
    patterns: [
      { urlPattern: `${apiUrl}/erve-packing-lists/eligible-cartons*`, requestStage: 'Request' },
    ],
  });
  await driver.clickButton('Continue searching');
  await driver.waitFor(`document.body.textContent.includes('Retry search')`);
  const failedCursor = requests.at(-1).searchParams.get('cursor');
  await driver.clickButton('Retry search');
  await driver.waitFor(
    `!document.body.textContent.includes('Retry search') && !document.body.textContent.includes('Searching more eligible cartons')`,
  );
  assert.equal(requests.at(-1).searchParams.get('cursor'), failedCursor);
  await driver.command('Fetch.disable');
  await driver.assert(
    'add-retry',
    'Failed continuation retries the same cursor',
    `!document.body.textContent.includes('Retry search')`,
  );
  // Explicit user-driven continuation only, with keyboard Enter on each batch.
  for (let n = 0; n < 12; n++) {
    if (await driver.evaluate(`document.querySelectorAll('input[type="checkbox"]').length > 0`))
      break;
    await driver.evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue searching').focus()`,
    );
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
    });
    await driver.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await driver.waitFor(`!document.body.textContent.includes('Searching more eligible cartons')`);
    await delay(150);
  }
  const first = await driver.evaluate(
    `document.querySelector('input[type="checkbox"]').getAttribute('aria-label').replace('Select carton ', '')`,
  );
  await select(first);
  await search('BENCH-CTN-11985');
  await select('BENCH-CTN-11985');
  await search('no-such-carton');
  await driver.waitFor(`document.body.textContent.includes('No more eligible cartons')`);
  await driver.assert(
    'add-retained-empty',
    'Add selection and 16-piece summary persist with no visible results',
    `document.querySelector('[aria-label="Selected cartons"]').children.length === 2 && document.body.textContent.includes('16 pieces')`,
  );
  await driver.clickButton('Add Selected Cartons');
  await driver.waitFor(
    `document.querySelector('[aria-label="Selected cartons"]').children.length === 0 && document.body.textContent.includes('Carton BENCH-CTN-11985')`,
  );
  await driver.assert(
    'add-success',
    'Real Add clears selection and refreshes list detail',
    `document.body.textContent.includes(${JSON.stringify(`Carton ${first}`)}) && document.body.textContent.includes('Carton BENCH-CTN-11985')`,
  );
  await driver.captureEvidence({
    caseId: 'add',
    step: 'added',
    expected: 'Added selected cartons after empty continuation and search',
    observed: 'Selection cleared; both real carton records displayed',
  });
  assert.ok(
    requests.length > 5 && requests.every((url) => url.searchParams.get('limit') === '25'),
    'Every eligible-carton request is bounded',
  );
  assert.equal(runtimeErrors.length, 0);
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        assertions: driver.assertions,
        runtimeErrors,
        requests: requests.map((url) => ({
          path: url.pathname,
          params: Object.fromEntries(url.searchParams),
        })),
        injectedFailure,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      passed: driver.assertions.length,
      requests: requests.length,
      runtimeErrors,
    }),
  );
} finally {
  if (driver) await driver.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
