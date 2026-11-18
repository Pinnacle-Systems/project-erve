/**
 * Release gate for APKs that are distributed WITHOUT Google Play.
 *
 * Android installs an APK over an existing app only when it is signed with the
 * same certificate (or one in its signing-key lineage) and has a higher
 * versionCode. A mismatch is not a soft failure: the installer refuses, and the
 * only way forward for the user is to uninstall — which deletes the app's data
 * and its stored login. Nothing in the repository records which key the APKs
 * already in the field were signed with, so this module checks a candidate APK
 * against an APK that really was distributed (or against a recorded
 * certificate fingerprint).
 *
 * The parsers are pure; the tools (`apksigner`, `aapt2`) are located and run by
 * the small wrappers at the bottom so the logic can be tested with real output.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { unzipSync } from 'fflate';

export const EXPECTED_PACKAGE = 'com.erve.mobile';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** `certificate SHA-256 digest: <hex>` lines from `apksigner verify --print-certs`. */
export function parseSignerDigests(apksignerOutput) {
  const digests = new Set();
  for (const match of apksignerOutput.matchAll(
    /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/g,
  )) {
    digests.add(match[1].toLowerCase());
  }
  return [...digests].sort();
}

/** First `certificate DN:` line, for human-readable messages and the debug-key guard. */
export function parseSignerSubjects(apksignerOutput) {
  const subjects = new Set();
  for (const match of apksignerOutput.matchAll(/certificate DN:\s*(.+)/g))
    subjects.add(match[1].trim());
  return [...subjects];
}

/** Facts from `aapt2 dump badging`. */
export function parseBadging(badging) {
  const pkg = /^package: name='([^']*)' versionCode='(\d+)' versionName='([^']*)'/m.exec(badging);
  return {
    packageName: pkg?.[1] ?? null,
    versionCode: pkg ? Number(pkg[2]) : null,
    versionName: pkg?.[3] ?? null,
    debuggable: /^application-debuggable/m.test(badging),
  };
}

export function normaliseDigest(value) {
  const digest = String(value).trim().toLowerCase().replace(/[:\s]/g, '');
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`"${value}" is not a SHA-256 certificate fingerprint (64 hex characters).`);
  }
  return digest;
}

/** The OTA identity baked into the APK by the build (`plugins.CapacitorUpdater.version`). */
export function readOtaIdentity(apkBytes) {
  const files = unzipSync(apkBytes, {
    filter: (file) => file.name === 'assets/capacitor.config.json',
  });
  const raw = files['assets/capacitor.config.json'];
  if (!raw) return { present: false };
  const config = JSON.parse(Buffer.from(raw).toString('utf8'));
  const updater = config?.plugins?.CapacitorUpdater;
  const match = /^(.*)-erve-native\.([0-9a-f]{32})\.([a-z0-9][a-z0-9_-]{0,31})$/.exec(
    updater?.version ?? '',
  );
  return {
    present: Boolean(updater),
    appVersion: match?.[1] ?? null,
    fingerprint: match?.[2] ?? null,
    channel: match?.[3] ?? null,
    publicKey: typeof updater?.publicKey === 'string' ? updater.publicKey : null,
  };
}

const normalisePem = (pem) => pem.replace(/-----[A-Z ]+-----|\s/g, '');

// AGP shortens resource paths (res/raw/ca.pem -> res/Px.pem), so match by extension anywhere under res/.
const BUNDLED_CERT_ENTRY = /^res\/(?:.*\/)?[^/]+\.(pem|crt|cer|der)$/i;
const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.0\.2\.2|0\.0\.0\.0|\[?::1\]?|[^.]+\.local|[^.]+\.test|[^.]+\.invalid)$/i;

/**
 * Things that must not be in a distributed APK: bundled certificates (how a test CA
 * gets trusted) and an OTA update URL that points at a developer machine. (The
 * manifest's networkSecurityConfig reference is read from the compiled manifest by
 * the aapt2 wrapper below, because resource file names are shortened inside the APK.)
 */
