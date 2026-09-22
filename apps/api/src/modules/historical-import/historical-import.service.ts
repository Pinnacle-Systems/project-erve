// Write-only historical Job Order import service (H1 plan §13).
//
// Deliberately separate from job-orders.service.ts's createJobOrder — no
// `{ dryRun }` option, no flags added to the live path. In Story H1 this
// function is invoked only from tests against the disposable test database;
// no H1 CLI imports or references it. H2 introduces the first command that
// calls this against Dev, after the staging/reconciliation artifacts this
// module also builds have been reviewed and approved.
//
// Every enforced rule below traces to a specific H1 plan requirement:
//   - ADMIN actor required                        (§13)
//   - zero Order Sheets (never touched at all)     (§13, §7)
//   - recordOrigin = HISTORICAL_IMPORT             (§1.1)
//   - status = PRODUCTION_COMPLETE                 (§13)
//   - pinned, ACTIVE processFlowVersionId          (§12, §13)
//   - ordered quantities only, via the same Style/Size/StyleSize validation
//     live createJobOrder uses (createJobOrderLine, reused not duplicated)
//   - financialYearId follows createdAt, exactly like a live Job Order,
//     never historicalBusinessDate                 (§2.1)
//   - jobOrderSerial stays NULL; jobOrderNumber comes from the isolated
//     HISTORICAL_JOB_ORDER/EIJOH sequence           (§2)
//   - a HistoricalDocument is attached (new or existing) via the join table
//   - a HISTORICAL_JOB_ORDER_IMPORTED audit event, with a true current
//     import timestamp, independent of historicalBusinessDate
//   - creates nothing else: no JobOrderAcknowledgement, no stage-status
//     rows, no QA/inventory/dispatch/invoice rows of any kind
import { createId } from '@erve/shared';
import type { Prisma } from '../../db/prisma.js';
import { prisma } from '../../db/prisma.js';
import type { HistoricalDocumentRelationshipType, HistoricalDocumentType } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { createJobOrderLine } from '../job-orders/job-orders.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';

type Tx = Prisma.TransactionClient;

export type ImportHistoricalJobOrderDocumentInput =
  | {
      mode: 'existing';
      historicalDocumentId: string;
      relationshipType?: HistoricalDocumentRelationshipType;
    }
  | {
      mode: 'create';
      documentType: HistoricalDocumentType;
      externalReference?: string | null;
      documentDate?: Date | null;
      fileId: string;
      sourceSnapshot: Prisma.InputJsonValue;
      notes?: string | null;
      relationshipType?: HistoricalDocumentRelationshipType;
    };

export interface ImportHistoricalJobOrderInput {
  /** The real historical identity, e.g. "EI25001". Not required to be globally unique at the schema level — the caller (reconciliation) is responsible for the batch's chosen identity rule. */
  legacyReferenceNumber: string;
  /** Original historic PO/order date — independent of createdAt/financialYearId. */
  historicalBusinessDate: Date;
  /** Original historic shipment/delivery date, reusing JobOrder.requiredDeliveryDate. */
  requiredDeliveryDate?: Date | null;
  factoryId: string;
  styleId: string;
  /** Must resolve to an ACTIVE ProcessFlowVersion — the pinned version from the dry run. */
  processFlowVersionId: string;
  /** Required for a historical Job Order batch (H1 plan §3): ImportBatch.processFlowVersionId must already be populated on this batch. */
  importBatchId: string;
  /** Supplier/unit cost where present in the source document. */
  unitPrice: string;
  /** Ordered quantities ONLY — never prepared/QA-passed/dispatched/invoiced quantities. */
  sizes: Array<{ sizeId: string; quantity: number }>;
  document: ImportHistoricalJobOrderDocumentInput;
  migrationNotes?: string | null;
}

export interface ImportHistoricalJobOrderResult {
  jobOrderId: string;
  jobOrderNumber: string;
  historicalDocumentId: string;
}

async function generateHistoricalJobOrderNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ jobOrderNumber: string }> {
  const serial = await allocateDocumentSerial(client, 'HISTORICAL_JOB_ORDER', financialYear.id);
  return {
    jobOrderNumber: formatDocumentNumber(DOCUMENT_PREFIXES.HISTORICAL_JOB_ORDER, financialYear.code, serial),
  };
}

