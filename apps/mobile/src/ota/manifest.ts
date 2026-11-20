import { base64ToBytes, verifyRsaSha256 } from './rsa.js';

/**
 * Signed release manifest served at <baseUrl>/<channel>/manifest.json.
 *
 * The file on the wire is an envelope { format, payload, signature } where
 * `payload` is the base64 of the exact JSON bytes that were signed. Nothing in
 * the payload is trusted until the signature has been verified against the
 * public key compiled into the app.
 */
export const MANIFEST_FORMAT = 1;
export const MANIFEST_SCHEMA = 1;
const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/;
const RELEASE_VERSION_PATTERN = /-ota\.(\d{1,15})$/;
const MAX_BUNDLE_BYTES = 150 * 1024 * 1024;

export interface OtaRelease {
  /** `<semver>-ota.<buildNumber>` — the buildNumber is recoverable from the version. */
  version: string;
  /** Strictly increasing per publish; a device never installs a lower or equal one. */
  buildNumber: number;
  /** Relative to the manifest URL, or absolute https on the same origin. */
  url: string;
  /** RSA-private-key-encrypted SHA-256 of the plain zip (hex, 256 bytes). */
  checksum: string;
  /** base64(iv):base64(RSA-private-key-encrypted AES key). */
  sessionKey: string;
  sizeBytes: number;
  createdAt: string;
}

export interface OtaManifest {
  schema: typeof MANIFEST_SCHEMA;
  channel: string;
  /** Epoch ms at signing time; a device refuses a manifest older than one it has seen. */
  sequence: number;
  generatedAt: string;
  /** Newest APK generation. Differs from a device's own fingerprint once a new APK exists. */
  latestNativeFingerprint: string;
  /** Latest compatible release per native fingerprint. */
  releases: Record<string, OtaRelease>;
}

export type ManifestErrorCode = 'malformed' | 'signature' | 'channel' | 'unsupported';

export class ManifestError extends Error {
  readonly code: ManifestErrorCode;
  constructor(code: ManifestErrorCode, message: string) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
  }
}

/** `0.2.0-ota.123` -> `0.2.0` (the app version the release was published under). */
export function appVersionFromReleaseVersion(version: string | undefined | null): string | null {
  const stripped = (version ?? '').replace(RELEASE_VERSION_PATTERN, '');
  return stripped && stripped !== version ? stripped : null;
}

/**
 * True only when `candidate` is provably a HIGHER MAJOR.MINOR.PATCH than
 * `reference`. Anything unparsable or equal is "not provably newer", so callers
 * fall back to the conservative answer.
 */
