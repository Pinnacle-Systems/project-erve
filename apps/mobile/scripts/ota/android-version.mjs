/**
 * Android `versionCode` / `versionName` policy for sideloaded APKs.
 *
 * Capacitor generates android/app/build.gradle once with `versionCode 1` and
 * `versionName "1.0"` and never touches it again, so without this step every APK
 * ever built claims to be version 1. That breaks two things the OTA design
 * relies on:
 *   - Android orders installs by versionCode, so a newer APK is not
 *     distinguishable from the one it replaces (and an older one is not refused);
 *   - @capgo/capacitor-updater discards downloaded OTA bundles on an APK upgrade
 *     by comparing versionCode, so a constant value leaves a stale bundle in
 *     place across a native upgrade (the startup fingerprint check still catches
 *     it, but the platform mechanism should work too).
 *
 * versionName  = apps/mobile/package.json "version" — always, so it can never disagree with the
 *                app version in the OTA native version string (<version>-erve-native.<fp>.<channel>).
 * versionCode  = ERVE_ANDROID_VERSION_CODE, or derived from the version as
 *                major*10000 + minor*100 + patch  (0.1.0 -> 100, 1.4.2 -> 10402).
 * Both must be raised for every APK that is distributed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Android's hard upper bound for versionCode. */
export const MAX_VERSION_CODE = 2_100_000_000;

export function deriveVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version ?? '');
  if (!match) {
    throw new Error(
      `Cannot derive an Android versionCode from package version "${version}". ` +
        'Use a plain MAJOR.MINOR.PATCH version or set ERVE_ANDROID_VERSION_CODE.',
    );
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(
      `Version ${version} is outside the derivable range (minor and patch <= 99). ` +
        'Set ERVE_ANDROID_VERSION_CODE explicitly.',
    );
  }
  return major * 10000 + minor * 100 + patch;
}

export function resolveAndroidVersion({ packageVersion, env = process.env }) {
  const name = packageVersion;
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(name ?? '')) {
    throw new Error(`Invalid Android versionName "${name}".`);
  }
  const rawCode = (env.ERVE_ANDROID_VERSION_CODE ?? '').trim();
  let code;
  if (rawCode) {
    if (!/^\d+$/.test(rawCode)) {
      throw new Error(`ERVE_ANDROID_VERSION_CODE must be a positive integer, got "${rawCode}".`);
    }
    code = Number(rawCode);
  } else {
    code = deriveVersionCode(packageVersion);
  }
  if (!Number.isSafeInteger(code) || code < 1 || code > MAX_VERSION_CODE) {
    throw new Error(`Android versionCode ${code} is outside 1..${MAX_VERSION_CODE}.`);
  }
  return { code, name };
}

const CODE_LINE = /^([ \t]*)versionCode[ \t]+.*$/m;
const NAME_LINE = /^([ \t]*)versionName[ \t]+.*$/m;

/** Returns the gradle text with the two lines replaced; throws if either is missing. */
export function applyAndroidVersion(gradleText, { code, name }) {
  if (!CODE_LINE.test(gradleText) || !NAME_LINE.test(gradleText)) {
    throw new Error(
      'android/app/build.gradle has no versionCode/versionName line to update. ' +
        'Refusing to build an APK with an unmanaged version.',
    );
  }
  return gradleText
    .replace(CODE_LINE, (_line, indent) => `${indent}versionCode ${code}`)
    .replace(NAME_LINE, (_line, indent) => `${indent}versionName "${name}"`);
}

export function configureAndroidVersion({ gradleFile, packageJsonFile, env = process.env }) {
  const packageVersion = JSON.parse(readFileSync(packageJsonFile, 'utf8')).version;
  const version = resolveAndroidVersion({ packageVersion, env });
  const before = readFileSync(gradleFile, 'utf8');
  const after = applyAndroidVersion(before, version);
  if (after !== before) writeFileSync(gradleFile, after);
  return version;
}
