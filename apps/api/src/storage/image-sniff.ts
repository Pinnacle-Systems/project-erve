// Server-side image format detection from file signatures (magic bytes).
// The browser-provided MIME type is never trusted — the detected type is
// what gets validated, stored, and later served as the Content-Type.

export type AllowedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface SniffedImage {
  mimeType: AllowedImageMimeType;
  extension: 'jpg' | 'png' | 'webp';
}

export const ALLOWED_IMAGE_MIME_TYPES: readonly AllowedImageMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImage(data: Buffer): SniffedImage | null {
  // The longest check below needs 16 bytes; anything shorter cannot be a
  // renderable image in any of the accepted formats.
  if (data.length < 16) {
    return null;
  }

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (
    data.subarray(0, 8).equals(PNG_SIGNATURE) &&
    // The first chunk of a well-formed PNG is always IHDR.
    data.subarray(12, 16).toString('latin1') === 'IHDR'
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(data.subarray(12, 16).toString('latin1'))
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
}

// Reduces a user-provided display filename to a safe, short label for
// storage in metadata and audit logs. Never used to build storage paths —
// storage keys are always server-generated.
export function sanitizeDisplayFileName(
  name: string | undefined,
  fallbackExtension: string,
): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (!base || base === '.' || base === '..') {
    return `image.${fallbackExtension}`;
  }
  return base.length > 200 ? base.slice(base.length - 200) : base;
}
