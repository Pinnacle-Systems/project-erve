import type { ReconciliationDetail, ReconciliationLine, ReconciliationQueue } from '@erve/types';
import { canViewReconciliation, canReviewReconciliation, createId } from '@erve/shared';
import { z } from 'zod';
import { Prisma, prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import {
  reconciliationCte,
  summaryView,
  type ReconciliationFilters,
  type SummaryRow,
} from './reconciliation-query.js';
import { compareReconciliationLine } from './reconciliation-comparison.js';
import { computeAvailability, getSaleOrReturnPairQuantities } from './sale-or-return-quantities.js';

type Tx = Prisma.TransactionClient;
const readOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 30000,
};
function assertView(actor: CurrentUser) {
  if (!canViewReconciliation(actor)) throw HttpError.forbidden();
}

export const reconciliationReviewSchema = z
  .object({
    action: z.enum(['ACKNOWLEDGE', 'FOLLOW_UP', 'FINANCE_REVIEW']),
    remarks: z.string().trim().min(1).max(2000),
    snapshotToken: z.string().regex(/^[a-f0-9]{32}$/),
    previousReviewId: z.string().min(1).max(200).nullable(),
  })
  .strict();

export async function listReconciliation(
  actor: CurrentUser,
  filters: ReconciliationFilters,
): Promise<ReconciliationQueue> {
  assertView(actor);
  return prisma.$transaction(async (tx) => {
    const cte = reconciliationCte(filters);
    const counts = await tx.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`${cte} SELECT count(*)::int AS count FROM filtered`,
    );
    const count = counts[0]!.count;
    const rows = await tx.$queryRaw<SummaryRow[]>(
      Prisma.sql`${cte} SELECT * FROM filtered ORDER BY "dispatchDate" DESC, id DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`,
    );
    return {
      items: rows.map(summaryView),
      total: count,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }, readOptions);
}

async function loadDetail(tx: Tx, id: string): Promise<ReconciliationDetail> {
  const rows = await tx.$queryRaw<SummaryRow[]>(
    Prisma.sql`${reconciliationCte({}, id)} SELECT * FROM filtered`,
  );
  if (!rows[0]) throw HttpError.notFound('Erve dispatch not found');
  const summary = summaryView(rows[0]);
  const dispatch = await tx.erveDispatch.findUniqueOrThrow({
    where: { id },
    include: {
      ervePackingList: {
        include: {
          cartons: {
            where: { retiredAt: null },
            orderBy: { cartonNumber: 'asc' },
            include: { deliveryConfirmation: true, lines: true },
          },
        },
      },
      deliveryLines: true,
      deliveredBy: { select: { name: true } },
      distributorReceipt: { include: { lines: true, receivedBy: { select: { name: true } } } },
      reconciliationReviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
    },
  });
  const packed = new Map<string, number>();
  for (const carton of dispatch.ervePackingList.cartons) {
    for (const line of carton.lines)
      packed.set(line.saleOrderLineId, (packed.get(line.saleOrderLineId) ?? 0) + line.quantity);
  }
  const ledger = new Map(
    dispatch.deliveryLines.map((l) => [l.saleOrderLineId, l.receivedQuantity]),
  );
  const receipt = dispatch.distributorReceipt;
  const evidence = new Map(receipt?.lines.map((l) => [l.saleOrderLineId, l.receivedQuantity]));
  // Include every evidence/ledger source even if inconsistent historical data lacks a carton row.
  const ids = [...new Set([...packed.keys(), ...ledger.keys(), ...evidence.keys()])];
  const sources = await tx.saleOrderLine.findMany({
    where: { id: { in: ids } },
    include: {
      style: true,
      size: true,
      saleOrder: { select: { saleOrderNumber: true } },
      destination: { include: { saleOrderDistributor: { select: { purchaseMode: true } } } },
    },
  });
  const lines: ReconciliationLine[] = [];
  for (const source of sources) {
    const dispatchedQuantity = packed.get(source.id) ?? 0;
    const receivedQuantity = evidence.get(source.id) ?? null;
    const ledgerQuantity = ledger.get(source.id) ?? null;
    const quantities = await getSaleOrReturnPairQuantities(tx, id, source.id);
    const saleReturn = source.destination.saleOrderDistributor.purchaseMode === 'SALE_RETURN';
    const availability = saleReturn ? computeAvailability(quantities) : null;
    lines.push({
      saleOrderLineId: source.id,
      saleOrderNumber: source.saleOrder.saleOrderNumber,
      purchaseMode: source.destination.saleOrderDistributor.purchaseMode,
      styleId: source.styleId,
      styleNumber: source.style.styleNumber,
      styleName: source.style.styleName,
      sizeId: source.sizeId,
      sizeLabel: source.size.label,
      sizeSortOrder: source.size.sortOrder,
      dispatchedQuantity,
      receivedQuantity,
      ledgerQuantity,
      ...compareReconciliationLine(dispatchedQuantity, receivedQuantity, ledgerQuantity),
      actualSoldQuantity: quantities.actualSoldQuantity,
      returnedQuantity: quantities.returnedQuantity,
      approvedAwaitingReceiptQuantity: quantities.approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity: quantities.pendingRequestedQuantity,
      availableForActualSale: availability?.availableForActualSale ?? null,
      availableForNewReturn: availability?.availableForNewReturn ?? null,
    });
  }
  lines.sort(
    (a, b) =>
      a.styleNumber.localeCompare(b.styleNumber) ||
      a.sizeSortOrder - b.sizeSortOrder ||
      a.saleOrderNumber.localeCompare(b.saleOrderNumber) ||
      a.saleOrderLineId.localeCompare(b.saleOrderLineId),
  );
  return {
    summary,
    lines,
    cartons: dispatch.ervePackingList.cartons.map((c) => ({
      id: c.id,
      cartonNumber: c.cartonNumber,
      confirmedAt: c.deliveryConfirmation?.deliveredAt.toISOString() ?? null,
    })),
    receipt: receipt
      ? {
          receivedAt: receipt.receivedAt.toISOString(),
          receivedBy: receipt.receivedBy.name,
          remarks: receipt.remarks,
          priorSource: receipt.priorDeliveryConfirmationSource,
          priorRemarks: receipt.priorDeliveryRemarks,
        }
      : null,
    ledger: {
      recordedBy: dispatch.deliveredBy?.name ?? null,
      recordedAt: dispatch.deliveredAt?.toISOString() ?? null,
      remarks: dispatch.deliveryRemarks,
    },
    reviews: dispatch.reconciliationReviews.map((r) => ({
      id: r.id,
      action: r.action,
      remarks: r.remarks,
      actor: { id: r.actorId, name: r.actorName },
      createdAt: r.createdAt.toISOString(),
      snapshotToken: r.snapshotToken,
      snapshot: r.snapshot,
    })),
  };
}

