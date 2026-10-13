import { createHash } from 'node:crypto';
import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../errors/http-error.js';
import { FileNotFoundInStorageError, getFileStorage } from '../../storage/index.js';
import {
  sanitizeDisplayFileName,
  sniffImage,
  type SniffedImage,
} from '../../storage/image-sniff.js';

const styleImageInclude = { file: true } satisfies Prisma.StyleImageInclude;
type StyleImageRecord = Prisma.StyleImageGetPayload<{ include: typeof styleImageInclude }>;

const styleImageOrder = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.StyleImageOrderByWithRelationInput[];

export interface StyleImageUpload {
  buffer: Buffer;
  originalName?: string;
}

export function toStyleImageView(image: StyleImageRecord) {
  return {
    id: image.id,
    styleId: image.styleId,
    fileId: image.fileId,
    fileName: image.file.fileName,
    mimeType: image.file.mimeType,
    sizeBytes: image.file.sizeBytes,
    isPrimary: image.isPrimary,
    sortOrder: image.sortOrder,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}

// Shared across every Style-bearing projection outside the Style master
// itself (PO/JO lines, Style lookup options) — the primary (or, if none
// flagged, first-by-sortOrder) image only, never the full gallery; those
// belong to the Style master (SM-000 PR3 coverage matrix).
export const stylePrimaryImageInclude = {
  include: { file: true },
  orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  take: 1,
} satisfies Prisma.StyleImageFindManyArgs;

/** `toStyleImageView` + the Date->ISO-string conversion every `@erve/types` view interface expects at the HTTP boundary. */
export function toPrimaryImageView(images: StyleImageRecord[]) {
  if (!images[0]) return null;
  const image = toStyleImageView(images[0]);
  return { ...image, createdAt: image.createdAt.toISOString(), updatedAt: image.updatedAt.toISOString() };
}

export interface ResolvedPrimaryStyle {
  id: string;
  styleNumber: string;
  styleName: string;
  primaryImage: ReturnType<typeof toPrimaryImageView>;
}

export type PrimaryStyleAcrossLinesResult =
  | { consistent: true; style: ResolvedPrimaryStyle }
  | { consistent: false };

/**
 * Server-side mirror of apps/web's resolveJobOrderPrimaryStyle.ts. A Job
 * Order is exactly one Style — server-enforced on create and on adding a
 * source Order Sheet (see "must share one Style" in job-orders.service.ts).
 * Lines legitimately differ by Size/allocation, never by Style; this is a
 * defensive check against corrupted/legacy data, not a "Job Orders can have
 * several Styles" case — `consistent: false` must surface as an explicit
 * "identity unavailable" state downstream, never nothing and never a guess
 * at one line's Style/image. Used by views that synthesize a single
 * resolved Style identity server-side (e.g. QualityExecutionView, which has
 * no reason to carry raw per-line data to the client at all) rather than
 * shipping raw `lines[]` for the client to resolve itself (as JobOrderDetail
 * already does).
 */
export function resolvePrimaryStyleAcrossLines(
  lines: Array<{ styleId: string; style: { id: string; styleNumber: string; styleName: string; images: StyleImageRecord[] } }>,
): PrimaryStyleAcrossLinesResult {
  const first = lines[0];
  if (!first) return { consistent: false };
  if (!lines.every((line) => line.styleId === first.styleId)) return { consistent: false };
  return {
    consistent: true,
    style: {
      id: first.style.id,
      styleNumber: first.style.styleNumber,
      styleName: first.style.styleName,
      primaryImage: toPrimaryImageView(first.style.images),
    },
  };
}

export function validateImageUpload(buffer: Buffer): SniffedImage {
  if (buffer.length === 0) {
    throw HttpError.badRequest('Uploaded file is empty');
  }
  if (buffer.length > env.UPLOAD_MAX_IMAGE_BYTES) {
    throw new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Image exceeds the maximum allowed size of ${env.UPLOAD_MAX_IMAGE_BYTES} bytes`,
    );
  }
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    throw HttpError.badRequest(
      'Unsupported or corrupted image file — only JPEG, PNG and WebP images are accepted',
    );
  }
  return sniffed;
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function deleteFromStorageBestEffort(storageKey: string): Promise<void> {
  try {
    await getFileStorage().delete(storageKey);
  } catch (error) {
    // Database state is authoritative; an orphaned file in storage is
    // harmless (never referenced, never served) and only wastes space, so
    // cleanup failures are logged rather than surfaced to the client.
    console.error(`Failed to clean up stored file ${storageKey}:`, error);
  }
}

// Serializes all image mutations for one style, matching the advisory-lock
// convention used for process flows. Prevents two concurrent first uploads
// from both becoming primary, and keeps sortOrder assignment race-free.
async function acquireStyleImagesLock(tx: Prisma.TransactionClient, styleId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('style_images:' || ${styleId}, 0))::text`;
}

async function requireStyle(styleId: string): Promise<void> {
  const style = await prisma.style.findUnique({ where: { id: styleId }, select: { id: true } });
  if (!style) {
    throw HttpError.notFound('Style not found');
  }
}

export interface StagedStyleImage {
  fileId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/** Stage bytes before a logical create and verify the bytes storage actually retained. */
export async function stageStyleImage(upload: StyleImageUpload, styleId = 'staged'): Promise<StagedStyleImage> {
  const sniffed = validateImageUpload(upload.buffer);
  const fileId = createId();
  const staged = {
    fileId, storageKey: `style-images/${styleId}/${fileId}.${sniffed.extension}`,
    fileName: sanitizeDisplayFileName(upload.originalName, sniffed.extension),
    mimeType: sniffed.mimeType, sizeBytes: upload.buffer.length, checksum: sha256Hex(upload.buffer),
  };
  try {
    await getFileStorage().put(staged.storageKey, upload.buffer);
    await verifyStagedStyleImage(staged);
    return staged;
  } catch (error) {
    await discardStagedStyleImage(staged);
    throw error;
  }
}

export async function verifyStagedStyleImage(staged: StagedStyleImage): Promise<void> {
  const bytes = await getFileStorage().read(staged.storageKey);
  if (bytes.length !== staged.sizeBytes || sha256Hex(bytes) !== staged.checksum) {
    throw HttpError.badRequest('Stored image checksum does not match the expected image');
  }
}

export async function discardStagedStyleImage(staged: StagedStyleImage): Promise<void> {
  await deleteFromStorageBestEffort(staged.storageKey);
}

/** Same image locking, deduplication and auditing for manual and atomic import writes. */
export async function attachStagedStyleImage(
  actor: CurrentUser, tx: Prisma.TransactionClient, styleId: string, staged: StagedStyleImage,
) {
  await acquireStyleImagesLock(tx, styleId);
  await verifyStagedStyleImage(staged);
  const duplicate = await tx.styleImage.findFirst({
    where: { styleId, file: { checksumSha256: staged.checksum, sizeBytes: staged.sizeBytes } },
    include: styleImageInclude,
  });
  if (duplicate) {
    // Verify/repair retained bytes too: metadata alone cannot establish image completion.
    try {
      const bytes = await getFileStorage().read(duplicate.file.storageKey);
      if (bytes.length === staged.sizeBytes && sha256Hex(bytes) === staged.checksum) return { image: duplicate, created: false };
    } catch (error) {
      if (!(error instanceof FileNotFoundInStorageError)) throw error;
    }
    // Missing or corrupted — repoint at the freshly staged bytes and
    // remove the stale blob so a corrupted copy never lingers in storage.
    await getFileStorage().delete(duplicate.file.storageKey);
    await tx.file.update({ where: { id: duplicate.fileId }, data: { storageKey: staged.storageKey } });
    return { image: duplicate, created: true };
  }
  const [maxSort, primaryCount] = await Promise.all([
    tx.styleImage.aggregate({ where: { styleId }, _max: { sortOrder: true } }),
    tx.styleImage.count({ where: { styleId, isPrimary: true } }),
  ]);
  const image = await tx.styleImage.create({
    data: {
      id: createId(), style: { connect: { id: styleId } },
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1, isPrimary: primaryCount === 0,
      file: { create: { id: staged.fileId, fileName: staged.fileName, mimeType: staged.mimeType,
        sizeBytes: staged.sizeBytes, storageKey: staged.storageKey, checksumSha256: staged.checksum, uploadedById: actor.id } },
    }, include: styleImageInclude,
  });
  await recordAuditLog({ actorId: actor.id, action: 'STYLE_IMAGE_UPLOADED', entityType: 'Style', entityId: styleId,
    metadata: { imageId: image.id, fileId: staged.fileId, fileName: staged.fileName, mimeType: staged.mimeType,
      sizeBytes: staged.sizeBytes, storageKey: staged.storageKey, isPrimary: image.isPrimary } }, tx);
  return { image, created: true };
}

export async function listStyleImages(styleId: string) {
  await requireStyle(styleId);
  const images = await prisma.styleImage.findMany({
    where: { styleId },
    include: styleImageInclude,
    orderBy: styleImageOrder,
  });
  return images.map(toStyleImageView);
}

export async function uploadStyleImage(
  actor: CurrentUser,
  styleId: string,
  upload: StyleImageUpload,
) {
  await requireStyle(styleId);
  const staged = await stageStyleImage(upload, styleId);
  let outcome: { image: StyleImageRecord; created: boolean };
  try {
    outcome = await prisma.$transaction((tx) => attachStagedStyleImage(actor, tx, styleId, staged));
  } catch (error) {
    await discardStagedStyleImage(staged);
    throw error;
  }
  if (!outcome.created) await discardStagedStyleImage(staged);
  return { image: toStyleImageView(outcome.image), created: outcome.created };
}

export async function getStyleImageContent(styleId: string, imageId: string) {
  const image = await prisma.styleImage.findFirst({
    where: { id: imageId, styleId },
    include: styleImageInclude,
  });
  if (!image) {
    throw HttpError.notFound('Style image not found');
  }

  let data: Buffer;
  try {
    data = await getFileStorage().read(image.file.storageKey);
  } catch (error) {
    if (error instanceof FileNotFoundInStorageError) {
      // Metadata without a stored file (e.g. a restored database without a
      // matching uploads restore) — a clear 404 rather than a 500.
      throw HttpError.notFound('The stored image file is missing');
    }
    throw error;
  }

  return {
    data,
    mimeType: image.file.mimeType,
    fileName: image.file.fileName,
    // The storage key changes on every replace, so it doubles as a strong
    // cache validator for the current content.
    etag: `"${image.file.storageKey}"`,
  };
}

export async function replaceStyleImage(
  actor: CurrentUser,
  styleId: string,
  imageId: string,
  upload: StyleImageUpload,
) {
  const existing = await prisma.styleImage.findFirst({
    where: { id: imageId, styleId },
    include: styleImageInclude,
  });
  if (!existing) {
    throw HttpError.notFound('Style image not found');
  }

  const sniffed = validateImageUpload(upload.buffer);
  const checksum = sha256Hex(upload.buffer);
  const fileName = sanitizeDisplayFileName(upload.originalName, sniffed.extension);

  // Replacing with identical content is a no-op (idempotent retry).
  if (
    existing.file.checksumSha256 === checksum &&
    existing.file.sizeBytes === upload.buffer.length
  ) {
    return toStyleImageView(existing);
  }

  const previousStorageKey = existing.file.storageKey;
  const newStorageKey = `style-images/${styleId}/${createId()}.${sniffed.extension}`;
  const storage = getFileStorage();

  await storage.put(newStorageKey, upload.buffer);

  let updated: StyleImageRecord;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await acquireStyleImagesLock(tx, styleId);

      const current = await tx.styleImage.findFirst({
        where: { id: imageId, styleId },
        select: { fileId: true },
      });
      if (!current) {
        throw HttpError.notFound('Style image not found');
      }

      await tx.file.update({
        where: { id: current.fileId },
        data: {
          fileName,
          mimeType: sniffed.mimeType,
          sizeBytes: upload.buffer.length,
          storageKey: newStorageKey,
          checksumSha256: checksum,
          uploadedById: actor.id,
        },
      });

      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'STYLE_IMAGE_REPLACED',
          entityType: 'Style',
          entityId: styleId,
          metadata: {
            imageId,
            fileId: current.fileId,
            fileName,
            mimeType: sniffed.mimeType,
            sizeBytes: upload.buffer.length,
            storageKey: newStorageKey,
            previousStorageKey,
          },
        },
        tx,
      );

      const refreshed = await tx.styleImage.findUniqueOrThrow({
        where: { id: imageId },
        include: styleImageInclude,
      });
      return refreshed;
    });
  } catch (error) {
    // The replacement never became visible — the existing image stays intact.
    await deleteFromStorageBestEffort(newStorageKey);
    throw error;
  }

  // Only after the replacement is committed does the old file become
  // unreferenced and safe to remove.
  if (previousStorageKey !== newStorageKey) {
    await deleteFromStorageBestEffort(previousStorageKey);
  }

  return toStyleImageView(updated);
}

