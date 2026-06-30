import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { PurchaseMode, PurchaseOrderStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';

// ---------------------------------------------------------------------------
// PO number generation
// ---------------------------------------------------------------------------

export async function generatePoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;

  // Find the highest existing sequence for this year
  const last = await prisma.distributorPurchaseOrder.findFirst({
    where: { poNumber: { startsWith: prefix } },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  });

  const lastSeq = last ? parseInt(last.poNumber.slice(prefix.length), 10) : 0;
  const next = String(lastSeq + 1).padStart(6, '0');
  return `${prefix}${next}`;
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const poInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  merchandiser: { select: { id: true, name: true, email: true } },
  creator: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      style: { select: { id: true, styleNumber: true, styleName: true } },
      sizes: { include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } }, orderBy: { size: { sortOrder: 'asc' as const } } },
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

function toPOView(po: PORecord) {
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
    poDate: po.poDate,
    requiredDeliveryDate: po.requiredDeliveryDate,
    purchaseMode: po.purchaseMode,
    status: po.status,
    remarks: po.remarks,
    lines: po.lines.map(toLineView),
    totalOrderedQuantity: totalQuantity,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
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
  if (user.roles.includes('DISTRIBUTOR') && user.distributorIds.includes(po.distributorId)) return;
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
  },
) {
  const distributorIdFilter = canViewAllPOs(user)
    ? filters.distributorId
    : user.distributorIds[0]; // DISTRIBUTOR users see only their own

  const where: Prisma.DistributorPurchaseOrderWhereInput = {
    distributorId: distributorIdFilter ?? undefined,
    status: filters.status,
    purchaseMode: filters.purchaseMode,
    OR: filters.search
      ? [{ poNumber: { contains: filters.search, mode: 'insensitive' } }]
      : undefined,
  };

  const orders = await prisma.distributorPurchaseOrder.findMany({
    where,
    include: poInclude,
    orderBy: { createdAt: 'desc' },
  });

  return orders.map(toPOView);
}

export async function getPurchaseOrderDetail(user: CurrentUser, id: string) {
  const po = await prisma.distributorPurchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(user, po);
  return toPOView(po);
}

export async function createPurchaseOrder(
  actor: CurrentUser,
  input: {
    distributorId: string;
    merchandiserId?: string | null;
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
  if (actor.roles.includes('DISTRIBUTOR') && !actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER')) {
    if (!actor.distributorIds.includes(input.distributorId)) {
      throw HttpError.forbidden('You can only create purchase orders for your mapped distributor');
    }
  }

  const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) throw HttpError.badRequest('Distributor not found');
  if (distributor.status !== 'ACTIVE') throw HttpError.badRequest('Distributor is not active');

  await validateLines(input.lines);

  const poNumber = await generatePoNumber();
  const poId = createId();

  await prisma.distributorPurchaseOrder.create({
    data: {
      id: poId,
      poNumber,
      distributorId: input.distributorId,
      merchandiserId: input.merchandiserId ?? null,
      poDate: new Date(input.poDate),
      requiredDeliveryDate: input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null,
      purchaseMode: input.purchaseMode,
      status: 'DRAFT',
      remarks: input.remarks ?? null,
      createdBy: actor.id,
      lines: {
        create: input.lines.map((line) => ({
          id: createId(),
          styleId: line.styleId,
          remarks: line.remarks ?? null,
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

  await recordAuditLog({
    actorId: actor.id,
    action: 'PO_CREATED',
    entityType: 'DistributorPurchaseOrder',
    entityId: poId,
    metadata: { poNumber, distributorId: input.distributorId },
  });

  return getPurchaseOrderDetail(actor, poId);
}

export async function updatePurchaseOrderDraft(
  actor: CurrentUser,
  id: string,
  input: {
    merchandiserId?: string | null;
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
  if (po.status !== 'DRAFT') throw HttpError.badRequest('Purchase order can only be edited in DRAFT status');

  if (input.lines) {
    await validateLines(input.lines);
  }

  await prisma.$transaction(async (tx) => {
    await tx.distributorPurchaseOrder.update({
      where: { id },
      data: {
        merchandiserId: input.merchandiserId !== undefined ? input.merchandiserId : undefined,
        poDate: input.poDate ? new Date(input.poDate) : undefined,
        requiredDeliveryDate:
          input.requiredDeliveryDate !== undefined
            ? input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null
            : undefined,
        purchaseMode: input.purchaseMode,
        remarks: input.remarks !== undefined ? input.remarks : undefined,
      },
    });

    if (input.lines) {
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
  if (po.status !== 'DRAFT') throw HttpError.badRequest('Only DRAFT purchase orders can be submitted');

  await prisma.distributorPurchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED' } });

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
  const po = await prisma.distributorPurchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { sizes: { select: { jobOrderedQuantity: true } } } } },
  });
  if (!po) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(actor, po);

  const cancellableStatuses: PurchaseOrderStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'];
  if (!cancellableStatuses.includes(po.status)) {
    throw HttpError.badRequest(
      `Purchase order in status ${po.status} cannot be cancelled`,
    );
  }

  // Guard: no job ordered quantities must exist
  const hasJobOrdered = po.lines.some((line) =>
    line.sizes.some((sz) => sz.jobOrderedQuantity > 0),
  );
  if (hasJobOrdered) {
    throw HttpError.badRequest('Cannot cancel a purchase order that has job ordered quantities');
  }

  await prisma.distributorPurchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PO_CANCELLED',
    entityType: 'DistributorPurchaseOrder',
    entityId: id,
    metadata: { poNumber: po.poNumber },
  });

  return getPurchaseOrderDetail(actor, id);
}

export async function getJobOrderBalance(user: CurrentUser, id: string) {
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

  return { poId: id, poNumber: po.poNumber, lines };
}

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

  const lines = po.lines.map((line) => {
    const totals = line.sizes.reduce(
      (acc, s) => ({
        ordered: acc.ordered + s.orderedQuantity,
        dispatched: acc.dispatched + s.dispatchedQuantity,
        delivered: acc.delivered + s.deliveredQuantity,
        sold: acc.sold + s.actualSoldQuantity,
        returned: acc.returned + s.returnedQuantity,
      }),
      { ordered: 0, dispatched: 0, delivered: 0, sold: 0, returned: 0 },
    );

    return {
      lineId: line.id,
      styleId: line.style.id,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      sizes: line.sizes.map((s) => ({
        sizeId: s.sizeId,
        sizeCode: s.size.code,
        sizeLabel: s.size.label,
        orderedQuantity: s.orderedQuantity,
        dispatchedQuantity: s.dispatchedQuantity,
        deliveredQuantity: s.deliveredQuantity,
        actualSoldQuantity: s.actualSoldQuantity,
        returnedQuantity: s.returnedQuantity,
        pendingDispatchQuantity: s.orderedQuantity - s.dispatchedQuantity,
      })),
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
        styleSizes: { where: { status: 'ACTIVE' }, select: { sizeId: true } },
      },
    });

    if (!style) throw HttpError.badRequest(`Style ${line.styleId} not found`);
    if (style.status !== 'ACTIVE') throw HttpError.badRequest(`Style ${style.styleNumber} is not active`);

    const validSizeIds = new Set(style.styleSizes.map((ss) => ss.sizeId));
    for (const sz of line.sizes) {
      if (!validSizeIds.has(sz.sizeId)) {
        throw HttpError.badRequest(
          `Size ${sz.sizeId} is not valid for style ${style.styleNumber}`,
        );
      }
      if (sz.orderedQuantity <= 0) {
        throw HttpError.badRequest('Ordered quantity must be greater than 0');
      }
    }
  }
}
