import { createHash } from 'node:crypto';
import { canPerformQaOperation, createId } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { FileNotFoundInStorageError, getFileStorage } from '../../storage/index.js';
import { sanitizeDisplayFileName, sniffImage } from '../../storage/image-sniff.js';

function supervisor(user: CurrentUser) {
  return (
    canPerformQaOperation(user) ||
    user.roles.some((role) => ['MERCHANDISER', 'SENIOR_MANAGEMENT'].includes(role))
  );
}
function assertView(user: CurrentUser, factoryId: string) {
  if (supervisor(user)) return;
  if (user.roles.includes('QA_USER')) return;
  if (
    user.factoryIds.length !== 1 ||
    user.factoryIds[0] !== factoryId ||
    (!canPerformQaOperation(user) && !user.roles.includes('FACTORY_USER'))
  )
    throw HttpError.forbidden('You cannot access this QA evidence');
}
function validate(buffer: Buffer) {
  if (!buffer.length) throw HttpError.badRequest('Uploaded file is empty');
  if (buffer.length > env.UPLOAD_MAX_IMAGE_BYTES)
    throw new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Image exceeds the maximum allowed size of ${env.UPLOAD_MAX_IMAGE_BYTES} bytes`,
    );
  const sniffed = sniffImage(buffer);
  if (!sniffed) throw HttpError.badRequest('Only valid JPEG, PNG and WebP evidence is accepted');
  return sniffed;
}

export async function uploadEvidence(
  user: CurrentUser,
  sessionId: string,
  inspectionLineId: string | undefined,
  upload: { buffer: Buffer; originalName?: string },
) {
  const session = await prisma.qaInspectionSession.findUnique({
    where: { id: sessionId },
    include: { jobOrder: true, lines: true },
  });
  if (!session) throw HttpError.notFound('Inspection session not found');
  if (session.status !== 'DRAFT')
    throw HttpError.conflict('Evidence can only be attached to a draft inspection');
  if (
    session.inspectorId !== user.id &&
    !canPerformQaOperation(user) &&
    !user.roles.includes('MERCHANDISER')
  )
    throw HttpError.forbidden('Only the inspector can upload evidence');
  assertView(user, session.jobOrder.factoryId);
  if (inspectionLineId && !session.lines.some((line) => line.id === inspectionLineId))
    throw HttpError.badRequest('Evidence line does not belong to this inspection');
  const image = validate(upload.buffer);
  const checksum = createHash('sha256').update(upload.buffer).digest('hex');
  const duplicate = await prisma.qaEvidence.findUnique({
    where: {
      inspectionSessionId_checksumSha256: {
        inspectionSessionId: sessionId,
        checksumSha256: checksum,
      },
    },
    include: { file: true },
  });
  if (duplicate) return { evidence: duplicate, created: false };
  const fileId = createId();
  const evidenceId = createId();
  const storageKey = `qa-evidence/${session.jobOrderId}/${sessionId}/${fileId}.${image.extension}`;
  const storage = getFileStorage();
  await storage.put(storageKey, upload.buffer);
  try {
    const evidence = await prisma.$transaction(async (tx) => {
      await tx.file.create({
        data: {
          id: fileId,
          fileName: sanitizeDisplayFileName(upload.originalName, image.extension),
          mimeType: image.mimeType,
          sizeBytes: upload.buffer.length,
          storageKey,
          checksumSha256: checksum,
          uploadedById: user.id,
        },
      });
      const created = await tx.qaEvidence.create({
        data: {
          id: evidenceId,
          inspectionSessionId: sessionId,
          inspectionLineId,
          checksumSha256: checksum,
          fileId,
        },
        include: { file: true },
      });
      await recordAuditLog(
        {
          actorId: user.id,
          action: 'QA_EVIDENCE_UPLOADED',
          entityType: 'QaInspectionSession',
          entityId: sessionId,
          metadata: {
            evidenceId,
            inspectionLineId: inspectionLineId ?? null,
            checksum,
            sizeBytes: upload.buffer.length,
          },
        },
        tx,
      );
      return created;
    });
    return { evidence, created: true };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function readEvidence(user: CurrentUser, evidenceId: string) {
  const evidence = await prisma.qaEvidence.findUnique({
    where: { id: evidenceId },
    include: { file: true, session: { include: { jobOrder: true } } },
  });
  if (!evidence) throw HttpError.notFound('QA evidence not found');
  assertView(user, evidence.session.jobOrder.factoryId);
  try {
    return {
      data: await getFileStorage().read(evidence.file.storageKey),
      mimeType: evidence.file.mimeType,
      fileName: evidence.file.fileName,
      etag: `"${evidence.file.storageKey}"`,
    };
  } catch (error) {
    if (error instanceof FileNotFoundInStorageError)
      throw HttpError.notFound('QA evidence content not found');
    throw error;
  }
}
