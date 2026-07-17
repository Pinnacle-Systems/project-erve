import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileNotFoundInStorageError,
  FileStorageError,
  InvalidStorageKeyError,
  StorageKeyConflictError,
  isSafeStorageKey,
} from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';
import { sanitizeDisplayFileName, sniffImage } from './image-sniff.js';

let tempRoot: string;
let storage: LocalFileStorage;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'erve-storage-test-'));
  storage = new LocalFileStorage(tempRoot);
  await storage.init();
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('LocalFileStorage', () => {
  it('stores and reads back a file', async () => {
    const data = Buffer.from('image-bytes');
    await storage.put('style-images/abc/file1.jpg', data);

    expect(await storage.exists('style-images/abc/file1.jpg')).toBe(true);
    expect((await storage.read('style-images/abc/file1.jpg')).equals(data)).toBe(true);
  });

  it('throws FileNotFoundInStorageError when reading a missing key', async () => {
    await expect(storage.read('style-images/missing.jpg')).rejects.toBeInstanceOf(
      FileNotFoundInStorageError,
    );
  });

  it('deletes a stored file and reports an already-missing file as false', async () => {
    await storage.put('style-images/file2.png', Buffer.from('x'));

    expect(await storage.delete('style-images/file2.png')).toBe(true);
    expect(await storage.exists('style-images/file2.png')).toBe(false);
    expect(await storage.delete('style-images/file2.png')).toBe(false);
  });

  it('rejects a second put to the same key instead of overwriting', async () => {
    await storage.put('style-images/file3.jpg', Buffer.from('first'));

    await expect(
      storage.put('style-images/file3.jpg', Buffer.from('second')),
    ).rejects.toBeInstanceOf(StorageKeyConflictError);
    expect((await storage.read('style-images/file3.jpg')).toString()).toBe('first');
  });

  it.each([
    '../outside.jpg',
    'style-images/../../outside.jpg',
    '/absolute.jpg',
    'style-images\\windows.jpg',
    '',
    '.hidden',
    'style-images/..',
  ])('rejects unsafe key %j', async (key) => {
    await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.read(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
  });

  it('never writes outside the storage root', async () => {
    const sibling = path.join(path.dirname(tempRoot), 'erve-storage-test-escape-target');
    await expect(
      storage.put(`../${path.basename(sibling)}/escaped.jpg`, Buffer.from('x')),
    ).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(fs.access(sibling)).rejects.toThrow();
  });

  it('fails init clearly when the configured root is a file', async () => {
    const filePath = path.join(tempRoot, 'not-a-directory');
    await fs.writeFile(filePath, 'x');

    const misconfigured = new LocalFileStorage(filePath);
    await expect(misconfigured.init()).rejects.toBeInstanceOf(FileStorageError);
  });
});

describe('isSafeStorageKey', () => {
  it('accepts server-generated style-image keys', () => {
    expect(isSafeStorageKey('style-images/ck123/ck456.jpg')).toBe(true);
    expect(isSafeStorageKey('style-images/a-b_c.9/x.webp')).toBe(true);
  });

  it('rejects traversal, separators and empty segments', () => {
    expect(isSafeStorageKey('..')).toBe(false);
    expect(isSafeStorageKey('a/../b')).toBe(false);
    expect(isSafeStorageKey('/a')).toBe(false);
    expect(isSafeStorageKey('a//b')).toBe(false);
    expect(isSafeStorageKey('a\\b')).toBe(false);
    expect(isSafeStorageKey('.env')).toBe(false);
  });
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0x11)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.alloc(17, 0x00),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
  Buffer.alloc(16, 0x00),
]);

describe('sniffImage', () => {
  it('detects JPEG, PNG and WebP from their signatures', () => {
    expect(sniffImage(JPEG)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(sniffImage(PNG)).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(sniffImage(WEBP)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rejects empty, truncated and non-image content', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a-not-accepted-format-here'))).toBeNull();
    expect(sniffImage(Buffer.from('just some plain text, definitely not an image'))).toBeNull();
  });

  it('rejects a PNG signature without an IHDR chunk', () => {
    const corrupted = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16, 0xab),
    ]);
    expect(sniffImage(corrupted)).toBeNull();
  });
});

describe('sanitizeDisplayFileName', () => {
  it('strips path components and control characters', () => {
    expect(sanitizeDisplayFileName('C:\\evil\\..\\photo.jpg', 'jpg')).toBe('photo.jpg');
    expect(sanitizeDisplayFileName('/tmp/photo.png', 'png')).toBe('photo.png');
    expect(sanitizeDisplayFileName('pho\x00to.jpg', 'jpg')).toBe('photo.jpg');
  });

  it('falls back to a generated name when nothing safe remains', () => {
    expect(sanitizeDisplayFileName(undefined, 'jpg')).toBe('image.jpg');
    expect(sanitizeDisplayFileName('   ', 'png')).toBe('image.png');
    expect(sanitizeDisplayFileName('..', 'webp')).toBe('image.webp');
  });

  it('caps very long names', () => {
    const longName = `${'a'.repeat(500)}.jpg`;
    expect(sanitizeDisplayFileName(longName, 'jpg').length).toBeLessThanOrEqual(200);
  });
});
