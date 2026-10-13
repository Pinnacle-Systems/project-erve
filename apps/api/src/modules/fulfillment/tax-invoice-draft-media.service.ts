import { canViewTaxInvoice } from '@erve/shared';
import { createHash } from 'node:crypto';
import type { CurrentUser } from '../../auth/current-user.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { FileNotFoundInStorageError, getFileStorage } from '../../storage/index.js';

/** Invoice-scoped access only; never changes Style Master permissions. */
export async function readDraftInvoiceImage(
  actor: CurrentUser,
  invoiceId: string,
  styleId: string,
  imageId: string,
) {
  if (!canViewTaxInvoice(actor))
    throw HttpError.forbidden('You do not have permission to view invoice images');
  return prisma.$transaction(async (tx) => {
    // Same lifecycle/media locks as issuance and Style image mutation. Keep the
    // Draft and current-primary validation valid until the bytes have been read.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tax-invoice-finalize-${invoiceId}`}))`;
    const invoice = await tx.taxInvoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, lines: { select: { styleId: true } } },
    });
    if (
      !invoice ||
      invoice.status !== 'DRAFT' ||
      !invoice.lines.some((line) => line.styleId === styleId)
    )
      throw HttpError.notFound('Draft invoice image not found');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('style_images:' || ${styleId}, 0))::text`;
    const primary = await tx.styleImage.findFirst({
      where: { styleId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, file: { select: { storageKey: true, mimeType: true } } },
    });
    if (primary?.id !== imageId) throw HttpError.notFound('Draft invoice primary image not found');
    let data: Buffer;
    try {
      data = await getFileStorage().read(primary.file.storageKey);
    } catch (error) {
      if (error instanceof FileNotFoundInStorageError)
        throw HttpError.notFound('Draft invoice image unavailable');
      throw error;
    }
    return {
      data,
      mimeType: primary.file.mimeType,
      etag: `"${createHash('sha256').update(data).digest('hex')}"`,
    };
  });
}
