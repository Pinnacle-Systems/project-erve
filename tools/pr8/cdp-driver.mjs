import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';

export function localUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('An explicit loopback HTTP endpoint without credentials/query is required');
  return url;
}
export function safeEvidenceName(caseId, step) {
  if (![caseId, step].every((value) => /^[a-zA-Z0-9_-]+$/.test(value)))
    throw new Error('Unsafe evidence name');
  return `${caseId}-${step}`;
}
export function publicNetworkEvent(event) {
  const url = new URL(event.response.url);
  return {
    requestId: event.requestId,
    origin: url.origin,
    path: url.pathname,
    status: event.response.status,
  };
}
export class CdpDriver {
  static async connect({ endpoint, appUrl, output, repositoryRoot }) {
    const base = localUrl(endpoint),
      app = localUrl(appUrl);
    // Resolve existing parents to reject an output path routed back into the repo by a junction.
    await assertExternalArtifactRoot(output, repositoryRoots(repositoryRoot));
    await mkdir(output, { recursive: true });
    const actual = await realpath(output),
      repository = await realpath(repositoryRoot);
    const rel = relative(repository, actual);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)))
      throw new Error('Evidence must be outside the repository');
    const version = await fetch(new URL('/json/version', base)).then((response) => response.json());
    const page = await fetch(new URL('/json/new?about:blank', base), { method: 'PUT' }).then(
      (response) => response.json(),
    );
    const wsUrl = new URL(page.webSocketDebuggerUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(wsUrl.hostname))
      throw new Error('Nonlocal debugging WebSocket refused');
    const driver = new CdpDriver(new WebSocket(wsUrl), {
      app,
      output: actual,
      version,
      pageId: page.id,
    });
    await new Promise((ok, fail) => {
      driver.socket.addEventListener('open', ok, { once: true });
      driver.socket.addEventListener('error', fail, { once: true });
    });
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable'])
      await driver.command(method);
    await driver.command('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: join(actual, 'downloads'),
    });
    return driver;
  }
  constructor(socket, context) {
    this.socket = socket;
    this.context = context;
    this.pending = new Map();
    this.sequence = 0;
    this.assertions = [];
    this.evidence = [];
    this.responses = [];
    this.networkFailures = [];
    this.consoleErrors = [];
    socket.addEventListener('message', ({ data }) => {
      const event = JSON.parse(data);
      if (event.id) {
        const pending = this.pending.get(event.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.error) pending.reject(new Error(event.error.message));
        else pending.resolve(event.result);
      } else if (event.method === 'Network.responseReceived') {
        const response = publicNetworkEvent(event.params);
        this.responses.push(response);
        if (response.status >= 400) this.networkFailures.push(response);
      } else if (event.method === 'Network.loadingFailed') {
        this.networkFailures.push({
          requestId: event.params.requestId,
          error: event.params.errorText,
          canceled: event.params.canceled,
        });
      } else if (event.method === 'Runtime.exceptionThrown') {
        // Never persist raw console arguments, request headers, payloads, or token-bearing URLs.
        this.consoleErrors.push({
          timestamp: event.params.timestamp,
          text: event.params.exceptionDetails.text,
          lineNumber: event.params.exceptionDetails.lineNumber,
        });
      } else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        this.consoleErrors.push({
          timestamp: event.params.timestamp,
          text: 'console.error (arguments omitted for secret protection)',
        });
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP disconnected'));
      }
      this.pending.clear();
    });
  }
  command(method, params = {}) {
    return new Promise((resolveCommand, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve: resolveCommand, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(`Browser evaluation failed: ${response.exceptionDetails.text}`);
    return response.result.value;
  }
  async waitFor(expression, timeout = 20000) {
    const until = Date.now() + timeout;
    do {
      if (await this.evaluate(expression)) return;
      await delay(100);
    } while (Date.now() < until);
    throw new Error('Observable browser condition timed out');
  }
  async navigateTo(path) {
    const url = new URL(path, this.context.app);
    if (url.origin !== this.context.app.origin)
      throw new Error('Navigation outside the verified app refused');
    await this.command('Page.navigate', { url: url.href });
    await this.waitFor(
      'document.readyState === "complete" && !!document.querySelector("#root")?.firstElementChild',
    );
    await this.stabilize();
  }
  async stabilize() {
    await this.evaluate(
      'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))',
    );
  }
  locator(selector) {
    return `document.querySelector(${JSON.stringify(selector)})`;
  }
  async fill(selector, value) {
    await this.evaluate(
      `(() => { const element = ${this.locator(selector)}; if (!element) throw Error('Input missing'); const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    // Two frames allow React to commit its controlled value; a reverted value fails.
    await this.stabilize();
    if (!(await this.evaluate(`${this.locator(selector)}?.value === ${JSON.stringify(value)}`)))
      throw new Error('Controlled input did not retain the entered value');
  }
  async select(selector, value) {
    await this.evaluate(
      `(() => { const element = ${this.locator(selector)}; if (!element) throw Error('Select missing'); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await this.stabilize();
    if (!(await this.evaluate(`${this.locator(selector)}?.value === ${JSON.stringify(value)}`)))
      throw new Error('Selection did not persist');
  }
  async clickButton(text) {
    await this.waitFor(
      `[...document.querySelectorAll('button,a,[role="tab"]')].some(node => node.textContent.trim() === ${JSON.stringify(text)} && node.getClientRects().length && !node.disabled)`,
    );
    const point = await this.evaluate(
      `(() => { const element = [...document.querySelectorAll('button,a,[role="tab"]')].find(node => node.textContent.trim() === ${JSON.stringify(text)} && node.getClientRects().length); if (!element || element.disabled) throw Error('Action unavailable'); element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`,
    );
    await this.command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await this.stabilize();
  }
  async uploadFile(selector, file) {
    const { root } = await this.command('DOM.getDocument');
    const { nodeId } = await this.command('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error('File input missing');
    await this.command('DOM.setFileInputFiles', { nodeId, files: [resolve(file)] });
    await this.stabilize();
    if (!(await this.evaluate(`${this.locator(selector)}?.files.length === 1`)))
      throw new Error('File not selected');
  }
  async viewport(width, height, mobile = false) {
    await this.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await this.command('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await this.stabilize();
  }
  async assert(caseId, description, expression) {
    const passed = Boolean(await this.evaluate(expression));
    this.assertions.push({
      caseId,
      description,
      status: passed ? 'PASS' : 'FAIL',
      timestamp: new Date().toISOString(),
    });
    if (!passed) throw new Error(`Assertion failed: ${caseId}: ${description}`);
  }
  async captureEvidence({ caseId, step, expected, observed, status = 'PASS', fullPage = false }) {
    const name = safeEvidenceName(caseId, step);
    await this.stabilize();
    const state = await this.evaluate(
      '({ path: location.pathname, width: innerWidth, height: innerHeight, zoom: visualViewport.scale, overflow: document.documentElement.scrollWidth > innerWidth + 1 })',
    );
    const params = { format: 'png', captureBeyondViewport: fullPage };
    if (fullPage) {
      const { cssContentSize } = await this.command('Page.getLayoutMetrics');
      params.clip = {
        x: 0,
        y: 0,
        width: cssContentSize.width,
        height: cssContentSize.height,
        scale: 1,
      };
    }
    const { data } = await this.command('Page.captureScreenshot', params);
    const png = Buffer.from(data, 'base64');
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('Invalid screenshot PNG');
    const directory = join(this.context.output, 'screenshots');
    await mkdir(directory, { recursive: true });
    const filename = `screenshots/${name}.png`;
    await writeFile(join(this.context.output, filename), png, { flag: 'wx' });
    const metadata = {
      caseId,
      step,
      timestamp: new Date().toISOString(),
      appOrigin: this.context.app.origin,
      ...state,
      browserVersion: this.context.version.Browser,
      expected,
      observed,
      status,
      screenshot: filename,
      sha256: createHash('sha256').update(png).digest('hex'),
      relevantResponses: this.responses.slice(-10),
    };
    await writeFile(join(directory, `${name}.json`), JSON.stringify(metadata, null, 2), {
      flag: 'wx',
    });
    this.evidence.push(metadata);
    return metadata;
  }
  async save() {
    for (const [name, data] of Object.entries({
      'browser-session': {
        browserVersion: this.context.version.Browser,
        appOrigin: this.context.app.origin,
        pageId: this.context.pageId,
        actor: this.context.actor,
      },
      assertions: this.assertions,
      evidence: this.evidence,
      'network-failures': this.networkFailures,
      'console-errors': this.consoleErrors,
    }))
      await writeFile(join(this.context.output, `${name}.json`), JSON.stringify(data, null, 2));
  }
  async close() {
    await this.save();
    this.socket.close();
  }
}
