/**
 * Publisher-side cryptography for OTA bundles and the release manifest.
 *
 * Two independent layers, both anchored to the one RSA-2048 key pair whose
 * PUBLIC half is compiled into the APK (capacitor.config.ts `publicKey`):
 *
 * 1. Bundle layer — the wire format @capgo/capacitor-updater verifies NATIVELY
 *    on the device before it will store a bundle (CryptoCipher.java):
 *      - zip is encrypted with a random AES-128-CBC key / IV (PKCS#7 padding);
 *      - sessionKey = base64(iv) ":" base64(RSA-PKCS1-private-op(aesKey));
 *      - checksum   = hex(RSA-PKCS1-private-op(sha256(plain zip)))  (256 bytes).
 *    The device recovers the AES key and the expected checksum with the PUBLIC
 *    key, so only the private-key holder can produce an installable bundle.
 *    (This gives authenticity + integrity, not confidentiality: the public key
 *    ships in the APK. Do not put secrets in a bundle.)
 *
 * 2. Manifest layer — a detached RSASSA-PKCS1-v1_5/SHA-256 signature over the
 *    exact manifest payload bytes, verified in the app (WebCrypto) before any
 *    field of the manifest is trusted. This is what stops a tampered or
 *    replayed manifest from steering a device to the wrong native fingerprint,
 *    version, or URL.
 *
 * The private key never lives in the repository. See apps/mobile/OTA_UPDATES.md.
 */
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  privateEncrypt,
  publicDecrypt,
  randomBytes,
} from 'node:crypto';

export const RSA_MODULUS_BITS = 2048;
export const MANIFEST_FORMAT = 1;

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: RSA_MODULUS_BITS });
  return {
    publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString().trim(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
  };
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rsaPrivateOp(privateKeyPem, data) {
  return privateEncrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING }, data);
}

function rsaPublicOp(publicKeyPem, data) {
  return publicDecrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, data);
}

/** Verifies the private key really is the pair of `publicKeyPem` (publish pre-flight). */
export function keysMatch(publicKeyPem, privateKeyPem) {
  const probe = randomBytes(16);
  try {
    return rsaPublicOp(publicKeyPem, rsaPrivateOp(privateKeyPem, probe)).equals(probe);
  } catch {
    return false;
  }
}

export function publicKeyFromPrivate(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'pkcs1', format: 'pem' })
    .toString()
    .trim();
}

/** @returns {{ encrypted: Buffer, sessionKey: string, checksum: string, sha256: string }} */
export function encryptBundle(zip, privateKeyPem) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(zip), cipher.final()]);
  const digest = createHash('sha256').update(zip).digest();
  return {
    encrypted,
    sessionKey: `${iv.toString('base64')}:${rsaPrivateOp(privateKeyPem, aesKey).toString('base64')}`,
    checksum: rsaPrivateOp(privateKeyPem, digest).toString('hex'),
    sha256: digest.toString('hex'),
  };
}

/**
 * Mirrors what the device does. Throws on any failure — used by the publish
 * self-check, the standalone verifier and the tests.
 */
export function decryptBundle(encrypted, { sessionKey, checksum }, publicKeyPem) {
  const [ivB64, wrappedKeyB64, ...extra] = sessionKey.split(':');
  if (!ivB64 || !wrappedKeyB64 || extra.length) throw new Error('Malformed sessionKey');
  const iv = Buffer.from(ivB64, 'base64');
  const aesKey = rsaPublicOp(publicKeyPem, Buffer.from(wrappedKeyB64, 'base64'));
  if (iv.length !== 16 || aesKey.length !== 16) throw new Error('Bad session key sizes');
  const decipher = createDecipheriv('aes-128-cbc', aesKey, iv);
  const zip = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const checksumBytes = Buffer.from(checksum, 'hex');
  if (checksumBytes.length !== RSA_MODULUS_BITS / 8)
    throw new Error('Checksum is not RSA-encrypted');
  const expected = rsaPublicOp(publicKeyPem, checksumBytes);
  if (!expected.equals(createHash('sha256').update(zip).digest())) {
    throw new Error('Bundle checksum mismatch');
  }
  return zip;
}

/** Signs the exact serialised payload so verification never depends on key order. */
export function signManifest(payload, privateKeyPem) {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = createSign('RSA-SHA256').update(payloadBytes).sign({
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PADDING,
  });
  return {
    format: MANIFEST_FORMAT,
    payload: payloadBytes.toString('base64'),
    signature: signature.toString('base64'),
  };
}

export function verifyManifestEnvelope(envelope, publicKeyPem) {
  if (!envelope || envelope.format !== MANIFEST_FORMAT)
    throw new Error('Unsupported manifest format');
  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  const ok = createVerify('RSA-SHA256')
    .update(payloadBytes)
    .verify(
      { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(envelope.signature, 'base64'),
    );
  if (!ok) throw new Error('Manifest signature is invalid');
  return JSON.parse(payloadBytes.toString('utf8'));
}
