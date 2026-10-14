import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TaxInvoiceDocumentSnapshot, TaxInvoiceArchivedImage } from '@erve/types';
import { canViewTaxInvoice } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import {
  getFileStorage,
  FileNotFoundInStorageError,
  StorageKeyConflictError,
} from '../../storage/index.js';
import { sniffImage } from '../../storage/image-sniff.js';

type Tx = Prisma.TransactionClient;
interface InvoiceBasis {
  id: string;
  ervePackingListId: string;
  lines: Array<{ id: string; styleId: string; saleOrderLineId: string; quantity: number }>;
}
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const prefix = (id: string) => `invoice-images/${id}/`;
export const invoiceDocumentLockKey = (id: string) => `tax-invoice-finalize-${id}`;

const archivedImageSchema = z.object({
  id: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const documentSchema = z
  .object({
    schemaVersion: z.literal('ERVE_TAX_INVOICE_DOCUMENT_V1'),
    lines: z.array(
      z.object({
        lineId: z.string().min(1),
        quantity: z.number().int().positive(),
        style: z.object({
          id: z.string(),
          styleNumber: z.string(),
          styleName: z.string(),
          description: z.string().nullable(),
          colour: z.string().nullable(),
        }),
        size: z.object({
          id: z.string(),
          code: z.string(),
          label: z.string(),
          sortOrder: z.number().int().optional(),
        }),
        image: archivedImageSchema.nullable(),
        imageAvailability: z.enum(['ARCHIVED', 'NO_IMAGE', 'SOURCE_UNAVAILABLE']),
      }),
    ),
    dispatchOrders: z.array(
      z.object({ id: z.string(), number: z.string(), cartonIds: z.array(z.string()) }),
    ),
    transport: z
      .object({
        erveDispatchId: z.string(),
        lrNumber: z.string().nullable(),
        transporter: z.string().nullable(),
        vehicleNumber: z.string().nullable(),
      })
      .nullable(),
    historicalBuyerOrderReference: z
      .object({ kind: z.literal('HISTORICAL_EISO'), value: z.string().min(1) })
      .nullable(),
  })
  .strict();

export function readInvoiceDocumentSnapshot(
  value: Prisma.JsonValue | null,
): TaxInvoiceDocumentSnapshot | null {
  const parsed = documentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function documentMetadata(tx: Tx, invoice: InvoiceBasis) {
  const styleIds = [...new Set(invoice.lines.map((line) => line.styleId))].sort();
  // Match the existing Style-image mutation lock; no shared media changes.
  for (const id of styleIds)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('style_images:' || ${id}, 0))::text`;
  const styles = await tx.style.findMany({
    where: { id: { in: styleIds } },
    include: {
      images: {
        include: { file: true },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
      },
    },
    orderBy: { id: 'asc' },
  });
  const sources = await tx.factoryPackingCartonLine.findMany({
    where: { carton: { ervePackingListId: invoice.ervePackingListId, retiredAt: null } },
    include: { saleOrderLine: { include: { size: true, saleOrder: true } } },
    orderBy: { id: 'asc' },
  });
  const packing = await tx.ervePackingList.findUniqueOrThrow({
    where: { id: invoice.ervePackingListId },
    include: { dispatch: true },
  });
  const orders = new Map<string, { id: string; number: string; cartonIds: Set<string> }>();
  for (const source of sources) {
    const order = source.saleOrderLine.saleOrder;
    const entry = orders.get(order.id) ?? {
      id: order.id,
      number: order.saleOrderNumber,
      cartonIds: new Set<string>(),
    };
    entry.cartonIds.add(source.cartonId);
    orders.set(order.id, entry);
  }
  const lines = [...invoice.lines]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((line) => {
      const source = sources.find((item) => item.saleOrderLineId === line.saleOrderLineId);
      const quantity = sources
        .filter((item) => item.saleOrderLineId === line.saleOrderLineId)
        .reduce((sum, item) => sum + item.quantity, 0);
      const style = styles.find((item) => item.id === line.styleId);
      if (
        !source ||
        !style ||
        source.saleOrderLine.styleId !== line.styleId ||
        quantity !== line.quantity
      )
        throw HttpError.conflict('Invoice document provenance is unavailable or inconsistent', {
          reason: 'INVOICE_DOCUMENT_PROVENANCE_UNAVAILABLE',
        });
      return {
        lineId: line.id,
        quantity: line.quantity,
        style: {
          id: style.id,
          styleNumber: style.styleNumber,
          styleName: style.styleName,
          description: style.description,
          colour: style.colour,
        },
        size: {
          id: source.saleOrderLine.size.id,
          code: source.saleOrderLine.size.code,
          label: source.saleOrderLine.size.label,
          sortOrder: source.saleOrderLine.size.sortOrder,
        },
        sourceImage: style.images[0]?.file ?? null,
      };
    });
  const dispatch = packing.dispatch;
  const transport = dispatch
    ? {
        erveDispatchId: dispatch.id,
        lrNumber: dispatch.lrNumber,
        transporter: dispatch.transporter,
        vehicleNumber: dispatch.vehicleNumber,
      }
    : null;
  const dispatchOrders = [...orders.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((order) => ({ ...order, cartonIds: [...order.cartonIds].sort() }));
  // Private fingerprint includes source keys/checksums; never sent to clients.
  return {
    lines,
    transport,
    dispatchOrders,
    fingerprint: digest(JSON.stringify({ lines, transport, dispatchOrders })),
  };
}

export interface PreparedInvoiceDocument {
  snapshot: TaxInvoiceDocumentSnapshot;
  fingerprint: string;
  uploads: Array<{ key: string; data: Buffer; image: TaxInvoiceArchivedImage }>;
}

export async function prepareInvoiceDocument(
  tx: Tx,
  invoice: InvoiceBasis,
  actorId: string,
): Promise<PreparedInvoiceDocument> {
  const metadata = await documentMetadata(tx, invoice);
  const uploads: PreparedInvoiceDocument['uploads'] = [];
  const archivedByStyle = new Map<
    string,
    {
      image: TaxInvoiceArchivedImage | null;
      imageAvailability: 'ARCHIVED' | 'NO_IMAGE' | 'SOURCE_UNAVAILABLE';
    }
  >();
  const lines: TaxInvoiceDocumentSnapshot['lines'] = [];
  for (const { sourceImage, ...line } of metadata.lines) {
    let archive = archivedByStyle.get(line.style.id);
    if (!archive) {
      archive = { image: null, imageAvailability: sourceImage ? 'SOURCE_UNAVAILABLE' : 'NO_IMAGE' };
      if (sourceImage) {
        let data: Buffer | null = null;
        try {
          data = await getFileStorage().read(sourceImage.storageKey);
        } catch (error) {
          if (!(error instanceof FileNotFoundInStorageError)) throw error;
        }
        if (data) {
          const sniffed = sniffImage(data);
          const checksum = digest(data);
          if (
            !sniffed ||
            data.length !== sourceImage.sizeBytes ||
            (sourceImage.checksumSha256 !== null && checksum !== sourceImage.checksumSha256)
          )
            throw HttpError.conflict(
              'Style image integrity could not be verified; retry after correcting the source image',
              { reason: 'INVOICE_IMAGE_SOURCE_INTEGRITY' },
            );
          const id = `IVIMG${digest(`${invoice.id}:${line.style.id}:${checksum}`)}`;
          const key = `${prefix(invoice.id)}${id}.${sniffed.extension}`;
          const image = {
            id,
            mimeType: sniffed.mimeType,
            sizeBytes: data.length,
            checksumSha256: checksum,
          };
          // Journal commits before any archive upload. Not public or issued.
          await tx.file.upsert({
            where: { id },
            update: {},
            create: {
              id,
              fileName: `invoice-${line.style.id}.${sniffed.extension}`,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
              checksumSha256: checksum,
              storageKey: key,
              uploadedById: actorId,
            },
          });
          uploads.push({ key, data, image });
          archive = { image, imageAvailability: 'ARCHIVED' };
        }
      }
      archivedByStyle.set(line.style.id, archive);
    }
    lines.push({ ...line, ...archive });
  }
  return {
    fingerprint: metadata.fingerprint,
    uploads,
    snapshot: {
      schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
      lines,
      dispatchOrders: metadata.dispatchOrders,
      transport: metadata.transport,
      historicalBuyerOrderReference: null,
    },
  };
}

export async function uploadInvoiceDocument(
  invoiceId: string,
  prepared: PreparedInvoiceDocument,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceDocumentLockKey(invoiceId)}))`;
      const invoice = await tx.taxInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (invoice.status === 'FINALIZED' || invoice.status === 'CANCELLED') return;
      for (const upload of prepared.uploads) {
        const storage = getFileStorage();
        try {
          // Reuse complete copies; recover a partially written local object.
          if (await storage.exists(upload.key)) {
            if (digest(await storage.read(upload.key)) === upload.image.checksumSha256) continue;
            // Never overwrite a referenced issued archive, even on corruption.
            await storage.delete(upload.key);
          }
          try {
            await storage.put(upload.key, upload.data);
          } catch (error) {
            if (!(error instanceof StorageKeyConflictError)) throw error;
          }
          const copied = await storage.read(upload.key);
          if (
            copied.length !== upload.image.sizeBytes ||
            digest(copied) !== upload.image.checksumSha256
          )
            throw new Error('Archive verification failed');
        } catch {
          // Journal remains for retry/reconciliation; no financial transaction runs.
          throw HttpError.conflict(
            'Invoice image archive could not be completed. The invoice remains a draft; retry is safe.',
            { reason: 'INVOICE_IMAGE_ARCHIVE_FAILED' },
          );
        }
      }
    },
    { timeout: 30000 },
  );
}

