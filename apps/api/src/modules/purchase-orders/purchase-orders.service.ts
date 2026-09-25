import { createId } from '@erve/shared';
import type { OrderSheetStyleDetail, OrderSheetStyleOption, PurchaseOrderDetail } from '@erve/types';
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
import { getActiveStyleSizeIds } from '../master-data/style-size.util.js';

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
  // Order Sheet planning lock: exposed so the list/detail views can derive
  // "Available for Job Order" / "Included in Job Order" without a status
  // enum that no longer reflects the real lifecycle. lockedByJobOrder's
  // status is included so a locked Order Sheet keeps showing correctly even
  // if its Job Order later reaches a terminal state.
  lockedByJobOrder: { select: { id: true, jobOrderNumber: true, status: true } },
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
    jobOrderId: po.jobOrderId,
    lockedByJobOrder: po.lockedByJobOrder,
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

// An Order Sheet may be edited or cancelled only while it is not cancelled
// and has no Job Order mapping yet (jobOrderId == null). Once a Job Order
// claims it, the entire Order Sheet is locked — permanently, with no ADMIN
// override — regardless of the Job Order's own later status.
function assertOrderSheetMutable(po: { status: PurchaseOrderStatus; jobOrderId: string | null }): void {
  if (po.status === 'CANCELLED') {
    throw HttpError.badRequest('This Order Sheet has been cancelled');
  }
  if (po.jobOrderId) {
    throw HttpError.badRequest(
      'This Order Sheet is locked because it has already been included in a Job Order',
    );
  }
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

type OrderSheetPlanningState = 'AVAILABLE' | 'INCLUDED_IN_JOB_ORDER' | 'CANCELLED';

// Translates the user-facing Planning State into the real underlying
// condition — never sent to/from the client as a raw legacy status value.
function planningStateWhere(
  planningState: OrderSheetPlanningState,
): Prisma.DistributorPurchaseOrderWhereInput {
  switch (planningState) {
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    case 'INCLUDED_IN_JOB_ORDER':
      return { status: { not: 'CANCELLED' }, jobOrderId: { not: null } };
    case 'AVAILABLE':
      return { status: { not: 'CANCELLED' }, jobOrderId: null };
  }
}

export async function getPurchaseOrderList(
  user: CurrentUser,
  filters: {
    search?: string;
    planningState?: OrderSheetPlanningState;
    distributorId?: string;
    purchaseMode?: PurchaseMode;
    styleId?: string;
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
    ...(filters.planningState ? planningStateWhere(filters.planningState) : {}),
    purchaseMode: filters.purchaseMode,
    lines: filters.styleId ? { some: { styleId: filters.styleId } } : undefined,
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
    include: { season: { include: { financialYear: true } } },
  });
  // Every Style has a required Season (Correction 7), so this is always
  // resolvable — the map exists only to look line styles up by id.
  const seasonByStyle = new Map(styles.map((style) => [style.id, style.season]));

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
        // Never client-supplied: Purchase Mode is authoritative on the
        // Distributor and locked there — this is a create-time snapshot only.
        purchaseMode: distributor.purchaseMode,
        // No Draft -> Submitted workflow anymore: an Order Sheet is
        // immediately eligible for Job Order planning the moment it's
        // created. SUBMITTED is reused as the "open" internal status value
        // rather than introducing a new enum member (see purchase-order
        // rename plan) — it is never presented to users as a workflow step.
        status: 'SUBMITTED',
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
              create: (() => {
                const season = seasonByStyle.get(line.styleId);
                return season
                  ? [
                      {
                        id: createId(),
                        seasonId: season.id,
                        code: season.code,
                        name: season.name,
                        financialYear: toCompactFinancialYearCode(season.financialYear.code),
                        displayName: `${season.code} ${toCompactFinancialYearCode(season.financialYear.code)}`,
                      },
                    ]
                  : [];
              })(),
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
  assertOrderSheetMutable(po);

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
        include: { season: { include: { financialYear: true } } },
      });
      // Every Style has a required Season (Correction 7), so this is always
      // resolvable — the map exists only to look line styles up by id.
      const seasonByStyle = new Map(styles.map((style) => [style.id, style.season]));
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
              create: (() => {
                const season = seasonByStyle.get(line.styleId);
                return season
                  ? [
                      {
                        id: createId(),
                        seasonId: season.id,
                        code: season.code,
                        name: season.name,
                        financialYear: toCompactFinancialYearCode(season.financialYear.code),
                        displayName: `${season.code} ${toCompactFinancialYearCode(season.financialYear.code)}`,
                      },
                    ]
                  : [];
              })(),
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