export async function removeStyleImage(actor: CurrentUser, styleId: string, imageId: string) {
  // Database metadata is authoritative for deletion: once the transaction
  // commits the image is gone for every reader, and the stored file is
  // removed best-effort afterwards (an already-missing file is fine).
  const storageKey = await prisma.$transaction(async (tx) => {
    await acquireStyleImagesLock(tx, styleId);

    const image = await tx.styleImage.findFirst({
      where: { id: imageId, styleId },
      include: styleImageInclude,
    });
    if (!image) {
      throw HttpError.notFound('Style image not found');
    }

    await tx.styleImage.delete({ where: { id: imageId } });

    // Files are never shared between style images in this domain, but the
    // schema does not forbid it — only delete the file row when this was
    // its last reference.
    const remainingReferences = await tx.styleImage.count({ where: { fileId: image.fileId } });
    if (remainingReferences === 0) {
      await tx.file.delete({ where: { id: image.fileId } });
    }

    if (image.isPrimary) {
      const nextPrimary = await tx.styleImage.findFirst({
        where: { styleId },
        orderBy: styleImageOrder,
        select: { id: true },
      });
      if (nextPrimary) {
        await tx.styleImage.update({ where: { id: nextPrimary.id }, data: { isPrimary: true } });
      }
    }

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'STYLE_IMAGE_REMOVED',
        entityType: 'Style',
        entityId: styleId,
        metadata: {
          imageId,
          fileId: image.fileId,
          fileName: image.file.fileName,
          mimeType: image.file.mimeType,
          sizeBytes: image.file.sizeBytes,
          storageKey: image.file.storageKey,
          wasPrimary: image.isPrimary,
        },
      },
      tx,
    );

    return remainingReferences === 0 ? image.file.storageKey : null;
  });

  if (storageKey) {
    await deleteFromStorageBestEffort(storageKey);
  }

  return listStyleImages(styleId);
}

export async function setPrimaryStyleImage(actor: CurrentUser, styleId: string, imageId: string) {
  await prisma.$transaction(async (tx) => {
    await acquireStyleImagesLock(tx, styleId);

    const image = await tx.styleImage.findFirst({
      where: { id: imageId, styleId },
      select: { id: true, isPrimary: true },
    });
    if (!image) {
      throw HttpError.notFound('Style image not found');
    }
    if (image.isPrimary) {
      return;
    }

    const previousPrimary = await tx.styleImage.findFirst({
      where: { styleId, isPrimary: true },
      select: { id: true },
    });

    await tx.styleImage.updateMany({
      where: { styleId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.styleImage.update({ where: { id: imageId }, data: { isPrimary: true } });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'STYLE_PRIMARY_IMAGE_CHANGED',
        entityType: 'Style',
        entityId: styleId,
        metadata: { imageId, previousPrimaryImageId: previousPrimary?.id ?? null },
      },
      tx,
    );
  });

  return listStyleImages(styleId);
}