export async function validatePreparedInvoiceDocument(
  tx: Tx,
  invoice: InvoiceBasis,
  prepared: PreparedInvoiceDocument,
) {
  const metadata = await documentMetadata(tx, invoice);
  if (metadata.fingerprint !== prepared.fingerprint)
    throw HttpError.conflict(
      'Invoice presentation or source references changed during archival. Refresh and retry finalization.',
      { reason: 'INVOICE_DOCUMENT_CHANGED_RETRY' },
    );
  for (const upload of prepared.uploads) {
    const data = await getFileStorage().read(upload.key);
    if (digest(data) !== upload.image.checksumSha256)
      throw HttpError.conflict('Invoice archive integrity check failed', {
        reason: 'INVOICE_IMAGE_ARCHIVE_FAILED',
      });
  }
}

export async function readArchivedInvoiceImage(
  actor: CurrentUser,
  invoiceId: string,
  imageId: string,
) {
  if (!canViewTaxInvoice(actor))
    throw HttpError.forbidden('You do not have permission to view archived invoice images');
  const invoice = await prisma.taxInvoice.findUnique({ where: { id: invoiceId } });
  const snapshot =
    invoice?.status === 'FINALIZED' || invoice?.status === 'CANCELLED'
      ? readInvoiceDocumentSnapshot(invoice.documentSnapshot)
      : null;
  const image = snapshot?.lines.find((line) => line.image?.id === imageId)?.image;
  if (!image) throw HttpError.notFound('Archived invoice image not found');
  const file = await prisma.file.findUnique({ where: { id: imageId } });
  if (
    !file ||
    !file.storageKey.startsWith(prefix(invoiceId)) ||
    file.checksumSha256 !== image.checksumSha256
  )
    throw HttpError.notFound('Archived invoice image not found');
  let data: Buffer;
  try {
    data = await getFileStorage().read(file.storageKey);
  } catch (error) {
    if (error instanceof FileNotFoundInStorageError)
      throw HttpError.notFound('Archived invoice image unavailable');
    throw error;
  }
  if (data.length !== image.sizeBytes || digest(data) !== image.checksumSha256)
    throw HttpError.conflict('Archived invoice image integrity failed', {
      reason: 'INVOICE_IMAGE_ARCHIVE_INTEGRITY',
    });
  return { data, mimeType: image.mimeType, etag: `"${image.checksumSha256}"` };
}

