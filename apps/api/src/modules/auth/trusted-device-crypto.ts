import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

/** Version tag that domain-separates what a device signs from anything else it could sign. */
const MESSAGE_VERSION = 'erve-trusted-device/v1';

export type SignedPurpose = 'REGISTRATION' | 'SIGN_IN';

export interface ChallengeMessageInput {
  purpose: SignedPurpose;
  challengeId: string;
  nonce: string;
  userId: string;
  /** `null` while registering: the device does not exist yet. */
  deviceId: string | null;
}

/**
 * The exact text the device signs. It is rebuilt on the server from the stored
 * challenge, never taken from the client, and binds the signature to the
 * purpose, this one challenge, the account and (for sign-in) the device.
 */
export function buildChallengeMessage(input: ChallengeMessageInput): string {
  return [
    MESSAGE_VERSION,
    `purpose:${input.purpose}`,
    `challenge:${input.challengeId}`,
    `nonce:${input.nonce}`,
    `user:${input.userId}`,
    `device:${input.deviceId ?? '-'}`,
  ].join('\n');
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeBase64(value: string): Buffer | null {
  if (!BASE64.test(value) || value.length % 4 !== 0) return null;
  return Buffer.from(value, 'base64');
}

export interface ParsedPublicKey {
  key: KeyObject;
  /** Canonical SPKI DER, base64. */
  spki: string;
  /** SHA-256 of the SPKI DER, lowercase hex. */
  fingerprint: string;
}

/**
 * Accepts only an EC P-256 public key in SPKI DER form (what Android's
 * Keystore exports). Anything else, including RSA or other curves, is rejected
 * so the server never verifies against an unexpected algorithm.
 */
export function parseDevicePublicKey(base64: string): ParsedPublicKey | null {
  const der = decodeBase64(base64);
  if (!der || der.length === 0 || der.length > 512) return null;
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return null;
    }
    const spki = key.export({ format: 'der', type: 'spki' });
    return {
      key,
      spki: spki.toString('base64'),
      fingerprint: createHash('sha256').update(spki).digest('hex'),
    };
  } catch {
    return null;
  }
}

/** Verifies an ECDSA-SHA256 signature in the DER form Android's `SHA256withECDSA` produces. */
export function verifyDeviceSignature(
  publicKey: KeyObject,
  message: string,
  signatureBase64: string,
): boolean {
  const signature = decodeBase64(signatureBase64);
  if (!signature || signature.length === 0 || signature.length > 80) return false;
  try {
    return verify('sha256', Buffer.from(message, 'utf8'), { key: publicKey, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}
