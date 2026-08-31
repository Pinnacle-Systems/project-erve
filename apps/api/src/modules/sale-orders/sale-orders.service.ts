import { createId } from '@erve/shared';
import { createHash } from 'node:crypto';
import { Prisma, prisma } from '../../db/prisma.js';
import type { SaleOrderStatus, StockAllocationSource } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import {
  getAvailableQuantities,
  getEligibleStockForDistributor,
  getGlobalInventory,
  getReleaseLineDistributorIds,
} from './inventory.service.js';

type Tx = Prisma.TransactionClient;

const ACTIVE_REVIEW_STATUSES: SaleOrderStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

// Reduction priority: undo the merchandiser's own sourcing decisions before
// ever touching the distributor's original request.
const SOURCE_RELEASE_PRIORITY: Record<StockAllocationSource, number> = {
  MERCHANDISER_REASSIGNMENT: 0,
  MERCHANDISER_ADJUSTMENT: 1,
  DISTRIBUTOR_REQUEST: 2,
};

// ---------------------------------------------------------------------------
// Sale Order number generation
// ---------------------------------------------------------------------------

// The Sale Order's own Financial Year, derived from its own soDate — never
// inherited from the referenced Purchase Order(s) — matching the
// DistributorPurchaseOrder/JobOrder convention.
async function generateSaleOrderNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ saleOrderNumber: string; saleOrderSerial: number }> {
  const saleOrderSerial = await allocateDocumentSerial(client, 'SALE_ORDER', financialYear.id);
  return {
    saleOrderNumber: formatDocumentNumber(DOCUMENT_PREFIXES.SALE_ORDER, financialYear.code, saleOrderSerial),
    saleOrderSerial,
  };
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const soInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  financialYear: { select: { id: true, code: true } },
  lines: {
    include: {
      purchaseOrderLineSize: {
        include: {
          size: { select: { id: true, code: true, label: true, sortOrder: true } },
          purchaseOrderLine: {
            include: {
              style: { select: { id: true, styleNumber: true, styleName: true } },
              purchaseOrder: { select: { id: true, poNumber: true } },
            },
          },
        },
      },
      allocations: {
        include: {
          qaReleaseLine: {
            include: {
              release: {
                select: {
                  releasedAt: true,
                  jobOrder: {
                    select: {
                      id: true,
                      jobOrderNumber: true,
                      factory: { select: { id: true, code: true, name: true } },
                    },
                  },
                },
              },
              purchaseOrderLineSize: {
                include: {
                  purchaseOrderLine: {
                    include: {
                      purchaseOrder: {
                        select: {
                          id: true,
                          poNumber: true,
                          distributor: { select: { id: true, code: true, name: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SaleOrderInclude;

type SORecord = Prisma.SaleOrderGetPayload<{ include: typeof soInclude }>;
type SOLineRecord = SORecord['lines'][number];
type SOAllocationRecord = SOLineRecord['allocations'][number];

function toAllocationView(allocation: SOAllocationRecord, includeFullProvenance: boolean) {
  const base = {
    id: allocation.id,
    quantity: allocation.quantity,
    status: allocation.status,
    allocationSource: allocation.allocationSource,
    reason: allocation.reason,
    createdAt: allocation.createdAt.toISOString(),
  };

  // A distributor viewer never sees another distributor's PO/JO identity,
  // even for stock reassigned onto their own approved order — only the fact
  // that a reassignment occurred and how many units.
  if (!includeFullProvenance && allocation.allocationSource === 'MERCHANDISER_REASSIGNMENT') {
    return { ...base, source: null };
  }

  const releaseLine = allocation.qaReleaseLine;
  const purchaseOrderLine = releaseLine.purchaseOrderLineSize.purchaseOrderLine;
  return {
    ...base,
    source: {
      qaReleaseLineId: releaseLine.id,
      distributor: purchaseOrderLine.purchaseOrder.distributor,
      purchaseOrder: { id: purchaseOrderLine.purchaseOrderId, poNumber: purchaseOrderLine.purchaseOrder.poNumber },
      jobOrder: {
        id: releaseLine.release.jobOrder.id,
        jobOrderNumber: releaseLine.release.jobOrder.jobOrderNumber,
      },
      factory: releaseLine.release.jobOrder.factory,
      releasedAt: releaseLine.release.releasedAt.toISOString(),
    },
  };
}

function toLineView(line: SOLineRecord, includeFullProvenance: boolean) {
  const pols = line.purchaseOrderLineSize;
  const pol = pols.purchaseOrderLine;
  return {
    id: line.id,
    purchaseOrderLineSizeId: pols.id,
    purchaseOrderId: pol.purchaseOrderId,
    poNumber: pol.purchaseOrder.poNumber,
    styleId: pol.styleId,
    styleNumber: pol.style.styleNumber,
    styleName: pol.style.styleName,
    sizeId: pols.sizeId,
    sizeCode: pols.size.code,
    sizeLabel: pols.size.label,
    orderedQuantity: pols.orderedQuantity,
    qaPassedQuantity: pols.qaPassedQuantity,
    requestedQuantity: line.requestedQuantity,
    approvedQuantity: line.approvedQuantity,
    remarks: line.remarks,
    allocations: line.allocations.map((allocation) => toAllocationView(allocation, includeFullProvenance)),
  };
}

function toSaleOrderView(order: SORecord, viewer: CurrentUser) {
  const includeFullProvenance = canViewAllSaleOrders(viewer);
  const lines = order.lines.map((line) => toLineView(line, includeFullProvenance));
  return {
    id: order.id,
    saleOrderNumber: order.saleOrderNumber,
    distributor: order.distributor,
    financialYear: order.financialYear,
    soDate: order.soDate.toISOString(),
    status: order.status,
    creator: order.creator,
    reviewedBy: order.reviewedBy,
    remarks: order.remarks,
    submittedAt: order.submittedAt?.toISOString() ?? null,
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    decisionReason: order.decisionReason,
    lines,
    totalRequestedQuantity: lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
    totalApprovedQuantity: lines.reduce((sum, line) => sum + (line.approvedQuantity ?? 0), 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    version: order.version,
  };
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function canViewAllSaleOrders(user: CurrentUser): boolean {
  return user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT');
}

function assertSaleOrderViewAccess(user: CurrentUser, order: { distributorId: string }): void {
  if (canViewAllSaleOrders(user)) return;
  if (user.roles.includes('DISTRIBUTOR') && getSoleDistributorId(user) === order.distributorId) return;
  throw HttpError.forbidden('You do not have access to this sale order');
}

function assertSaleOrderReviewAccess(user: CurrentUser): void {
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER')) {
    throw HttpError.forbidden('You do not have permission to review sale orders');
  }
}

function assertSaleOrderDistributorOwnership(user: CurrentUser, order: { distributorId: string }): void {
  if (user.roles.includes('ADMIN')) return;
  if (getSoleDistributorId(user) !== order.distributorId) {
    throw HttpError.forbidden('You do not have access to this sale order');
  }
}

// ---------------------------------------------------------------------------
// Idempotency (mirrors JobOrderIdempotencyRecord's actorId:operation:key scheme)
// ---------------------------------------------------------------------------

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function beginIdempotentOperation(
  tx: Tx,
  actorId: string,
  saleOrderId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actorId}:${operation}:${idempotencyKey}`}))`;
  const existing = await tx.saleOrderIdempotencyRecord.findUnique({
    where: { actorId_operation_idempotencyKey: { actorId, operation, idempotencyKey } },
  });
  if (!existing) return false;
  if (existing.saleOrderId !== saleOrderId || existing.requestHash !== hash) {
    throw HttpError.idempotencyKeyReused();
  }
  return true;
}

async function finishIdempotentOperation(
  tx: Tx,
  actorId: string,
  saleOrderId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
  resultVersion: number,
): Promise<void> {
  await tx.saleOrderIdempotencyRecord.create({
    data: { id: createId(), actorId, saleOrderId, operation, idempotencyKey, requestHash: hash, resultVersion },
  });
}

async function releaseAllActiveAllocations(tx: Tx, saleOrderId: string, actorId: string): Promise<number> {
  const result = await tx.stockAllocation.updateMany({
    where: { status: 'ACTIVE', saleOrderLine: { saleOrderId } },
    data: { status: 'RELEASED', releasedById: actorId, releasedAt: new Date() },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Line validation
// ---------------------------------------------------------------------------

async function validateSaleOrderLines(
  distributorId: string,
  lines: Array<{ purchaseOrderLineSizeId: string; requestedQuantity: number }>,
): Promise<void> {
  const ids = lines.map((line) => line.purchaseOrderLineSizeId);
  if (new Set(ids).size !== ids.length) {
    throw HttpError.badRequest('Duplicate purchase-order line/size entries are not allowed in the same sale order');
  }

  const sizes = await prisma.distributorPurchaseOrderLineSize.findMany({
    where: { id: { in: ids } },
    include: { purchaseOrderLine: { include: { purchaseOrder: { select: { distributorId: true } } } } },
  });
  const foundIds = new Set(sizes.map((size) => size.id));
  for (const id of ids) {
    if (!foundIds.has(id)) throw HttpError.badRequest(`Purchase order line/size ${id} not found`);
  }
  for (const size of sizes) {
    if (size.purchaseOrderLine.purchaseOrder.distributorId !== distributorId) {
      throw HttpError.badRequest(
        `Purchase order line/size ${size.id} does not belong to this distributor's purchase orders`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Service methods — CRUD
// ---------------------------------------------------------------------------

export async function getSaleOrderList(
  user: CurrentUser,
  filters: {
    search?: string;
    status?: SaleOrderStatus;
    distributorId?: string;
    financialYearId?: string;
    cursor?: string;
    limit: number;
  },
) {
  const distributorIdFilter = canViewAllSaleOrders(user) ? filters.distributorId : getSoleDistributorId(user);

  const where: Prisma.SaleOrderWhereInput = {
    distributorId: distributorIdFilter ?? undefined,
    status: filters.status,
    financialYearId: filters.financialYearId,
    OR: filters.search
      ? [{ saleOrderNumber: { contains: filters.search, mode: 'insensitive' } }]
      : undefined,
  };

  const orders = await prisma.saleOrder.findMany({
    where,
    include: soInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = orders.length > filters.limit;
  const page = hasMore ? orders.slice(0, filters.limit) : orders;
  return {
    items: page.map((order) => toSaleOrderView(order, user)),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getSaleOrderDetail(user: CurrentUser, id: string) {
  const order = await prisma.saleOrder.findUnique({ where: { id }, include: soInclude });
  if (!order) throw HttpError.notFound('Sale order not found');
  assertSaleOrderViewAccess(user, order);
  return toSaleOrderView(order, user);
}

// ---------------------------------------------------------------------------
// Audit history
// ---------------------------------------------------------------------------

const SALE_ORDER_AUDIT_TITLES: Record<string, string> = {
  SALE_ORDER_CREATED: 'Sale Order Created',
  SALE_ORDER_UPDATED: 'Draft Updated',
  SALE_ORDER_SUBMITTED: 'Submitted',
  SALE_ORDER_REVIEW_STARTED: 'Review Started',
  SALE_ORDER_APPROVED: 'Approved',
  SALE_ORDER_LINE_APPROVED: 'Line Approved',
  SALE_ORDER_REJECTED: 'Rejected',
  SALE_ORDER_CANCELLED: 'Cancelled',
};

function sentenceCaseAction(action: string): string {
  const words = action.trim().replaceAll('_', ' ').toLowerCase().trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Unknown event';
}

function auditMetadataObject(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

interface StoredAllocationAuditEntry {
  qaReleaseLineId: string;
  quantity: number;
  allocationSource?: string;
  reason?: string | null;
}

function asAllocationEntries(value: unknown): StoredAllocationAuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is StoredAllocationAuditEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).qaReleaseLineId === 'string' &&
      typeof (entry as Record<string, unknown>).quantity === 'number',
  );
}

interface ReassignmentSource {
  distributorName: string;
  poNumber: string;
  jobOrderNumber: string;
  factoryName: string;
}

// Resolves the CURRENT owning distributor/PO/Job Order/factory of a QA
// release line — a release line's source is fixed at creation and never
// moves, so this is an accurate historical fact, not a guess, even though
// it is not itself stored on the audit row (only the qaReleaseLineId is).
async function resolveReassignmentSources(releaseLineIds: string[]): Promise<Map<string, ReassignmentSource>> {
  if (releaseLineIds.length === 0) return new Map();
  const rows = await prisma.qaReleaseLine.findMany({
    where: { id: { in: releaseLineIds } },
    select: {
      id: true,
      release: {
        select: { jobOrder: { select: { jobOrderNumber: true, factory: { select: { name: true } } } } },
      },
      purchaseOrderLineSize: {
        select: {
          purchaseOrderLine: {
            select: { purchaseOrder: { select: { poNumber: true, distributor: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        distributorName: row.purchaseOrderLineSize.purchaseOrderLine.purchaseOrder.distributor.name,
        poNumber: row.purchaseOrderLineSize.purchaseOrderLine.purchaseOrder.poNumber,
        jobOrderNumber: row.release.jobOrder.jobOrderNumber,
        factoryName: row.release.jobOrder.factory.name,
      },
    ]),
  );
}

// A DISTRIBUTOR viewer (even the owning one) must never learn another
// distributor's identity/PO/Job Order/factory from a MERCHANDISER_REASSIGNMENT
// allocation — the Sale Order detail view already masks this (toAllocationView
// above); the audit trail must mask it identically.
function describeAddedAllocation(
  entry: StoredAllocationAuditEntry,
  includeFullProvenance: boolean,
  sources: Map<string, ReassignmentSource>,
): string {
  if (entry.allocationSource === 'MERCHANDISER_REASSIGNMENT') {
    if (includeFullProvenance) {
      const source = sources.get(entry.qaReleaseLineId);
      return source
        ? `+${entry.quantity} sourced from ${source.distributorName}'s stock (PO ${source.poNumber}, Job Order ${source.jobOrderNumber})`
        : `+${entry.quantity} sourced from another distributor's stock`;
    }
    return `+${entry.quantity} additional stock allocated by Merchandiser`;
  }
  if (entry.allocationSource === 'MERCHANDISER_ADJUSTMENT') {
    return `+${entry.quantity} allocated from this distributor's other released stock`;
  }
  return `+${entry.quantity} allocated`;
}

function describeLineApproval(
  metadata: Record<string, unknown>,
  lineContext: { styleNumber: string; sizeLabel: string } | undefined,
  includeFullProvenance: boolean,
  sources: Map<string, ReassignmentSource>,
): string {
  const requested = typeof metadata.requestedQuantity === 'number' ? metadata.requestedQuantity : undefined;
  const approved = typeof metadata.approvedQuantity === 'number' ? metadata.approvedQuantity : undefined;
  const label = lineContext ? `${lineContext.styleNumber} / ${lineContext.sizeLabel}` : 'Line';
  const parts: string[] =
    requested !== undefined && approved !== undefined
      ? [`${label}: Requested ${requested} → Approved ${approved}`]
      : [label];
  for (const entry of asAllocationEntries(metadata.allocationsAdded)) {
    parts.push(describeAddedAllocation(entry, includeFullProvenance, sources));
  }
  return parts.join('; ');
}

function describeCancellation(metadata: Record<string, unknown>): string {
  const previousStatus = nonEmptyString(metadata.previousStatus);
  const releasedAllocationCount =
    typeof metadata.releasedAllocationCount === 'number' ? metadata.releasedAllocationCount : 0;
  const reason = nonEmptyString(metadata.reason);
  const base =
    previousStatus === 'APPROVED'
      ? `Cancelled from Approved${releasedAllocationCount > 0 ? '; committed allocations released' : ''}`
      : previousStatus
        ? `Cancelled from ${sentenceCaseAction(previousStatus)}`
        : 'Cancelled';
  return reason ? `${base}. Reason: ${reason}` : `${base}.`;
}

export async function getSaleOrderAuditHistory(user: CurrentUser, id: string) {
  const order = await prisma.saleOrder.findUnique({ where: { id }, select: { id: true, distributorId: true } });
  if (!order) throw HttpError.notFound('Sale order not found');
  assertSaleOrderViewAccess(user, order);

  const includeFullProvenance = canViewAllSaleOrders(user);

  const lines = await prisma.saleOrderLine.findMany({
    where: { saleOrderId: id },
    select: {
      id: true,
      purchaseOrderLineSize: {
        select: {
          size: { select: { label: true } },
          purchaseOrderLine: { select: { style: { select: { styleNumber: true } } } },
        },
      },
    },
  });
  const lineContextById = new Map(
    lines.map((line) => [
      line.id,
      {
        styleNumber: line.purchaseOrderLineSize.purchaseOrderLine.style.styleNumber,
        sizeLabel: line.purchaseOrderLineSize.size.label,
      },
    ]),
  );

  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'SaleOrder', entityId: id },
        { entityType: 'SaleOrderLine', entityId: { in: [...lineContextById.keys()] } },
      ],
    },
    select: {
      id: true,
      action: true,
      entityId: true,
      createdAt: true,
      metadata: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const reassignmentReleaseLineIds = new Set<string>();
  if (includeFullProvenance) {
    for (const row of rows) {
      if (row.action !== 'SALE_ORDER_LINE_APPROVED') continue;
      const metadata = auditMetadataObject(row.metadata);
      for (const entry of asAllocationEntries(metadata.allocationsAdded)) {
        if (entry.allocationSource === 'MERCHANDISER_REASSIGNMENT') {
          reassignmentReleaseLineIds.add(entry.qaReleaseLineId);
        }
      }
    }
  }
  const sources = await resolveReassignmentSources([...reassignmentReleaseLineIds]);

  return rows.map((row) => {
    const metadata = auditMetadataObject(row.metadata);
    let detail: string | null;

    switch (row.action) {
      case 'SALE_ORDER_SUBMITTED': {
        const total = asAllocationEntries(metadata.allocations).reduce((sum, entry) => sum + entry.quantity, 0);
        detail = total > 0 ? `${total} unit(s) reserved from available stock` : null;
        break;
      }
      case 'SALE_ORDER_APPROVED': {
        const reason = nonEmptyString(metadata.reason);
        detail = reason ? `Reason: ${reason}` : null;
        break;
      }
      case 'SALE_ORDER_LINE_APPROVED': {
        const lineId = nonEmptyString(metadata.saleOrderLineId) ?? row.entityId;
        detail = describeLineApproval(metadata, lineContextById.get(lineId), includeFullProvenance, sources);
        break;
      }
      case 'SALE_ORDER_REJECTED': {
        const reason = nonEmptyString(metadata.reason);
        detail = reason ? `Reason: ${reason}` : null;
        break;
      }
      case 'SALE_ORDER_CANCELLED': {
        detail = describeCancellation(metadata);
        break;
      }
      default:
        detail = null;
    }

    return {
      id: row.id,
      action: row.action,
      title: SALE_ORDER_AUDIT_TITLES[row.action] ?? sentenceCaseAction(row.action),
      detail,
      actor: row.actor,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function createSaleOrder(
  actor: CurrentUser,
  input: {
    distributorId: string;
    soDate: string;
    remarks?: string | null;
    lines: Array<{ purchaseOrderLineSizeId: string; requestedQuantity: number; remarks?: string | null }>;
  },
) {
  if (actor.roles.includes('DISTRIBUTOR') && !actor.roles.includes('ADMIN')) {
    if (getSoleDistributorId(actor) !== input.distributorId) {
      throw HttpError.forbidden('You can only create sale orders for your mapped distributor');
    }
  }

  const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) throw HttpError.badRequest('Distributor not found');
  if (distributor.status !== 'ACTIVE') throw HttpError.badRequest('Distributor is not active');

  await validateSaleOrderLines(input.distributorId, input.lines);

  const soId = createId();
  await prisma.$transaction(async (tx) => {
    const financialYear = await ensureFinancialYear(tx, new Date(input.soDate));
    const { saleOrderNumber, saleOrderSerial } = await generateSaleOrderNumber(tx, financialYear);
    await tx.saleOrder.create({
      data: {
        id: soId,
        saleOrderNumber,
        distributorId: input.distributorId,
        createdBy: actor.id,
        soDate: new Date(input.soDate),
        status: 'DRAFT',
        remarks: input.remarks ?? null,
        financialYearId: financialYear.id,
        soSerial: saleOrderSerial,
        lines: {
          create: input.lines.map((line) => ({
            id: createId(),
            purchaseOrderLineSizeId: line.purchaseOrderLineSizeId,
            requestedQuantity: line.requestedQuantity,
            remarks: line.remarks ?? null,
          })),
        },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'SALE_ORDER_CREATED',
        entityType: 'SaleOrder',
        entityId: soId,
        metadata: { saleOrderNumber, distributorId: input.distributorId },
      },
      tx,
    );
  });

  return getSaleOrderDetail(actor, soId);
}

export async function updateSaleOrderDraft(
  actor: CurrentUser,
  id: string,
  input: {
    soDate?: string;
    remarks?: string | null;
    lines?: Array<{ purchaseOrderLineSizeId: string; requestedQuantity: number; remarks?: string | null }>;
  },
) {
  const order = await prisma.saleOrder.findUnique({ where: { id } });
  if (!order) throw HttpError.notFound('Sale order not found');
  assertSaleOrderDistributorOwnership(actor, order);
  if (order.status !== 'DRAFT') throw HttpError.badRequest('Sale order can only be edited in DRAFT status');

  if (input.lines) {
    await validateSaleOrderLines(order.distributorId, input.lines);
  }

  await prisma.$transaction(async (tx) => {
    let renumber: { financialYearId: string; soSerial: number; saleOrderNumber: string } | undefined;
    if (input.soDate) {
      const financialYear = await ensureFinancialYear(tx, new Date(input.soDate));
      if (financialYear.id !== order.financialYearId) {
        const { saleOrderNumber, saleOrderSerial } = await generateSaleOrderNumber(tx, financialYear);
        renumber = { financialYearId: financialYear.id, soSerial: saleOrderSerial, saleOrderNumber };
      }
    }

    await tx.saleOrder.update({
      where: { id },
      data: {
        soDate: input.soDate ? new Date(input.soDate) : undefined,
        remarks: input.remarks !== undefined ? input.remarks : undefined,
        financialYearId: renumber?.financialYearId,
        soSerial: renumber?.soSerial,
        saleOrderNumber: renumber?.saleOrderNumber,
        version: { increment: 1 },
      },
    });

    if (input.lines) {
      await tx.saleOrderLine.deleteMany({ where: { saleOrderId: id } });
      await tx.saleOrderLine.createMany({
        data: input.lines.map((line) => ({
          id: createId(),
          saleOrderId: id,
          purchaseOrderLineSizeId: line.purchaseOrderLineSizeId,
          requestedQuantity: line.requestedQuantity,
          remarks: line.remarks ?? null,
        })),
      });
    }
  });

  await recordAuditLog({ actorId: actor.id, action: 'SALE_ORDER_UPDATED', entityType: 'SaleOrder', entityId: id });

  return getSaleOrderDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function submitSaleOrder(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number },
  idempotencyKey: string,
) {
  const preCheck = await prisma.saleOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Sale order not found');
  assertSaleOrderDistributorOwnership(actor, preCheck);

  const hash = requestHash(input);

  await prisma.$transaction(async (tx) => {
    // The idempotency short-circuit must run before any version/status
    // validation — a replay of an already-succeeded request carries the
    // expectedVersion/status that were true when it was FIRST sent, which
    // the subsequent mutation has since moved past.
    if (await beginIdempotentOperation(tx, actor.id, id, 'SUBMIT', idempotencyKey, hash)) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${id}`}))`;

    const order = await tx.saleOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
    if (order.status !== 'DRAFT') throw HttpError.badRequest('Only DRAFT sale orders can be submitted');
    if (order.lines.length === 0)
      throw HttpError.badRequest('A sale order must have at least one line to submit');

    // Candidates are restricted to THIS distributor's own released stock —
    // a QaReleaseLine's purchaseOrderLineSizeId already belongs to a PO
    // owned by this distributor by construction (validated at line-creation
    // time), so no cross-distributor sourcing is possible here.
    const purchaseOrderLineSizeIds = [...new Set(order.lines.map((line) => line.purchaseOrderLineSizeId))];
    const candidates = await tx.qaReleaseLine.findMany({
      where: { purchaseOrderLineSizeId: { in: purchaseOrderLineSizeIds } },
      select: { id: true, purchaseOrderLineSizeId: true },
      orderBy: { release: { releasedAt: 'asc' } },
    });
    const candidatesByLineSize = new Map<string, string[]>();
    for (const candidate of candidates) {
      const list = candidatesByLineSize.get(candidate.purchaseOrderLineSizeId) ?? [];
      list.push(candidate.id);
      candidatesByLineSize.set(candidate.purchaseOrderLineSizeId, list);
    }

    const releaseLineIds = [...new Set(candidates.map((candidate) => candidate.id))].sort();
    for (const releaseLineId of releaseLineIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-release-line-${releaseLineId}`}))`;
    }
    const availability = await getAvailableQuantities(tx, releaseLineIds);

    const plannedAllocations: Array<{ saleOrderLineId: string; qaReleaseLineId: string; quantity: number }> = [];
    for (const line of order.lines) {
      let remaining = line.requestedQuantity;
      for (const releaseLineId of candidatesByLineSize.get(line.purchaseOrderLineSizeId) ?? []) {
        if (remaining <= 0) break;
        const availabilityRow = availability.get(releaseLineId);
        if (!availabilityRow || availabilityRow.available <= 0) continue;
        const consume = Math.min(availabilityRow.available, remaining);
        availabilityRow.available -= consume;
        remaining -= consume;
        plannedAllocations.push({ saleOrderLineId: line.id, qaReleaseLineId: releaseLineId, quantity: consume });
      }
      // All-or-nothing across every line — a SUBMITTED order's
      // DISTRIBUTOR_REQUEST allocations always sum to exactly
      // requestedQuantity, which simplifies the approve reduction logic.
      if (remaining > 0) {
        throw HttpError.conflict(
          `Insufficient QA-released stock available for line ${line.id} — short by ${remaining} unit(s)`,
        );
      }
    }

    for (const allocation of plannedAllocations) {
      await tx.stockAllocation.create({
        data: {
          id: createId(),
          saleOrderLineId: allocation.saleOrderLineId,
          qaReleaseLineId: allocation.qaReleaseLineId,
          quantity: allocation.quantity,
          status: 'ACTIVE',
          allocationSource: 'DISTRIBUTOR_REQUEST',
          allocatedById: actor.id,
        },
      });
    }

    const updated = await tx.saleOrder.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(order.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'SALE_ORDER_SUBMITTED',
        entityType: 'SaleOrder',
        entityId: id,
        metadata: { saleOrderNumber: order.saleOrderNumber, allocations: plannedAllocations },
      },
      tx,
    );
    await finishIdempotentOperation(tx, actor.id, id, 'SUBMIT', idempotencyKey, hash, order.version + 1);
  });

  return getSaleOrderDetail(actor, id);
}

export async function startReviewSaleOrder(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertSaleOrderReviewAccess(actor);
  const order = await prisma.saleOrder.findUnique({ where: { id } });
  if (!order) throw HttpError.notFound('Sale order not found');
  if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
  if (order.status !== 'SUBMITTED')
    throw HttpError.badRequest(`Sale order in status ${order.status} cannot move to review`);

  const updated = await prisma.saleOrder.updateMany({
    where: { id, version: input.expectedVersion },
    data: { status: 'UNDER_REVIEW', version: { increment: 1 } },
  });
  if (updated.count !== 1) throw HttpError.staleVersion(order.version);

  await recordAuditLog({
    actorId: actor.id,
    action: 'SALE_ORDER_REVIEW_STARTED',
    entityType: 'SaleOrder',
    entityId: id,
  });

  return getSaleOrderDetail(actor, id);
}

export async function rejectSaleOrder(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; reason?: string | null },
) {
  assertSaleOrderReviewAccess(actor);
  const preCheck = await prisma.saleOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Sale order not found');
  if (preCheck.version !== input.expectedVersion) throw HttpError.staleVersion(preCheck.version);
  if (!ACTIVE_REVIEW_STATUSES.includes(preCheck.status))
    throw HttpError.badRequest(`Sale order in status ${preCheck.status} cannot be rejected`);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${id}`}))`;
    const order = await tx.saleOrder.findUnique({ where: { id } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
    if (!ACTIVE_REVIEW_STATUSES.includes(order.status))
      throw HttpError.badRequest(`Sale order in status ${order.status} cannot be rejected`);

    await releaseAllActiveAllocations(tx, id, actor.id);
    const updated = await tx.saleOrder.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'REJECTED',
        reviewedById: actor.id,
        reviewedAt: new Date(),
        decisionReason: input.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(order.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'SALE_ORDER_REJECTED',
        entityType: 'SaleOrder',
        entityId: id,
        metadata: { reason: input.reason ?? null },
      },
      tx,
    );
  });

  return getSaleOrderDetail(actor, id);
}

export async function cancelSaleOrder(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; reason?: string | null },
) {
  const preCheck = await prisma.saleOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Sale order not found');

  const isAdmin = actor.roles.includes('ADMIN');
  const isOwningDistributor =
    actor.roles.includes('DISTRIBUTOR') && getSoleDistributorId(actor) === preCheck.distributorId;
  const isMerchandiser = actor.roles.includes('MERCHANDISER');
  if (!isAdmin && !isOwningDistributor && !isMerchandiser) {
    throw HttpError.forbidden('You do not have access to this sale order');
  }

  // Distributors (and ADMIN) may withdraw their own DRAFT/SUBMITTED/
  // UNDER_REVIEW order; a merchandiser may only decline a submitted one —
  // not reach into a distributor's private draft.
  const preApprovalStatuses: SaleOrderStatus[] =
    isAdmin || isOwningDistributor ? ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] : ACTIVE_REVIEW_STATUSES;
  // Unwinding an APPROVED order releases stock that may already have been
  // sourced across distributors by the merchandiser — only ADMIN/MERCHANDISER
  // may authorize that, never the (possibly unrelated-to-the-source)
  // owning distributor.
  const cancellableStatuses: SaleOrderStatus[] =
    isAdmin || isMerchandiser ? [...preApprovalStatuses, 'APPROVED'] : preApprovalStatuses;
  if (!cancellableStatuses.includes(preCheck.status)) {
    throw HttpError.badRequest(`Sale order in status ${preCheck.status} cannot be cancelled`);
  }
  if (preCheck.version !== input.expectedVersion) throw HttpError.staleVersion(preCheck.version);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${id}`}))`;
    const order = await tx.saleOrder.findUnique({ where: { id } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
    if (!cancellableStatuses.includes(order.status))
      throw HttpError.badRequest(`Sale order in status ${order.status} cannot be cancelled`);

    const releasedAllocationCount = await releaseAllActiveAllocations(tx, id, actor.id);
    const updated = await tx.saleOrder.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'CANCELLED', decisionReason: input.reason ?? null, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(order.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'SALE_ORDER_CANCELLED',
        entityType: 'SaleOrder',
        entityId: id,
        metadata: { reason: input.reason ?? null, previousStatus: order.status, releasedAllocationCount },
      },
      tx,
    );
  });

  return getSaleOrderDetail(actor, id);
}

export interface ApproveSaleOrderInput {
  expectedVersion: number;
  reason?: string | null;
  lines: Array<{
    saleOrderLineId: string;
    approvedQuantity: number;
    sourcing?: Array<{ qaReleaseLineId: string; quantity: number; reason?: string | null }>;
  }>;
}

export async function approveSaleOrder(
  actor: CurrentUser,
  id: string,
  input: ApproveSaleOrderInput,
  idempotencyKey: string,
) {
  assertSaleOrderReviewAccess(actor);

  const hash = requestHash(input);

  await prisma.$transaction(async (tx) => {
    // The idempotency short-circuit must run before any version/status
    // validation — a replay of an already-succeeded request carries the
    // expectedVersion/status that were true when it was FIRST sent, which
    // the subsequent mutation has since moved past.
    if (await beginIdempotentOperation(tx, actor.id, id, 'APPROVE', idempotencyKey, hash)) return;
    // Aggregate-root lock first, always — then release-line locks in a fixed
    // ascending order below. This ordering is what prevents deadlocks between
    // concurrent approvals touching overlapping release lines.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${id}`}))`;

    const order = await tx.saleOrder.findUnique({
      where: { id },
      include: { lines: { include: { allocations: true } } },
    });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
    if (!ACTIVE_REVIEW_STATUSES.includes(order.status))
      throw HttpError.badRequest(`Sale order in status ${order.status} cannot be approved`);

    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    for (const decision of input.lines) {
      if (!linesById.has(decision.saleOrderLineId)) {
        throw HttpError.badRequest(`Line ${decision.saleOrderLineId} does not belong to this sale order`);
      }
    }

    const releaseLineIdSet = new Set<string>();
    for (const decision of input.lines) {
      for (const allocation of linesById.get(decision.saleOrderLineId)!.allocations) {
        if (allocation.status === 'ACTIVE') releaseLineIdSet.add(allocation.qaReleaseLineId);
      }
      for (const entry of decision.sourcing ?? []) releaseLineIdSet.add(entry.qaReleaseLineId);
    }
    const releaseLineIds = [...releaseLineIdSet].sort();
    for (const releaseLineId of releaseLineIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-release-line-${releaseLineId}`}))`;
    }

    const availability = await getAvailableQuantities(tx, releaseLineIds);
    const distributorByReleaseLine = await getReleaseLineDistributorIds(tx, releaseLineIds);

    const lineAuditEntries: Array<Record<string, unknown>> = [];

    for (const decision of input.lines) {
      const line = linesById.get(decision.saleOrderLineId)!;
      const activeAllocations = line.allocations.filter((allocation) => allocation.status === 'ACTIVE');
      const currentActiveTotal = activeAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);

      const released: Array<{ qaReleaseLineId: string; quantity: number; allocationSource: string }> = [];
      const added: Array<{
        qaReleaseLineId: string;
        quantity: number;
        allocationSource: string;
        reason: string | null;
      }> = [];

      if (decision.approvedQuantity < currentActiveTotal) {
        let remaining = currentActiveTotal - decision.approvedQuantity;
        const ordered = [...activeAllocations].sort((a, b) => {
          const rank = SOURCE_RELEASE_PRIORITY[a.allocationSource] - SOURCE_RELEASE_PRIORITY[b.allocationSource];
          return rank !== 0 ? rank : b.createdAt.getTime() - a.createdAt.getTime();
        });
        for (const allocation of ordered) {
          if (remaining <= 0) break;
          const consume = Math.min(allocation.quantity, remaining);
          remaining -= consume;
          released.push({
            qaReleaseLineId: allocation.qaReleaseLineId,
            quantity: consume,
            allocationSource: allocation.allocationSource,
          });
          if (consume === allocation.quantity) {
            await tx.stockAllocation.update({
              where: { id: allocation.id },
              data: { status: 'RELEASED', releasedById: actor.id, releasedAt: new Date() },
            });
          } else {
            await tx.stockAllocation.update({
              where: { id: allocation.id },
              data: { quantity: { decrement: consume } },
            });
          }
        }
      } else if (decision.approvedQuantity > currentActiveTotal) {
        const delta = decision.approvedQuantity - currentActiveTotal;
        const sourcing = decision.sourcing ?? [];
        const sourcingTotal = sourcing.reduce((sum, entry) => sum + entry.quantity, 0);
        if (sourcing.length === 0 || sourcingTotal !== delta) {
          throw HttpError.badRequest(
            `Line ${decision.saleOrderLineId}: sourcing quantities must sum to exactly the requested increase of ${delta} unit(s)`,
          );
        }

        for (const entry of sourcing) {
          const availabilityRow = availability.get(entry.qaReleaseLineId);
          if (!availabilityRow) {
            throw HttpError.badRequest(`QA release line ${entry.qaReleaseLineId} not found`);
          }
          if (availabilityRow.available < entry.quantity) {
            throw HttpError.conflict(
              `Insufficient QA-released stock available on release line ${entry.qaReleaseLineId}`,
            );
          }
          availabilityRow.available -= entry.quantity;

          const sourceDistributorId = distributorByReleaseLine.get(entry.qaReleaseLineId);
          const allocationSource: StockAllocationSource =
            sourceDistributorId === order.distributorId ? 'MERCHANDISER_ADJUSTMENT' : 'MERCHANDISER_REASSIGNMENT';
          if (allocationSource === 'MERCHANDISER_REASSIGNMENT' && !entry.reason?.trim()) {
            throw HttpError.badRequest(
              `A reason is required when sourcing stock from another distributor's release line ${entry.qaReleaseLineId}`,
            );
          }

          const existing = line.allocations.find((allocation) => allocation.qaReleaseLineId === entry.qaReleaseLineId);
          if (existing?.status === 'ACTIVE') {
            await tx.stockAllocation.update({
              where: { id: existing.id },
              data: {
                quantity: { increment: entry.quantity },
                allocatedById: actor.id,
                reason: entry.reason ?? existing.reason,
              },
            });
          } else if (existing) {
            await tx.stockAllocation.update({
              where: { id: existing.id },
              data: {
                status: 'ACTIVE',
                quantity: entry.quantity,
                allocationSource,
                reason: entry.reason ?? null,
                allocatedById: actor.id,
                releasedById: null,
                releasedAt: null,
              },
            });
          } else {
            await tx.stockAllocation.create({
              data: {
                id: createId(),
                saleOrderLineId: line.id,
                qaReleaseLineId: entry.qaReleaseLineId,
                quantity: entry.quantity,
                status: 'ACTIVE',
                allocationSource,
                reason: entry.reason ?? null,
                allocatedById: actor.id,
              },
            });
          }
          added.push({
            qaReleaseLineId: entry.qaReleaseLineId,
            quantity: entry.quantity,
            allocationSource,
            reason: entry.reason ?? null,
          });
        }
      }

      await tx.saleOrderLine.update({
        where: { id: line.id },
        data: { approvedQuantity: decision.approvedQuantity },
      });

      lineAuditEntries.push({
        saleOrderLineId: line.id,
        requestedQuantity: line.requestedQuantity,
        approvedQuantity: decision.approvedQuantity,
        diff: decision.approvedQuantity - line.requestedQuantity,
        allocationsReleased: released,
        allocationsAdded: added,
      });
    }

    const updated = await tx.saleOrder.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'APPROVED',
        reviewedById: actor.id,
        reviewedAt: new Date(),
        decisionReason: input.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(order.version);

    for (const entry of lineAuditEntries) {
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'SALE_ORDER_LINE_APPROVED',
          entityType: 'SaleOrderLine',
          entityId: entry.saleOrderLineId as string,
          metadata: entry as Prisma.InputJsonValue,
        },
        tx,
      );
    }
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'SALE_ORDER_APPROVED',
        entityType: 'SaleOrder',
        entityId: id,
        metadata: { saleOrderNumber: order.saleOrderNumber, reason: input.reason ?? null },
      },
      tx,
    );

    await finishIdempotentOperation(tx, actor.id, id, 'APPROVE', idempotencyKey, hash, order.version + 1);
  });

  return getSaleOrderDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Inventory views
// ---------------------------------------------------------------------------

export async function getEligibleStock(user: CurrentUser, distributorId?: string) {
  const targetDistributorId = user.roles.includes('ADMIN')
    ? (distributorId ?? (user.distributorIds.length === 1 ? user.distributorIds[0]! : undefined))
    : getSoleDistributorId(user);
  if (!targetDistributorId) throw HttpError.badRequest('distributorId is required');
  return getEligibleStockForDistributor(targetDistributorId);
}

export async function getGlobalInventoryView(
  user: CurrentUser,
  filters: { styleId?: string; sizeId?: string; distributorId?: string; onlyAvailable?: boolean },
) {
  if (!canViewAllSaleOrders(user)) {
    throw HttpError.forbidden('You do not have permission to view global inventory');
  }
  return getGlobalInventory(filters);
}
