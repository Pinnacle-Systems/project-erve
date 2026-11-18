#!/usr/bin/env node
/**
 * Generates the OTA signing key pair.
 *
 *   node scripts/ota-keygen.mjs --private-out <path outside the repo>
 *
 * The PRIVATE key authorises what devices will install — guard it like a
 * deployment credential and never commit it. The PUBLIC key is written to
 * apps/mobile/ota/ota-public-key.pem (commit it): it is compiled into the APK.
 * Rotating the key requires shipping a new APK.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateKeyPair } from './ota/bundle-crypto.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileRoot, '..', '..');
const { values } = parseArgs({
  options: {
    'private-out': { type: 'string' },
    'public-out': { type: 'string', default: join(mobileRoot, 'ota', 'ota-public-key.pem') },
  },
});

function fail(message) {
  console.error(`[ota-keygen] ${message}`);
  process.exit(1);
}

if (!values['private-out'])
  fail('--private-out <file> is required (must be outside this repository).');
const privateOut = resolve(values['private-out']);
const publicOut = resolve(values['public-out']);
const insideRepo = !relative(repoRoot, privateOut).startsWith('..');
if (insideRepo) fail(`Refusing to write the private key inside the repository (${privateOut}).`);
for (const path of [privateOut, publicOut]) {
  if (existsSync(path)) fail(`${path} already exists; refusing to overwrite a key.`);
}

const { publicKeyPem, privateKeyPem } = generateKeyPair();
mkdirSync(dirname(privateOut), { recursive: true });
mkdirSync(dirname(publicOut), { recursive: true });
writeFileSync(privateOut, `${privateKeyPem}\n`, { mode: 0o600 });
writeFileSync(publicOut, `${publicKeyPem}\n`);
console.log(`[ota-keygen] private key: ${privateOut}  (keep secret; back it up)`);
console.log(`[ota-keygen] public key:  ${publicOut}  (commit this)`);
