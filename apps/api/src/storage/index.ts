import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import type { FileStorage } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

export * from './file-storage.js';
export { LocalFileStorage } from './local-file-storage.js';

// A relative FILE_STORAGE_DIR (the development default '.data/uploads') is
// resolved against the API package directory, not process.cwd(), so it does
// not depend on where the process happens to be launched from. Production
// requires an explicit absolute path (enforced in config/env.ts).
const API_PACKAGE_DIR = path.resolve(fileURLToPath(import.meta.url), '../../..');

export function resolveFileStorageDir(): string {
  return path.isAbsolute(env.FILE_STORAGE_DIR)
    ? env.FILE_STORAGE_DIR
    : path.resolve(API_PACKAGE_DIR, env.FILE_STORAGE_DIR);
}

let instance: FileStorage | null = null;

export function getFileStorage(): FileStorage {
  // env.FILE_STORAGE_DRIVER is an enum with 'local' as its only member
  // today; the switch is where an 's3' adapter would slot in.
  instance ??= new LocalFileStorage(resolveFileStorageDir());
  return instance;
}

// Fails startup loudly when the configured storage root is unusable,
// instead of deferring the failure to the first upload.
export async function initFileStorage(): Promise<void> {
  const storage = getFileStorage();
  if (storage instanceof LocalFileStorage) {
    await storage.init();
  }
}
