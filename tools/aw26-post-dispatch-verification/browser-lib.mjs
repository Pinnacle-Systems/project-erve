// Raw-CDP browser helpers for the AW26 UAT evidence run (reuses tools/pr8/cdp-driver.mjs; no browser framework).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpDriver } from '../pr8/cdp-driver.mjs';

const root = resolve(import.meta.dirname, '../..');
export const WS = process.env.AW26_WORKSPACE;
export const cfg = JSON.parse(readFileSync(join(WS, 'scenario-config.json'), 'utf8'));
export const evidence = join(WS, '07-technical-evidence');
export const shots = join(evidence, 'screenshots');
mkdirSync(shots, { recursive: true });
mkdirSync(join(evidence, 'pdfs'), { recursive: true });
const captionsPath = join(shots, 'captions.json');
export const captions = existsSync(captionsPath)
  ? JSON.parse(readFileSync(captionsPath, 'utf8'))
  : {};
export const appUrl = process.env.AW26_WEB ?? 'http://127.0.0.1:5190';
export const apiUrl = process.env.AW26_API ?? 'http://127.0.0.1:4080';
const port = 9331;

export async function launch() {
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
  if (!chrome) throw new Error('Chrome or Edge required');
  const profile = join(WS, '06-test-fixtures', 'runtime', `chrome-profile-${Date.now()}`);
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,1000',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await delay(150);
  }
  const output = join(evidence, 'browser-run');
  const driver = await CdpDriver.connect({
    endpoint: `http://127.0.0.1:${port}`,
    appUrl,
    output,
    repositoryRoot: root,
  });
  driver.__child = child;
  return driver;
}

export async function login(b, identifier, password) {
  await b.command('Network.clearBrowserCookies');
  await b.viewport(1440, 1000);
  await b.navigateTo('/login');
  await b.evaluate('try { localStorage.clear(); sessionStorage.clear(); } catch {}');
  await b.navigateTo('/login');
  await b.waitFor('!!document.querySelector("#identifier")');
  await b.fill('#identifier', identifier);
  await b.fill('#password', password);
  await b.clickButton('Sign in');
  await b.waitFor('location.pathname !== "/login"', 30000);
}

export async function shot(b, name, caption, { full = false } = {}) {
  await delay(900);
  const { data } = await b.command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full,
    fromSurface: true,
  });
  const file = `${name}.png`;
  writeFileSync(join(shots, file), Buffer.from(data, 'base64'));
  captions[file] = caption;
  writeFileSync(captionsPath, JSON.stringify(captions, null, 2));
  console.log(`shot ${file}`);
  return file;
}
export const bodyText = (b) => b.evaluate('document.body.innerText');
export const actors = () =>
  JSON.parse(readFileSync(join(WS, '06-test-fixtures', 'runtime', 'actor-passwords.json'), 'utf8'));
export const state = () =>
  JSON.parse(readFileSync(join(WS, '06-test-fixtures', 'runtime', 'state.json'), 'utf8'));
export const adminCreds = () => ({
  identifier: 'admin.aw26@erve.test',
  password: readFileSync(
    join(WS, '06-test-fixtures', 'runtime', 'admin-password.txt'),
    'utf8',
  ).trim(),
});
export { delay };
