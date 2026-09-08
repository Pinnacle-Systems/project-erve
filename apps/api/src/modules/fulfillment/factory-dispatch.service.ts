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
          style: { select: { id: true, styleNumber: true, styleName: true } },
          size: { select: { id: true, code: true, label: true } },
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
                  style: { select: { styleNumber: true, styleName: true } },
                  size: { select: { code: true, label: true } },
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
  const style = line.saleOrderLine.style;
  const size = line.saleOrderLine.size;
  return {
    id: line.id,
    saleOrderLineId: line.saleOrderLineId,
    stockAllocationId: line.stockAllocationId,
    styleId: style.id,
    styleNumber: style.styleNumber,
    styleName: style.styleName,
    sizeId: size.id,
    sizeCode: size.code,
    sizeLabel: size.label,
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
      const style = cartonLine.factoryDispatchLine.saleOrderLine.style;
      const size = cartonLine.factoryDispatchLine.saleOrderLine.size;
      return {
        factoryDispatchLineId: cartonLine.factoryDispatchLineId,
        styleNumber: style.styleNumber,
        styleName: style.styleName,
        sizeCode: size.code,
        sizeLabel: size.label,
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
// Stage 1 — Factory Packing Queue (business-level: Dispatch Order line only —
// Factory never sees/selects a StockAllocation/QaReleaseLine/Job Order)
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

  const lines = await prisma.saleOrderLine.findMany({
    where: { saleOrder: { factoryId } },
    select: {
      id: true,
      quantity: true,
      style: { select: { id: true, styleNumber: true, styleName: true } },
      size: { select: { id: true, code: true, label: true } },
      saleOrder: {
        select: { id: true, saleOrderNumber: true, distributor: { select: { id: true, code: true, name: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (lines.length === 0) return [];

  const packedRows = await prisma.factoryDispatchLine.groupBy({
    by: ['saleOrderLineId'],
    where: { saleOrderLineId: { in: lines.map((l) => l.id) } },
    _sum: { packedQuantity: true },
  });
  const packedByLine = new Map(packedRows.map((row) => [row.saleOrderLineId, row._sum.packedQuantity ?? 0]));

  return lines
    .map((line) => {
      const packedQuantity = packedByLine.get(line.id) ?? 0;
      return {
        saleOrderId: line.saleOrder.id,
        saleOrderNumber: line.saleOrder.saleOrderNumber,
        distributor: line.saleOrder.distributor,
        saleOrderLineId: line.id,
        styleId: line.style.id,
        styleNumber: line.style.styleNumber,
        styleName: line.style.styleName,
        sizeId: line.size.id,
        sizeCode: line.size.code,
        sizeLabel: line.size.label,
        allocatedQuantity: line.quantity,
        packedQuantity,
        remainingQuantity: line.quantity - packedQuantity,
      };
    })
    .filter((row) => row.remainingQuantity > 0);
}

// ---------------------------------------------------------------------------
// Stage 2 — recording packing (one Dispatch Order -> one FactoryDispatch
// packing root; see the Dispatch Order Phase 3 plan §2.6/§2.7/§2.8)
// ---------------------------------------------------------------------------

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

export interface RecordPackingInput {
  saleOrderId: string;
  // Incremental packed quantity to ADD for each line (not a running total) —
  // business-level only: Dispatch Order line + quantity. The backend
  // auto-distributes this across the line's own ACTIVE StockAllocation rows,
  // oldest-QaRelease-first — never exposed to or chosen by the Factory user.
  lines: Array<{ saleOrderLineId: string; packedQuantity: number }>;
}

// Records progressive Factory packing against a Dispatch Order. Reuses the
// order's single FactoryDispatch packing root if one already exists (DB-
// enforced via @@unique([saleOrderId])), otherwise creates exactly one.
// Acquires the SAME sale-order-{id} advisory lock updateDispatchOrder and
// finalizeFactoryDispatch use, in the same outermost position, so a
// Merchandiser edit and a packing call can never race past each other (see
// plan §2.5/§2.7): the invariant SUM(packedQuantity for a line) <=
// SaleOrderLine.quantity is checked fresh, inside the lock, every time.
export async function recordFactoryPacking(actor: CurrentUser, input: RecordPackingInput) {
  assertMutationAccess(actor);
  const actorFactoryScope = resolveActorFactoryScope(actor);

  if (input.lines.length === 0) throw HttpError.badRequest('At least one line is required');
  if (input.lines.some((l) => !Number.isInteger(l.packedQuantity) || l.packedQuantity <= 0)) {
    throw HttpError.badRequest('packedQuantity must be a positive integer');
  }
  const saleOrderLineIds = input.lines.map((l) => l.saleOrderLineId);
  if (new Set(saleOrderLineIds).size !== saleOrderLineIds.length) {
    throw HttpError.badRequest('Duplicate dispatch order line entries are not allowed in the same request');
  }

  let dispatchId!: string;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${input.saleOrderId}`}))`;

    const order = await tx.saleOrder.findUnique({ where: { id: input.saleOrderId }, include: { lines: true } });
    if (!order) throw HttpError.notFound('Dispatch order not found');
    if (actorFactoryScope !== null && actorFactoryScope !== order.factoryId) {
      throw HttpError.forbidden('You may only pack quantity for your own mapped Factory');
    }

    const linesById = new Map(order.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      if (!linesById.has(line.saleOrderLineId)) {
        throw HttpError.badRequest(`Line ${line.saleOrderLineId} does not belong to this dispatch order`);
      }
    }

    let dispatch = await tx.factoryDispatch.findUnique({ where: { saleOrderId: input.saleOrderId } });
    if (dispatch && dispatch.status !== 'DRAFT') {
      throw HttpError.badRequest('This dispatch order has already completed Factory Dispatch');
    }

    let createdNew = false;
    if (!dispatch) {
      const financialYear = await ensureFinancialYear(tx, new Date());
      const { factoryDispatchNumber, factoryDispatchSerial } = await generateFactoryDispatchNumber(tx, financialYear);
      dispatch = await tx.factoryDispatch.create({
        data: {
          id: createId(),
          factoryDispatchNumber,
          factoryId: order.factoryId,
          saleOrderId: input.saleOrderId,
          status: 'DRAFT',
          preparedById: actor.id,
          financialYearId: financialYear.id,
          factoryDispatchSerial,
        },
      });
      createdNew = true;
    }
    dispatchId = dispatch.id;

    // Invariant: SUM(packedQuantity for a line) <= SaleOrderLine.quantity.
    const existingPackedRows = await tx.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: { saleOrderLineId: { in: saleOrderLineIds } },
      _sum: { packedQuantity: true },
    });
    const existingPackedByLine = new Map(existingPackedRows.map((r) => [r.saleOrderLineId, r._sum.packedQuantity ?? 0]));
    for (const line of input.lines) {
      const existingPacked = existingPackedByLine.get(line.saleOrderLineId) ?? 0;
      const targetQuantity = linesById.get(line.saleOrderLineId)!.quantity;
      if (existingPacked + line.packedQuantity > targetQuantity) {
        throw HttpError.conflict(
          `Packed quantity for line ${line.saleOrderLineId} would exceed its Dispatch Order quantity (${targetQuantity})`,
        );
      }
    }

    for (const line of input.lines) {
      const allocations = await tx.stockAllocation.findMany({
        where: { saleOrderLineId: line.saleOrderLineId, status: 'ACTIVE' },
        include: { qaReleaseLine: { include: { release: { select: { releasedAt: true } } } } },
      });
      const sorted = [...allocations].sort(
        (a, b) =>
          a.qaReleaseLine.release.releasedAt.getTime() - b.qaReleaseLine.release.releasedAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      const existingByAllocation = await tx.factoryDispatchLine.groupBy({
        by: ['stockAllocationId'],
        where: { stockAllocationId: { in: sorted.map((a) => a.id) } },
        _sum: { packedQuantity: true },
      });
      const packedByAllocation = new Map(existingByAllocation.map((r) => [r.stockAllocationId, r._sum.packedQuantity ?? 0]));

      let remaining = line.packedQuantity;
      for (const allocation of sorted) {
        if (remaining <= 0) break;
        const alreadyPacked = packedByAllocation.get(allocation.id) ?? 0;
        const capacity = allocation.quantity - alreadyPacked;
        if (capacity <= 0) continue;
        const increment = Math.min(capacity, remaining);
        remaining -= increment;

        const existingLine = await tx.factoryDispatchLine.findUnique({
          where: {
            factoryDispatchId_stockAllocationId: { factoryDispatchId: dispatch.id, stockAllocationId: allocation.id },
          },
        });
        if (existingLine) {
          await tx.factoryDispatchLine.update({ where: { id: existingLine.id }, data: { packedQuantity: { increment } } });
        } else {
          await tx.factoryDispatchLine.create({
            data: {
              id: createId(),
              factoryDispatchId: dispatch.id,
              saleOrderLineId: line.saleOrderLineId,
              stockAllocationId: allocation.id,
              packedQuantity: increment,
            },
          });
        }
      }
      if (remaining > 0) {
        // Unreachable given the ceiling check above (a line's total ACTIVE
        // allocation quantity always equals its Dispatch Order quantity) —
        // guarded defensively rather than silently dropping quantity.
        throw HttpError.conflict(
          `Unable to attribute all packed quantity for line ${line.saleOrderLineId} to a stock allocation`,
        );
      }
    }

    await tx.factoryDispatch.update({ where: { id: dispatch.id }, data: { version: { increment: 1 } } });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: createdNew ? 'FACTORY_DISPATCH_CREATED' : 'FACTORY_DISPATCH_PACKED',
        entityType: 'FactoryDispatch',
        entityId: dispatch.id,
        metadata: { saleOrderId: input.saleOrderId, factoryId: order.factoryId, lines: input.lines },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, dispatchId);
}

export async function removeFactoryDispatchLine(
  actor: CurrentUser,
  id: string,
  lineId: string,
  input: { expectedVersion: number },
) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
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
    const pre = await tx.factoryDispatch.findUnique({ where: { id }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
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
// Lifecycle — finalize (DRAFT -> READY_FOR_ERVE): the authoritative "goods
// left the factory for Erve" fact that locks the Dispatch Order (see the
// Phase 3 plan §2.5/§2.6). Coordinates on the SAME sale-order-{id} advisory
// lock updateDispatchOrder/recordFactoryPacking use, in the same outermost
// position, so a Merchandiser edit and this transition can never both
// commit past each other. The completion invariant (every line fully and
// exactly packed) is enforced here, not earlier — DRAFT packing may remain
// partial/progressive.
// ---------------------------------------------------------------------------

export async function finalizeFactoryDispatch(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
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

    // Completion invariant (no partial-fulfilment finalize): every Dispatch
    // Order line must be packed EXACTLY to its quantity — not more, not
    // less. Because one Dispatch Order has exactly one FactoryDispatch
    // packing root (@@unique([saleOrderId])), this dispatch's own lines are
    // the complete packing picture for the whole order.
    const saleOrderLines = await tx.saleOrderLine.findMany({
      where: { saleOrderId: dispatch.saleOrderId },
      select: { id: true, quantity: true },
    });
    const packedBySOLine = new Map<string, number>();
    for (const line of dispatch.lines) {
      packedBySOLine.set(line.saleOrderLineId, (packedBySOLine.get(line.saleOrderLineId) ?? 0) + line.packedQuantity);
    }
    const mismatches = saleOrderLines
      .map((line) => ({ id: line.id, required: line.quantity, packed: packedBySOLine.get(line.id) ?? 0 }))
      .filter((line) => line.packed !== line.required);
    if (mismatches.length > 0) {
      const detail = mismatches.map((m) => `${m.id} (packed ${m.packed}/${m.required})`).join(', ');
      throw HttpError.badRequest(
        `Cannot finalize: every Dispatch Order line must be packed exactly to its quantity — mismatched line(s): ${detail}`,
      );
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
