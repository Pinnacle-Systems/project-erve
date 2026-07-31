import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HOST = '127.0.0.1';
const PORT = 5174;
const STARTUP_TIMEOUT_MS = 30_000;
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function resolvePackageBinary(packageName, binaryName) {
  const packageJsonPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const relativeBinary =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binaryName];

  if (!relativeBinary) {
    throw new Error(`Could not resolve the ${binaryName} binary from ${packageName}.`);
  }

  return resolve(dirname(packageJsonPath), relativeBinary);
}

function run(command, args) {
  const child = spawn(command, args, {
    cwd: mobileRoot,
    env: process.env,
    stdio: 'inherit',
  });

  const completed = new Promise((resolveCompleted, rejectCompleted) => {
    child.once('error', rejectCompleted);
    child.once('exit', (code, signal) => resolveCompleted({ code, signal }));
  });

  return { child, completed };
}

async function getAndroidTarget() {
  const configuredTarget =
    process.env.CAPACITOR_ANDROID_TARGET?.trim() || process.env.ANDROID_SERIAL?.trim();

  if (configuredTarget) {
    return configuredTarget;
  }

  const { stdout } = await execFileAsync('adb', ['devices'], {
    cwd: mobileRoot,
    encoding: 'utf8',
  });
  const connectedDevices = stdout
    .split(/\r?\n/u)
    .map((line) => line.match(/^(\S+)\s+device$/u)?.[1])
    .filter(Boolean);

  if (connectedDevices.length === 0) {
    throw new Error('No Android device is connected. Start an emulator or connect a device first.');
  }

  if (connectedDevices.length > 1) {
    throw new Error(
      `Multiple Android devices are connected (${connectedDevices.join(', ')}). Set CAPACITOR_ANDROID_TARGET to the device serial to use.`,
    );
  }

  return connectedDevices[0];
}

function canConnect() {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host: HOST, port: PORT });

    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolveConnection(false);
    });
    socket.once('error', () => resolveConnection(false));
  });
}

async function waitForVite(viteCompleted) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await Promise.race([
      canConnect().then((connected) => ({ connected })),
      viteCompleted.then(({ code, signal }) => ({ code, signal })),
    ]);

    if ('code' in result) {
      throw new Error(
        `Vite exited before it became ready (code ${result.code ?? 'none'}, signal ${result.signal ?? 'none'}).`,
      );
    }

    if (result.connected) {
      return;
    }

    await delay(200);
  }

  throw new Error(`Vite did not become reachable at http://${HOST}:${PORT} within 30 seconds.`);
}

const viteBinary = resolvePackageBinary('vite', 'vite');
const capacitorBinary = resolvePackageBinary('@capacitor/cli', 'cap');
const androidTarget = await getAndroidTarget();
const vite = run(process.execPath, [
  viteBinary,
  '--host',
  HOST,
  '--port',
  String(PORT),
  '--strictPort',
]);

let capacitor;

function stopChildren() {
  capacitor?.child.kill();
  vite.child.kill();
}

process.once('SIGINT', stopChildren);
process.once('SIGTERM', stopChildren);

try {
  await waitForVite(vite.completed);

  const apiReverse = run('adb', ['-s', androidTarget, 'reverse', 'tcp:4000', 'tcp:4000']);
  const apiReverseResult = await apiReverse.completed;

  if (apiReverseResult.code !== 0) {
    throw new Error('Failed to reverse Android API port 4000. Is an emulator or device running?');
  }

  capacitor = run(process.execPath, [
    capacitorBinary,
    'run',
    'android',
    '--target',
    androidTarget,
    '--live-reload',
    '--host',
    'localhost',
    '--port',
    String(PORT),
    '--forwardPorts',
    `${PORT}:${PORT}`,
  ]);

  const result = await capacitor.completed;
  if (result.code !== 0 && result.signal === null) {
    process.exitCode = result.code ?? 1;
  }
} finally {
  stopChildren();
  process.removeListener('SIGINT', stopChildren);
  process.removeListener('SIGTERM', stopChildren);
}
