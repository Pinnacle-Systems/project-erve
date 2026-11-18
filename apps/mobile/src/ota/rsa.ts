/**
 * Minimal RSA helpers for verifying the signed release manifest with WebCrypto.
 *
 * The public key is distributed as a PKCS#1 PEM ("BEGIN RSA PUBLIC KEY") because
 * that is what the native updater plugin consumes; WebCrypto only imports SPKI,
 * so the PKCS#1 body is wrapped in the fixed rsaEncryption SubjectPublicKeyInfo
 * header here.
 */

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let remaining = length; remaining > 0; remaining = Math.floor(remaining / 256)) {
    bytes.unshift(remaining % 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

function derWrap(tag: number, content: Uint8Array): Uint8Array {
  return Uint8Array.from([tag, ...derLength(content.length), ...content]);
}

// SEQUENCE { OID rsaEncryption (1.2.840.113549.1.1.1), NULL }
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

export function pkcs1PemToSpki(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN RSA PUBLIC KEY-----/, '')
    .replace(/-----END RSA PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('Empty public key');
  const pkcs1 = base64ToBytes(body);
  const bitString = derWrap(0x03, Uint8Array.from([0x00, ...pkcs1]));
  const spki = derWrap(0x30, Uint8Array.from([...RSA_ALGORITHM_IDENTIFIER, ...bitString]));
  return new Uint8Array(spki);
}

/** RSASSA-PKCS1-v1_5 / SHA-256. Returns false (never throws) for a bad signature. */
export async function verifyRsaSha256(
  publicKeyPem: string,
  data: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is unavailable in this context');
  const key = await subtle.importKey(
    'spki',
    pkcs1PemToSpki(publicKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}
