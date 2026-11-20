/**
 * Verifies a LIVE update server the way a device (and an operator after a
 * deployment) needs it verified: over HTTPS, with certificate validation on
 * (NODE_EXTRA_CA_CERTS adds a private CA for disposable test servers), reading
 * only the public static files.
 *
 * It checks, for one channel:
 *   - the manifest is reachable, its signature verifies against the OTA public
 *     key, and it names the expected channel;
 *   - each release's bundle downloads, matches its signed size and file hash,
 *     decrypts, passes the checksum/signature check and targets the fingerprint
 *     it is listed under;
 *   - caching headers: mutable metadata is revalidated on every request and
 *     bundle files are marked immutable.
 */
import { verifyManifestEnvelope, sha256Hex } from './bundle-crypto.mjs';
import { verifyBundleBuffer } from './release-store.mjs';

const REVALIDATE = /(?:^|,\s*)(?:no-cache|no-store|max-age=0|must-revalidate)\b/i;

async function get(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store' });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

/**
 * @param {object} o
 * @param {string} o.baseUrl        e.g. https://host/mobile-updates/bundles
 * @param {string} o.channel
 * @param {string} o.publicKeyPem
 * @param {string} [o.fingerprint]  verify only this fingerprint's release
 * @param {typeof fetch} [o.fetchImpl]
 * @returns {Promise<{ ok: boolean, problems: string[], manifest: object|null, releases: object }>}
 */
export async function verifyRemoteChannel(o) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, '');
  const problems = [];
  const releases = {};
  const manifestUrl = `${base}/${o.channel}/manifest.json`;
  if (!/^https:\/\//i.test(base)) problems.push('The update server URL is not https.');

  const manifestResponse = await get(manifestUrl, fetchImpl);
  if (manifestResponse.status !== 200) {
    problems.push(`${manifestUrl} returned HTTP ${manifestResponse.status}.`);
    return { ok: false, problems, manifest: null, releases };
  }
  const manifestCache = manifestResponse.headers.get('cache-control') ?? '';
  if (!REVALIDATE.test(manifestCache)) {
    problems.push(
      `manifest.json is cacheable without revalidation (Cache-Control: "${manifestCache}").`,
    );
  }
  let manifest;
  try {
    manifest = verifyManifestEnvelope(
      JSON.parse(manifestResponse.body.toString('utf8')),
      o.publicKeyPem,
    );
  } catch (error) {
    problems.push(`manifest.json failed verification: ${error.message}`);
    return { ok: false, problems, manifest: null, releases };
  }
  if (manifest.channel !== o.channel) {
    problems.push(`manifest.json is for channel "${manifest.channel}", expected "${o.channel}".`);
  }

  for (const [fingerprint, release] of Object.entries(manifest.releases)) {
    if (o.fingerprint && fingerprint !== o.fingerprint) continue;
    const url = new URL(release.url, `${manifestUrl}`).toString();
    const bundle = await get(url, fetchImpl);
    if (bundle.status !== 200) {
      problems.push(`${url} returned HTTP ${bundle.status}.`);
      continue;
    }
    const cache = bundle.headers.get('cache-control') ?? '';
    if (!/\bimmutable\b/i.test(cache)) {
      problems.push(`${release.url} is not served as immutable (Cache-Control: "${cache}").`);
    }
    try {
      if (bundle.body.length !== release.sizeBytes)
        throw new Error('size differs from the signed manifest');
      if (release.fileSha256 && sha256Hex(bundle.body) !== release.fileSha256) {
        throw new Error('file hash differs from the signed manifest');
      }
      const checked = verifyBundleBuffer(bundle.body, release, o.publicKeyPem);
      if (checked.nativeFingerprint !== fingerprint) {
        throw new Error(`bundle targets ${checked.nativeFingerprint}, not ${fingerprint}`);
      }
      releases[fingerprint] = { version: release.version, buildNumber: release.buildNumber };
    } catch (error) {
      problems.push(`${release.url}: ${error.message}`);
    }
  }
  if (o.fingerprint && !manifest.releases[o.fingerprint]) {
    problems.push(`${o.channel} has no release for native ${o.fingerprint}.`);
  }
  return { ok: problems.length === 0, problems, manifest, releases };
}