export function isNewerAppVersion(candidate: string, reference: string | null): boolean {
  const parse = (value: string | null) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value ?? '');
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const a = parse(candidate);
  const b = parse(reference);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export function buildNumberFromVersion(version: string | undefined | null): number {
  const match = RELEASE_VERSION_PATTERN.exec(version ?? '');
  return match ? Number(match[1]) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRelease(fingerprint: string, raw: unknown): OtaRelease {
  if (!isRecord(raw))
    throw new ManifestError('malformed', `Release for ${fingerprint} is not an object`);
  const { version, buildNumber, url, checksum, sessionKey, sizeBytes, createdAt } = raw;
  if (typeof version !== 'string' || typeof url !== 'string' || typeof createdAt !== 'string') {
    throw new ManifestError('malformed', 'Release is missing version, url or createdAt');
  }
  if (!Number.isSafeInteger(buildNumber) || (buildNumber as number) < 1) {
    throw new ManifestError('malformed', 'Release buildNumber must be a positive integer');
  }
  if (buildNumberFromVersion(version) !== buildNumber) {
    throw new ManifestError('malformed', 'Release version does not end with -ota.<buildNumber>');
  }
  if (typeof checksum !== 'string' || !/^[0-9a-f]{512}$/.test(checksum)) {
    throw new ManifestError('malformed', 'Release checksum must be a 256-byte hex value');
  }
  if (typeof sessionKey !== 'string' || !/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(sessionKey)) {
    throw new ManifestError('malformed', 'Release sessionKey is malformed');
  }
  if (
    !Number.isSafeInteger(sizeBytes) ||
    (sizeBytes as number) <= 0 ||
    (sizeBytes as number) > MAX_BUNDLE_BYTES
  ) {
    throw new ManifestError('malformed', 'Release sizeBytes is out of range');
  }
  return {
    version,
    buildNumber: buildNumber as number,
    url,
    checksum,
    sessionKey,
    sizeBytes: sizeBytes as number,
    createdAt,
  };
}

export function parseManifestPayload(raw: unknown, expectedChannel: string): OtaManifest {
  if (!isRecord(raw)) throw new ManifestError('malformed', 'Manifest payload is not an object');
  if (raw.schema !== MANIFEST_SCHEMA) {
    throw new ManifestError('unsupported', `Unsupported manifest schema ${String(raw.schema)}`);
  }
  if (raw.channel !== expectedChannel) {
    throw new ManifestError('channel', `Manifest is for channel "${String(raw.channel)}"`);
  }
  if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1) {
    throw new ManifestError('malformed', 'Manifest sequence must be a positive integer');
  }
  if (typeof raw.generatedAt !== 'string') {
    throw new ManifestError('malformed', 'Manifest generatedAt is missing');
  }
  if (
    typeof raw.latestNativeFingerprint !== 'string' ||
    !FINGERPRINT_PATTERN.test(raw.latestNativeFingerprint)
  ) {
    throw new ManifestError('malformed', 'Manifest latestNativeFingerprint is malformed');
  }
  if (!isRecord(raw.releases)) throw new ManifestError('malformed', 'Manifest releases is missing');
  const releases: Record<string, OtaRelease> = {};
  for (const [fingerprint, release] of Object.entries(raw.releases)) {
    if (!FINGERPRINT_PATTERN.test(fingerprint)) {
      throw new ManifestError('malformed', 'Release key is not a native fingerprint');
    }
    releases[fingerprint] = parseRelease(fingerprint, release);
  }
  return {
    schema: MANIFEST_SCHEMA,
    channel: raw.channel,
    sequence: raw.sequence as number,
    generatedAt: raw.generatedAt,
    latestNativeFingerprint: raw.latestNativeFingerprint,
    releases,
  };
}

/** Verifies the signature first, and only then parses anything inside the payload. */
export async function verifyAndParseManifest(
  envelope: unknown,
  publicKeyPem: string,
  expectedChannel: string,
): Promise<OtaManifest> {
  if (!isRecord(envelope) || envelope.format !== MANIFEST_FORMAT) {
    throw new ManifestError('unsupported', 'Unsupported manifest envelope');
  }
  const { payload, signature } = envelope;
  if (typeof payload !== 'string' || typeof signature !== 'string') {
    throw new ManifestError('malformed', 'Manifest envelope is missing payload or signature');
  }
  let payloadBytes: Uint8Array<ArrayBuffer>;
  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    payloadBytes = base64ToBytes(payload);
    signatureBytes = base64ToBytes(signature);
  } catch {
    throw new ManifestError('malformed', 'Manifest envelope is not valid base64');
  }
  let valid: boolean;
  try {
    valid = await verifyRsaSha256(publicKeyPem, payloadBytes, signatureBytes);
  } catch (error) {
    throw new ManifestError(
      'signature',
      `Manifest signature could not be verified: ${String(error)}`,
    );
  }
  if (!valid) throw new ManifestError('signature', 'Manifest signature is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new ManifestError('malformed', 'Manifest payload is not valid JSON');
  }
  return parseManifestPayload(parsed, expectedChannel);
}

/**
 * Resolves a release URL against the manifest URL and enforces transport
 * rules: https only (http only for local-verification builds) and the same
 * origin as the configured update server.
 */
export function resolveReleaseUrl(
  releaseUrl: string,
  manifestUrl: string,
  options: { allowInsecureHttp: boolean },
): string {
  const resolved = new URL(releaseUrl, manifestUrl);
  const manifest = new URL(manifestUrl);
  const httpsOk = resolved.protocol === 'https:';
  const insecureOk = options.allowInsecureHttp && resolved.protocol === 'http:';
  if (!httpsOk && !insecureOk) throw new ManifestError('malformed', 'Release URL must use https');
  if (resolved.username || resolved.password) {
    throw new ManifestError('malformed', 'Release URL must not embed credentials');
  }
  if (resolved.origin !== manifest.origin) {
    throw new ManifestError('malformed', 'Release URL must be on the update server origin');
  }
  return resolved.toString();
}
