import { createId } from '@erve/shared';
import {
  canSubmitDistributorSalesReport,
  canViewDistributorSalesReport,
  canViewSaleOrReturnPosition,
} from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import {
  computeAvailability,
  getActualSoldQuantityForPair,
  getApprovedAwaitingReceiptQuantityForPair,
  getPendingRequestedQuantityForPair,
  getReceivedQuantityForPair,
  getReturnedQuantityForPair,
  saleOrReturnPositionLockKey,
} from './sale-or-return-quantities.js';

function isBroadViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function resolveViewerDistributorScope(actor: CurrentUser, requestedDistributorId?: string): string | undefined {
  if (isBroadViewer(actor)) return requestedDistributorId;
  return getSoleDistributorId(actor);
}

// ---------------------------------------------------------------------------
// Sale-or-Return consignment position — derived, never independently
// mutated. dispatchedQuantity sums FactoryDispatchLine.packedQuantity for
// this (erveDispatchId, saleOrderLineId) pair; actualSoldQuantity sums
// DistributorSalesReportLine.quantitySold (the ACTUAL SALE fact) for the
// same pair. Purchase Mode is resolved through the COMMERCIAL chain
// (SaleOrderLine's own PO) — never through StockAllocation/QaReleaseLine
// physical provenance, exactly like invoice-handoff.service.ts's automatic
// Dispatch Sale creation. This position is entirely independent of
// InvoiceHandoff/Tally status: the Dispatch Sale invoice already exists for
// the full dispatchedQuantity from the moment of physical Dispatch (see
// invoice-handoff.service.ts) — actualSoldQuantity only tracks commercial
// sell-through for royalty/settlement purposes and never triggers another
// invoice. This deliberately does not touch StockAllocation at all: once
// physically dispatched, stock has already left the central QA/allocation
// availability model (see the schema module doc).
// ---------------------------------------------------------------------------

export interface SaleOrReturnPositionRow {
  erveDispatchId: string;
  erveDispatchNumber: string;
  dispatchDate: string;
  saleOrderId: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
  returnableQuantity: number;
}

