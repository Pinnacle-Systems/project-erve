// Minimal Chrome DevTools Protocol driver for the E-Way Bill acceptance harness.
// Same technique as scripts/invoice-native-browser.mjs (raw CDP, real mouse and
// keyboard events, no test framework), but headless, so it runs the same on a
// laptop and on a CI runner without an X server. Every wait is a polled
// readiness condition, never a fixed sleep.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
const { fetch, WebSocket } = globalThis;

export async function until(callback, label, timeout = 20000, interval = 100) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      lastError = error; // navigation and rendering can transiently fail while polling
    }
    await delay(interval);
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

export async function launchChrome({ binary, port, width = 1440, height = 1000 }) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'eway-acceptance-chrome-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const endpoint = `http://127.0.0.1:${port}`;
  const target = await until(async () => {
    const response = await fetch(`${endpoint}/json/list`);
    const pages = (await response.json()).filter((item) => item.type === 'page');
    return pages[0];
  }, 'Chrome DevTools endpoint');
  return {
    child,
    webSocketUrl: target.webSocketDebuggerUrl,
    async close() {
      child.kill();
      await delay(300);
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    },
  };
}

export class Page {
  constructor(url, evidenceDir) {
    this.evidenceDir = evidenceDir;
    this.socket = new WebSocket(url);
    this.counter = 0;
    this.pending = new Map();
    this.requests = [];
    this.consoleErrors = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.push({
          id: message.params.requestId,
          url: message.params.request.url,
          method: message.params.request.method,
          status: null,
        });
      } else if (message.method === 'Network.responseReceived') {
        const entry = this.requests.find((item) => item.id === message.params.requestId);
        if (entry) entry.status = message.params.response.status;
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails?.text ?? 'exception');
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async init() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed');
    }
    return result.result.value;
  }

  text() {
    return this.evaluate('document.body.innerText');
  }

  async hasText(expected) {
    return (await this.text()).includes(expected);
  }

  async waitForText(expected, timeout = 20000) {
    await until(() => this.hasText(expected), `text "${expected}"`, timeout);
  }

  async waitForGone(expected, timeout = 20000) {
    await until(async () => !(await this.hasText(expected)), `text "${expected}" to disappear`, timeout);
  }

  async setViewport(width, height = 1000) {
    this.viewport = { width, height };
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async goto(url, expectedText) {
    await this.send('Page.navigate', { url });
    if (expectedText) await this.waitForText(expectedText);
  }

  async reload(expectedText) {
    await this.send('Page.reload');
    if (expectedText) {
      // Wait for the old document to be replaced before polling the new one.
      await until(() => this.evaluate("document.readyState === 'complete'"), 'document load');
      await this.waitForText(expectedText);
    }
  }

  /** Clicks the centre of an element described by an in-page expression returning it. */
  async clickElement(finder, label) {
    const rect = await until(
      () =>
        this.evaluate(
          `(() => { const node = (${finder})(); if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null; node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; const x = r.x+r.width/2, y = r.y+r.height/2; const top = document.elementFromPoint(x, y); if (!top || !(node === top || node.contains(top) || top.contains(node))) return null; return {x, y}; })()`,
        ),
      `enabled element: ${label}`,
    );
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect });
  }

  /** Clicks a button, tab or link by visible text or aria-label (optionally inside a root selector). */
  click(label, root = 'document') {
    const scope = root === 'document' ? 'document' : `document.querySelector(${JSON.stringify(root)})`;
    return this.clickElement(
      `() => [...(${scope} ?? document).querySelectorAll('button, [role=tab], a, [role=switch], [role=checkbox], [role=radio]')].find(n => n.textContent.trim() === ${JSON.stringify(label)} || n.getAttribute('aria-label') === ${JSON.stringify(label)})`,
      label,
    );
  }

  clickSelector(selector) {
    return this.clickElement(`() => document.querySelector(${JSON.stringify(selector)})`, selector);
  }

  /** The form control associated (label[for]) with a visible label. */
  static controlFor(label, root = 'document') {
    const scope = root === 'document' ? 'document' : `document.querySelector(${JSON.stringify(root)})`;
    return `() => { const l = [...(${scope} ?? document).querySelectorAll('label')].find(n => n.textContent.replace(/\\s+/g, ' ').trim().replace(/\\s*\\*$/, '') === ${JSON.stringify(label)}); return l ? l.control : null; }`;
  }

  async fill(label, value, root = 'document') {
    const finder = Page.controlFor(label, root);
    await until(() => this.evaluate(`Boolean((${finder})())`), `field ${label}`);
    await until(() => this.evaluate(`!(${finder})().disabled`), `enabled field ${label}`);
    await this.evaluate(`(${finder})().focus()`);
    // Select any existing content, then replace it with real text input.
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    if (value === '') {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    } else {
      await this.send('Input.insertText', { text: value });
    }
  }

  async value(label, root = 'document') {
    const finder = Page.controlFor(label, root);
    return this.evaluate(`(() => { const c = (${finder})(); return c ? (c.value ?? c.textContent) : null; })()`);
  }

  /** Radix Select: open the trigger that belongs to `label`, then choose `option`. */
  async select(label, option) {
    await this.clickElement(Page.controlFor(label), `select ${label}`);
    await this.clickElement(
      `() => [...document.querySelectorAll('[role=option]')].find(n => n.textContent.trim() === ${JSON.stringify(option)})`,
      `option ${option}`,
    );
    await until(() => this.evaluate("!document.querySelector('[role=listbox]')"), `listbox closed after ${option}`);
  }

  async selectedText(label) {
    return this.evaluate(`(() => { const c = (${Page.controlFor(label)})(); return c ? c.textContent.trim() : null; })()`);
  }

  async press(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }

  pressEscape() {
    return this.press('Escape', 'Escape', 27);
  }

  /** Fetches a same-session API URL from inside the page, with the current access token. */
  apiFromPage(apiBase, suffix, method = 'GET', data) {
    return this.evaluate(
      `(async () => { const response = await fetch(${JSON.stringify(apiBase)} + ${JSON.stringify(suffix)}, {method: ${JSON.stringify(method)}, credentials: 'include', headers: {Authorization: 'Bearer ' + sessionStorage.getItem('erve.accessToken'), 'Content-Type': 'application/json'}, body: ${data === undefined ? 'undefined' : JSON.stringify(JSON.stringify(data))}}); let payload = null; try { payload = await response.json(); } catch {} return {status: response.status, body: payload}; })()`,
    );
  }

  async screenshot(name, { fullPage = true } = {}) {
    await this.evaluate('window.scrollTo(0, 0)');
    const viewport = this.viewport ?? { width: await this.evaluate('innerWidth'), height: await this.evaluate('innerHeight') };
    let height = viewport.height;
    if (fullPage) {
      // Resize the emulated viewport to the document instead of using
      // captureBeyondViewport, which leaves very tall pages mis-scrolled for later clicks.
      height = Math.min(await this.evaluate('document.documentElement.scrollHeight'), 16000);
      await this.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height, deviceScaleFactor: 1, mobile: false });
    }
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    if (fullPage) {
      await this.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    }
    const file = path.join(this.evidenceDir, `${name}.png`);
    await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
    return path.relative(path.dirname(this.evidenceDir), file).replaceAll(path.sep, '/');
  }

  /** Requests whose URL contains `fragment` since `since` (an index into this.requests). */
  requestsSince(since, fragment) {
    return this.requests.slice(since).filter((request) => request.url.includes(fragment));
  }

  close() {
    this.socket.close();
  }
}

export function log(message) {
  console.log(`[eway-acceptance] ${message}`);
}
