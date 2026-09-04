import { createId } from '@erve/shared';
import { canMutateFactoryDispatch, canViewFactoryDispatch } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleFactoryId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { resolveAllocationFactories } from './factory-source-resolution.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function assertMutationAccess(actor: CurrentUser): void {
  if (!canMutateFactoryDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to manage Factory Dispatches');
  }
}

function assertViewAccess(actor: CurrentUser): void {
  if (!canViewFactoryDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Factory Dispatches');
  }
}

// null means "no restriction" (ADMIN) — every other mutating role is scoped
// to its own single mapped Factory.
function resolveActorFactoryScope(actor: CurrentUser): string | null {
  if (actor.roles.includes('ADMIN')) return null;
  return getSoleFactoryId(actor);
}

function assertFactoryRowAccess(actor: CurrentUser, dispatchFactoryId: string): void {
  const scope = resolveActorFactoryScope(actor);
  if (scope !== null && scope !== dispatchFactoryId) {
    throw HttpError.forbidden('You do not have access to this Factory Dispatch');
  }
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function generateFactoryDispatchNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ factoryDispatchNumber: string; factoryDispatchSerial: number }> {
  const serial = await allocateDocumentSerial(client, 'FACTORY_DISPATCH', financialYear.id);
  return {
    factoryDispatchNumber: formatDocumentNumber(DOCUMENT_PREFIXES.FACTORY_DISPATCH, financialYear.code, serial),
    factoryDispatchSerial: serial,
  };
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

const dispatchInclude = {
  factory: { select: { id: true, code: true, name: true } },
  saleOrder: {
    select: { id: true, saleOrderNumber: true, distributor: { select: { id: true, code: true, name: true } } },
  },
  preparedBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  ervePackingSource: { select: { id: true } },
  lines: {
    include: {
      saleOrderLine: {
        select: {
          purchaseOrderLineSize: {
            select: {
              sizeId: true,
              size: { select: { code: true, label: true } },
              purchaseOrderLine: { select: { styleId: true, style: { select: { styleNumber: true, styleName: true } } } },
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
} satisfies Prisma.FactoryDispatchInclude;

type DispatchRecord = Prisma.FactoryDispatchGetPayload<{ include: typeof dispatchInclude }>;

function toLineView(line: DispatchRecord['lines'][number]) {
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

function toCartonView(carton: DispatchRecord['cartons'][number]) {
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

function toSummaryView(record: DispatchRecord) {
  return {
    id: record.id,
    factoryDispatchNumber: record.factoryDispatchNumber,
    factory: record.factory,
    saleOrder: record.saleOrder,
    status: record.status,
    preparedBy: record.preparedBy,
    preparedAt: record.preparedAt.toISOString(),
    finalizedBy: record.finalizedBy,
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    totalPackedQuantity: record.lines.reduce((sum, line) => sum + line.packedQuantity, 0),
    consolidated: record.ervePackingSource !== null,
    createdAt: record.createdAt.toISOString(),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toDetailView(record: DispatchRecord) {
  return {
    ...toSummaryView(record),
    lines: record.lines.map(toLineView),
    cartons: record.cartons.map(toCartonView),
  };
}

async function loadDispatch(id: string): Promise<DispatchRecord> {
  const record = await prisma.factoryDispatch.findUnique({ where: { id }, include: dispatchInclude });
  if (!record) throw HttpError.notFound('Factory dispatch not found');
  return record;
}

export async function getFactoryDispatchDetail(actor: CurrentUser, id: string) {
  assertViewAccess(actor);
  const record = await loadDispatch(id);
  assertFactoryRowAccess(actor, record.factoryId);
  return toDetailView(record);
}

export async function getFactoryDispatchList(
  actor: CurrentUser,
  filters: {
    status?: 'DRAFT' | 'READY_FOR_ERVE';
    saleOrderId?: string;
    factoryId?: string;
    unconsolidatedOnly?: boolean;
    cursor?: string;
    limit: number;
  },
) {
  assertViewAccess(actor);
  const scope = resolveActorFactoryScope(actor);
  const factoryId = scope ?? filters.factoryId;

  const where: Prisma.FactoryDispatchWhereInput = {
    factoryId,
    status: filters.status,
    saleOrderId: filters.saleOrderId,
    ervePackingSource: filters.unconsolidatedOnly ? null : undefined,
  };

  const records = await prisma.factoryDispatch.findMany({
    where,
    include: dispatchInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map(toSummaryView),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// ---------------------------------------------------------------------------
// Stage 1 — Factory Packing Queue
// ---------------------------------------------------------------------------

export async function getFactoryPackingQueue(actor: CurrentUser, requestedFactoryId?: string) {
  assertViewAccess(actor);

  let factoryId: string;
  if (actor.roles.includes('ADMIN')) {
    if (requestedFactoryId) factoryId = requestedFactoryId;
    else if (actor.factoryIds.length === 1) factoryId = actor.factoryIds[0]!;
    else throw HttpError.badRequest('factoryId is required');
  } else {
    factoryId = getSoleFactoryId(actor);
  }

  const allocations = await prisma.stockAllocation.findMany({
    where: {
      status: 'ACTIVE',
      saleOrderLine: { saleOrder: { status: 'APPROVED' } },
      qaReleaseLine: { release: { jobOrder: { factoryId } } },
    },
    select: {
      id: true,
      quantity: true,
      saleOrderLine: {
        select: {
          id: true,
          saleOrder: {
            select: { id: true, saleOrderNumber: true, distributor: { select: { id: true, code: true, name: true } } },
          },
          purchaseOrderLineSize: {
            select: {
              sizeId: true,
              size: { select: { code: true, label: true } },
              purchaseOrderLine: { select: { styleId: true, style: { select: { styleNumber: true, styleName: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (allocations.length === 0) return [];

  const packedRows = await prisma.factoryDispatchLine.groupBy({
    by: ['stockAllocationId'],
    where: { stockAllocationId: { in: allocations.map((a) => a.id) } },
    _sum: { packedQuantity: true },
  });
  const packedByAllocation = new Map(packedRows.map((row) => [row.stockAllocationId, row._sum.packedQuantity ?? 0]));

  return allocations
    .map((allocation) => {
      const pols = allocation.saleOrderLine.purchaseOrderLineSize;
      const pol = pols.purchaseOrderLine;
      const packedQuantity = packedByAllocation.get(allocation.id) ?? 0;
      return {
        saleOrderId: allocation.saleOrderLine.saleOrder.id,
        saleOrderNumber: allocation.saleOrderLine.saleOrder.saleOrderNumber,
        distributor: allocation.saleOrderLine.saleOrder.distributor,
        saleOrderLineId: allocation.saleOrderLine.id,
        stockAllocationId: allocation.id,
        styleId: pol.styleId,
        styleNumber: pol.style.styleNumber,
        styleName: pol.style.styleName,
        sizeId: pols.sizeId,
        sizeCode: pols.size.code,
        sizeLabel: pols.size.label,
        allocatedQuantity: allocation.quantity,
        packedQuantity,
        remainingQuantity: allocation.quantity - packedQuantity,
      };
    })
    .filter((row) => row.remainingQuantity > 0);
}

// ---------------------------------------------------------------------------
// Stage 2 — Factory Dispatch header/lines
// ---------------------------------------------------------------------------

interface FactoryDispatchLineInput {
  saleOrderLineId: string;
  stockAllocationId: string;
  packedQuantity: number;
}

async function lockAllocationsAscending(tx: Tx, allocationIds: string[]): Promise<void> {
  const sorted = [...new Set(allocationIds)].sort();
  for (const id of sorted) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-allocation-${id}`}))`;
  }
}

// Re-reads allocation/approved-quantity ceilings inside the caller's already-
// locked transaction and throws if the requested additional packedQuantity
// values would push any allocation or any Sale Order line's cumulative
// packed quantity past its ceiling. `excludeDispatchId` lets a line-add on an
// existing dispatch ignore that dispatch's own already-counted lines (not
// used today since lines are only ever added, never replaced in place, but
// keeps the guard correct if that changes).
async function assertWithinPackingCeilings(
  tx: Tx,
  lines: FactoryDispatchLineInput[],
  allocationById: Map<string, { id: string; quantity: number; saleOrderLineId: string }>,
  approvedQuantityBySOLine: Map<string, number>,
): Promise<void> {
  const allocationIds = [...new Set(lines.map((l) => l.stockAllocationId))];
  const existingByAllocation = await tx.factoryDispatchLine.groupBy({
    by: ['stockAllocationId'],
    where: { stockAllocationId: { in: allocationIds } },
    _sum: { packedQuantity: true },
  });
  const existingByAllocationMap = new Map(existingByAllocation.map((r) => [r.stockAllocationId, r._sum.packedQuantity ?? 0]));

  const soLineIds = [...new Set(lines.map((l) => l.saleOrderLineId))];
  const existingBySOLine = await tx.factoryDispatchLine.groupBy({
    by: ['saleOrderLineId'],
    where: { saleOrderLineId: { in: soLineIds } },
    _sum: { packedQuantity: true },
  });
  const existingBySOLineMap = new Map(existingBySOLine.map((r) => [r.saleOrderLineId, r._sum.packedQuantity ?? 0]));

  const requestedTotalBySOLine = new Map<string, number>();
  for (const line of lines) {
    const allocation = allocationById.get(line.stockAllocationId);
    if (!allocation) throw HttpError.badRequest(`Stock allocation ${line.stockAllocationId} not found`);
    const existingForAllocation = existingByAllocationMap.get(line.stockAllocationId) ?? 0;
    if (existingForAllocation + line.packedQuantity > allocation.quantity) {
      throw HttpError.conflict(
        `Packed quantity for stock allocation ${line.stockAllocationId} would exceed the allocated quantity (${allocation.quantity})`,
      );
    }
    requestedTotalBySOLine.set(
      line.saleOrderLineId,
      (requestedTotalBySOLine.get(line.saleOrderLineId) ?? 0) + line.packedQuantity,
    );
  }
  for (const [soLineId, requestedTotal] of requestedTotalBySOLine) {
    const approvedQuantity = approvedQuantityBySOLine.get(soLineId) ?? 0;
    const existing = existingBySOLineMap.get(soLineId) ?? 0;
    if (existing + requestedTotal > approvedQuantity) {
      throw HttpError.conflict(
        `Packed quantity for sale order line ${soLineId} would exceed the approved quantity (${approvedQuantity})`,
      );
    }
  }
}

// Explicit child-first deletion order for one or more Factory Dispatches.
// Required because Postgres cascade resolution does not order two SEPARATE
// cascade branches under one parent relative to each other: FactoryDispatch
// -> FactoryDispatchLine (CASCADE) and FactoryDispatch -> FactoryPackingCarton
// -> FactoryPackingCartonLine (CASCADE) are independent branches, and
// FactoryPackingCartonLine.factoryDispatchLineId is onDelete: Restrict — a
// plain `factoryDispatch.delete()`/`deleteMany()` can therefore fail with a
// RESTRICT violation whenever cartons exist, depending on cascade ordering.
// Deleting bottom-up here (carton lines -> cartons -> dispatch lines ->
// dispatch) sidesteps that entirely.
export async function hardDeleteFactoryDispatches(tx: Tx, factoryDispatchIds: string[]): Promise<number> {
  if (factoryDispatchIds.length === 0) return 0;
  await tx.factoryPackingCartonLine.deleteMany({
    where: { factoryDispatchLine: { factoryDispatchId: { in: factoryDispatchIds } } },
  });
  await tx.factoryPackingCarton.deleteMany({ where: { factoryDispatchId: { in: factoryDispatchIds } } });
  await tx.factoryDispatchLine.deleteMany({ where: { factoryDispatchId: { in: factoryDispatchIds } } });
  const result = await tx.factoryDispatch.deleteMany({ where: { id: { in: factoryDispatchIds } } });
  return result.count;
}

async function resolveUniformFactory(
  tx: Tx,
  allocationIds: string[],
  actorFactoryScope: string | null,
): Promise<string> {
  const factories = await resolveAllocationFactories(tx, allocationIds);
  let resolvedFactoryId: string | null = null;
  for (const allocationId of allocationIds) {
    const factory = factories.get(allocationId);
    if (!factory) throw HttpError.badRequest(`Stock allocation ${allocationId} not found`);
    if (resolvedFactoryId === null) resolvedFactoryId = factory.id;
    else if (resolvedFactoryId !== factory.id) {
      throw HttpError.badRequest('All lines in a Factory Dispatch must be sourced from the same Factory');
    }
  }
  const factoryId = resolvedFactoryId!;
  if (actorFactoryScope !== null && actorFactoryScope !== factoryId) {
    throw HttpError.forbidden('You may only pack quantity allocated from your own mapped Factory');
  }
  return factoryId;
}

export interface CreateFactoryDispatchInput {
  saleOrderId: string;
  lines: FactoryDispatchLineInput[];
}

export async function createFactoryDispatch(actor: CurrentUser, input: CreateFactoryDispatchInput) {
  assertMutationAccess(actor);
  const actorFactoryScope = resolveActorFactoryScope(actor);

  const allocationIds = input.lines.map((l) => l.stockAllocationId);
  if (new Set(allocationIds).size !== allocationIds.length) {
    throw HttpError.badRequest('Duplicate stock allocation entries are not allowed in the same Factory Dispatch');
  }

  const dispatchId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${input.saleOrderId}`}))`;

    const order = await tx.saleOrder.findUnique({ where: { id: input.saleOrderId } });
    if (!order) throw HttpError.notFound('Sale order not found');
    if (order.status !== 'APPROVED') {
      throw HttpError.badRequest(`Sale order in status ${order.status} is not eligible for Factory packing`);
    }

    await lockAllocationsAscending(tx, allocationIds);

    const allocations = await tx.stockAllocation.findMany({
      where: { id: { in: allocationIds } },
      include: { saleOrderLine: { select: { id: true, saleOrderId: true, approvedQuantity: true } } },
    });
    const allocationById = new Map(allocations.map((a) => [a.id, a]));
    const approvedQuantityBySOLine = new Map<string, number>();

    for (const line of input.lines) {
      const allocation = allocationById.get(line.stockAllocationId);
      if (!allocation) throw HttpError.badRequest(`Stock allocation ${line.stockAllocationId} not found`);
      if (allocation.status !== 'ACTIVE') {
        throw HttpError.badRequest(`Stock allocation ${line.stockAllocationId} is not active`);
      }
      if (allocation.saleOrderLineId !== line.saleOrderLineId) {
        throw HttpError.badRequest(
          `Stock allocation ${line.stockAllocationId} does not belong to sale order line ${line.saleOrderLineId}`,
        );
      }
      if (allocation.saleOrderLine.saleOrderId !== input.saleOrderId) {
        throw HttpError.badRequest(`Sale order line ${line.saleOrderLineId} does not belong to this sale order`);
      }
      approvedQuantityBySOLine.set(line.saleOrderLineId, allocation.saleOrderLine.approvedQuantity ?? 0);
    }

    const factoryId = await resolveUniformFactory(tx, allocationIds, actorFactoryScope);
    await assertWithinPackingCeilings(
      tx,
      input.lines,
      new Map(allocations.map((a) => [a.id, { id: a.id, quantity: a.quantity, saleOrderLineId: a.saleOrderLineId }])),
      approvedQuantityBySOLine,
    );

    const financialYear = await ensureFinancialYear(tx, new Date());
    const { factoryDispatchNumber, factoryDispatchSerial } = await generateFactoryDispatchNumber(tx, financialYear);

    await tx.factoryDispatch.create({
      data: {
        id: dispatchId,
        factoryDispatchNumber,
        factoryId,
        saleOrderId: input.saleOrderId,
        status: 'DRAFT',
        preparedById: actor.id,
        financialYearId: financialYear.id,
        factoryDispatchSerial,
        lines: {
          create: input.lines.map((line) => ({
            id: createId(),
            saleOrderLineId: line.saleOrderLineId,
            stockAllocationId: line.stockAllocationId,
            packedQuantity: line.packedQuantity,
          })),
        },
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_DISPATCH_CREATED',
        entityType: 'FactoryDispatch',
        entityId: dispatchId,
        metadata: { factoryDispatchNumber, saleOrderId: input.saleOrderId, factoryId, lineCount: input.lines.length },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, dispatchId);
}

export async function addFactoryDispatchLines(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; lines: FactoryDispatchLineInput[] },
) {
  assertMutationAccess(actor);
  const actorFactoryScope = resolveActorFactoryScope(actor);

  const allocationIds = input.lines.map((l) => l.stockAllocationId);
  if (new Set(allocationIds).size !== allocationIds.length) {
    throw HttpError.badRequest('Duplicate stock allocation entries are not allowed in the same request');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id }, include: { lines: true } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Only a DRAFT Factory Dispatch can be edited');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const existingAllocationIds = new Set(dispatch.lines.map((l) => l.stockAllocationId));
    for (const line of input.lines) {
      if (existingAllocationIds.has(line.stockAllocationId)) {
        throw HttpError.badRequest(
          `Stock allocation ${line.stockAllocationId} is already a line on this Factory Dispatch`,
        );
      }
    }

    await lockAllocationsAscending(tx, allocationIds);

    const allocations = await tx.stockAllocation.findMany({
      where: { id: { in: allocationIds } },
      include: { saleOrderLine: { select: { id: true, saleOrderId: true, approvedQuantity: true } } },
    });
    const allocationById = new Map(allocations.map((a) => [a.id, a]));
    const approvedQuantityBySOLine = new Map<string, number>();

    for (const line of input.lines) {
      const allocation = allocationById.get(line.stockAllocationId);
      if (!allocation) throw HttpError.badRequest(`Stock allocation ${line.stockAllocationId} not found`);
      if (allocation.status !== 'ACTIVE') {
        throw HttpError.badRequest(`Stock allocation ${line.stockAllocationId} is not active`);
      }
      if (allocation.saleOrderLineId !== line.saleOrderLineId) {
        throw HttpError.badRequest(
          `Stock allocation ${line.stockAllocationId} does not belong to sale order line ${line.saleOrderLineId}`,
        );
      }
      if (allocation.saleOrderLine.saleOrderId !== dispatch.saleOrderId) {
        throw HttpError.badRequest(`Sale order line ${line.saleOrderLineId} does not belong to this Sale Order`);
      }
      approvedQuantityBySOLine.set(line.saleOrderLineId, allocation.saleOrderLine.approvedQuantity ?? 0);
    }

    // resolveUniformFactory checks internal consistency across OLD (already
    // known to be dispatch.factoryId) and NEW allocations together — any new
    // allocation resolving to a different Factory fails here, which is what
    // guarantees the new lines match dispatch.factoryId without a second pass.
    await resolveUniformFactory(tx, [...existingAllocationIds, ...allocationIds], actorFactoryScope);

    await assertWithinPackingCeilings(
      tx,
      input.lines,
      new Map(allocations.map((a) => [a.id, { id: a.id, quantity: a.quantity, saleOrderLineId: a.saleOrderLineId }])),
      approvedQuantityBySOLine,
    );

    await tx.factoryDispatchLine.createMany({
      data: input.lines.map((line) => ({
        id: createId(),
        factoryDispatchId: id,
        saleOrderLineId: line.saleOrderLineId,
        stockAllocationId: line.stockAllocationId,
        packedQuantity: line.packedQuantity,
      })),
    });
    await tx.factoryDispatch.update({ where: { id }, data: { version: { increment: 1 } } });
  });

  return getFactoryDispatchDetail(actor, id);
}

export async function removeFactoryDispatchLine(
  actor: CurrentUser,
  id: string,
  lineId: string,
  input: { expectedVersion: number },
) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Only a DRAFT Factory Dispatch can be edited');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const line = await tx.factoryDispatchLine.findUnique({
      where: { id: lineId },
      include: { cartonLines: { select: { id: true } } },
    });
    if (!line || line.factoryDispatchId !== id) throw HttpError.notFound('Factory dispatch line not found');
    if (line.cartonLines.length > 0) {
      throw HttpError.badRequest('Remove this line from its carton(s) before removing it from the Factory Dispatch');
    }

    await tx.factoryDispatchLine.delete({ where: { id: lineId } });
    await tx.factoryDispatch.update({ where: { id }, data: { version: { increment: 1 } } });
  });

  return getFactoryDispatchDetail(actor, id);
}

export async function deleteFactoryDispatch(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') {
      throw HttpError.badRequest('Only a DRAFT Factory Dispatch may be abandoned; finalized packing cannot be deleted');
    }
    assertFactoryRowAccess(actor, dispatch.factoryId);

    await hardDeleteFactoryDispatches(tx, [id]);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_DISPATCH_DELETED',
        entityType: 'FactoryDispatch',
        entityId: id,
        metadata: { factoryDispatchNumber: dispatch.factoryDispatchNumber },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Stage 3 — Cartons / Packing List
// ---------------------------------------------------------------------------

export interface CreateCartonInput {
  expectedVersion: number;
  cartonNumber: string;
  packageDetails?: string | null;
  weight?: number | null;
  lines: Array<{ factoryDispatchLineId: string; quantity: number }>;
}

export async function addFactoryPackingCarton(actor: CurrentUser, dispatchId: string, input: CreateCartonInput) {
  assertMutationAccess(actor);

  const cartonId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${dispatchId}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id: dispatchId }, include: { lines: true } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Cartons can only be edited on a DRAFT Factory Dispatch');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const linesById = new Map(dispatch.lines.map((line) => [line.id, line]));
    const ids = input.lines.map((l) => l.factoryDispatchLineId);
    if (new Set(ids).size !== ids.length) {
      throw HttpError.badRequest('Each carton line must reference a distinct Factory Dispatch line');
    }
    for (const entry of input.lines) {
      if (!linesById.has(entry.factoryDispatchLineId)) {
        throw HttpError.badRequest(`Factory dispatch line ${entry.factoryDispatchLineId} does not belong to this dispatch`);
      }
    }

    const existingCartonedByLine = await tx.factoryPackingCartonLine.groupBy({
      by: ['factoryDispatchLineId'],
      where: { factoryDispatchLineId: { in: ids } },
      _sum: { quantity: true },
    });
    const existingByLine = new Map(existingCartonedByLine.map((r) => [r.factoryDispatchLineId, r._sum.quantity ?? 0]));

    for (const entry of input.lines) {
      const line = linesById.get(entry.factoryDispatchLineId)!;
      const existing = existingByLine.get(entry.factoryDispatchLineId) ?? 0;
      if (existing + entry.quantity > line.packedQuantity) {
        throw HttpError.conflict(
          `Carton quantity for line ${entry.factoryDispatchLineId} would exceed its packed quantity (${line.packedQuantity})`,
        );
      }
    }

    const duplicateCartonNumber = await tx.factoryPackingCarton.findUnique({
      where: { factoryDispatchId_cartonNumber: { factoryDispatchId: dispatchId, cartonNumber: input.cartonNumber } },
    });
    if (duplicateCartonNumber) {
      throw HttpError.badRequest(`Carton number ${input.cartonNumber} already exists on this Factory Dispatch`);
    }

    await tx.factoryPackingCarton.create({
      data: {
        id: cartonId,
        factoryDispatchId: dispatchId,
        cartonNumber: input.cartonNumber,
        packageDetails: input.packageDetails ?? null,
        weight: input.weight ?? null,
        lines: {
          create: input.lines.map((entry) => ({
            id: createId(),
            factoryDispatchLineId: entry.factoryDispatchLineId,
            quantity: entry.quantity,
          })),
        },
      },
    });
    await tx.factoryDispatch.update({ where: { id: dispatchId }, data: { version: { increment: 1 } } });
  });

  return getFactoryDispatchDetail(actor, dispatchId);
}

export async function removeFactoryPackingCarton(
  actor: CurrentUser,
  dispatchId: string,
  cartonId: string,
  input: { expectedVersion: number },
) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${dispatchId}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id: dispatchId } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Cartons can only be edited on a DRAFT Factory Dispatch');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const carton = await tx.factoryPackingCarton.findUnique({ where: { id: cartonId } });
    if (!carton || carton.factoryDispatchId !== dispatchId) throw HttpError.notFound('Carton not found');

    await tx.factoryPackingCarton.delete({ where: { id: cartonId } });
    await tx.factoryDispatch.update({ where: { id: dispatchId }, data: { version: { increment: 1 } } });
  });

  return getFactoryDispatchDetail(actor, dispatchId);
}

// ---------------------------------------------------------------------------
// Lifecycle — finalize (DRAFT -> READY_FOR_ERVE)
// ---------------------------------------------------------------------------

export async function finalizeFactoryDispatch(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({
      where: { id },
      include: { lines: { include: { cartonLines: true } } },
    });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Only a DRAFT Factory Dispatch can be finalized');
    assertFactoryRowAccess(actor, dispatch.factoryId);
    if (dispatch.lines.length === 0) throw HttpError.badRequest('A Factory Dispatch must have at least one line');

    for (const line of dispatch.lines) {
      const cartonedQuantity = line.cartonLines.reduce((sum, cartonLine) => sum + cartonLine.quantity, 0);
      if (cartonedQuantity !== line.packedQuantity) {
        throw HttpError.badRequest(
          `Line ${line.id} has ${cartonedQuantity} unit(s) carton-packed but ${line.packedQuantity} packed — carton contents must reconcile exactly before finalizing`,
        );
      }
    }

    const updated = await tx.factoryDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'READY_FOR_ERVE', finalizedById: actor.id, finalizedAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_DISPATCH_FINALIZED',
        entityType: 'FactoryDispatch',
        entityId: id,
        metadata: { factoryDispatchNumber: dispatch.factoryDispatchNumber },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, id);
}
