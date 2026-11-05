// Orchestrates one E-Way Bill browser acceptance run (Track B / B5):
//   guard -> seed synthetic fixtures -> start QA API (mock provider) and web app
//   -> run the browser scenarios -> ALWAYS stop every child process.
//
// Required environment (the guard in apps/api/src/test/eway-bill-acceptance-guard.ts
// refuses to proceed unless all of it is exactly right):
//   EWAY_ACCEPTANCE_AUTHORIZED=true, NODE_ENV=test,
//   EWAY_ACCEPTANCE_DATABASE_URL = DATABASE_URL = a loopback postgres database
//   named erve_eway_acceptance_test, GST_VERIFICATION_API_KEY = the synthetic key.
// EWAY_ACCEPTANCE_CHROME_BINARY must point at Chrome/Chromium.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { until } from './cdp.mjs';
const { fetch } = globalThis;

const root = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.env.EWAY_ACCEPTANCE_OUTPUT ?? path.join(root, '.artifacts/eway-bill-acceptance'));
const API_PORT = Number(process.env.EWAY_ACCEPTANCE_API_PORT ?? 4208);
const CONTROL_PORT = Number(process.env.EWAY_ACCEPTANCE_CONTROL_PORT ?? 4209);
const WEB_PORT = Number(process.env.EWAY_ACCEPTANCE_WEB_PORT ?? 5178);
const controlToken = randomBytes(24).toString('hex');
const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';

if (!process.env.EWAY_ACCEPTANCE_CHROME_BINARY) throw new Error('EWAY_ACCEPTANCE_CHROME_BINARY is required');
await fs.mkdir(out, { recursive: true });

const children = [];
function start(name, command, args, options) {
  const logFile = path.join(out, `${name}.log`);
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows });
  fs.open(logFile, 'w').then((handle) => {
    child.stdout.on('data', (chunk) => handle.write(chunk));
    child.stderr.on('data', (chunk) => handle.write(chunk));
    child.on('close', () => handle.close());
  });
  children.push({ name, child });
  return child;
}
function run(name, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', shell: isWindows });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))));
  });
}
async function stopAll() {
  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) {
      await new Promise((resolve) => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', resolve));
    } else {
      child.kill('SIGTERM');
    }
  }
  await delay(500);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void stopAll().finally(() => process.exit(130)));
}

const baseEnv = {
  ...process.env,
  PORT: String(API_PORT),
  HOST: '127.0.0.1',
  CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
  EWAY_ACCEPTANCE_CONTROL_PORT: String(CONTROL_PORT),
  EWAY_ACCEPTANCE_CONTROL_TOKEN: controlToken,
  EWAY_ACCEPTANCE_FIXTURE_PATH: path.join(out, 'fixtures.json'),
  FILE_STORAGE_DIR: path.join(out, 'media'),
};

let exitCode = 1;
try {
  const apiDir = path.join(root, 'apps/api');
  console.log('[eway-acceptance] seeding synthetic fixtures (guarded)');
  await run('fixtures', pnpm, ['exec', 'tsx', 'src/test/eway-bill-acceptance-fixtures.ts'], { cwd: apiDir, env: baseEnv });

  console.log('[eway-acceptance] starting QA API with the mock provider, and the web application');
  start('api', pnpm, ['exec', 'tsx', 'src/test/eway-bill-acceptance-server.ts'], { cwd: apiDir, env: baseEnv });
  start('web', pnpm, ['--filter', '@erve/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(WEB_PORT)], {
    cwd: root,
    env: { ...baseEnv, VITE_API_URL: `http://localhost:${API_PORT}` },
  });
  await until(async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok, 'API health', 90000, 500);
  await until(async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/`)).ok, 'web application', 120000, 500);
  // Warm the first page load so Vite's dependency optimisation never lands inside a scenario.
  await fetch(`http://127.0.0.1:${WEB_PORT}/login`).catch(() => {});

  console.log('[eway-acceptance] running browser scenarios');
  await run('acceptance', process.execPath, [path.join(import.meta.dirname, 'acceptance.mjs')], {
    cwd: root,
    env: {
      ...baseEnv,
      EWAY_ACCEPTANCE_APP_URL: `http://localhost:${WEB_PORT}`,
      EWAY_ACCEPTANCE_API_URL: `http://localhost:${API_PORT}`,
      EWAY_ACCEPTANCE_API_NODE_URL: `http://127.0.0.1:${API_PORT}`,
      EWAY_ACCEPTANCE_CONTROL_URL: `http://127.0.0.1:${CONTROL_PORT}`,
      EWAY_ACCEPTANCE_OUTPUT: out,
    },
  });
  exitCode = 0;
} catch (error) {
  console.error(`[eway-acceptance] ${error instanceof Error ? error.message : error}`);
  for (const name of ['api', 'web']) {
    const file = path.join(out, `${name}.log`);
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    if (text) console.error(`--- tail of ${name}.log ---\n${text.split('\n').slice(-30).join('\n')}`);
  }
} finally {
  await stopAll();
  // The fixture file holds synthetic passwords; it is never part of the published evidence.
  await fs.rm(path.join(out, 'fixtures.json'), { force: true });
}
process.exit(exitCode);