export async function listSaleOrReturnPositions(
  actor: CurrentUser,
  filters: { distributorId?: string; onlyWithRemaining?: boolean },
): Promise<SaleOrReturnPositionRow[]> {
  if (!canViewSaleOrReturnPosition(actor)) {
    throw HttpError.forbidden('You do not have permission to view Sale-or-Return positions');
  }
  const distributorId = resolveViewerDistributorScope(actor, filters.distributorId);

  const lines = await prisma.factoryDispatchLine.findMany({
    where: {
      saleOrderLine: {
        purchaseOrderLineSize: { purchaseOrderLine: { purchaseOrder: { purchaseMode: 'SALE_RETURN' } } },
      },
    },
    select: {
      packedQuantity: true,
      saleOrderLine: {
        select: {
          id: true,
          saleOrderId: true,
          saleOrder: { select: { saleOrderNumber: true, distributor: { select: { id: true, code: true, name: true } } } },
          purchaseOrderLineSize: {
            select: {
              sizeId: true,
              size: { select: { code: true, label: true } },
              purchaseOrderLine: { select: { styleId: true, style: { select: { styleNumber: true, styleName: true } } } },
            },
          },
        },
      },
      factoryDispatch: {
        select: {
          ervePackingSource: {
            select: {
              ervePackingList: {
                select: {
                  dispatch: { select: { id: true, erveDispatchNumber: true, dispatchDate: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const grouped = new Map<string, SaleOrReturnPositionRow>();
  for (const line of lines) {
    const dispatch = line.factoryDispatch.ervePackingSource?.ervePackingList.dispatch;
    if (!dispatch) continue; // packed but not yet Erve-dispatched — no consignment position exists yet
    const so = line.saleOrderLine.saleOrder;
    if (distributorId && so.distributor.id !== distributorId) continue;

    const key = `${dispatch.id}:${line.saleOrderLine.id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.dispatchedQuantity += line.packedQuantity;
      continue;
    }
    const pols = line.saleOrderLine.purchaseOrderLineSize;
    grouped.set(key, {
      erveDispatchId: dispatch.id,
      erveDispatchNumber: dispatch.erveDispatchNumber,
      dispatchDate: dispatch.dispatchDate.toISOString(),
      saleOrderId: line.saleOrderLine.saleOrderId,
      saleOrderNumber: so.saleOrderNumber,
      distributor: so.distributor,
      saleOrderLineId: line.saleOrderLine.id,
      styleNumber: pols.purchaseOrderLine.style.styleNumber,
      styleName: pols.purchaseOrderLine.style.styleName,
      sizeCode: pols.size.code,
      sizeLabel: pols.size.label,
      dispatchedQuantity: line.packedQuantity,
      receivedQuantity: 0,
      actualSoldQuantity: 0,
      returnedQuantity: 0,
      approvedAwaitingReceiptQuantity: 0,
      pendingRequestedQuantity: 0,
      remainingWithDistributor: 0,
      returnableQuantity: 0,
    });
  }

  const keys = [...grouped.keys()];
  if (keys.length > 0) {
    const orClause = keys.map((key) => {
      const [erveDispatchId, saleOrderLineId] = key.split(':') as [string, string];
      return { erveDispatchId, saleOrderLineId };
    });

    const [receivedSums, actualSoldSums, returnedSums, approvedSums, pendingSums] = await Promise.all([
      prisma.erveDispatchDeliveryLine.groupBy({
        by: ['erveDispatchId', 'saleOrderLineId'],
        where: { OR: orClause },
        _sum: { receivedQuantity: true },
      }),
      prisma.distributorSalesReportLine.groupBy({
        by: ['erveDispatchId', 'saleOrderLineId'],
        where: { OR: orClause },
        _sum: { quantitySold: true },
      }),
      prisma.distributorReturnLine.groupBy({
        by: ['erveDispatchId', 'saleOrderLineId'],
        where: { OR: orClause, distributorReturn: { status: 'RECEIVED' } },
        _sum: { receivedQuantity: true },
      }),
      prisma.distributorReturnLine.groupBy({
        by: ['erveDispatchId', 'saleOrderLineId'],
        where: { OR: orClause, distributorReturn: { status: 'APPROVED' } },
        _sum: { approvedQuantity: true },
      }),
      prisma.distributorReturnLine.groupBy({
        by: ['erveDispatchId', 'saleOrderLineId'],
        where: { OR: orClause, distributorReturn: { status: 'SUBMITTED' } },
        _sum: { requestedQuantity: true },
      }),
    ]);
    for (const sum of receivedSums) {
      const row = grouped.get(`${sum.erveDispatchId}:${sum.saleOrderLineId}`);
      if (row) row.receivedQuantity = sum._sum.receivedQuantity ?? 0;
    }
    for (const sum of actualSoldSums) {
      const row = grouped.get(`${sum.erveDispatchId}:${sum.saleOrderLineId}`);
      if (row) row.actualSoldQuantity = sum._sum.quantitySold ?? 0;
    }
    for (const sum of returnedSums) {
      const row = grouped.get(`${sum.erveDispatchId}:${sum.saleOrderLineId}`);
      if (row) row.returnedQuantity = sum._sum.receivedQuantity ?? 0;
    }
    for (const sum of approvedSums) {
      const row = grouped.get(`${sum.erveDispatchId}:${sum.saleOrderLineId}`);
      if (row) row.approvedAwaitingReceiptQuantity = sum._sum.approvedQuantity ?? 0;
    }
    for (const sum of pendingSums) {
      const row = grouped.get(`${sum.erveDispatchId}:${sum.saleOrderLineId}`);
      if (row) row.pendingRequestedQuantity = sum._sum.requestedQuantity ?? 0;
    }
  }

  const rows = [...grouped.values()].map((row) => {
    const availability = computeAvailability(row);
    return {
      ...row,
      remainingWithDistributor: availability.remainingWithDistributor,
      returnableQuantity: availability.availableForNewReturn,
    };
  });

  return filters.onlyWithRemaining ? rows.filter((row) => row.remainingWithDistributor > 0) : rows;
}

// ---------------------------------------------------------------------------
// Distributor Sales Report — append-only submission of newly-sold quantity
// against previously-dispatched SALE_RETURN stock (BRD 6.7/8.13).
// ---------------------------------------------------------------------------

const reportInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
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
    },
  },
} satisfies Prisma.DistributorSalesReportInclude;

type ReportRecord = Prisma.DistributorSalesReportGetPayload<{ include: typeof reportInclude }>;

function toReportView(record: ReportRecord) {
  return {
    id: record.id,
    distributor: record.distributor,
    reportDate: record.reportDate.toISOString(),
    remarks: record.remarks,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt.toISOString(),
    lines: record.lines.map((line) => ({
      id: line.id,
      erveDispatch: line.erveDispatch,
      saleOrderLineId: line.saleOrderLineId,
      styleNumber: line.saleOrderLine.purchaseOrderLineSize.purchaseOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.purchaseOrderLineSize.purchaseOrderLine.style.styleName,
      sizeCode: line.saleOrderLine.purchaseOrderLineSize.size.code,
      sizeLabel: line.saleOrderLine.purchaseOrderLineSize.size.label,
      quantitySold: line.quantitySold,
    })),
  };
}

function assertReportViewAccess(actor: CurrentUser, distributorId: string): void {
  if (!canViewDistributorSalesReport(actor)) {
    throw HttpError.forbidden('You do not have permission to view Distributor Sales Reports');
  }
  if (!isBroadViewer(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this Distributor Sales Report');
  }
}

export async function getDistributorSalesReportDetail(actor: CurrentUser, id: string) {
  const record = await prisma.distributorSalesReport.findUnique({ where: { id }, include: reportInclude });
  if (!record) throw HttpError.notFound('Distributor Sales Report not found');
  assertReportViewAccess(actor, record.distributorId);
  return toReportView(record);
}

export async function listDistributorSalesReports(
  actor: CurrentUser,
  filters: { distributorId?: string; cursor?: string; limit: number },
) {
  if (!canViewDistributorSalesReport(actor)) {
    throw HttpError.forbidden('You do not have permission to view Distributor Sales Reports');
  }
  const distributorId = resolveViewerDistributorScope(actor, filters.distributorId);

  const records = await prisma.distributorSalesReport.findMany({
    where: { distributorId },
    include: reportInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map(toReportView),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export interface SubmitDistributorSalesReportInput {
  distributorId: string;
  reportDate: string;
  remarks?: string | null;
  lines: Array<{ erveDispatchId: string; saleOrderLineId: string; quantitySold: number }>;
}

export async function submitDistributorSalesReport(actor: CurrentUser, input: SubmitDistributorSalesReportInput) {
  if (!canSubmitDistributorSalesReport(actor)) {
    throw HttpError.forbidden('You do not have permission to report Distributor sales');
  }
  const distributorId = actor.roles.includes('ADMIN') ? input.distributorId : getSoleDistributorId(actor);
  if (distributorId !== input.distributorId) {
    throw HttpError.forbidden('You may only report sales for your own distributor');
  }
  if (input.lines.length === 0) {
    throw HttpError.badRequest('A sales report must have at least one line');
  }

  const reportId = createId();
  await prisma.$transaction(async (tx) => {
    // Lock every (erveDispatchId, saleOrderLineId) pair being reported
    // against, in a stable order, so two concurrent reports against the
    // same consignment line cannot both pass the ceiling check.
    const pairKeys = [...new Set(input.lines.map((line) => saleOrReturnPositionLockKey(line.erveDispatchId, line.saleOrderLineId)))].sort();
    for (const key of pairKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    const dispatches = await tx.erveDispatch.findMany({
      where: { id: { in: [...new Set(input.lines.map((l) => l.erveDispatchId))] } },
      select: { id: true, distributorId: true, status: true },
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
      if (line.quantitySold <= 0) throw HttpError.badRequest('Reported quantity must be greater than zero');

      const dispatch = dispatchById.get(line.erveDispatchId);
      if (!dispatch) throw HttpError.notFound(`Erve dispatch ${line.erveDispatchId} not found`);
      if (dispatch.distributorId !== input.distributorId) {
        throw HttpError.forbidden('You may only report sales against your own dispatched goods');
      }
      if (dispatch.status !== 'DELIVERED') {
        throw HttpError.badRequest('This Erve Dispatch has not yet been confirmed delivered — actual sales can only be reported against delivered stock');
      }

      const mode = modeBySaleOrderLineId.get(line.saleOrderLineId);
      if (!mode) throw HttpError.notFound(`Sale order line ${line.saleOrderLineId} not found`);
      if (mode !== 'SALE_RETURN') {
        throw HttpError.badRequest('Only Sale-or-Return goods can be reported as sold — this line is Outright');
      }

      const [receivedQuantity, actualSoldQuantity, returnedQuantity, approvedAwaitingReceiptQuantity, pendingRequestedQuantity] =
        await Promise.all([
          getReceivedQuantityForPair(tx, line.erveDispatchId, line.saleOrderLineId),
          getActualSoldQuantityForPair(tx, line.erveDispatchId, line.saleOrderLineId),
          getReturnedQuantityForPair(tx, line.erveDispatchId, line.saleOrderLineId),
          getApprovedAwaitingReceiptQuantityForPair(tx, line.erveDispatchId, line.saleOrderLineId),
          getPendingRequestedQuantityForPair(tx, line.erveDispatchId, line.saleOrderLineId),
        ]);
      if (receivedQuantity === 0) {
        throw HttpError.badRequest('This style/size has no confirmed received quantity under this Erve Dispatch');
      }
      const { availableForActualSale } = computeAvailability({
        receivedQuantity,
        actualSoldQuantity,
        returnedQuantity,
        approvedAwaitingReceiptQuantity,
        pendingRequestedQuantity,
      });
      if (line.quantitySold > availableForActualSale) {
        throw HttpError.badRequest(
          `Reported quantity exceeds the quantity available for Actual Sale (available ${availableForActualSale}, of which received ${receivedQuantity}, already sold ${actualSoldQuantity}, returned ${returnedQuantity}, approved-awaiting-receipt ${approvedAwaitingReceiptQuantity})`,
        );
      }
    }

    await tx.distributorSalesReport.create({
      data: {
        id: reportId,
        distributorId: input.distributorId,
        reportDate: new Date(input.reportDate),
        remarks: input.remarks ?? null,
        submittedById: actor.id,
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISTRIBUTOR_SALES_REPORT_SUBMITTED',
        entityType: 'DistributorSalesReport',
        entityId: reportId,
        metadata: { distributorId: input.distributorId, lineCount: input.lines.length },
      },
      tx,
    );

    // Deliberately does NOT create/touch InvoiceHandoff — this is an ACTUAL
    // SALE (commercial sell-through / royalty-reporting) fact, distinct from
    // the Dispatch Sale invoice handoff already created when the goods
    // physically left Erve India (see invoice-handoff.service.ts's module
    // doc). Recording an Actual Sale must never create a second invoice.
    for (const line of input.lines) {
      await tx.distributorSalesReportLine.create({
        data: {
          id: createId(),
          distributorSalesReportId: reportId,
          erveDispatchId: line.erveDispatchId,
          saleOrderLineId: line.saleOrderLineId,
          quantitySold: line.quantitySold,
        },
      });
    }
  });

  return getDistributorSalesReportDetail(actor, reportId);
}
