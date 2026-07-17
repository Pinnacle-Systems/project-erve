import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { getFileStorage, resolveFileStorageDir } from '../../storage/index.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x11)]);
const JPEG_ALT = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x22)]);
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

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAdminToken() {
  const { token } = await createTestUserAndToken({
    email: `admin-${createId()}@test.local`,
    password: 'admin-password',
    roles: ['ADMIN'],
  });
  return token;
}

async function createStyleRecord() {
  return prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-${createId()}`,
      styleName: 'Image Test Style',
      finalMrp: 100,
    },
  });
}

function upload(
  token: string,
  styleId: string,
  data: Buffer,
  filename = 'photo.jpg',
  contentType = 'image/jpeg',
) {
  return request(app)
    .post(`/styles/${styleId}/images`)
    .set('Authorization', `Bearer ${token}`)
    .attach('image', data, { filename, contentType });
}

function storedPath(storageKey: string): string {
  return path.join(resolveFileStorageDir(), ...storageKey.split('/'));
}

async function storedFileExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(storedPath(storageKey));
    return true;
  } catch {
    return false;
  }
}

describe('style images API', () => {
  it('uploads a JPEG and persists metadata, checksum and the stored file', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const res = await upload(token, style.id, JPEG, 'front view.jpg');

    expect(res.status).toBe(201);
    expect(res.body.data.mimeType).toBe('image/jpeg');
    expect(res.body.data.fileName).toBe('front view.jpg');
    expect(res.body.data.sizeBytes).toBe(JPEG.length);
    expect(res.body.data.isPrimary).toBe(true);
    expect(res.body.data.sortOrder).toBe(0);

    const file = await prisma.file.findUniqueOrThrow({ where: { id: res.body.data.fileId } });
    expect(file.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.storageKey).toMatch(new RegExp(`^style-images/${style.id}/[A-Za-z0-9._-]+\\.jpg$`));
    expect(await storedFileExists(file.storageKey)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'STYLE_IMAGE_UPLOADED' } });
    expect(audit?.entityId).toBe(style.id);
    expect(audit?.metadata).toMatchObject({
      imageId: res.body.data.id,
      fileName: 'front view.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG.length,
    });
  });

  it('uploads PNG and WebP images', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const pngRes = await upload(token, style.id, PNG, 'a.png', 'image/png');
    const webpRes = await upload(token, style.id, WEBP, 'b.webp', 'image/webp');

    expect(pngRes.status).toBe(201);
    expect(pngRes.body.data.mimeType).toBe('image/png');
    expect(webpRes.status).toBe(201);
    expect(webpRes.body.data.mimeType).toBe('image/webp');
    // Second image never silently becomes primary.
    expect(pngRes.body.data.isPrimary).toBe(true);
    expect(webpRes.body.data.isPrimary).toBe(false);
    expect(webpRes.body.data.sortOrder).toBe(1);
  });

  it('rejects unsupported formats even when the claimed MIME type is an accepted image type', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const gif = Buffer.from('GIF89a-this-is-not-an-accepted-format');
    const fakeMime = await upload(token, style.id, gif, 'fake.png', 'image/png');
    expect(fakeMime.status).toBe(400);

    const text = await upload(
      token,
      style.id,
      Buffer.from('plain text pretending to be an image'),
      'notes.jpg',
      'image/jpeg',
    );
    expect(text.status).toBe(400);

    expect(await prisma.styleImage.count()).toBe(0);
    expect(await prisma.file.count()).toBe(0);
  });

  it('rejects an empty file', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const res = await upload(token, style.id, Buffer.alloc(0), 'empty.jpg');
    expect(res.status).toBe(400);
  });

  it('rejects an oversized file with 413', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const oversized = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024, 0x11)]);
    const res = await upload(token, style.id, oversized, 'big.jpg');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await prisma.styleImage.count()).toBe(0);
  });

  it('rejects a missing multipart file field', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const res = await request(app)
      .post(`/styles/${style.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('note', 'no file attached');

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown style', async () => {
    const token = await createAdminToken();
    const res = await upload(token, createId(), JPEG);
    expect(res.status).toBe(404);
  });

  it('enforces RBAC: manage roles can upload, view-only roles can read, others get 403', async () => {
    const style = await createStyleRecord();
    const { token: merchandiser } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'x-password',
      roles: ['MERCHANDISER'],
    });
    const { token: seniorManagement } = await createTestUserAndToken({
      email: 'sm@test.local',
      password: 'x-password',
      roles: ['SENIOR_MANAGEMENT'],
    });
    const { token: factoryUser } = await createTestUserAndToken({
      email: 'factory@test.local',
      password: 'x-password',
      roles: ['FACTORY_USER'],
    });
    const { token: distributor } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'x-password',
      roles: ['DISTRIBUTOR'],
    });

    const uploaded = await upload(merchandiser, style.id, JPEG);
    expect(uploaded.status).toBe(201);
    const imageId = uploaded.body.data.id as string;

    // SENIOR_MANAGEMENT can view metadata and content but cannot manage.
    const list = await request(app)
      .get(`/styles/${style.id}/images`)
      .set('Authorization', `Bearer ${seniorManagement}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const content = await request(app)
      .get(`/styles/${style.id}/images/${imageId}/content`)
      .set('Authorization', `Bearer ${seniorManagement}`);
    expect(content.status).toBe(200);
    const smUpload = await upload(seniorManagement, style.id, JPEG_ALT);
    expect(smUpload.status).toBe(403);
    const smDelete = await request(app)
      .delete(`/styles/${style.id}/images/${imageId}`)
      .set('Authorization', `Bearer ${seniorManagement}`);
    expect(smDelete.status).toBe(403);

    // Factory and distributor users gain no style-image access at all.
    for (const token of [factoryUser, distributor]) {
      expect((await upload(token, style.id, JPEG_ALT)).status).toBe(403);
      const forbiddenContent = await request(app)
        .get(`/styles/${style.id}/images/${imageId}/content`)
        .set('Authorization', `Bearer ${token}`);
      expect(forbiddenContent.status).toBe(403);
    }

    // Unauthenticated requests are rejected outright.
    expect((await request(app).get(`/styles/${style.id}/images`)).status).toBe(401);
  });

  it('serves image content with the detected content type and a working ETag', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const uploaded = await upload(token, style.id, PNG, 'shot.png', 'image/png');

    const res = await request(app)
      .get(`/styles/${style.id}/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
    expect(res.headers.etag).toBeTruthy();

    const cached = await request(app)
      .get(`/styles/${style.id}/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', res.headers.etag!);
    expect(cached.status).toBe(304);
  });

  it('answers a retried upload of identical content with the existing image instead of a duplicate', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const first = await upload(token, style.id, JPEG);
    const retry = await upload(token, style.id, JPEG, 'renamed-retry.jpg');

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1);
    expect(await prisma.file.count()).toBe(1);
  });

  it('replaces an image atomically and removes the previous stored file', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const uploaded = await upload(token, style.id, JPEG);
    const originalFile = await prisma.file.findUniqueOrThrow({
      where: { id: uploaded.body.data.fileId },
    });

    const replaced = await request(app)
      .put(`/styles/${style.id}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'replacement.png', contentType: 'image/png' });

    expect(replaced.status).toBe(200);
    expect(replaced.body.data.id).toBe(uploaded.body.data.id);
    expect(replaced.body.data.mimeType).toBe('image/png');
    expect(replaced.body.data.fileName).toBe('replacement.png');

    const updatedFile = await prisma.file.findUniqueOrThrow({ where: { id: originalFile.id } });
    expect(updatedFile.storageKey).not.toBe(originalFile.storageKey);
    expect(await storedFileExists(originalFile.storageKey)).toBe(false);
    expect(await storedFileExists(updatedFile.storageKey)).toBe(true);

    const content = await request(app)
      .get(`/styles/${style.id}/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(content.headers['content-type']).toBe('image/png');
    expect(Buffer.from(content.body).equals(PNG)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'STYLE_IMAGE_REPLACED' } });
    expect(audit?.entityId).toBe(style.id);
  });

  it('keeps the existing image when a replacement fails validation', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const uploaded = await upload(token, style.id, JPEG);
    const originalFile = await prisma.file.findUniqueOrThrow({
      where: { id: uploaded.body.data.fileId },
    });

    const replaced = await request(app)
      .put(`/styles/${style.id}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not an image at all, sorry'), {
        filename: 'broken.png',
        contentType: 'image/png',
      });

    expect(replaced.status).toBe(400);
    const untouched = await prisma.file.findUniqueOrThrow({ where: { id: originalFile.id } });
    expect(untouched.storageKey).toBe(originalFile.storageKey);
    expect(await storedFileExists(originalFile.storageKey)).toBe(true);

    const content = await request(app)
      .get(`/styles/${style.id}/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(content.status).toBe(200);
    expect(Buffer.from(content.body).equals(JPEG)).toBe(true);
  });

  it('deletes an image, promotes the next primary and cleans up storage', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const first = await upload(token, style.id, JPEG);
    const second = await upload(token, style.id, JPEG_ALT, 'second.jpg');
    const firstFile = await prisma.file.findUniqueOrThrow({
      where: { id: first.body.data.fileId },
    });

    const res = await request(app)
      .delete(`/styles/${style.id}/images/${first.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(second.body.data.id);
    expect(res.body.data[0].isPrimary).toBe(true);

    expect(await prisma.styleImage.count({ where: { id: first.body.data.id } })).toBe(0);
    expect(await prisma.file.count({ where: { id: firstFile.id } })).toBe(0);
    expect(await storedFileExists(firstFile.storageKey)).toBe(false);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'STYLE_IMAGE_REMOVED' } });
    expect(audit?.entityId).toBe(style.id);
    expect(audit?.metadata).toMatchObject({ imageId: first.body.data.id, wasPrimary: true });
  });

  it('changes the primary image and records the audit event', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const first = await upload(token, style.id, JPEG);
    const second = await upload(token, style.id, JPEG_ALT, 'second.jpg');

    const res = await request(app)
      .patch(`/styles/${style.id}/images/${second.body.data.id}/primary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const byId = new Map(res.body.data.map((image: { id: string }) => [image.id, image]));
    expect((byId.get(first.body.data.id) as { isPrimary: boolean }).isPrimary).toBe(false);
    expect((byId.get(second.body.data.id) as { isPrimary: boolean }).isPrimary).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'STYLE_PRIMARY_IMAGE_CHANGED' },
    });
    expect(audit?.metadata).toMatchObject({
      imageId: second.body.data.id,
      previousPrimaryImageId: first.body.data.id,
    });
  });

  it('returns 404 image content when the stored file has gone missing', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const uploaded = await upload(token, style.id, JPEG);
    const file = await prisma.file.findUniqueOrThrow({ where: { id: uploaded.body.data.fileId } });

    await fs.rm(storedPath(file.storageKey));

    const res = await request(app)
      .get(`/styles/${style.id}/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);

    // Deleting the image whose stored file is already gone still succeeds.
    const removed = await request(app)
      .delete(`/styles/${style.id}/images/${uploaded.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toHaveLength(0);
  });

  it('includes images in the style detail view', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    await upload(token, style.id, JPEG);

    const res = await request(app)
      .get(`/styles/${style.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(1);
    expect(res.body.data.images[0].isPrimary).toBe(true);
    expect(res.body.data.images[0].mimeType).toBe('image/jpeg');
  });
});

