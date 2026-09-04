import { createId } from '@erve/shared';
import { canApproveDistributorReturn, canReceiveDistributorReturn, canSubmitDistributorReturn, canViewSaleOrReturnPosition } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { computeAvailability, getSaleOrReturnPairQuantities, saleOrReturnPositionLockKey } from './sale-or-return-quantities.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function isBroadViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function isOwnDistributorActor(actor: CurrentUser, distributorId: string): boolean {
  if (actor.roles.includes('ADMIN')) return true;
  if (!actor.roles.includes('DISTRIBUTOR')) return false;
  return getSoleDistributorId(actor) === distributorId;
}

function assertViewAccess(actor: CurrentUser, distributorId: string): void {
  if (!canViewSaleOrReturnPosition(actor)) {
    throw HttpError.forbidden('You do not have permission to view Distributor Returns');
  }
  if (!isBroadViewer(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this Distributor Return');
  }
}

// ---------------------------------------------------------------------------
// View shaping
// ---------------------------------------------------------------------------

const returnInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  receivedBy: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
  creditNoteRecordedBy: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      erveDispatch: { select: { id: true, erveDispatchNumber: true } },
      saleOrderLine: {
        select: {
          purchaseOrderLineSize: {
            select: {
              sizeId: true,
              size: { select: { code: true, label: true } },
              purchaseOrderLine: { select: { style: { select: { styleNumber: true, styleName: true } } } },
            },
          },
        },
      },
      returnedStockLot: { select: { id: true, quantity: true } },
    },
  },
} satisfies Prisma.DistributorReturnInclude;

type ReturnRecord = Prisma.DistributorReturnGetPayload<{ include: typeof returnInclude }>;

function toReturnView(record: ReturnRecord) {
  return {
    id: record.id,
    returnNumber: record.returnNumber,
    distributor: record.distributor,
    returnDate: record.returnDate.toISOString(),
    status: record.status,
    returnReason: record.returnReason,
    remarks: record.remarks,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt.toISOString(),
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    approvalRemarks: record.approvalRemarks,
    rejectionReason: record.rejectionReason,
    receivedBy: record.receivedBy,
    receivedAt: record.receivedAt?.toISOString() ?? null,
    creditNoteReference: record.creditNoteReference,
    creditNoteDate: record.creditNoteDate?.toISOString() ?? null,
    creditNoteRecordedBy: record.creditNoteRecordedBy,
    cancelledBy: record.cancelledBy,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
    lines: record.lines.map((line) => ({
      id: line.id,
      erveDispatch: line.erveDispatch,
      saleOrderLineId: line.saleOrderLineId,
      styleNumber: line.saleOrderLine.purchaseOrderLineSize.purchaseOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.purchaseOrderLineSize.purchaseOrderLine.style.styleName,
      sizeCode: line.saleOrderLine.purchaseOrderLineSize.size.code,
      sizeLabel: line.saleOrderLine.purchaseOrderLineSize.size.label,
      requestedQuantity: line.requestedQuantity,
      approvedQuantity: line.approvedQuantity,
      receivedQuantity: line.receivedQuantity,
      returnedStockLotId: line.returnedStockLot?.id ?? null,
    })),
  };
}

async function loadReturn(id: string): Promise<ReturnRecord> {
  const record = await prisma.distributorReturn.findUnique({ where: { id }, include: returnInclude });
  if (!record) throw HttpError.notFound('Distributor return not found');
  return record;
}

export async function getDistributorReturnDetail(actor: CurrentUser, id: string) {
  const record = await loadReturn(id);
  assertViewAccess(actor, record.distributorId);
  return toReturnView(record);
}

