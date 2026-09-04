import { createId } from '@erve/shared';
import { canMutateErveDispatch, canViewErveDispatch, canViewErvePackingList } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { computeSaleOrderFulfillmentProgress } from './fulfillment-progress.js';
import { createInvoiceHandoffsForDispatch } from './invoice-handoff.service.js';
import {
  computeAvailability,
  getActualSoldQuantityForPair,
  getApprovedAwaitingReceiptQuantityForPair,
  getPendingRequestedQuantityForPair,
  getReceivedQuantityForPair,
  getReturnedQuantityForPair,
} from './sale-or-return-quantities.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function assertPackingListMutationAccess(actor: CurrentUser): void {
  if (!canMutateErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to consolidate Factory Dispatches');
  }
}

function assertPackingListViewAccess(actor: CurrentUser): void {
  if (!canViewErvePackingList(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Packing Lists');
  }
}

function assertDispatchMutationAccess(actor: CurrentUser): void {
  if (!canMutateErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to record Erve Dispatches');
  }
}

// Sees every Distributor's Erve Dispatches (no per-row ownership check),
// mirroring canListAllSaleOrders — ACCOUNTANT included since this view is
// already sanitized (no Factory/QA/StockAllocation provenance, see
// ErveDispatchView) unlike the Erve Packing List detail above.
function isBroadErveDispatchViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function assertDispatchViewAccess(actor: CurrentUser, distributorId: string): void {
  if (!canViewErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Dispatches');
  }
  if (!isBroadErveDispatchViewer(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this dispatch');
  }
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function generateErvePackingListNumber(client: Tx, financialYear: { id: string; code: string }) {
  const serial = await allocateDocumentSerial(client, 'ERVE_PACKING_LIST', financialYear.id);
  return {
    ervePackingListNumber: formatDocumentNumber(DOCUMENT_PREFIXES.ERVE_PACKING_LIST, financialYear.code, serial),
    ervePackingListSerial: serial,
  };
}

async function generateErveDispatchNumber(client: Tx, financialYear: { id: string; code: string }) {
  const serial = await allocateDocumentSerial(client, 'ERVE_DISPATCH', financialYear.id);
  return {
    erveDispatchNumber: formatDocumentNumber(DOCUMENT_PREFIXES.ERVE_DISPATCH, financialYear.code, serial),
    erveDispatchSerial: serial,
  };
}

// ---------------------------------------------------------------------------
// Erve Packing List — consolidation
// ---------------------------------------------------------------------------

const packingListInclude = {
  saleOrder: {
    select: { id: true, saleOrderNumber: true, distributor: { select: { id: true, code: true, name: true } } },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  dispatch: { select: { id: true } },
  sources: {
    include: {
      factoryDispatch: {
        include: {
          factory: { select: { id: true, code: true, name: true } },
          lines: {
            include: {
              saleOrderLine: {
                select: {
                  purchaseOrderLineSize: {
                    select: {
                      sizeId: true,
                      size: { select: { code: true, label: true } },
                      purchaseOrderLine: {
                        select: { styleId: true, style: { select: { styleNumber: true, styleName: true } } },
                      },
                    },
                  },
                },
              },
              cartonLines: { select: { quantity: true } },
            },
          },
          cartons: {
            include: {
              lines: {
                include: {
                  factoryDispatchLine: {
                    select: {
                      saleOrderLine: {
                        select: {
                          purchaseOrderLineSize: {
                            select: {
                              size: { select: { code: true, label: true } },
                              purchaseOrderLine: { select: { style: { select: { styleNumber: true, styleName: true } } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ErvePackingListInclude;

type PackingListRecord = Prisma.ErvePackingListGetPayload<{ include: typeof packingListInclude }>;

function toFactoryDispatchLineView(line: PackingListRecord['sources'][number]['factoryDispatch']['lines'][number]) {
  const pols = line.saleOrderLine.purchaseOrderLineSize;
  const pol = pols.purchaseOrderLine;
  return {
    id: line.id,
    saleOrderLineId: line.saleOrderLineId,
    stockAllocationId: line.stockAllocationId,
    styleId: pol.styleId,
    styleNumber: pol.style.styleNumber,
    styleName: pol.style.styleName,
    sizeId: pols.sizeId,
    sizeCode: pols.size.code,
    sizeLabel: pols.size.label,
    packedQuantity: line.packedQuantity,
    cartonedQuantity: line.cartonLines.reduce((sum, cartonLine) => sum + cartonLine.quantity, 0),
  };
}

function toFactoryPackingCartonView(carton: PackingListRecord['sources'][number]['factoryDispatch']['cartons'][number]) {
  return {
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    packageDetails: carton.packageDetails,
    weight: carton.weight?.toString() ?? null,
    createdAt: carton.createdAt.toISOString(),
    lines: carton.lines.map((cartonLine) => {
      const pols = cartonLine.factoryDispatchLine.saleOrderLine.purchaseOrderLineSize;
      const pol = pols.purchaseOrderLine;
      return {
        factoryDispatchLineId: cartonLine.factoryDispatchLineId,
        styleNumber: pol.style.styleNumber,
        styleName: pol.style.styleName,
        sizeCode: pols.size.code,
        sizeLabel: pols.size.label,
        quantity: cartonLine.quantity,
      };
    }),
  };
}

function totalQuantityOf(record: PackingListRecord): number {
  return record.sources.reduce(
    (sum, source) => sum + source.factoryDispatch.lines.reduce((lineSum, line) => lineSum + line.packedQuantity, 0),
    0,
  );
}

function toPackingListSummary(record: PackingListRecord) {
  return {
    id: record.id,
    ervePackingListNumber: record.ervePackingListNumber,
    saleOrder: record.saleOrder,
    status: record.status,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    totalQuantity: totalQuantityOf(record),
  };
}

function toPackingListDetail(record: PackingListRecord) {
  return {
    ...toPackingListSummary(record),
    sources: record.sources.map((source) => ({
      factoryDispatchId: source.factoryDispatch.id,
      factoryDispatchNumber: source.factoryDispatch.factoryDispatchNumber,
      factory: source.factoryDispatch.factory,
      lines: source.factoryDispatch.lines.map(toFactoryDispatchLineView),
      cartons: source.factoryDispatch.cartons.map(toFactoryPackingCartonView),
    })),
  };
}

async function loadPackingList(id: string): Promise<PackingListRecord> {
  const record = await prisma.ervePackingList.findUnique({ where: { id }, include: packingListInclude });
  if (!record) throw HttpError.notFound('Erve packing list not found');
  return record;
}

export async function getErvePackingListDetail(actor: CurrentUser, id: string) {
  assertPackingListViewAccess(actor);
  return toPackingListDetail(await loadPackingList(id));
}

export async function getErvePackingListList(
  actor: CurrentUser,
  filters: { saleOrderId?: string; status?: 'OPEN' | 'DISPATCHED'; cursor?: string; limit: number },
) {
  assertPackingListViewAccess(actor);
  const records = await prisma.ervePackingList.findMany({
    where: { saleOrderId: filters.saleOrderId, status: filters.status },
    include: packingListInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map(toPackingListSummary),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export interface CreateErvePackingListInput {
  saleOrderId: string;
  factoryDispatchIds: string[];
}

export async function createErvePackingList(actor: CurrentUser, input: CreateErvePackingListInput) {
  assertPackingListMutationAccess(actor);

  const factoryDispatchIds = [...new Set(input.factoryDispatchIds)];
  if (factoryDispatchIds.length !== input.factoryDispatchIds.length) {
    throw HttpError.badRequest('Duplicate Factory Dispatch entries are not allowed');
  }

  const packingListId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${input.saleOrderId}`}))`;

    const order = await tx.saleOrder.findUnique({ where: { id: input.saleOrderId } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.status !== 'APPROVED') {
      throw HttpError.badRequest(`Sale order in status ${order.status} is not eligible for consolidation`);
    }

    const sorted = [...factoryDispatchIds].sort();
    for (const id of sorted) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;
    }

    const dispatches = await tx.factoryDispatch.findMany({
      where: { id: { in: factoryDispatchIds } },
      include: { ervePackingSource: { select: { id: true } } },
    });
    const dispatchById = new Map(dispatches.map((d) => [d.id, d]));
    for (const id of factoryDispatchIds) {
      const dispatch = dispatchById.get(id);
      if (!dispatch) throw HttpError.notFound(`Factory dispatch ${id} not found`);
      if (dispatch.saleOrderId !== input.saleOrderId) {
        throw HttpError.badRequest(`Factory dispatch ${id} does not belong to this Sale Order`);
      }
      if (dispatch.status !== 'READY_FOR_ERVE') {
        throw HttpError.badRequest(`Factory dispatch ${id} must be finalized (READY_FOR_ERVE) before consolidation`);
      }
      if (dispatch.ervePackingSource) {
        throw HttpError.conflict(`Factory dispatch ${id} has already been consolidated into another Erve Packing List`);
      }
    }

    const financialYear = await ensureFinancialYear(tx, new Date());
    const { ervePackingListNumber, ervePackingListSerial } = await generateErvePackingListNumber(tx, financialYear);

    await tx.ervePackingList.create({
      data: {
        id: packingListId,
        ervePackingListNumber,
        saleOrderId: input.saleOrderId,
        status: 'OPEN',
        createdById: actor.id,
        financialYearId: financialYear.id,
        ervePackingListSerial,
        sources: {
          create: factoryDispatchIds.map((factoryDispatchId) => ({ id: createId(), factoryDispatchId })),
        },
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_PACKING_LIST_CREATED',
        entityType: 'ErvePackingList',
        entityId: packingListId,
        metadata: { ervePackingListNumber, saleOrderId: input.saleOrderId, factoryDispatchIds },
      },
      tx,
    );
  });

  return getErvePackingListDetail(actor, packingListId);
}

// ---------------------------------------------------------------------------
// Erve Dispatch — physical dispatch to Distributor
// ---------------------------------------------------------------------------

const erveDispatchInclude = {
  ervePackingList: { select: { id: true, ervePackingListNumber: true } },
  saleOrder: { select: { id: true, saleOrderNumber: true } },
  distributor: { select: { id: true, code: true, name: true } },
  dispatchedBy: { select: { id: true, name: true, email: true } },
  lrUpdatedBy: { select: { id: true, name: true, email: true } },
  deliveredBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ErveDispatchInclude;

type ErveDispatchRecord = Prisma.ErveDispatchGetPayload<{ include: typeof erveDispatchInclude }>;

async function computePackingListQuantity(client: Tx | typeof prisma, ervePackingListId: string): Promise<number> {
  const rows = await client.factoryDispatchLine.findMany({
    where: { factoryDispatch: { ervePackingSource: { ervePackingListId } } },
    select: { packedQuantity: true },
  });
  return rows.reduce((sum, row) => sum + row.packedQuantity, 0);
}

// Breaks this Dispatch's packed quantity down per SaleOrderLine and resolves
// each line's COMMERCIAL PurchaseMode (never StockAllocation/QaReleaseLine
// physical provenance — see invoice-handoff.service.ts) purely for display
// context. EVERY line — both Purchase Modes — already has an auto-created
// InvoiceHandoff (the "Dispatch Sale"); SALE_RETURN lines additionally get a
// consignment-position entry (dispatched/actual sold/remaining) so a
// mixed-mode Dispatch shows both the invoice status and, where relevant, the
// Sale-or-Return position without a second navigation.
async function computeDispatchFinancialBreakdown(erveDispatchId: string, ervePackingListId: string) {
  const lines = await prisma.factoryDispatchLine.findMany({
    where: { factoryDispatch: { ervePackingSource: { ervePackingListId } } },
    select: {
      saleOrderLineId: true,
      packedQuantity: true,
      saleOrderLine: {
        select: {
          purchaseOrderLineSize: {
            select: {
              sizeId: true,
              size: { select: { code: true, label: true } },
              purchaseOrderLine: {
                select: {
                  styleId: true,
                  style: { select: { styleNumber: true, styleName: true } },
                  purchaseOrder: { select: { purchaseMode: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  type LineMeta = {
    quantity: number;
    purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
  };
  const bySaleOrderLine = new Map<string, LineMeta>();
  for (const line of lines) {
    const pols = line.saleOrderLine.purchaseOrderLineSize;
    const existing = bySaleOrderLine.get(line.saleOrderLineId);
    if (existing) {
      existing.quantity += line.packedQuantity;
      continue;
    }
    bySaleOrderLine.set(line.saleOrderLineId, {
      quantity: line.packedQuantity,
      purchaseMode: pols.purchaseOrderLine.purchaseOrder.purchaseMode,
      styleNumber: pols.purchaseOrderLine.style.styleNumber,
      styleName: pols.purchaseOrderLine.style.styleName,
      sizeCode: pols.size.code,
      sizeLabel: pols.size.label,
    });
  }

  const invoiceHandoffs: Array<{
    invoiceHandoffId: string;
    saleOrderLineId: string;
    purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
    status: 'PENDING_TALLY' | 'INVOICED';
    tallyInvoiceNumber: string | null;
    tallyInvoiceDate: string | null;
  }> = [];
  if (bySaleOrderLine.size > 0) {
    const handoffs = await prisma.invoiceHandoff.findMany({
      where: { erveDispatchId, saleOrderLineId: { in: [...bySaleOrderLine.keys()] } },
      select: { id: true, saleOrderLineId: true, status: true, tallyInvoiceNumber: true, tallyInvoiceDate: true },
    });
    for (const handoff of handoffs) {
      const meta = bySaleOrderLine.get(handoff.saleOrderLineId)!;
      invoiceHandoffs.push({
        invoiceHandoffId: handoff.id,
        saleOrderLineId: handoff.saleOrderLineId,
        purchaseMode: meta.purchaseMode,
        styleNumber: meta.styleNumber,
        styleName: meta.styleName,
        sizeCode: meta.sizeCode,
        sizeLabel: meta.sizeLabel,
        quantity: meta.quantity,
        status: handoff.status,
        tallyInvoiceNumber: handoff.tallyInvoiceNumber,
        tallyInvoiceDate: handoff.tallyInvoiceDate?.toISOString() ?? null,
      });
    }
  }

  const saleReturnSaleOrderLineIds = [...bySaleOrderLine.entries()].filter(([, meta]) => meta.purchaseMode === 'SALE_RETURN').map(([id]) => id);
  const saleOrReturnLines: Array<{
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
  }> = [];
  for (const saleOrderLineId of saleReturnSaleOrderLineIds) {
    const meta = bySaleOrderLine.get(saleOrderLineId)!;
    const [receivedQuantity, actualSoldQuantity, returnedQuantity, approvedAwaitingReceiptQuantity, pendingRequestedQuantity] =
      await Promise.all([
        getReceivedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getActualSoldQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getReturnedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getApprovedAwaitingReceiptQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getPendingRequestedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
      ]);
    const availability = computeAvailability({
      receivedQuantity,
      actualSoldQuantity,
      returnedQuantity,
      approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity,
    });
    saleOrReturnLines.push({
      saleOrderLineId,
      styleNumber: meta.styleNumber,
      styleName: meta.styleName,
      sizeCode: meta.sizeCode,
      sizeLabel: meta.sizeLabel,
      dispatchedQuantity: meta.quantity,
      receivedQuantity,
      actualSoldQuantity,
      returnedQuantity,
      approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity,
      remainingWithDistributor: availability.remainingWithDistributor,
      returnableQuantity: availability.availableForNewReturn,
    });
  }

  return { invoiceHandoffs, saleOrReturnLines };
}

async function toErveDispatchView(record: ErveDispatchRecord) {
  const totalQuantity = await computePackingListQuantity(prisma, record.ervePackingListId);
  const { invoiceHandoffs, saleOrReturnLines } = await computeDispatchFinancialBreakdown(record.id, record.ervePackingListId);
  return {
    id: record.id,
    erveDispatchNumber: record.erveDispatchNumber,
    ervePackingList: record.ervePackingList,
    saleOrder: record.saleOrder,
    distributor: record.distributor,
    status: record.status,
    dispatchDate: record.dispatchDate.toISOString(),
    transporter: record.transporter,
    vehicleNumber: record.vehicleNumber,
    lrNumber: record.lrNumber,
    remarks: record.remarks,
    dispatchedBy: record.dispatchedBy,
    dispatchedAt: record.dispatchedAt.toISOString(),
    lrUpdatedBy: record.lrUpdatedBy,
    lrUpdatedAt: record.lrUpdatedAt?.toISOString() ?? null,
    deliveredBy: record.deliveredBy,
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    deliveryRemarks: record.deliveryRemarks,
    deliveryConfirmationSource: record.deliveryConfirmationSource,
    totalQuantity,
    invoiceHandoffs,
    saleOrReturnLines,
    version: record.version,
    updatedAt: record.dispatchedAt.toISOString(),
  };
}

async function loadErveDispatch(id: string): Promise<ErveDispatchRecord> {
  const record = await prisma.erveDispatch.findUnique({ where: { id }, include: erveDispatchInclude });
  if (!record) throw HttpError.notFound('Erve dispatch not found');
  return record;
}

export async function getErveDispatchDetail(actor: CurrentUser, id: string) {
  const record = await loadErveDispatch(id);
  assertDispatchViewAccess(actor, record.distributor.id);
  return toErveDispatchView(record);
}

export async function getErveDispatchList(
  actor: CurrentUser,
  filters: { saleOrderId?: string; distributorId?: string; cursor?: string; limit: number },
) {
  if (!canViewErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Dispatches');
  }
  const distributorId = isBroadErveDispatchViewer(actor) ? filters.distributorId : getSoleDistributorId(actor);

  const records = await prisma.erveDispatch.findMany({
    where: { saleOrderId: filters.saleOrderId, distributorId },
    include: erveDispatchInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  const items = await Promise.all(page.map(toErveDispatchView));
  return { items, pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null } };
}

export interface RecordErveDispatchInput {
  ervePackingListId: string;
  dispatchDate: string;
  transporter?: string | null;
  vehicleNumber?: string | null;
  lrNumber?: string | null;
  remarks?: string | null;
}

export async function recordErveDispatch(actor: CurrentUser, input: RecordErveDispatchInput) {
  assertDispatchMutationAccess(actor);

  const dispatchId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-packing-list-${input.ervePackingListId}`}))`;

    const packingList = await tx.ervePackingList.findUnique({ where: { id: input.ervePackingListId } });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'OPEN') {
      throw HttpError.conflict('This Erve Packing List has already been dispatched');
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${packingList.saleOrderId}`}))`;
    const order = await tx.saleOrder.findUnique({ where: { id: packingList.saleOrderId } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.status !== 'APPROVED') {
      throw HttpError.badRequest(`Sale order in status ${order.status} cannot be dispatched`);
    }

    const financialYear = await ensureFinancialYear(tx, new Date(input.dispatchDate));
    const { erveDispatchNumber, erveDispatchSerial } = await generateErveDispatchNumber(tx, financialYear);

    await tx.erveDispatch.create({
      data: {
        id: dispatchId,
        erveDispatchNumber,
        ervePackingListId: input.ervePackingListId,
        saleOrderId: packingList.saleOrderId,
        distributorId: order.distributorId,
        status: 'DISPATCHED',
        dispatchDate: new Date(input.dispatchDate),
        transporter: input.transporter ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
        lrNumber: input.lrNumber ?? null,
        remarks: input.remarks ?? null,
        dispatchedById: actor.id,
        financialYearId: financialYear.id,
        erveDispatchSerial,
      },
    });
    await tx.ervePackingList.update({ where: { id: input.ervePackingListId }, data: { status: 'DISPATCHED' } });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_RECORDED',
        entityType: 'ErveDispatch',
        entityId: dispatchId,
        metadata: { erveDispatchNumber, ervePackingListId: input.ervePackingListId, saleOrderId: packingList.saleOrderId },
      },
      tx,
    );

    // OUTRIGHT-sourced quantity in this Dispatch becomes invoiceable
    // immediately — one PENDING_TALLY InvoiceHandoff per SaleOrderLine, in
    // this same transaction. SALE_RETURN-sourced quantity gets nothing here:
    // it only becomes invoiceable once the Distributor reports it sold (see
    // distributor-sales-report.service.ts) — physical dispatch and financial
    // sale are separate events for SALE_RETURN (see the schema module doc).
    await createInvoiceHandoffsForDispatch(tx, actor, dispatchId, erveDispatchNumber, input.ervePackingListId);

    // Recompute cumulative dispatched quantity for every approved line inside
    // this same transaction — only when every approved line's cumulative
    // dispatched quantity now equals its approved quantity does the Sale
    // Order become FULFILLED (see the fulfillment schema module doc).
    const lines = await tx.saleOrderLine.findMany({
      where: { saleOrderId: order.id },
      select: { id: true, approvedQuantity: true },
    });
    const progress = await computeSaleOrderFulfillmentProgress(tx, order.id, { status: order.status }, lines);
    const fullyDispatched =
      progress.totalApprovedQuantity > 0 && progress.totalDispatchedQuantity === progress.totalApprovedQuantity;

    if (fullyDispatched) {
      await tx.saleOrder.update({
        where: { id: order.id },
        data: {
          status: 'FULFILLED',
          fulfilledById: actor.id,
          fulfilledAt: new Date(),
          fulfillmentReference: erveDispatchNumber,
          version: { increment: 1 },
        },
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'SALE_ORDER_FULFILLED',
          entityType: 'SaleOrder',
          entityId: order.id,
          metadata: { saleOrderNumber: order.saleOrderNumber, fulfillmentReference: erveDispatchNumber },
        },
        tx,
      );
    }
  });

  return getErveDispatchDetail(actor, dispatchId);
}

export async function updateErveDispatchLr(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; transporter?: string | null; vehicleNumber?: string | null; lrNumber?: string | null },
) {
  assertDispatchMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;

    const dispatch = await tx.erveDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Erve dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);

    const updated = await tx.erveDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        transporter: input.transporter !== undefined ? input.transporter : undefined,
        vehicleNumber: input.vehicleNumber !== undefined ? input.vehicleNumber : undefined,
        lrNumber: input.lrNumber !== undefined ? input.lrNumber : undefined,
        lrUpdatedById: actor.id,
        lrUpdatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_LR_UPDATED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: { erveDispatchNumber: dispatch.erveDispatchNumber },
      },
      tx,
    );
  });

  return getErveDispatchDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Delivery confirmation — the "received by distributor" fact that
// DistributorSalesReport and DistributorReturn key off (see
// sale-or-return-quantities.ts). This is a single DISPATCHED -> DELIVERED
// transition (not append-only/repeatable) performed by the same
// merchandising-team fallback actor that already owns the LR update, per the
// BRD's "if transporter does not use the delivery link, the merchandising
// team... marks goods as delivered." POD upload / transporter link are out
// of scope here — only this fallback path is built.
// ---------------------------------------------------------------------------

export interface ConfirmErveDispatchDeliveryInput {
  expectedVersion: number;
  lines: Array<{ saleOrderLineId: string; receivedQuantity: number }>;
  remarks?: string | null;
}

export async function confirmErveDispatchDelivery(actor: CurrentUser, id: string, input: ConfirmErveDispatchDeliveryInput) {
  assertDispatchMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;

    const dispatch = await tx.erveDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Erve dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DISPATCHED') {
      throw HttpError.conflict('This Erve Dispatch has already been marked delivered');
    }

    const packedLines = await tx.factoryDispatchLine.findMany({
      where: { factoryDispatch: { ervePackingSource: { ervePackingListId: dispatch.ervePackingListId } } },
      select: { saleOrderLineId: true, packedQuantity: true },
    });
    const dispatchedBySaleOrderLine = new Map<string, number>();
    for (const line of packedLines) {
      dispatchedBySaleOrderLine.set(line.saleOrderLineId, (dispatchedBySaleOrderLine.get(line.saleOrderLineId) ?? 0) + line.packedQuantity);
    }

    const inputSaleOrderLineIds = new Set(input.lines.map((l) => l.saleOrderLineId));
    if (inputSaleOrderLineIds.size !== input.lines.length) {
      throw HttpError.badRequest('Duplicate saleOrderLineId entries are not allowed');
    }
    if (inputSaleOrderLineIds.size !== dispatchedBySaleOrderLine.size || [...dispatchedBySaleOrderLine.keys()].some((id) => !inputSaleOrderLineIds.has(id))) {
      throw HttpError.badRequest('Delivery confirmation must cover exactly the lines dispatched on this Erve Dispatch');
    }

    let totalReceived = 0;
    let anyShort = false;
    for (const line of input.lines) {
      const dispatchedQuantity = dispatchedBySaleOrderLine.get(line.saleOrderLineId);
      if (dispatchedQuantity === undefined) {
        throw HttpError.badRequest(`Sale order line ${line.saleOrderLineId} was not dispatched on this Erve Dispatch`);
      }
      if (line.receivedQuantity < 0 || line.receivedQuantity > dispatchedQuantity) {
        throw HttpError.badRequest(`Received quantity for ${line.saleOrderLineId} must be between 0 and the dispatched quantity (${dispatchedQuantity})`);
      }
      totalReceived += line.receivedQuantity;
      if (line.receivedQuantity < dispatchedQuantity) anyShort = true;
    }

    if (totalReceived <= 0) {
      throw HttpError.badRequest('At least one line must have a received quantity greater than zero to confirm delivery');
    }
    if (anyShort && !input.remarks?.trim()) {
      throw HttpError.badRequest('Delivery remarks are required when any line is received short of the dispatched quantity');
    }

    await tx.erveDispatchDeliveryLine.createMany({
      data: input.lines.map((line) => ({
        id: createId(),
        erveDispatchId: id,
        saleOrderLineId: line.saleOrderLineId,
        receivedQuantity: line.receivedQuantity,
      })),
    });

    const updated = await tx.erveDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'DELIVERED',
        deliveredById: actor.id,
        deliveredAt: new Date(),
        deliveryRemarks: input.remarks ?? null,
        deliveryConfirmationSource: 'USER_CONFIRMED',
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_DELIVERY_CONFIRMED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: { erveDispatchNumber: dispatch.erveDispatchNumber, totalReceived, lineCount: input.lines.length },
      },
      tx,
    );
  });

  return getErveDispatchDetail(actor, id);
}