const JPEG_THIRD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x33)]);

async function listStoredFiles(styleId: string): Promise<string[]> {
  const dir = path.join(resolveFileStorageDir(), 'style-images', styleId);
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

describe('duplicate-upload storage cleanup', () => {
  it('sequential duplicate upload leaves one DB record, one physical file and one audit event', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const first = await upload(token, style.id, JPEG, 'original.jpg');
    const retry = await upload(token, style.id, JPEG, 'retried.jpg');

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);

    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1);
    expect(await prisma.file.count()).toBe(1);

    // The losing request's freshly written copy must not survive on disk.
    const stored = await listStoredFiles(style.id);
    expect(stored).toHaveLength(1);
    const file = await prisma.file.findFirstOrThrow();
    expect(file.storageKey.endsWith(stored[0]!)).toBe(true);
    expect((await fs.readFile(storedPath(file.storageKey))).equals(JPEG)).toBe(true);

    // A no-op duplicate retry is deliberately not audited as a second upload.
    expect(await prisma.auditLog.count({ where: { action: 'STYLE_IMAGE_UPLOADED' } })).toBe(1);
  });

  it('concurrent identical uploads leave one DB record and one physical file', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();

    const [a, b] = await Promise.all([
      upload(token, style.id, JPEG, 'race-a.jpg'),
      upload(token, style.id, JPEG, 'race-b.jpg'),
    ]);

    // Exactly one request created the image (201); the other was answered
    // with the existing record (200). Both return the same image.
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);

    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(1);
    expect(await prisma.file.count()).toBe(1);

    const stored = await listStoredFiles(style.id);
    expect(stored).toHaveLength(1);
    const file = await prisma.file.findFirstOrThrow();
    expect(file.storageKey.endsWith(stored[0]!)).toBe(true);
    // The surviving file is the referenced one and remains byte-identical.
    expect((await fs.readFile(storedPath(file.storageKey))).equals(JPEG)).toBe(true);

    expect(await prisma.auditLog.count({ where: { action: 'STYLE_IMAGE_UPLOADED' } })).toBe(1);
  });

  it('logs a cleanup failure instead of silently leaking the duplicate file', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    await upload(token, style.id, JPEG);

    const storage = getFileStorage();
    const deleteSpy = vi
      .spyOn(storage, 'delete')
      .mockRejectedValueOnce(new Error('simulated storage failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // The duplicate is still answered successfully — cleanup is
      // best-effort — but the failure must leave an operational trace.
      const retry = await upload(token, style.id, JPEG, 'retry.jpg');
      expect(retry.status).toBe(200);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up stored file'),
        expect.any(Error),
      );
    } finally {
      deleteSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('one-primary-image database invariant', () => {
  async function insertImageDirectly(styleId: string, isPrimary: boolean, sortOrder: number) {
    return prisma.styleImage.create({
      data: {
        id: createId(),
        style: { connect: { id: styleId } },
        sortOrder,
        isPrimary,
        file: {
          create: {
            id: createId(),
            fileName: 'direct.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 10,
            storageKey: `style-images/${styleId}/${createId()}.jpg`,
          },
        },
      },
    });
  }

  it('rejects a direct database insert of a second primary image for the same style', async () => {
    const style = await createStyleRecord();
    await insertImageDirectly(style.id, true, 0);

    await expect(insertImageDirectly(style.id, true, 1)).rejects.toThrow();
    // A non-primary image is still fine.
    await expect(insertImageDirectly(style.id, false, 1)).resolves.toBeTruthy();
    expect(await prisma.styleImage.count({ where: { styleId: style.id, isPrimary: true } })).toBe(
      1,
    );
  });

  it('allows different styles to each have their own primary image', async () => {
    const styleA = await createStyleRecord();
    const styleB = await createStyleRecord();

    await expect(insertImageDirectly(styleA.id, true, 0)).resolves.toBeTruthy();
    await expect(insertImageDirectly(styleB.id, true, 0)).resolves.toBeTruthy();
  });

  it('concurrent primary-change requests never produce multiple primary rows', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    await upload(token, style.id, JPEG);
    const second = await upload(token, style.id, JPEG_ALT, 'b.jpg');
    const third = await upload(token, style.id, JPEG_THIRD, 'c.jpg');

    const [a, b] = await Promise.all([
      request(app)
        .patch(`/styles/${style.id}/images/${second.body.data.id}/primary`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .patch(`/styles/${style.id}/images/${third.body.data.id}/primary`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await prisma.styleImage.count({ where: { styleId: style.id, isPrimary: true } })).toBe(
      1,
    );
  });

  it('a failed primary change leaves the previous primary unchanged', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const first = await upload(token, style.id, JPEG);

    const res = await request(app)
      .patch(`/styles/${style.id}/images/${createId()}/primary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    const image = await prisma.styleImage.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    expect(image.isPrimary).toBe(true);
  });

  it('deleting the primary promotes exactly one replacement in deterministic order', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const first = await upload(token, style.id, JPEG);
    const second = await upload(token, style.id, JPEG_ALT, 'b.jpg');
    await upload(token, style.id, JPEG_THIRD, 'c.jpg');
    expect(first.body.data.isPrimary).toBe(true);

    const res = await request(app)
      .delete(`/styles/${style.id}/images/${first.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const primaries = await prisma.styleImage.findMany({
      where: { styleId: style.id, isPrimary: true },
    });
    // Exactly one replacement, and it is the next image by sort order —
    // not the newest, not arbitrary.
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.id).toBe(second.body.data.id);
  });

  it('deleting the last image leaves no primary; uploading again creates exactly one', async () => {
    const token = await createAdminToken();
    const style = await createStyleRecord();
    const first = await upload(token, style.id, JPEG);

    await request(app)
      .delete(`/styles/${style.id}/images/${first.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(0);

    const again = await upload(token, style.id, JPEG_ALT, 'fresh.jpg');
    expect(again.status).toBe(201);
    expect(again.body.data.isPrimary).toBe(true);
    expect(await prisma.styleImage.count({ where: { styleId: style.id, isPrimary: true } })).toBe(
      1,
    );
  });
});