export async function cancelPurchaseOrder(actor: CurrentUser, id: string) {
  const preCheck = await prisma.distributorPurchaseOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Purchase order not found');
  assertPOViewAccess(actor, preCheck);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-order-${id}`}))`;

    const po = await tx.distributorPurchaseOrder.findUnique({ where: { id } });
    if (!po) throw HttpError.notFound('Purchase order not found');

    assertOrderSheetMutable(po);

    // Dispatch Order Phase 3: a Dispatch Order never references an Order
    // Sheet/Purchase Order line/size (it allocates pooled Factory+Style+Size
    // stock only) — the old blocking-guard against a live Sale Order
    // referencing this PO (see the retired sale-order-lifecycle.ts) no
    // longer has anything to check.

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

// getJobOrderBalance and getFulfilmentSummary (retired): the Order Sheet is
// no longer a remaining-balance/partial-fulfilment ledger under the Order
// Sheet model — Job Order creation now claims an Order Sheet wholly and
// atomically (see job-orders.service.ts createJobOrderFromPO), so
// "remaining quantity"/"fulfilment progress" no longer means anything at the
// Order Sheet level. Retired along with their routes and frontend panels.

// ---------------------------------------------------------------------------
// Style lookup (P1L1)
// ---------------------------------------------------------------------------

// Slim projection for the Order Sheet Style lookup. Never the Style master's
// styleInclude: no sizes, images or factory mappings in search results.
const styleOptionSelect = {
  id: true,
  styleNumber: true,
  styleName: true,
  lmixNumber: true,
  status: true,
  season: { select: { code: true, financialYear: { select: { code: true } } } },
} satisfies Prisma.StyleSelect;

function toStyleOptionView(
  style: Prisma.StyleGetPayload<{ select: typeof styleOptionSelect }>,
): OrderSheetStyleOption {
  return {
    id: style.id,
    styleNumber: style.styleNumber,
    styleName: style.styleName,
    lmixNumber: style.lmixNumber,
    status: style.status,
    season: {
      code: style.season.code,
      displayName: `${style.season.code} ${toCompactFinancialYearCode(style.season.financialYear.code)}`,
    },
  };
}

// New-selection search: ACTIVE Styles only (the same eligibility
// validateLines enforces on save), matched on LMIX, Style Number or Style
// Name, and always bounded by `limit` — a broad query is refined by typing
// more, never paged. LMIX is searched in its own right: UI-created Styles
// have a Style Number independent of their LMIX.
export async function listOrderSheetStyleOptions(filters: {
  search?: string;
  limit: number;
}): Promise<OrderSheetStyleOption[]> {
  const search = filters.search || undefined;
  const styles = await prisma.style.findMany({
    where: {
      status: 'ACTIVE',
      OR: search
        ? [
            { lmixNumber: { contains: search, mode: 'insensitive' } },
            { styleNumber: { contains: search, mode: 'insensitive' } },
            { styleName: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    select: styleOptionSelect,
    orderBy: { styleNumber: 'asc' },
    take: filters.limit,
  });
  return styles.map(toStyleOptionView);
}

// The selected Style, by id, whatever its status — an Order Sheet saved
// against a since-retired Style must still display it. Sizes are the
// orderable ones only; saving still re-validates status and sizes.
export async function getOrderSheetStyleOption(styleId: string): Promise<OrderSheetStyleDetail> {
  const style = await prisma.style.findUnique({
    where: { id: styleId },
    select: {
      ...styleOptionSelect,
      styleSizes: {
        where: { status: 'ACTIVE', size: { status: 'ACTIVE' } },
        select: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
        orderBy: { size: { sortOrder: 'asc' } },
      },
    },
  });
  if (!style) throw HttpError.notFound('Style not found');
  return {
    ...toStyleOptionView(style),
    sizes: style.styleSizes.map(({ size }) => size),
  };
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

    const style = await prisma.style.findUnique({ where: { id: line.styleId } });

    if (!style) throw HttpError.badRequest(`Style ${line.styleId} not found`);
    if (style.status !== 'ACTIVE')
      throw HttpError.badRequest(`Style ${style.styleNumber} is not active`);

    const validSizeIds = await getActiveStyleSizeIds(prisma, line.styleId);
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
