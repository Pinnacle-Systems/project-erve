import { createId } from '@erve/shared';
import type { PurchaseOrderDetail } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import type { PurchaseMode, PurchaseOrderStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { toCompactFinancialYearCode } from '../master-data/financial-year.util.js';
import { getAvailableQuantities } from '../sale-orders/inventory.service.js';
import { SALE_ORDER_STATUSES_BLOCKING_PO_CANCELLATION } from '../sale-orders/sale-order-lifecycle.js';

// ---------------------------------------------------------------------------
// PO number generation
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

// The PO's Financial Year is derived from its own poDate — never inherited
// from any other document — and its serial comes from the FY-scoped
// DocumentSequence high-water mark, not from the max poSerial currently
// attached to a document (see document-sequence.service.ts for why that
// distinction matters once a DRAFT PO's date can move it to another FY).
async function generatePoNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ poNumber: string; poSerial: number }> {
  const poSerial = await allocateDocumentSerial(client, 'PURCHASE_ORDER', financialYear.id);
  return { poNumber: formatDocumentNumber(DOCUMENT_PREFIXES.PURCHASE_ORDER, financialYear.code, poSerial), poSerial };
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const poInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  merchandiser: { select: { id: true, name: true, email: true } },
  creator: { select: { id: true, name: true, email: true } },
  financialYear: { select: { id: true, code: true } },
  lines: {
    include: {
      style: { select: { id: true, styleNumber: true, styleName: true } },
      seasonSnapshots: { orderBy: [{ financialYear: 'asc' as const }, { name: 'asc' as const }] },
      sizes: {
        include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
        orderBy: { size: { sortOrder: 'asc' as const } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.DistributorPurchaseOrderInclude;

type PORecord = Prisma.DistributorPurchaseOrderGetPayload<{ include: typeof poInclude }>;

function toLineView(line: PORecord['lines'][number]) {
  const totalOrdered = line.sizes.reduce((sum, s) => sum + s.orderedQuantity, 0);
  return {
    id: line.id,
    styleId: line.styleId,
    styleNumber: line.style.styleNumber,
    styleName: line.style.styleName,
    lineStatus: line.lineStatus,
    remarks: line.remarks,
    seasonSnapshots: line.seasonSnapshots.map((season) => ({
      seasonId: season.seasonId,
      code: season.code,
      name: season.name,
      financialYear: season.financialYear,
      displayName: season.displayName,
    })),
    sizes: line.sizes.map((s) => ({
      id: s.id,
      sizeId: s.sizeId,
      sizeCode: s.size.code,
      sizeLabel: s.size.label,
      orderedQuantity: s.orderedQuantity,
      jobOrderedQuantity: s.jobOrderedQuantity,
      qaPassedQuantity: s.qaPassedQuantity,
      saleOrderedQuantity: s.saleOrderedQuantity,
      dispatchedQuantity: s.dispatchedQuantity,
      deliveredQuantity: s.deliveredQuantity,
      actualSoldQuantity: s.actualSoldQuantity,
      returnedQuantity: s.returnedQuantity,
      reassignedQuantity: s.reassignedQuantity,
    })),
    totalOrderedQuantity: totalOrdered,
  };
}

function toPOView(po: PORecord): PurchaseOrderDetail {
  const totalQuantity = po.lines.reduce(
    (sum, line) => sum + line.sizes.reduce((s, sz) => s + sz.orderedQuantity, 0),
    0,
  );
  return {
    id: po.id,
    poNumber: po.poNumber,
    distributor: po.distributor,
    merchandiser: po.merchandiser,
    creator: po.creator,
    financialYear: po.financialYear,
    poDate: po.poDate.toISOString(),
    requiredDeliveryDate: po.requiredDeliveryDate?.toISOString() ?? null,
    purchaseMode: po.purchaseMode,
    status: po.status,
    remarks: po.remarks,
    lines: po.lines.map(toLineView),
    totalOrderedQuantity: totalQuantity,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    version: po.version,
  };
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function canViewAllPOs(user: CurrentUser): boolean {
  return user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT');
}

function assertPOViewAccess(user: CurrentUser, po: { distributorId: string }): void {
  if (canViewAllPOs(user)) return;
  if (user.roles.includes('DISTRIBUTOR') && getSoleDistributorId(user) === po.distributorId) return;
  throw HttpError.forbidden('You do not have access to this purchase order');
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export async function getPurchaseOrderList(
  user: CurrentUser,
  filters: {
    search?: string;
    status?: PurchaseOrderStatus;
    distributorId?: string;
    purchaseMode?: PurchaseMode;
    financialYearId?: string;
    cursor?: string;
    limit: number;
  },
) {
  const distributorIdFilter = canViewAllPOs(user)
    ? filters.distributorId
    : getSoleDistributorId(user); // DISTRIBUTOR users see only their own

  const where: Prisma.DistributorPurchaseOrderWhereInput = {
    distributorId: distributorIdFilter ?? undefined,
    status: filters.status,
    purchaseMode: filters.purchaseMode,
    // This PO's own Financial Year (derived from its poDate) — never a
    // downstream document's Financial Year.
    financialYearId: filters.financialYearId,
    OR: filters.search
      ? [{ poNumber: { contains: filters.search, mode: 'insensitive' } }]
      : undefined,
  };

  const orders = await prisma.distributorPurchaseOrder.findMany({
    where,
    include: poInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = orders.length > filters.limit;
  const page = hasMore ? orders.slice(0, filters.limit) : orders;
  return {
    items: page.map(toPOView),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getPurchaseOrderDetail(user: CurrentUser, id: string) {
  const po = await prisma.distributorPurchaseOrder.findUnique({
    where: { id },
    include: poInclude,
  });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(user, po);
  return toPOView(po);
}

export async function createPurchaseOrder(
  actor: CurrentUser,
  input: {
    distributorId: string;
    poDate: string;
    requiredDeliveryDate?: string | null;
    purchaseMode: PurchaseMode;
    remarks?: string | null;
    lines: Array<{
      styleId: string;
      remarks?: string | null;
      sizes: Array<{ sizeId: string; orderedQuantity: number }>;
    }>;
  },
) {
  // DISTRIBUTOR users can only create POs for their mapped distributor
  if (
    actor.roles.includes('DISTRIBUTOR') &&
    !actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER')
  ) {
    if (getSoleDistributorId(actor) !== input.distributorId) {
      throw HttpError.forbidden('You can only create purchase orders for your mapped distributor');
    }
  }

  const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) throw HttpError.badRequest('Distributor not found');
  if (distributor.status !== 'ACTIVE') throw HttpError.badRequest('Distributor is not active');

  await validateLines(input.lines);
  const styles = await prisma.style.findMany({
    where: { id: { in: input.lines.map((line) => line.styleId) } },
    include: { styleSeasons: { include: { season: { include: { financialYear: true } } } } },
  });
  const seasonsByStyle = new Map(
    styles.map((style) => [style.id, style.styleSeasons.map(({ season }) => season)]),
  );
  if ([...seasonsByStyle.values()].some((seasons) => seasons.length === 0))
    throw HttpError.badRequest('Every purchase-order Style must have Seasons assigned');

  const poId = createId();
  await prisma.$transaction(async (tx) => {
    // The PO's Financial Year is derived from its own poDate, server-side —
    // the client never supplies financialYearId directly.
    const financialYear = await ensureFinancialYear(tx, new Date(input.poDate));
    const { poNumber, poSerial } = await generatePoNumber(tx, financialYear);
    await tx.distributorPurchaseOrder.create({
      data: {
        id: poId,
        poNumber,
        distributorId: input.distributorId,
        // The responsible Merchandiser is derived from the authenticated
        // actor, never client-supplied — a PO created by anyone else (ADMIN,
        // DISTRIBUTOR) has no Merchandiser owner until one acts on it.
        merchandiserId: actor.roles.includes('MERCHANDISER') ? actor.id : null,
        poDate: new Date(input.poDate),
        requiredDeliveryDate: input.requiredDeliveryDate
          ? new Date(input.requiredDeliveryDate)
          : null,
        purchaseMode: input.purchaseMode,
        status: 'DRAFT',
        remarks: input.remarks ?? null,
        createdBy: actor.id,
        financialYearId: financialYear.id,
        poSerial,
        lines: {
          create: input.lines.map((line) => ({
            id: createId(),
            styleId: line.styleId,
            remarks: line.remarks ?? null,
            seasonSnapshots: {
              create: (seasonsByStyle.get(line.styleId) ?? []).map((season) => ({
                id: createId(),
                seasonId: season.id,
                code: season.code,
                name: season.name,
                financialYear: toCompactFinancialYearCode(season.financialYear.code),
                displayName: `${season.code} ${toCompactFinancialYearCode(season.financialYear.code)}`,
              })),
            },
            sizes: {
              create: line.sizes.map((sz) => ({
                id: createId(),
                sizeId: sz.sizeId,
                orderedQuantity: sz.orderedQuantity,
              })),
            },
          })),
        },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'PO_CREATED',
        entityType: 'DistributorPurchaseOrder',
        entityId: poId,
        metadata: { poNumber, distributorId: input.distributorId },
      },
      tx,
    );
  });

  return getPurchaseOrderDetail(actor, poId);
}

export async function updatePurchaseOrderDraft(
  actor: CurrentUser,
  id: string,
  input: {
    poDate?: string;
    requiredDeliveryDate?: string | null;
    purchaseMode?: PurchaseMode;
    remarks?: string | null;
    lines?: Array<{
      styleId: string;
      remarks?: string | null;
      sizes: Array<{ sizeId: string; orderedQuantity: number }>;
    }>;
  },
) {
  const po = await prisma.distributorPurchaseOrder.findUnique({ where: { id } });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(actor, po);
  if (po.status !== 'DRAFT')
    throw HttpError.badRequest('Purchase order can only be edited in DRAFT status');

  if (input.lines) {
    await validateLines(input.lines);
  }

  await prisma.$transaction(async (tx) => {
    // Recompute the Financial Year only when poDate is actually changing. If
    // it resolves to a different FY, allocate a fresh serial/number from that
    // FY's sequence — the old FY's high-water mark is left untouched, so its
    // vacated serial is never reissued. Same FY: leave financialYearId/
    // poSerial/poNumber alone, no unnecessary renumbering.
    let renumber: { financialYearId: string; poSerial: number; poNumber: string } | undefined;
    if (input.poDate) {
      const financialYear = await ensureFinancialYear(tx, new Date(input.poDate));
      if (financialYear.id !== po.financialYearId) {
        const { poNumber, poSerial } = await generatePoNumber(tx, financialYear);
        renumber = { financialYearId: financialYear.id, poSerial, poNumber };
      }
    }

    await tx.distributorPurchaseOrder.update({
      where: { id },
      data: {
        poDate: input.poDate ? new Date(input.poDate) : undefined,
        requiredDeliveryDate:
          input.requiredDeliveryDate !== undefined
            ? input.requiredDeliveryDate
              ? new Date(input.requiredDeliveryDate)
              : null
            : undefined,
        purchaseMode: input.purchaseMode,
        remarks: input.remarks !== undefined ? input.remarks : undefined,
        financialYearId: renumber?.financialYearId,
        poSerial: renumber?.poSerial,
        poNumber: renumber?.poNumber,
        version: { increment: 1 },
      },
    });

    if (input.lines) {
      const styles = await tx.style.findMany({
        where: { id: { in: input.lines.map((line) => line.styleId) } },
        include: { styleSeasons: { include: { season: { include: { financialYear: true } } } } },
      });
      const seasonsByStyle = new Map(
        styles.map((style) => [style.id, style.styleSeasons.map(({ season }) => season)]),
      );
      if ([...seasonsByStyle.values()].some((seasons) => seasons.length === 0))
        throw HttpError.badRequest('Every purchase-order Style must have Seasons assigned');
      // Replace all lines atomically
      await tx.distributorPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      for (const line of input.lines) {
        const lineId = createId();
        await tx.distributorPurchaseOrderLine.create({
          data: {
            id: lineId,
            purchaseOrderId: id,
            styleId: line.styleId,
            remarks: line.remarks ?? null,
            seasonSnapshots: {
              create: (seasonsByStyle.get(line.styleId) ?? []).map((season) => ({
                id: createId(),
                seasonId: season.id,
                code: season.code,
                name: season.name,
                financialYear: toCompactFinancialYearCode(season.financialYear.code),
                displayName: `${season.code} ${toCompactFinancialYearCode(season.financialYear.code)}`,
              })),
            },
            sizes: {
              create: line.sizes.map((sz) => ({
                id: createId(),
                sizeId: sz.sizeId,
                orderedQuantity: sz.orderedQuantity,
              })),
            },
          },
        });
      }
    }
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PO_UPDATED',
    entityType: 'DistributorPurchaseOrder',
    entityId: id,
  });

  return getPurchaseOrderDetail(actor, id);
}

export async function submitPurchaseOrder(actor: CurrentUser, id: string) {
  const po = await prisma.distributorPurchaseOrder.findUnique({ where: { id } });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(actor, po);
  if (po.status !== 'DRAFT')
    throw HttpError.badRequest('Only DRAFT purchase orders can be submitted');

  await prisma.distributorPurchaseOrder.update({
    where: { id },
    data: { status: 'SUBMITTED', version: { increment: 1 } },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PO_SUBMITTED',
    entityType: 'DistributorPurchaseOrder',
    entityId: id,
    metadata: { poNumber: po.poNumber },
  });

  return getPurchaseOrderDetail(actor, id);
}

export async function cancelPurchaseOrder(actor: CurrentUser, id: string) {
  const preCheck = await prisma.distributorPurchaseOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(actor, preCheck);

  await prisma.$transaction(async (tx) => {
    // Serializes against submitSaleOrder's own purchase-order-{id} advisory
    // lock (see sale-orders.service.ts) — whichever transaction acquires
    // this lock first runs to completion (and commits its status change)
    // before the other observes consistent state, so a PO can never be
    // cancelled out from under a concurrently-submitting Sale Order (nor can
    // a Sale Order submit against a PO mid-cancellation).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-order-${id}`}))`;

    const po = await tx.distributorPurchaseOrder.findUnique({
      where: { id },
      include: { lines: { include: { sizes: { select: { jobOrderedQuantity: true } } } } },
    });
    if (!po) throw HttpError.notFound('Purchase order not found');

    const cancellableStatuses: PurchaseOrderStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'];
    if (!cancellableStatuses.includes(po.status)) {
      throw HttpError.badRequest(`Purchase order in status ${po.status} cannot be cancelled`);
    }

    // Guard: no job ordered quantities must exist
    const hasJobOrdered = po.lines.some((line) => line.sizes.some((sz) => sz.jobOrderedQuantity > 0));
    if (hasJobOrdered) {
      throw HttpError.badRequest('Cannot cancel a purchase order that has job ordered quantities');
    }

    // Guard: no active/open Sale Order demand may reference this PO — see
    // sale-order-lifecycle.ts for exactly which statuses count. Cancellation
    // must fail explicitly here rather than silently leaving those Sale
    // Orders referencing a now-void Purchase Order.
    const blockingSaleOrder = await tx.saleOrder.findFirst({
      where: {
        status: { in: [...SALE_ORDER_STATUSES_BLOCKING_PO_CANCELLATION] },
        lines: { some: { purchaseOrderLineSize: { purchaseOrderLine: { purchaseOrderId: id } } } },
      },
      select: { id: true },
    });
    if (blockingSaleOrder) {
      throw HttpError.badRequest(
        'Purchase order cannot be cancelled because it is referenced by one or more active Sale Orders',
      );
    }

    await tx.distributorPurchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'PO_CANCELLED',
        entityType: 'DistributorPurchaseOrder',
        entityId: id,
        metadata: { poNumber: po.poNumber },
      },
      tx,
    );
  });

  return getPurchaseOrderDetail(actor, id);
}

export async function getJobOrderBalance(user: CurrentUser, id: string, factoryId?: string) {
  const po = await prisma.distributorPurchaseOrder.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          style: { select: { id: true, styleNumber: true, styleName: true } },
          sizes: {
            include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
            orderBy: { size: { sortOrder: 'asc' } },
          },
        },
      },
    },
  });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(user, po);

  const lines = po.lines.map((line) => ({
    lineId: line.id,
    styleId: line.style.id,
    styleNumber: line.style.styleNumber,
    styleName: line.style.styleName,
    sizes: line.sizes.map((s) => ({
      purchaseOrderLineSizeId: s.id,
      sizeId: s.sizeId,
      sizeCode: s.size.code,
      sizeLabel: s.size.label,
      orderedQuantity: s.orderedQuantity,
      jobOrderedQuantity: s.jobOrderedQuantity,
      balanceQuantity: s.orderedQuantity - s.jobOrderedQuantity,
    })),
  }));

  const styleFactoryPrices: Record<string, number | null> = {};
  if (factoryId) {
    const mappings = await prisma.styleFactoryMapping.findMany({
      where: { factoryId, styleId: { in: lines.map((line) => line.styleId) }, status: 'ACTIVE' },
      select: { styleId: true, exFactoryPrice: true },
    });
    for (const mapping of mappings)
      styleFactoryPrices[mapping.styleId] = mapping.exFactoryPrice.toNumber();
  }
  return { poId: id, poNumber: po.poNumber, version: po.version, lines, styleFactoryPrices };
}

const fulfilmentTotalsZero = {
  orderedQuantity: 0,
  jobOrderedQuantity: 0,
  preparedQuantity: 0,
  qaReleasedQuantity: 0,
  saleOrderAllocatedQuantity: 0,
  remainingToJobOrderQuantity: 0,
  notPreparedQuantity: 0,
  preparedNotReleasedQuantity: 0,
  releasedUnallocatedQuantity: 0,
};

// Read-only lifecycle reconciliation: Ordered -> Job Ordered -> Prepared ->
// QA Released -> Sale Order Allocated. Stops at Sale Order allocation
// deliberately — packing/dispatch/invoicing don't exist in the product yet,
// so this must not label anything "Dispatched"/"Delivered". Every quantity
// is read from the same authoritative sources their own owning modules
// already write (job-orders.service.ts for jobOrdered/prepared,
// quality-executions.service.ts for qaReleased, the StockAllocation ledger
// via getAvailableQuantities for saleOrderAllocated) — nothing here is a
// second, competing calculation of any of those numbers.
export async function getFulfilmentSummary(user: CurrentUser, id: string) {
  const po = await prisma.distributorPurchaseOrder.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          style: { select: { id: true, styleNumber: true, styleName: true } },
          sizes: {
            include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
            orderBy: { size: { sortOrder: 'asc' } },
          },
        },
      },
    },
  });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(user, po);

  const allSizeIds = po.lines.flatMap((line) => line.sizes.map((s) => s.id));

  // Prepared is size-scoped on JobOrderLineSize, not on the PO line size
  // itself, and a PO can be split across multiple Job Orders — sum across
  // every non-cancelled Job Order's line size for this PO size.
  const preparedBySize = await prisma.jobOrderLineSize.groupBy({
    by: ['purchaseOrderLineSizeId'],
    where: {
      purchaseOrderLineSizeId: { in: allSizeIds },
      jobOrderLine: { jobOrder: { status: { not: 'CANCELLED' } } },
    },
    _sum: { preparedQuantity: true },
  });
  const preparedById = new Map(
    preparedBySize.map((row) => [row.purchaseOrderLineSizeId, row._sum.preparedQuantity ?? 0]),
  );

  // Sale Order allocation is committed against a QaReleaseLine, not against
  // this PO's Distributor, so it must be summed via the release lines this
  // PO's sizes actually produced — this is what makes reallocation to a
  // different distributor's Sale Order still count correctly against this PO.
  const releaseLines = await prisma.qaReleaseLine.findMany({
    where: { purchaseOrderLineSizeId: { in: allSizeIds } },
    select: { id: true, purchaseOrderLineSizeId: true },
  });
  const availability = await getAvailableQuantities(
    prisma,
    releaseLines.map((line) => line.id),
  );
  const allocatedById = new Map<string, number>();
  for (const releaseLine of releaseLines) {
    const committed = availability.get(releaseLine.id)?.committed ?? 0;
    allocatedById.set(
      releaseLine.purchaseOrderLineSizeId,
      (allocatedById.get(releaseLine.purchaseOrderLineSizeId) ?? 0) + committed,
    );
  }

  const lines = po.lines.map((line) => {
    const sizes = line.sizes.map((s) => {
      const orderedQuantity = s.orderedQuantity;
      const jobOrderedQuantity = s.jobOrderedQuantity;
      const preparedQuantity = preparedById.get(s.id) ?? 0;
      const qaReleasedQuantity = s.qaPassedQuantity;
      const saleOrderAllocatedQuantity = allocatedById.get(s.id) ?? 0;

      return {
        sizeId: s.sizeId,
        sizeCode: s.size.code,
        sizeLabel: s.size.label,
        orderedQuantity,
        jobOrderedQuantity,
        preparedQuantity,
        qaReleasedQuantity,
        saleOrderAllocatedQuantity,
        remainingToJobOrderQuantity: Math.max(0, orderedQuantity - jobOrderedQuantity),
        notPreparedQuantity: Math.max(0, jobOrderedQuantity - preparedQuantity),
        preparedNotReleasedQuantity: Math.max(0, preparedQuantity - qaReleasedQuantity),
        releasedUnallocatedQuantity: Math.max(0, qaReleasedQuantity - saleOrderAllocatedQuantity),
      };
    });

    const totals = sizes.reduce((acc, s) => {
      const next = { ...acc };
      for (const key of Object.keys(fulfilmentTotalsZero) as Array<keyof typeof fulfilmentTotalsZero>) {
        next[key] = acc[key] + s[key];
      }
      return next;
    }, fulfilmentTotalsZero);

    return {
      lineId: line.id,
      styleId: line.style.id,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      sizes,
      totals,
    };
  });

  return { poId: id, poNumber: po.poNumber, status: po.status, lines };
}

