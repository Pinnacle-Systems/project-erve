// Storage abstraction for uploaded files. Business logic (style images
// today) depends only on this interface, never on a concrete path layout or
// vendor SDK, so a future S3-compatible adapter is a drop-in replacement.

export interface FileStorage {
  /**
   * Persist `data` under `key`. Keys are always generated server-side
   * (see safety rules on isSafeStorageKey) and must not already exist —
   * adapters reject collisions instead of overwriting.
   */
  put(key: string, data: Buffer): Promise<void>;
  /** Read the full contents stored under `key`. */
  read(key: string): Promise<Buffer>;
  /**
   * Remove the object stored under `key`. Returns true when something was
   * deleted, false when the object was already missing (never throws for
   * a missing object).
   */
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export class FileStorageError extends Error {}

export class FileNotFoundInStorageError extends FileStorageError {
  constructor(key: string) {
    super(`No stored file for key: ${key}`);
  }
}

export class StorageKeyConflictError extends FileStorageError {
  constructor(key: string) {
    super(`A stored file already exists for key: ${key}`);
  }
}

export class InvalidStorageKeyError extends FileStorageError {
  constructor(key: string) {
    super(`Invalid storage key: ${key}`);
  }
}

// Server-generated keys look like "style-images/<id>.<ext>". Each segment
// must be a plain name (letters/digits/dot/dash/underscore) that is not
// "." or "..", so a key can never escape the storage root, name an
// absolute path, or smuggle separators/reserved characters.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 512 || key.includes('\\')) {
    return false;
  }
  const segments = key.split('/');
  return segments.every(
    (segment) => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..',
  );
}