// Recovery can inspect orphan journals immediately; deletion is restricted to
// old, unreferenced files of a finalized invoice, under its lifecycle lock.
// Draft journals remain available for retry. No production job is activated.
export async function reconcileInvoiceImageArchives(invoiceId: string, dryRun = true) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceDocumentLockKey(invoiceId)}))`;
    const invoice = await tx.taxInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const snapshot = readInvoiceDocumentSnapshot(invoice.documentSnapshot);
    const referenced = new Set(
      snapshot?.lines.flatMap((line) => (line.image ? [line.image.id] : [])) ?? [],
    );
    const files = await tx.file.findMany({
      where: { storageKey: { startsWith: prefix(invoiceId) } },
    });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const orphaned = files.filter((file) => !referenced.has(file.id));
    const removable =
      (invoice.status === 'FINALIZED' || invoice.status === 'CANCELLED') && snapshot !== null
        ? orphaned.filter((file) => file.createdAt.getTime() < cutoff)
        : [];
    if (!dryRun)
      for (const file of removable) {
        await getFileStorage().delete(file.storageKey);
        await tx.file.delete({ where: { id: file.id } });
      }
    return {
      orphanedIds: orphaned.map((file) => file.id),
      removableIds: removable.map((file) => file.id),
      dryRun,
    };
  });
}