export async function listDistributorReturns(
  actor: CurrentUser,
  filters: { distributorId?: string; status?: string; cursor?: string; limit: number },
) {
  if (!canViewSaleOrReturnPosition(actor)) {
    throw HttpError.forbidden('You do not have permission to view Distributor Returns');
  }
  const distributorId = isBroadViewer(actor) ? filters.distributorId : getSoleDistributorId(actor);

  const records = await prisma.distributorReturn.findMany({
    where: { distributorId, status: filters.status as never },
    include: returnInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map(toReturnView),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function generateReturnNumber(client: Tx, financialYear: { id: string; code: string }) {
  const serial = await allocateDocumentSerial(client, 'DISTRIBUTOR_RETURN', financialYear.id);
  return { returnNumber: formatDocumentNumber(DOCUMENT_PREFIXES.DISTRIBUTOR_RETURN, financialYear.code, serial), returnSerial: serial };
}

// ---------------------------------------------------------------------------
// Submit — Distributor request against SALE_RETURN stock currently
// availableForNewReturn (see sale-or-return-quantities.ts). Reserves only
// against other return requests, never against Actual Sale reporting.
// ---------------------------------------------------------------------------

export interface SubmitDistributorReturnInput {
  distributorId: string;
  returnDate: string;
  returnReason: string;
  remarks?: string | null;
  lines: Array<{ erveDispatchId: string; saleOrderLineId: string; requestedQuantity: number }>;
}

export async function submitDistributorReturn(actor: CurrentUser, input: SubmitDistributorReturnInput) {
  if (!canSubmitDistributorReturn(actor)) {
    throw HttpError.forbidden('You do not have permission to submit a Distributor Return');
  }
  const distributorId = actor.roles.includes('ADMIN') ? input.distributorId : getSoleDistributorId(actor);
  if (distributorId !== input.distributorId) {
    throw HttpError.forbidden('You may only submit a return for your own distributor');
  }
  if (!input.returnReason?.trim()) {
    throw HttpError.badRequest('A return reason is required');
  }
  if (input.lines.length === 0) {
    throw HttpError.badRequest('A return must have at least one line');
  }

  const returnId = createId();
  await prisma.$transaction(async (tx) => {
    const pairKeys = [...new Set(input.lines.map((line) => saleOrReturnPositionLockKey(line.erveDispatchId, line.saleOrderLineId)))].sort();
    for (const key of pairKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    const dispatches = await tx.erveDispatch.findMany({
      where: { id: { in: [...new Set(input.lines.map((l) => l.erveDispatchId))] } },
      select: { id: true, distributorId: true },
    });
    const dispatchById = new Map(dispatches.map((d) => [d.id, d]));

    const saleOrderLineModes = await tx.saleOrderLine.findMany({
      where: { id: { in: [...new Set(input.lines.map((l) => l.saleOrderLineId))] } },
      select: {
        id: true,
        purchaseOrderLineSize: { select: { purchaseOrderLine: { select: { purchaseOrder: { select: { purchaseMode: true } } } } } },
      },
    });
    const modeBySaleOrderLineId = new Map(
      saleOrderLineModes.map((sol) => [sol.id, sol.purchaseOrderLineSize.purchaseOrderLine.purchaseOrder.purchaseMode]),
    );

    for (const line of input.lines) {
      if (line.requestedQuantity <= 0) throw HttpError.badRequest('Requested return quantity must be greater than zero');

      const dispatch = dispatchById.get(line.erveDispatchId);
      if (!dispatch) throw HttpError.notFound(`Erve dispatch ${line.erveDispatchId} not found`);
      if (dispatch.distributorId !== input.distributorId) {
        throw HttpError.forbidden('You may only return your own dispatched goods');
      }

      const mode = modeBySaleOrderLineId.get(line.saleOrderLineId);
      if (!mode) throw HttpError.notFound(`Sale order line ${line.saleOrderLineId} not found`);
      if (mode !== 'SALE_RETURN') {
        throw HttpError.badRequest('Only Sale-or-Return goods can be returned — this line is Outright');
      }

      const quantities = await getSaleOrReturnPairQuantities(tx, line.erveDispatchId, line.saleOrderLineId);
      const { availableForNewReturn } = computeAvailability(quantities);
      if (line.requestedQuantity > availableForNewReturn) {
        throw HttpError.badRequest(
          `Requested return quantity exceeds the quantity available to return (available ${availableForNewReturn})`,
        );
      }
    }

    const financialYear = await ensureFinancialYear(tx, new Date(input.returnDate));
    const { returnNumber, returnSerial } = await generateReturnNumber(tx, financialYear);

    await tx.distributorReturn.create({
      data: {
        id: returnId,
        returnNumber,
        distributorId: input.distributorId,
        returnDate: new Date(input.returnDate),
        returnReason: input.returnReason.trim(),
        remarks: input.remarks ?? null,
        submittedById: actor.id,
        financialYearId: financialYear.id,
        returnSerial,
        lines: {
          create: input.lines.map((line) => ({
            id: createId(),
            erveDispatchId: line.erveDispatchId,
            saleOrderLineId: line.saleOrderLineId,
            requestedQuantity: line.requestedQuantity,
          })),
        },
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_SUBMITTED',
        entityType: 'DistributorReturn',
        entityId: returnId,
        metadata: { returnNumber, distributorId: input.distributorId, lineCount: input.lines.length },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, returnId);
}

// ---------------------------------------------------------------------------
// Approve / Reject — Accountant/Admin finance review. Approving reserves
// approvedQuantity against Actual Sale reporting too (availableForActualSale);
// rejecting releases the request entirely.
// ---------------------------------------------------------------------------

export interface ApproveDistributorReturnInput {
  expectedVersion: number;
  lines: Array<{ id: string; approvedQuantity: number }>;
  approvalRemarks?: string | null;
}

export async function approveDistributorReturn(actor: CurrentUser, id: string, input: ApproveDistributorReturnInput) {
  if (!canApproveDistributorReturn(actor)) {
    throw HttpError.forbidden('You do not have permission to approve Distributor Returns');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distributor-return-${id}`}))`;

    const existing = await tx.distributorReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) throw HttpError.notFound('Distributor return not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);
    if (existing.status !== 'SUBMITTED') {
      throw HttpError.conflict(`Distributor return in status ${existing.status} cannot be approved`);
    }

    const lineById = new Map(existing.lines.map((l) => [l.id, l]));
    const inputLineIds = new Set(input.lines.map((l) => l.id));
    if (inputLineIds.size !== existing.lines.length || existing.lines.some((l) => !inputLineIds.has(l.id))) {
      throw HttpError.badRequest('Approval must cover exactly the lines on this return');
    }

    const pairKeys = [...new Set(existing.lines.map((l) => saleOrReturnPositionLockKey(l.erveDispatchId, l.saleOrderLineId)))].sort();
    for (const key of pairKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    let totalApproved = 0;
    for (const line of input.lines) {
      const existingLine = lineById.get(line.id)!;
      if (line.approvedQuantity < 0 || line.approvedQuantity > existingLine.requestedQuantity) {
        throw HttpError.badRequest(
          `Approved quantity for line ${line.id} must be between 0 and the requested quantity (${existingLine.requestedQuantity})`,
        );
      }
      totalApproved += line.approvedQuantity;

      if (line.approvedQuantity > 0) {
        // Re-check availability now, under lock — quantity may have moved
        // since the original request (e.g. an Actual Sale reported meanwhile).
        const quantities = await getSaleOrReturnPairQuantities(tx, existingLine.erveDispatchId, existingLine.saleOrderLineId);
        const { availableForActualSale } = computeAvailability(quantities);
        if (line.approvedQuantity > availableForActualSale) {
          throw HttpError.badRequest(
            `Approved quantity for line ${line.id} exceeds the quantity currently available (available ${availableForActualSale})`,
          );
        }
      }
    }

    if (totalApproved <= 0) {
      throw HttpError.badRequest(
        'At least one line must have an approved quantity greater than zero — use rejectDistributorReturn to refuse the request entirely',
      );
    }

    for (const line of input.lines) {
      await tx.distributorReturnLine.update({ where: { id: line.id }, data: { approvedQuantity: line.approvedQuantity } });
    }

    const updated = await tx.distributorReturn.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'APPROVED',
        approvedById: actor.id,
        approvedAt: new Date(),
        approvalRemarks: input.approvalRemarks ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_APPROVED',
        entityType: 'DistributorReturn',
        entityId: id,
        metadata: { returnNumber: existing.returnNumber, totalApproved },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, id);
}

export interface RejectDistributorReturnInput {
  expectedVersion: number;
  rejectionReason: string;
}

export async function rejectDistributorReturn(actor: CurrentUser, id: string, input: RejectDistributorReturnInput) {
  if (!canApproveDistributorReturn(actor)) {
    throw HttpError.forbidden('You do not have permission to reject Distributor Returns');
  }
  if (!input.rejectionReason?.trim()) {
    throw HttpError.badRequest('A rejection reason is required');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distributor-return-${id}`}))`;

    const existing = await tx.distributorReturn.findUnique({ where: { id } });
    if (!existing) throw HttpError.notFound('Distributor return not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);
    if (existing.status !== 'SUBMITTED') {
      throw HttpError.conflict(`Distributor return in status ${existing.status} cannot be rejected`);
    }

    const updated = await tx.distributorReturn.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'REJECTED', rejectionReason: input.rejectionReason.trim(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_REJECTED',
        entityType: 'DistributorReturn',
        entityId: id,
        metadata: { returnNumber: existing.returnNumber, rejectionReason: input.rejectionReason.trim() },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Credit note — decoupled from both approve and receive (see the schema
// module doc). Callable once APPROVED or RECEIVED, re-callable to correct,
// mirrors invoice-handoff.service.ts's recordTallyInvoiceReference exactly.
// Once recorded, blocks CANCELLED (see cancelDistributorReturn) and requires
// receiveDistributorReturn to receive exactly the approved quantity.
// ---------------------------------------------------------------------------

export interface RecordDistributorReturnCreditNoteInput {
  expectedVersion: number;
  creditNoteReference: string;
  creditNoteDate: string;
}

export async function recordDistributorReturnCreditNote(actor: CurrentUser, id: string, input: RecordDistributorReturnCreditNoteInput) {
  if (!canApproveDistributorReturn(actor)) {
    throw HttpError.forbidden('You do not have permission to record a credit note for a Distributor Return');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distributor-return-${id}`}))`;

    const existing = await tx.distributorReturn.findUnique({ where: { id } });
    if (!existing) throw HttpError.notFound('Distributor return not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);
    if (existing.status !== 'APPROVED' && existing.status !== 'RECEIVED') {
      throw HttpError.conflict('A credit note can only be recorded once the return has been approved');
    }

    const updated = await tx.distributorReturn.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        creditNoteReference: input.creditNoteReference,
        creditNoteDate: new Date(input.creditNoteDate),
        creditNoteRecordedById: actor.id,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_CREDIT_NOTE_RECORDED',
        entityType: 'DistributorReturn',
        entityId: id,
        metadata: { returnNumber: existing.returnNumber, creditNoteReference: input.creditNoteReference },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Receive — Merchandiser/Admin physical receipt. Creates ReturnedStockLot
// (the new physical-inventory fact) exactly once per line, only here. Never
// releases/mutates the original StockAllocation, QaReleaseLine or
// ErveDispatch. Terminal — a shortfall vs approved is not reopenable under
// this document (a fresh DistributorReturn is required), though the
// shortfall quantity itself correctly flows back into the position via the
// normal formulas once approvedAwaitingReceipt's reservation for it lapses.
// ---------------------------------------------------------------------------

export interface ReceiveDistributorReturnInput {
  expectedVersion: number;
  lines: Array<{ id: string; receivedQuantity: number }>;
}

export async function receiveDistributorReturn(actor: CurrentUser, id: string, input: ReceiveDistributorReturnInput) {
  if (!canReceiveDistributorReturn(actor)) {
    throw HttpError.forbidden('You do not have permission to record physical receipt of a Distributor Return');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distributor-return-${id}`}))`;

    const existing = await tx.distributorReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) throw HttpError.notFound('Distributor return not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);
    if (existing.status !== 'APPROVED') {
      throw HttpError.conflict(`Distributor return in status ${existing.status} cannot be received`);
    }

    const lineById = new Map(existing.lines.map((l) => [l.id, l]));
    const inputLineIds = new Set(input.lines.map((l) => l.id));
    if (inputLineIds.size !== existing.lines.length || existing.lines.some((l) => !inputLineIds.has(l.id))) {
      throw HttpError.badRequest('Receipt must cover exactly the lines on this return');
    }

    const creditNoteAlreadyRecorded = existing.creditNoteReference != null;
    let totalReceived = 0;
    for (const line of input.lines) {
      const existingLine = lineById.get(line.id)!;
      const approvedQuantity = existingLine.approvedQuantity ?? 0;
      if (line.receivedQuantity < 0 || line.receivedQuantity > approvedQuantity) {
        throw HttpError.badRequest(
          `Received quantity for line ${line.id} must be between 0 and the approved quantity (${approvedQuantity})`,
        );
      }
      if (creditNoteAlreadyRecorded && line.receivedQuantity !== approvedQuantity) {
        throw HttpError.conflict(
          `A credit note has already been recorded for this return — line ${line.id} must be received in full (${approvedQuantity}), not partially`,
        );
      }
      totalReceived += line.receivedQuantity;
    }

    if (totalReceived <= 0) {
      throw HttpError.badRequest(
        'At least one line must have a received quantity greater than zero — use cancelDistributorReturn if the goods never arrived',
      );
    }

    for (const line of input.lines) {
      await tx.distributorReturnLine.update({ where: { id: line.id }, data: { receivedQuantity: line.receivedQuantity } });
      if (line.receivedQuantity > 0) {
        await tx.returnedStockLot.create({
          data: {
            id: createId(),
            distributorReturnLineId: line.id,
            saleOrderLineId: lineById.get(line.id)!.saleOrderLineId,
            quantity: line.receivedQuantity,
          },
        });
      }
    }

    const updated = await tx.distributorReturn.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'RECEIVED', receivedById: actor.id, receivedAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_RECEIVED',
        entityType: 'DistributorReturn',
        entityId: id,
        metadata: { returnNumber: existing.returnNumber, totalReceived, lineCount: input.lines.length },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Cancel — Distributor may cancel their own request while SUBMITTED;
// Accountant/Admin may cancel while SUBMITTED or APPROVED, but never once a
// credit note has been recorded (a financial document must not survive a
// cancelled business event — see the schema module doc).
// ---------------------------------------------------------------------------

export interface CancelDistributorReturnInput {
  expectedVersion: number;
}

export async function cancelDistributorReturn(actor: CurrentUser, id: string, input: CancelDistributorReturnInput) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distributor-return-${id}`}))`;

    const existing = await tx.distributorReturn.findUnique({ where: { id } });
    if (!existing) throw HttpError.notFound('Distributor return not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);

    const isOwnDistributor = canSubmitDistributorReturn(actor) && isOwnDistributorActor(actor, existing.distributorId);
    const isOps = canApproveDistributorReturn(actor);

    if (existing.status === 'SUBMITTED') {
      if (!isOwnDistributor && !isOps) {
        throw HttpError.forbidden('You do not have permission to cancel this Distributor Return');
      }
    } else if (existing.status === 'APPROVED') {
      if (!isOps) {
        throw HttpError.forbidden('Only Finance/Admin may cancel an approved Distributor Return');
      }
      if (existing.creditNoteReference != null) {
        throw HttpError.conflict('A credit note has already been recorded for this return — it can no longer be cancelled');
      }
    } else {
      throw HttpError.conflict(`Distributor return in status ${existing.status} cannot be cancelled`);
    }

    const updated = await tx.distributorReturn.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'CANCELLED', cancelledById: actor.id, cancelledAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_RETURN_CANCELLED',
        entityType: 'DistributorReturn',
        entityId: id,
        metadata: { returnNumber: existing.returnNumber, statusAtCancellation: existing.status },
      },
      tx,
    );
  });

  return getDistributorReturnDetail(actor, id);
}
