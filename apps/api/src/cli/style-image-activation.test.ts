import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import type { CurrentUser } from '../auth/current-user.js';
import { createTestSeason, createTestUser, resetDatabase } from '../test/helpers.js';
import { executeImageActivation, planImageActivation, type ImageActivationManifest } from './style-image-activation.js';
import * as styleImagesService from '../modules/master-data/style-images.service.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.alloc(17, 0x00),
]);
const PNG_SHA256 = createHash('sha256').update(PNG).digest('hex');

let imagesDir: string;

beforeEach(async () => {
  await resetDatabase();
  imagesDir = await mkdtemp(path.join(tmpdir(), 'style-image-activation-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(imagesDir, { recursive: true, force: true });
});

async function actor(): Promise<CurrentUser> {
  const userId = await createTestUser({ email: `activation-${createId()}@test.local`, password: 'password123', roles: ['ADMIN'] });
  return {
    id: userId,
    email: 'actor@test.local',
    mobile: null,
    name: 'Activation Actor',
    status: 'ACTIVE',
    authVersion: 1,
    roles: ['ADMIN'],
    distributorIds: [],
    factoryIds: [],
  };
}

async function createStyle(styleNumber: string) {
  const season = await createTestSeason();
  return prisma.style.create({ data: { id: createId(), styleNumber, styleName: 'x', finalMrp: 1, seasonId: season.id } });
}

describe('planImageActivation', () => {
  it('flags a Style Number with no matching Style as STYLE_NOT_FOUND', async () => {
    await writeFile(path.join(imagesDir, 'a.png'), PNG);
    const manifest: ImageActivationManifest = { records: [{ styleNumber: 'ST-MISSING', imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'STYLE_NOT_FOUND' });
  });

  it('flags a missing file as FILE_MISSING without touching the DB', async () => {
    const style = await createStyle('ST-NOFILE');
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'does-not-exist.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'FILE_MISSING', styleId: style.id });
  });

  it('refuses a file whose actual hash does not match the manifest-approved hash', async () => {
    const style = await createStyle('ST-TAMPERED');
    await writeFile(path.join(imagesDir, 'a.png'), Buffer.concat([PNG, Buffer.from('extra')]));
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'CHECKSUM_MISMATCH' });
  });

  it('plans UPLOAD for a verified image when the Style has none yet', async () => {
    const style = await createStyle('ST-UPLOAD');
    await writeFile(path.join(imagesDir, 'a.png'), PNG);
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'UPLOAD', styleId: style.id });
  });

  it('plans SKIP_ALREADY_PRESENT (idempotent) when an identical image already exists', async () => {
    const style = await createStyle('ST-IDEMPOTENT');
    const user = await actor();
    await styleImagesService.uploadStyleImage(user, style.id, { buffer: PNG, originalName: 'existing.png' });
    await writeFile(path.join(imagesDir, 'a.png'), PNG);
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'SKIP_ALREADY_PRESENT' });
  });

  it('never auto-replaces a conflicting existing image — routes to REVIEW_CONFLICT', async () => {
    const style = await createStyle('ST-CONFLICT');
    const user = await actor();
    const DIFFERENT_PNG = Buffer.concat([PNG, Buffer.alloc(4, 0xff)]);
    await styleImagesService.uploadStyleImage(user, style.id, { buffer: DIFFERENT_PNG, originalName: 'existing.png' });
    await writeFile(path.join(imagesDir, 'a.png'), PNG);
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    expect(plan[0]).toMatchObject({ action: 'REVIEW_CONFLICT' });
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1); // unchanged
  });
});

describe('executeImageActivation', () => {
  it('uploads only UPLOAD-planned rows and is idempotent on re-run', async () => {
    const style = await createStyle('ST-EXECUTE');
    const user = await actor();
    await writeFile(path.join(imagesDir, 'a.png'), PNG);
    const manifest: ImageActivationManifest = { records: [{ styleNumber: style.styleNumber, imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };

    const plan1 = await planImageActivation(manifest, imagesDir);
    const results1 = await executeImageActivation(user, plan1, imagesDir);
    expect(results1[0]!.outcome).toBe('UPLOADED');
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1);

    // Re-running the exact same manifest/images must not duplicate.
    const plan2 = await planImageActivation(manifest, imagesDir);
    const results2 = await executeImageActivation(user, plan2, imagesDir);
    expect(results2[0]!.outcome).toBe('SKIPPED_ALREADY_PRESENT');
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1);
  });

  it('never calls uploadStyleImage for a non-UPLOAD row (STYLE_NOT_FOUND, FILE_MISSING, etc.)', async () => {
    const manifest: ImageActivationManifest = { records: [{ styleNumber: 'ST-GHOST', imageRelativePath: 'a.png', sha256: PNG_SHA256 }] };
    const plan = await planImageActivation(manifest, imagesDir);
    const uploadSpy = vi.spyOn(styleImagesService, 'uploadStyleImage');
    const results = await executeImageActivation(await actor(), plan, imagesDir);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(results[0]!.outcome).toBe('SKIPPED_NOT_UPLOADABLE');
  });
});
