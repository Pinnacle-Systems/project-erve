import type { ErveDispatchDistributorReceiptView } from '@erve/types';
import { canSubmitErveDispatchDistributorReceipt, createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import {
  buildReceiptPlan,
  computeReceiptPayloadDigest,
  type ReceiptGroupInput,
  type ReceiptSourceLine,
} from './distributor-receipt-plan.js';

// ---------------------------------------------------------------------------
// A4 (ISS-079/080) — Distributor actual receipt. One final, immutable
// attestation per Erve Dispatch (see ErveDispatchDistributorReceipt in the
// schema for the evidence-vs-ledger model). The attestation writes through to
// the received-quantity ledger (ErveDispatchDeliveryLine) ONLY when no
// earlier ledger exists and something was actually received:
//
//   * no ledger, total > 0   -> APPLIED: ledger rows written, Dispatch
//                               DELIVERED / DISTRIBUTOR_CONFIRMED.
//   * no ledger, total = 0   -> NOT_APPLIED_ZERO: evidence only; no false
//                               positive ledger quantity, still DISPATCHED.
//   * any earlier ledger     -> EVIDENCE_ONLY_EXISTING: an Admin/Merchandiser
//     (or legacy-assumed)       or legacy confirmation is never overwritten;
//                               the discrepancy is surfaced on read.
//
// Never derived from carton QR evidence (A3), and not gated on DELIVERED.
// ---------------------------------------------------------------------------

export interface SubmitDistributorReceiptInput {
  expectedVersion: number;
  remarks?: string | null;
  groups: ReceiptGroupInput[];
}

/** Whether the actor may attest receipt for this distributor's Dispatch (role + exact ownership). */
export function canActorAttestDispatchReceipt(actor: CurrentUser, distributorId: string): boolean {
  return (
    canSubmitErveDispatchDistributorReceipt(actor) &&
    actor.distributorIds.length === 1 &&
    actor.distributorIds[0] === distributorId
  );
}

export async function submitDistributorReceipt(
  actor: CurrentUser,
  id: string,
  input: SubmitDistributorReceiptInput,
  idempotencyKey: string,
): Promise<{ replayed: boolean }> {
  if (!canSubmitErveDispatchDistributorReceipt(actor)) throw HttpError.forbidden();

  const remarks = input.remarks?.trim() || null;
  const digest = computeReceiptPayloadDigest({ remarks, groups: input.groups });

  try {
    return await prisma.$transaction(async (tx) => {
      // Same lock key as the Admin/Merchandiser delivery fallback, so the two
      // paths serialize and one can reliably see the other's committed result.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;

      const dispatch = await tx.erveDispatch.findUnique({
        where: { id },
        include: {
          distributorReceipt: { select: { id: true, receivedById: true, idempotencyKey: true, payloadDigest: true } },
          deliveryLines: { select: { saleOrderLineId: true, receivedQuantity: true } },
        },
      });
      if (!dispatch) throw HttpError.notFound('Erve dispatch not found');
      if (getSoleDistributorId(actor) !== dispatch.distributorId) {
        throw HttpError.forbidden('You do not have access to this dispatch');
      }

      // Idempotency is decided before the stale-version check: a retry after
      // an uncertain outcome carries the pre-submission version, which the
      // accepted submission has since bumped.
      const existing = dispatch.distributorReceipt;
      if (existing) {
        if (existing.receivedById === actor.id && existing.idempotencyKey === idempotencyKey) {
          if (existing.payloadDigest !== digest) {
            throw HttpError.conflict('This Idempotency-Key was already used with a different receipt');
          }
          return { replayed: true };
        }
        throw HttpError.conflict('A final distributor receipt has already been recorded for this Erve Dispatch');
      }

      if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);

      // Authoritative dispatched quantities: the frozen Packing List carton
      // lines, never anything the client sent.
      const packed = await tx.factoryPackingCartonLine.findMany({
        where: { carton: { ervePackingListId: dispatch.ervePackingListId, retiredAt: null } },
        select: { saleOrderLineId: true, quantity: true, saleOrderLine: { select: { styleId: true, sizeId: true } } },
      });
      const sourceById = new Map<string, ReceiptSourceLine>();
      for (const row of packed) {
        const current = sourceById.get(row.saleOrderLineId);
        if (current) current.dispatchedQuantity += row.quantity;
        else {
          sourceById.set(row.saleOrderLineId, {
            saleOrderLineId: row.saleOrderLineId,
            styleId: row.saleOrderLine.styleId,
            sizeId: row.saleOrderLine.sizeId,
            dispatchedQuantity: row.quantity,
          });
        }
      }
      if (sourceById.size === 0) throw HttpError.conflict('This Erve Dispatch has no dispatched quantities to receive');

      const plan = buildReceiptPlan([...sourceById.values()], input.groups);
      if (plan.hasShortage && !remarks) {
        throw HttpError.badRequest('Receipt remarks are required when any quantity is received short of the dispatched quantity');
      }

      const ledger = new Map(dispatch.deliveryLines.map((line) => [line.saleOrderLineId, line.receivedQuantity]));
      const noEarlierLedger =
        dispatch.status === 'DISPATCHED' && ledger.size === 0 && dispatch.deliveryConfirmationSource === null;
      const ledgerDisposition = !noEarlierLedger
        ? 'EVIDENCE_ONLY_EXISTING'
        : plan.totalReceivedQuantity > 0
          ? 'APPLIED'
          : 'NOT_APPLIED_ZERO';

      const now = new Date();
      const receiptId = createId();
      await tx.erveDispatchDistributorReceipt.create({
        data: {
          id: receiptId,
          erveDispatchId: id,
          distributorId: dispatch.distributorId,
          receivedById: actor.id,
          receivedAt: now,
          remarks,
          totalDispatchedQuantity: plan.totalDispatchedQuantity,
          totalReceivedQuantity: plan.totalReceivedQuantity,
          ledgerDisposition,
          priorStatus: dispatch.status,
          priorDeliveryConfirmationSource: dispatch.deliveryConfirmationSource,
          priorDeliveredById: dispatch.deliveredById,
          priorDeliveredAt: dispatch.deliveredAt,
          priorDeliveryRemarks: dispatch.deliveryRemarks,
          idempotencyKey,
          payloadDigest: digest,
        },
      });
      await tx.erveDispatchDistributorReceiptLine.createMany({
        data: plan.lines.map((line) => ({
          id: createId(),
          receiptId,
          saleOrderLineId: line.saleOrderLineId,
          dispatchedQuantity: line.dispatchedQuantity,
          receivedQuantity: line.receivedQuantity,
          previousLedgerQuantity: ledger.get(line.saleOrderLineId) ?? null,
        })),
      });

      if (ledgerDisposition === 'APPLIED') {
        await tx.erveDispatchDeliveryLine.createMany({
          data: plan.lines.map((line) => ({
            id: createId(),
            erveDispatchId: id,
            saleOrderLineId: line.saleOrderLineId,
            receivedQuantity: line.receivedQuantity,
          })),
        });
      }

      const updated = await tx.erveDispatch.updateMany({
        where: { id, version: input.expectedVersion },
        data:
          ledgerDisposition === 'APPLIED'
            ? {
                status: 'DELIVERED',
                deliveredById: actor.id,
                deliveredAt: now,
                deliveryRemarks: remarks,
                deliveryConfirmationSource: 'DISTRIBUTOR_CONFIRMED',
                version: { increment: 1 },
              }
            : { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'ERVE_DISPATCH_DISTRIBUTOR_RECEIPT_SUBMITTED',
          entityType: 'ErveDispatch',
          entityId: id,
          metadata: {
            erveDispatchNumber: dispatch.erveDispatchNumber,
            receiptId,
            distributorId: dispatch.distributorId,
            ledgerDisposition,
            totalDispatchedQuantity: plan.totalDispatchedQuantity,
            totalReceivedQuantity: plan.totalReceivedQuantity,
            lineCount: plan.lines.length,
          },
        },
        tx,
      );
      return { replayed: false };
    });
  } catch (error) {
    // DB backstop for the one-receipt-per-Dispatch rule if two submissions
    // ever bypassed the advisory lock.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw HttpError.conflict('A final distributor receipt has already been recorded for this Erve Dispatch');
    }
    throw error;
  }
}

