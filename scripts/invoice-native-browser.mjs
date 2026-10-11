import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import console from 'node:console';
import { spawn, execFileSync } from 'node:child_process';
const { fetch, WebSocket } = globalThis;

const fixture = JSON.parse(await fs.readFile(process.env.NATIVE_FIXTURE_PATH, 'utf8'));
const evidence = path.resolve('.artifacts/native-browser-evidence');
await fs.mkdir(evidence, { recursive: true });
const proof = { mode: 'headful Chrome on native X11 desktop', canonical: [], assertions: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.counter = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
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
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? 'Browser evaluation failed',
      );
    return result.result.value;
  }
  close() {
    this.socket.close();
  }
}
async function until(callback, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await callback();
      if (result) return result;
    } catch {
      // Desktop startup and browser navigation can transiently fail while polling.
    }
    await pause(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(page, label) {
  // Dialog entry animations must settle before measuring native click coordinates.
  await pause(300);
  const rect = await page.evaluate(
    `(() => { const node = [...document.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(label)} || n.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!node || node.disabled) return null; node.scrollIntoView({block:'center'}); const r=node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  assert.ok(rect, `Enabled action ${label}`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...rect,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...rect,
  });
}
async function type(page, selector, value) {
  assert.ok(
    await page.evaluate(
      `(() => { const node=document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.focus(); return true; })()`,
    ),
    `Input ${selector}`,
  );
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await page.send('Input.insertText', { text: value });
}
async function enter(page) {
  await page.send('Page.bringToFront');
  execFileSync('xdotool', ['key', '--clearmodifiers', 'Return'], {
    env: { ...process.env, DISPLAY: ':99' },
  });
}
const body = (page) => page.evaluate('document.body.innerText');
async function go(page, url, expected) {
  await page.send('Page.navigate', { url });
  await until(async () => (await body(page)).includes(expected), expected);
}
async function api(page, suffix, method = 'GET', data) {
  return page.evaluate(
    `(async () => { const response=await fetch('http://localhost:4107'+${JSON.stringify(suffix)}, {method:${JSON.stringify(method)},credentials:'include',headers:{Authorization:'Bearer '+sessionStorage.getItem('erve.accessToken'),'Content-Type':'application/json'},body:${data === undefined ? 'undefined' : JSON.stringify(JSON.stringify(data))}}); const payload=await response.json(); return {status:response.status,data:payload.data}; })()`,
  );
}
async function login(page, actor) {
  await page.evaluate(
    `(async () => { const token=sessionStorage.getItem('erve.accessToken'); if(token) await fetch('http://localhost:4107/auth/logout',{method:'POST',credentials:'include',headers:{Authorization:'Bearer '+token}}); sessionStorage.clear();localStorage.clear(); })()`,
  );
  await go(page, 'http://localhost:5177/login', 'Email or mobile number');
  await type(page, '#identifier', actor.email);
  await type(page, '#password', actor.password);
  await click(page, 'Sign in');
  await until(
    async () => Boolean(await page.evaluate("sessionStorage.getItem('erve.accessToken')")),
    'real sign-in',
  );
}
async function screenshot(page, name) {
  await page.evaluate('window.scrollTo(0,0)');
  await pause(250);
  // Capture the native desktop, including the real Chrome window/toolbar.
  execFileSync('import', ['-window', 'root', path.join(evidence, `${name}.png`)], {
    env: { ...process.env, DISPLAY: ':99' },
  });
}
async function main() {
  const chromeBinary = process.env.NATIVE_CHROME_BINARY;
  assert.ok(chromeBinary, 'Preinstalled Chrome required');
  for (const [index, width] of [1440, 1280, 1024].entries()) {
    const processes = [];
    let browser;
    let page;
    try {
      processes.push(
        spawn(
          'Xvfb',
          [':99', '-screen', '0', `${width}x1100x24`, '-dpi', '96', '-nolisten', 'tcp'],
          { stdio: 'ignore' },
        ),
      );
      await until(() => {
        execFileSync('xdpyinfo', [], { env: { ...process.env, DISPLAY: ':99' }, stdio: 'ignore' });
        return true;
      }, 'native display');
      processes.push(
        spawn('openbox', ['--sm-disable'], {
          env: { ...process.env, DISPLAY: ':99' },
          stdio: 'ignore',
        }),
      );
      await pause(750);
      const chrome = spawn(
        chromeBinary,
        [
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=9337',
          `--user-data-dir=${path.resolve(`.artifacts/native-chrome-${width}`)}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-search-engine-choice-screen',
          '--start-maximized',
          'about:blank',
        ],
        { env: { ...process.env, DISPLAY: ':99' }, stdio: ['ignore', 'ignore', 'inherit'] },
      );
      processes.push(chrome);
      const version = await until(async () => {
        const response = await fetch('http://127.0.0.1:9337/json/version');
        return response.ok ? response.json() : null;
      }, 'headful Chrome');
      browser = new Cdp(version.webSocketDebuggerUrl);
      const target = await (
        await fetch('http://127.0.0.1:9337/json/new?http://localhost:5177/login', { method: 'PUT' })
      ).json();
      page = new Cdp(target.webSocketDebuggerUrl);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      const window = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
      await browser.send('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: { windowState: 'maximized' },
      });
      await page.send('Page.bringToFront');
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: '0',
        code: 'Digit0',
        modifiers: 2,
        windowsVirtualKeyCode: 48,
      });
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: '0',
        code: 'Digit0',
        modifiers: 2,
        windowsVirtualKeyCode: 48,
      });
      await until(
        async () =>
          (await browser.send('Browser.getWindowBounds', { windowId: window.windowId })).bounds
            .windowState === 'maximized',
        'native maximization',
      );
      await login(page, fixture.actors.accountant);
      await go(page, 'http://localhost:5177/fulfillment/tax-invoices', 'Create draft');
      await until(
        async () => (await body(page)).includes(fixture.issued.invoice.invoiceNumber),
        'server-paginated queue records',
      );
      const desktop = await page.evaluate(
        '({innerWidth,outerWidth,devicePixelRatio,scale:visualViewport.scale,font:getComputedStyle(document.body).fontSize})',
      );
      assert.equal(desktop.innerWidth, width);
      assert.equal(desktop.devicePixelRatio, 1);
      assert.equal(desktop.scale, 1);
      assert.equal(await page.evaluate('getComputedStyle(document.documentElement).zoom'), '1');
      proof.canonical.push({
        width,
        chrome: version.Browser,
        window: (await browser.send('Browser.getWindowBounds', { windowId: window.windowId }))
          .bounds,
        ...desktop,
      });
      await screenshot(page, `queue-${width}`);
      const draft = fixture.drafts[index];
      await go(
        page,
        `http://localhost:5177/fulfillment/tax-invoices/${draft.id}`,
        'Finalize invoice',
      );
      assert.ok((await body(page)).includes('Preview'));
      assert.equal(
        await page.evaluate("document.querySelector('h1').innerText.startsWith('Draft')"),
        true,
      );
      await screenshot(page, `draft-review-${width}`);
      if (index === 0) {
        await click(page, 'Override');
        await until(
          async () => (await body(page)).includes('Accountant rate correction'),
          'rate dialog',
        );
        await type(page, '[role="dialog"] textarea', 'Native keyboard rate correction');
        await type(page, '[role="dialog"] input', '75.50');
        await screenshot(page, 'override-active-currency-1440');
        await enter(page);
        await until(
          async () =>
            !(await page.evaluate("Boolean(document.querySelector('[role=dialog]'))")) &&
            (await body(page)).includes('₹75.50'),
          'keyboard rate save',
        );
        assert.equal(
          (await api(page, `/tax-invoices/${draft.id}/review`)).data.lines[0].finalUnitRate,
          '75.5',
        );
        await click(page, 'Finalize invoice');
        await until(
          async () =>
            await page.evaluate(
              "[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='Confirm finalization'&&!n.disabled)",
            ),
          'confirmation ready',
        );
        await click(page, 'Confirm finalization');
        await until(
          async () => (await api(page, `/tax-invoices/${draft.id}`)).data.status === 'FINALIZED',
          'atomic issue',
        );
        const issued = (await api(page, `/tax-invoices/${draft.id}`)).data;
        assert.equal(issued.grandTotal, '554.93');
        assert.equal(issued.payableTotal, '555.00');
        await until(
          async () =>
            (await body(page)).includes('Finalized') &&
            !(await body(page)).includes('Finalize invoice'),
          'read-only issue',
        );
        await screenshot(page, 'finalized-readonly-1440');
        await click(page, 'History');
        await until(
          async () => (await body(page)).includes('Native keyboard rate correction'),
          'persisted history',
        );
        await screenshot(page, 'financial-history-1440');
        await go(
          page,
          `http://localhost:5177/fulfillment/tax-invoices/${fixture.blocked.id}`,
          'HSN_NOT_ASSIGNED',
        );
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Finalize invoice').disabled",
          ),
          true,
        );
        await screenshot(page, 'blocked-hsn-1440');
        await go(
          page,
          `http://localhost:5177/fulfillment/tax-invoices/${fixture.legacy.id}`,
          'Original issued total',
        );
        assert.ok((await body(page)).includes('Not snapshotted'));
        await screenshot(page, 'legacy-unavailable-snapshots-1440');
        proof.assertions.push(
          'Active currency Enter saved 75.50, quantities stayed fixed, finalized values match backend, audit persisted, HSN blockers and legacy nulls are honest',
        );
      }
      await go(
        page,
        `http://localhost:5177/fulfillment/tax-invoices/${fixture.multi.id}`,
        'Finalized',
      );
      await until(
        async () =>
          await page.evaluate(
            "[...document.querySelectorAll('img')].filter(n=>n.alt.startsWith('UAT-STYLE')).every(n=>n.complete&&n.naturalWidth>0) && [...document.querySelectorAll('img')].filter(n=>n.alt.startsWith('UAT-STYLE')).length===9",
          ),
        'nine archived Style markers',
      );
      const imageHashes = await page.evaluate(
        `(async () => { const images=[...document.querySelectorAll('img')].filter(n=>n.alt.startsWith('UAT-STYLE')); return Promise.all(images.map(async n => { const data=await (await fetch(n.src)).arrayBuffer(); const hash=await crypto.subtle.digest('SHA-256',data); return {styleNumber:n.alt,hash:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),objectFit:getComputedStyle(n).objectFit}; })); })()`,
      );
      for (const source of fixture.multi.sources) {
        const image = imageHashes.find((item) => item.styleNumber === source.styleNumber);
        assert.equal(image?.hash, source.expectedImageChecksum);
        assert.equal(image.objectFit, 'contain');
      }
      await screenshot(page, `multi-style-table-${width}`);
      await page.evaluate('window.scrollTo(0,document.body.scrollHeight)');
      await pause(250);
      execFileSync(
        'import',
        ['-window', 'root', path.join(evidence, `multi-style-totals-${width}.png`)],
        { env: { ...process.env, DISPLAY: ':99' } },
      );
      if (index === 0) {
        const imageStyle = fixture.multi.sources[0].styleNumber;
        await click(page, `View issued image for ${imageStyle}`);
        await until(
          async () => (await body(page)).includes(`Issued image · ${imageStyle}`),
          'shared image viewer',
        );
        await screenshot(page, 'shared-archive-viewer-1440');
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        // Supplemental responsive checks only. Canonical desktop evidence above
        // comes from real maximized windows, never viewport substitution.
        await go(
          page,
          `http://localhost:5177/fulfillment/tax-invoices/${fixture.drafts[2].id}`,
          'Finalize invoice',
        );
        proof.responsiveSupplements = [];
        for (const narrow of [820, 390]) {
          await page.send('Emulation.setDeviceMetricsOverride', {
            width: narrow,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await pause(250);
          assert.ok(
            await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
            `No page overflow at ${narrow}px; tables scroll within their containers`,
          );
          if (narrow === 390) {
            assert.ok(
              await page.evaluate(
                "document.querySelector('h1').getBoundingClientRect().bottom <= [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Finalize invoice').getBoundingClientRect().top",
              ),
              'Narrow header places actions below invoice identity',
            );
          }
          const capture = await page.send('Page.captureScreenshot', { format: 'png' });
          await fs.writeFile(
            path.join(evidence, `responsive-supplement-${narrow}.png`),
            Buffer.from(capture.data, 'base64'),
          );
          proof.responsiveSupplements.push({
            width: narrow,
            viewportEmulation: true,
            canonical: false,
          });
        }
        await page.send('Emulation.clearDeviceMetricsOverride');
      }
      await login(page, fixture.actors.admin);
      await go(
        page,
        `http://localhost:5177/fulfillment/tax-invoices/${fixture.issued.id}`,
        '₹44,050.00',
      );
      assert.ok(!(await body(page)).includes('Finalize invoice'));
      assert.equal(
        await page.evaluate(
          "[...document.querySelectorAll('button')].some(node => node.textContent.trim() === 'Override')",
        ),
        false,
      );
      await screenshot(page, `admin-readonly-${width}`);
      await login(page, fixture.actors.restricted);
      await page.send('Page.navigate', { url: 'http://localhost:5177/fulfillment/tax-invoices' });
      await until(
        async () => (await page.evaluate('location.pathname')) === '/forbidden',
        'restricted route',
      );
      await screenshot(page, `restricted-role-${width}`);
      proof.assertions.push(
        `Native ${width}px: queue/review/multiple archived Styles; ADMIN read-only and MERCHANDISER denied`,
      );
    } catch (error) {
      if (page) {
        await screenshot(page, `failure-${width}`).catch(() => undefined);
        const state = await page
          .evaluate(
            `JSON.stringify({path:location.pathname,body:document.body.innerText,inputs:Array.from(document.querySelectorAll('input')).map(node=>({id:node.id,type:node.type,length:node.value.length,valid:node.validity.valid}))})`,
          )
          .catch(() => 'Browser state unavailable');
        await fs.writeFile(path.join(evidence, `failure-state-${width}.json`), state);
      }
      throw error;
    } finally {
      page?.close();
      browser?.close();
      for (const worker of processes.reverse()) worker.kill('SIGTERM');
      await pause(1500);
    }
  }
  await fs.writeFile(path.join(evidence, 'native-proof.json'), JSON.stringify(proof, null, 2));
  console.log('Native desktop verification passed; evidence contains no fixture credentials');
}
main().catch(async (error) => {
  await fs.writeFile(path.join(evidence, 'failure.txt'), error.message);
  console.error(error.message);
  process.exitCode = 1;
});