export async function getReconciliation(
  actor: CurrentUser,
  id: string,
): Promise<ReconciliationDetail> {
  assertView(actor);
  return prisma.$transaction((tx) => loadDetail(tx, id), readOptions);
}

export async function recordReconciliationReview(
  actor: CurrentUser,
  id: string,
  raw: z.infer<typeof reconciliationReviewSchema>,
) {
  const input = reconciliationReviewSchema.parse(raw);
  if (!canReviewReconciliation(actor, input.action)) throw HttpError.forbidden();
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Serialize reviews and A4/Admin ledger confirmation without updating the Dispatch.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;
        const observed = await loadDetail(tx, id);
        if (
          observed.summary.snapshotToken !== input.snapshotToken ||
          observed.summary.latestReviewId !== input.previousReviewId
        ) {
          throw HttpError.conflict(
            'Reconciliation evidence or review history changed. Refresh and review the latest comparison before retrying.',
          );
        }
        const { reviews, ...snapshot } = observed;
        const reviewId = createId();
        await tx.erveDispatchReconciliationReview.create({
          data: {
            id: reviewId,
            erveDispatchId: id,
            actorId: actor.id,
            actorName: actor.name,
            action: input.action,
            remarks: input.remarks,
            snapshotToken: input.snapshotToken,
            snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
            previousReviewId: input.previousReviewId,
            createdAt: new Date(
              Math.max(Date.now(), reviews[0] ? new Date(reviews[0].createdAt).getTime() + 1 : 0),
            ),
          },
        });
        await recordAuditLog(
          {
            actorId: actor.id,
            action: 'ERVE_DISPATCH_RECONCILIATION_REVIEWED',
            entityType: 'ErveDispatch',
            entityId: id,
            metadata: {
              reviewId,
              action: input.action,
              snapshotToken: input.snapshotToken,
              previousReviewId: input.previousReviewId,
            },
          },
          tx,
        );
        return { id: reviewId };
      },
      { ...readOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2034', 'P2002'].includes(error.code)
    ) {
      throw HttpError.conflict('Reconciliation changed during review. Refresh and retry.');
    }
    throw error;
  }
}