export async function importHistoricalJobOrder(
  actor: CurrentUser,
  input: ImportHistoricalJobOrderInput,
): Promise<ImportHistoricalJobOrderResult> {
  if (!actor.roles.includes('ADMIN')) {
    throw HttpError.forbidden('Only an ADMIN may import historical Job Orders');
  }
  const legacyReferenceNumber = input.legacyReferenceNumber.trim();
  if (!legacyReferenceNumber) {
    throw HttpError.badRequest('legacyReferenceNumber is required');
  }
  if (input.sizes.length === 0) {
    throw HttpError.badRequest('At least one size quantity is required');
  }
  for (const size of input.sizes) {
    if (!Number.isInteger(size.quantity) || size.quantity <= 0) {
      throw HttpError.badRequest('Each historical ordered quantity must be a positive whole number');
    }
  }

  return prisma.$transaction(async (tx) => {
    const [factory, style, processFlowVersion, importBatch] = await Promise.all([
      tx.factory.findUnique({ where: { id: input.factoryId } }),
      tx.style.findUnique({ where: { id: input.styleId } }),
      tx.processFlowVersion.findUnique({ where: { id: input.processFlowVersionId } }),
      tx.importBatch.findUnique({ where: { id: input.importBatchId } }),
    ]);
    if (!factory) throw HttpError.badRequest('Factory not found');
    if (!style) throw HttpError.badRequest('Style not found');
    if (!processFlowVersion) throw HttpError.badRequest('Process Flow Version not found');
    if (processFlowVersion.status !== 'ACTIVE') {
      throw HttpError.badRequest('Process Flow Version must be ACTIVE to import a historical Job Order against it');
    }
    if (!importBatch) throw HttpError.badRequest('Import batch not found');
    if (importBatch.processFlowVersionId !== input.processFlowVersionId) {
      throw HttpError.badRequest(
        "The Job Order's Process Flow Version must match the batch's pinned Process Flow Version",
      );
    }

    // Mirrors live createJobOrder exactly: a Job Order's Financial Year
    // always comes from its own createdAt, never a business/document date —
    // historicalBusinessDate is stored independently below and never feeds
    // this resolution (H1 plan §2.1).
    const createdAt = new Date();
    const financialYear = await ensureFinancialYear(tx, toBusinessCalendarDate(createdAt));
    const generated = await generateHistoricalJobOrderNumber(tx, financialYear);

    const jobOrderId = createId();
    await tx.jobOrder.create({
      data: {
        id: jobOrderId,
        jobOrderNumber: generated.jobOrderNumber,
        factoryId: input.factoryId,
        processFlowVersionId: input.processFlowVersionId,
        unitPrice: input.unitPrice,
        status: 'PRODUCTION_COMPLETE',
        recordOrigin: 'HISTORICAL_IMPORT',
        requiredDeliveryDate: input.requiredDeliveryDate ?? null,
        createdBy: actor.id,
        createdAt,
        financialYearId: financialYear.id,
        // Historical rows never allocate a live serial — stays NULL.
        jobOrderSerial: null,
        legacyReferenceNumber,
        historicalBusinessDate: input.historicalBusinessDate,
        importBatchId: input.importBatchId,
        importedById: actor.id,
        importedAt: createdAt,
        migrationNotes: input.migrationNotes ?? null,
      },
    });

    // Reuses live createJobOrder's own Style/Size/StyleSize validation and
    // JobOrderLine/JobOrderLineSize creation (job-orders.service.ts) instead
    // of duplicating it — see that function's export comment.
    await createJobOrderLine(tx, jobOrderId, input.styleId, input.sizes);

    let historicalDocumentId: string;
    if (input.document.mode === 'existing') {
      const existing = await tx.historicalDocument.findUnique({ where: { id: input.document.historicalDocumentId } });
      if (!existing) throw HttpError.badRequest('Historical document not found');
      historicalDocumentId = existing.id;
    } else {
      historicalDocumentId = createId();
      await tx.historicalDocument.create({
        data: {
          id: historicalDocumentId,
          documentType: input.document.documentType,
          externalReference: input.document.externalReference ?? null,
          documentDate: input.document.documentDate ?? null,
          fileId: input.document.fileId,
          sourceSnapshot: input.document.sourceSnapshot,
          importBatchId: input.importBatchId,
          addedById: actor.id,
          notes: input.document.notes ?? null,
        },
      });
    }
    await tx.historicalDocumentJobOrder.create({
      data: {
        id: createId(),
        historicalDocumentId,
        jobOrderId,
        relationshipType: input.document.relationshipType ?? 'PRIMARY_SOURCE',
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'HISTORICAL_JOB_ORDER_IMPORTED',
        entityType: 'JobOrder',
        entityId: jobOrderId,
        metadata: {
          legacyReferenceNumber,
          jobOrderNumber: generated.jobOrderNumber,
          importBatchId: input.importBatchId,
          historicalDocumentId,
          historicalBusinessDate: input.historicalBusinessDate.toISOString(),
        },
      },
      tx,
    );

    return { jobOrderId, jobOrderNumber: generated.jobOrderNumber, historicalDocumentId };
  });
}