/** Receipt evidence for the detail read, with the ledger that currently drives downstream. */
export async function loadDistributorReceiptView(dispatchId: string): Promise<ErveDispatchDistributorReceiptView | null> {
  const receipt = await prisma.erveDispatchDistributorReceipt.findUnique({
    where: { erveDispatchId: dispatchId },
    include: {
      receivedBy: { select: { id: true, name: true } },
      lines: {
        include: {
          saleOrderLine: {
            select: {
              styleId: true,
              sizeId: true,
              saleOrder: { select: { saleOrderNumber: true } },
              style: { select: { styleNumber: true, styleName: true } },
              size: { select: { code: true, label: true, sortOrder: true } },
              destination: { select: { saleOrderDistributor: { select: { purchaseMode: true } } } },
            },
          },
        },
      },
    },
  });
  if (!receipt) return null;

  const ledgerRows = await prisma.erveDispatchDeliveryLine.findMany({
    where: { erveDispatchId: dispatchId },
    select: { saleOrderLineId: true, receivedQuantity: true },
  });
  const ledger = new Map(ledgerRows.map((row) => [row.saleOrderLineId, row.receivedQuantity]));
  const priorDeliveredBy =
    receipt.priorDeliveredById === null
      ? null
      : await prisma.user.findUnique({ where: { id: receipt.priorDeliveredById }, select: { id: true, name: true } });

  const lines = receipt.lines
    .map((line) => {
      const sol = line.saleOrderLine;
      return {
        saleOrderLineId: line.saleOrderLineId,
        styleId: sol.styleId,
        styleNumber: sol.style.styleNumber,
        styleName: sol.style.styleName,
        sizeId: sol.sizeId,
        sizeCode: sol.size.code,
        sizeLabel: sol.size.label,
        sizeSortOrder: sol.size.sortOrder,
        saleOrderNumber: sol.saleOrder.saleOrderNumber,
        purchaseMode: sol.destination.saleOrderDistributor.purchaseMode,
        dispatchedQuantity: line.dispatchedQuantity,
        receivedQuantity: line.receivedQuantity,
        shortageQuantity: line.dispatchedQuantity - line.receivedQuantity,
        previousLedgerQuantity: line.previousLedgerQuantity,
        currentLedgerQuantity: ledger.get(line.saleOrderLineId) ?? null,
      };
    })
    .sort((a, b) =>
      a.styleNumber.localeCompare(b.styleNumber) ||
      (a.sizeSortOrder ?? 0) - (b.sizeSortOrder ?? 0) ||
      a.saleOrderNumber.localeCompare(b.saleOrderNumber) ||
      a.saleOrderLineId.localeCompare(b.saleOrderLineId),
    );

  const downstreamBasis =
    receipt.ledgerDisposition === 'APPLIED' ? 'DISTRIBUTOR_RECEIPT' : ledger.size > 0 ? 'EXISTING_LEDGER' : 'NONE';
  return {
    id: receipt.id,
    receivedBy: receipt.receivedBy,
    receivedAt: receipt.receivedAt.toISOString(),
    remarks: receipt.remarks,
    ledgerDisposition: receipt.ledgerDisposition,
    totalDispatchedQuantity: receipt.totalDispatchedQuantity,
    totalReceivedQuantity: receipt.totalReceivedQuantity,
    totalShortageQuantity: receipt.totalDispatchedQuantity - receipt.totalReceivedQuantity,
    prior: {
      status: receipt.priorStatus,
      deliveryConfirmationSource: receipt.priorDeliveryConfirmationSource,
      deliveredBy: priorDeliveredBy,
      deliveredAt: receipt.priorDeliveredAt?.toISOString() ?? null,
      deliveryRemarks: receipt.priorDeliveryRemarks,
    },
    downstreamBasis,
    hasLedgerDiscrepancy: ledger.size > 0 && lines.some((line) => line.currentLedgerQuantity !== line.receivedQuantity),
    lines,
  };
}