export function readEmbeddedInfo(apkBytes) {
  const interesting = (name) =>
    BUNDLED_CERT_ENTRY.test(name) || /^assets\/public\/assets\/.*\.js$/.test(name);
  const files = unzipSync(apkBytes, { filter: (file) => interesting(file.name) });
  const names = Object.keys(files);
  const urls = new Set();
  for (const name of names.filter((n) => n.endsWith('.js'))) {
    const text = Buffer.from(files[name]).toString('utf8');
    // minified output writes the constant as a template literal: baseUrl:`https://...`
    for (const match of text.matchAll(/baseUrl\s*:\s*["'`]([^"'`]+)["'`]/g)) urls.add(match[1]);
  }
  return {
    bundledCertificates: names.filter((n) => BUNDLED_CERT_ENTRY.test(n)),
    otaBaseUrls: [...urls],
  };
}

export function isLocalUrl(value) {
  try {
    return LOCAL_HOST.test(new URL(value).hostname);
  } catch {
    return true; // an unparsable update URL is as bad as a local one
  }
}

/**
 * @param {object} candidate  { digests, subjects, badging, ota }
 * @param {object} policy     { previous?, expectedDigests?, channel?, otaPublicKeyPem?, allowDebug?,
 *                            allowUnchecked?, allowNetworkConfig?, allowLocalUrls? }
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
export function evaluateRelease(candidate, policy = {}) {
  const problems = [];
  const warnings = [];
  const { digests, subjects = [], badging, ota } = candidate;

  if (!digests.length) problems.push('The APK has no verifiable signature.');
  if (badging.packageName !== EXPECTED_PACKAGE) {
    problems.push(`Package is "${badging.packageName}", expected "${EXPECTED_PACKAGE}".`);
  }
  if (badging.debuggable && !policy.allowDebug) {
    problems.push('The APK is debuggable. A distributed build must come from assembleRelease.');
  }
  if (subjects.some((subject) => /Android Debug/i.test(subject)) && !policy.allowDebug) {
    problems.push(
      'The APK is signed with the Android DEBUG key. Devices running a release-signed app cannot be updated to it.',
    );
  }

  const embedded = candidate.embedded ?? { bundledCertificates: [], otaBaseUrls: [] };
  if (
    (embedded.manifestNetworkConfig || embedded.bundledCertificates.length) &&
    !policy.allowNetworkConfig
  ) {
    problems.push(
      'The APK declares a custom network security config and/or bundles certificate(s)' +
        `${embedded.bundledCertificates.length ? ` (${embedded.bundledCertificates.join(', ')})` : ''}. ` +
        'That is how a test CA gets trusted; a production APK must trust only the system CAs. ' +
        'Rebuild from a clean android/ project (delete android/app/src/{debug,release} overlays).',
    );
  }
  if (embedded.usesCleartextTraffic && !policy.allowNetworkConfig) {
    problems.push('The APK allows cleartext (http) traffic (usesCleartextTraffic="true").');
  }
  for (const url of embedded.otaBaseUrls) {
    if (!/^https:\/\//i.test(url) || isLocalUrl(url)) {
      if (!policy.allowLocalUrls) {
        problems.push(`The OTA update URL baked into the APK (${url}) is not a public https URL.`);
      }
    }
  }

  const expected = policy.expectedDigests ?? policy.previous?.digests;
  if (!expected?.length) {
    // Fail closed: a gate that silently checks nothing is worse than no gate.
    const message =
      'No reference certificate was given (--previous <distributed.apk> or --expected-sha256): ' +
      'signing compatibility was NOT checked.';
    if (policy.allowUnchecked) warnings.push(message);
    else problems.push(`${message} Pass --allow-unchecked only for a first-ever release.`);
  } else {
    const missing = expected.filter((digest) => !digests.includes(digest));
    const unexpected = digests.filter((digest) => !expected.includes(digest));
    if (missing.length || unexpected.length) {
      problems.push(
        'Signing identity differs from the distributed app. Android will REFUSE to install this APK over it; ' +
          'users would have to uninstall first, which deletes their data and login. ' +
          `Distributed: ${expected.join(', ')}  |  This APK: ${digests.join(', ') || 'none'}`,
      );
    }
  }

  if (policy.previous?.badging?.versionCode != null) {
    const before = policy.previous.badging.versionCode;
    if (badging.versionCode == null || badging.versionCode <= before) {
      problems.push(
        `versionCode ${badging.versionCode} is not higher than the distributed ${before}; Android will not treat this as an upgrade.`,
      );
    }
  } else if (policy.previous == null) {
    warnings.push('No previous APK given: versionCode ordering was NOT checked.');
  }

  if (!ota.present) {
    warnings.push('The APK carries no OTA updater configuration (a pre-OTA build).');
  } else {
    if (!ota.fingerprint || !ota.channel)
      problems.push('The OTA native version string is malformed.');
    if (policy.channel && ota.channel !== policy.channel) {
      problems.push(`The APK follows the "${ota.channel}" channel, expected "${policy.channel}".`);
    }
    if (ota.appVersion && badging.versionName && ota.appVersion !== badging.versionName) {
      problems.push(
        `versionName ${badging.versionName} and the OTA app version ${ota.appVersion} disagree; ` +
          'the OTA channel ordering relies on them matching.',
      );
    }
    if (policy.otaPublicKeyPem) {
      if (!ota.publicKey || normalisePem(ota.publicKey) !== normalisePem(policy.otaPublicKeyPem)) {
        problems.push('The OTA public key inside the APK is not the committed public key.');
      }
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

// ---- tool wrappers (not unit tested; thin) --------------------------------------

function sdkRoots() {
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
}

function findBuildTool(name) {
  const candidates = process.platform === 'win32' ? [`${name}.bat`, `${name}.exe`, name] : [name];
  const versions = [];
  for (const root of sdkRoots()) {
    const base = join(root, 'build-tools');
    if (existsSync(base)) versions.push(...readdirSync(base).map((version) => join(base, version)));
  }
  versions.sort().reverse(); // newest first (string order is adequate for the SDK's version names)
  for (const dir of [...versions, ...(process.env.PATH ?? '').split(delimiter)]) {
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  throw new Error(
    `Could not find ${name}. Set ANDROID_HOME to the Android SDK (it must contain build-tools/<version>/${name}).`,
  );
}

function runTool(tool, args) {
  const windowsScript = tool.toLowerCase().endsWith('.bat');
  const result = windowsScript
    ? spawnSync('cmd.exe', ['/c', tool, ...args], { encoding: 'utf8' })
    : spawnSync(tool, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Network-related attributes of the compiled manifest (via aapt2). */
export function parseManifestNetworkFacts(xmltree) {
  return {
    manifestNetworkConfig: /:networkSecurityConfig\(/.test(xmltree),
    usesCleartextTraffic: /:usesCleartextTraffic\([^)]*\)=\(type 0x12\)0xffffffff/.test(xmltree),
  };
}

function readManifestNetworkFacts(apkPath) {
  const tree = runTool(findBuildTool('aapt2'), [
    'dump',
    'xmltree',
    '--file',
    'AndroidManifest.xml',
    apkPath,
  ]);
  return parseManifestNetworkFacts(tree.stdout);
}

/** Reads certificate digests, subjects, badging facts and OTA identity from an APK file. */
export function inspectApk(apkPath) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  const verify = runTool(findBuildTool('apksigner'), ['verify', '--print-certs', apkPath]);
  const signatureValid = verify.status === 0;
  const badging = parseBadging(
    runTool(findBuildTool('aapt2'), ['dump', 'badging', apkPath]).stdout,
  );
  const apkBytes = readFileSync(apkPath);
  return {
    path: apkPath,
    signatureValid,
    signatureProblem: signatureValid
      ? null
      : (verify.stderr || verify.stdout).trim().split('\n')[0],
    digests: signatureValid ? parseSignerDigests(verify.stdout) : [],
    subjects: signatureValid ? parseSignerSubjects(verify.stdout) : [],
    badging,
    ota: readOtaIdentity(apkBytes),
    embedded: { ...readEmbeddedInfo(apkBytes), ...readManifestNetworkFacts(apkPath) },
  };
}

export function checkApk({
  apk,
  previousApk,
  expectedSha256 = [],
  channel,
  otaPublicKeyFile,
  allowDebug,
  allowUnchecked,
  allowNetworkConfig,
  allowLocalUrls,
}) {
  const candidate = inspectApk(apk);
  const previous = previousApk ? inspectApk(previousApk) : undefined;
  const result = evaluateRelease(candidate, {
    previous,
    expectedDigests: expectedSha256.length ? expectedSha256.map(normaliseDigest) : undefined,
    channel,
    otaPublicKeyPem: otaPublicKeyFile ? readFileSync(otaPublicKeyFile, 'utf8') : undefined,
    allowDebug,
    allowUnchecked,
    allowNetworkConfig,
    allowLocalUrls,
  });
  if (!candidate.signatureValid)
    result.problems.unshift(`apksigner rejected the signature: ${candidate.signatureProblem}`);
  return { ...result, ok: result.problems.length === 0, candidate, previous };
}
