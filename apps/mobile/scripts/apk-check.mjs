#!/usr/bin/env node
/**
 * APK identity / release gate. See scripts/ota/apk-check.mjs and the runbook (§2.4).
 *
 *   node scripts/apk-check.mjs cert  <apk>
 *       print package, versionCode/versionName, signer certificate SHA-256 and OTA identity
 *   node scripts/apk-check.mjs check <new.apk> (--previous <distributed.apk> | --expected-sha256 <hex>)
 *            [--channel production|testing] [--ota-public-key <pem>] [--allow-debug] [--allow-unchecked]
 *            [--allow-network-config] [--allow-local-urls]   (test builds only)
 *       exit 0 only if the APK can be installed over the distributed app and is release-grade
 *
 * Never reads or prints a private key or keystore.
 */
import { parseArgs } from 'node:util';
import { checkApk, inspectApk } from './ota/apk-check.mjs';

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    previous: { type: 'string' },
    'expected-sha256': { type: 'string', multiple: true, default: [] },
    channel: { type: 'string' },
    'ota-public-key': { type: 'string' },
    'allow-debug': { type: 'boolean', default: false },
    'allow-unchecked': { type: 'boolean', default: false },
    'allow-network-config': { type: 'boolean', default: false },
    'allow-local-urls': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

function describe(info) {
  return [
    `  file         ${info.path}`,
    `  package      ${info.badging.packageName}`,
    `  version      ${info.badging.versionName} (versionCode ${info.badging.versionCode})`,
    `  debuggable   ${info.badging.debuggable}`,
    `  signature    ${info.signatureValid ? 'valid' : `INVALID (${info.signatureProblem})`}`,
    ...info.digests.map((d) => `  signer SHA-256  ${d}`),
    ...info.subjects.map((s) => `  signer subject  ${s}`),
    info.embedded.manifestNetworkConfig || info.embedded.bundledCertificates.length
      ? `  network cfg  custom network security config${info.embedded.bundledCertificates.length ? `, certificates: ${info.embedded.bundledCertificates.join(', ')}` : ''}`
      : '  network cfg  none',
    `  OTA base URL ${info.embedded.otaBaseUrls.join(', ') || 'none found'}`,
    info.ota.present
      ? `  OTA          native ${info.ota.fingerprint}, channel ${info.ota.channel}, app ${info.ota.appVersion}`
      : '  OTA          none (pre-OTA build)',
  ].join('\n');
}

try {
  const apk = positionals[0];
  if (!apk || !['cert', 'check'].includes(command ?? '')) {
    console.error(
      'usage: apk-check.mjs cert <apk> | check <apk> (--previous <apk> | --expected-sha256 <hex>) [options]',
    );
    process.exit(2);
  }
  if (command === 'cert') {
    const info = inspectApk(apk);
    console.log(values.json ? JSON.stringify(info, null, 2) : describe(info));
    process.exit(info.signatureValid ? 0 : 1);
  }
  const result = checkApk({
    apk,
    previousApk: values.previous,
    expectedSha256: values['expected-sha256'],
    channel: values.channel,
    otaPublicKeyFile: values['ota-public-key'],
    allowDebug: values['allow-debug'],
    allowUnchecked: values['allow-unchecked'],
    allowNetworkConfig: values['allow-network-config'],
    allowLocalUrls: values['allow-local-urls'],
  });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Candidate:\n' + describe(result.candidate));
    if (result.previous) console.log('Distributed (reference):\n' + describe(result.previous));
    for (const warning of result.warnings) console.log(`WARNING: ${warning}`);
    for (const problem of result.problems) console.log(`PROBLEM: ${problem}`);
    console.log(
      result.ok
        ? 'RESULT: OK — safe to distribute over the reference app.'
        : 'RESULT: DO NOT DISTRIBUTE.',
    );
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`[apk-check] ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}
