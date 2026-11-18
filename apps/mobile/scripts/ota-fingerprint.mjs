#!/usr/bin/env node
/**
 * Prints the native-compatibility fingerprint and the OTA build configuration
 * the current sources resolve to. Use `--explain` to see every component that
 * contributes, e.g. to find out why a change forces a new APK.
 */
import { parseArgs } from 'node:util';
import baseConfig from '../capacitor.base-config.mjs';
import { loadOtaBuildConfig, resolveNativeIdentity } from './ota/ota-config.mjs';

const { values } = parseArgs({ options: { explain: { type: 'boolean', default: false } } });
const ota = loadOtaBuildConfig();
const { fingerprint, builtinVersion, components } = resolveNativeIdentity({ baseConfig, ota });

console.log(`native fingerprint : ${fingerprint}`);
console.log(`builtin version    : ${builtinVersion}`);
console.log(`ota enabled        : ${ota.enabled}${ota.enabled ? '' : ` (${ota.disabledReason})`}`);
console.log(`channel            : ${ota.channel}`);
console.log(`update base url    : ${ota.baseUrl || '(none)'}`);
if (values.explain) {
  const redacted = structuredClone(components);
  const updater = redacted.config.plugins?.CapacitorUpdater;
  if (updater?.publicKey) updater.publicKey = '(set)';
  console.log(JSON.stringify(redacted, null, 2));
}