// ---------------------------------------------------------------------------
// Internal validation helper
// ---------------------------------------------------------------------------

async function validateLines(
  lines: Array<{
    styleId: string;
    sizes: Array<{ sizeId: string; orderedQuantity: number }>;
  }>,
) {
  // Duplicate style check
  const styleIds = lines.map((l) => l.styleId);
  if (new Set(styleIds).size !== styleIds.length) {
    throw HttpError.badRequest('Duplicate styles are not allowed in the same purchase order');
  }

  for (const line of lines) {
    // Duplicate size check within line
    const sizesInLine = line.sizes.map((s) => s.sizeId);
    if (new Set(sizesInLine).size !== sizesInLine.length) {
      throw HttpError.badRequest('Duplicate sizes are not allowed in the same line');
    }

    const style = await prisma.style.findUnique({
      where: { id: line.styleId },
      include: {
        styleSizes: {
          where: { status: 'ACTIVE', size: { status: 'ACTIVE' } },
          select: { sizeId: true },
        },
      },
    });

    if (!style) throw HttpError.badRequest(`Style ${line.styleId} not found`);
    if (style.status !== 'ACTIVE')
      throw HttpError.badRequest(`Style ${style.styleNumber} is not active`);

    const validSizeIds = new Set(style.styleSizes.map((ss) => ss.sizeId));
    for (const sz of line.sizes) {
      if (!validSizeIds.has(sz.sizeId)) {
        throw HttpError.badRequest(`Size ${sz.sizeId} is not valid for style ${style.styleNumber}`);
      }
      if (sz.orderedQuantity <= 0) {
        throw HttpError.badRequest('Ordered quantity must be greater than 0');
      }
    }
  }
}
