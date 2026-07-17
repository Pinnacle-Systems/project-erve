import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  FileNotFoundInStorageError,
  FileStorageError,
  InvalidStorageKeyError,
  StorageKeyConflictError,
  isSafeStorageKey,
  type FileStorage,
} from './file-storage.js';

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

// Local-filesystem adapter. The root directory must live outside versioned
// release directories (production: <DEPLOY_ROOT>/shared/uploads) so
// deployments and release cleanup can never delete uploads.
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  get rootDir(): string {
    return this.root;
  }

  // Validates the configured root is usable, creating it if needed. Called
  // once at API startup so a misconfigured storage root fails the boot
  // loudly instead of failing the first upload at runtime.
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.root, { recursive: true });
    } catch (error) {
      throw new FileStorageError(
        `File storage root is not usable (${this.root}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const stats = await fs.stat(this.root);
    if (!stats.isDirectory()) {
      throw new FileStorageError(`File storage root is not a directory: ${this.root}`);
    }
  }

  private resolveKey(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new InvalidStorageKeyError(key);
    }
    const resolved = path.resolve(this.root, key);
    // isSafeStorageKey already forbids traversal; this is a final defensive
    // invariant so no future key format change can escape the root.
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new InvalidStorageKeyError(key);
    }
    return resolved;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      // 'wx' fails if the file already exists — server-generated keys are
      // unique, so a collision is always a bug or a replay, never something
      // to silently overwrite.
      await fs.writeFile(target, data, { flag: 'wx' });
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw new StorageKeyConflictError(key);
      }
      throw error;
    }
  }

  async read(key: string): Promise<Buffer> {
    const target = this.resolveKey(key);
    try {
      return await fs.readFile(target);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw new FileNotFoundInStorageError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    const target = this.resolveKey(key);
    try {
      await fs.unlink(target);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolveKey(key);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
