import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { PriceListStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import {
  lookupDistributorPrice,
  toDateOnly,
  toDateOnlyString,
  type PriceLookupResult,
} from './price-lookup.js';

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export async function generatePriceListCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PL-${year}-`;

  const last = await prisma.priceList.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  const lastSeq = last ? parseInt(last.code.slice(prefix.length), 10) : 0;
  const next = String(lastSeq + 1).padStart(6, '0');
  return `${prefix}${next}`;
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const priceListInclude = {
  distributor: { select: { id: true, code: true, name: true, status: true } },
  lines: {
    include: { style: { select: { id: true, styleNumber: true, styleName: true, status: true } } },
    orderBy: { style: { styleNumber: 'asc' as const } },
  },
} satisfies Prisma.PriceListInclude;

const priceListSummaryInclude = {
  distributor: { select: { id: true, code: true, name: true, status: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.PriceListInclude;

type PriceListRecord = Prisma.PriceListGetPayload<{ include: typeof priceListInclude }>;
type PriceListSummaryRecord = Prisma.PriceListGetPayload<{ include: typeof priceListSummaryInclude }>;

function toEffectiveDates(record: { effectiveFrom: Date | null; effectiveTo: Date | null }) {
  return {
    effectiveFrom: record.effectiveFrom ? toDateOnlyString(record.effectiveFrom) : null,
    effectiveTo: record.effectiveTo ? toDateOnlyString(record.effectiveTo) : null,
  };
}

function toPriceListView(priceList: PriceListRecord) {
  return {
    id: priceList.id,
    code: priceList.code,
    name: priceList.name,
    distributor: priceList.distributor,
    ...toEffectiveDates(priceList),
    status: priceList.status,
    lines: priceList.lines.map((line) => ({
      id: line.id,
      styleId: line.styleId,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      styleStatus: line.style.status,
      unitPrice: line.unitPrice.toNumber(),
      currency: line.currency,
    })),
    lineCount: priceList.lines.length,
    createdAt: priceList.createdAt,
    updatedAt: priceList.updatedAt,
  };
}

function toPriceListSummaryView(priceList: PriceListSummaryRecord) {
  return {
    id: priceList.id,
    code: priceList.code,
    name: priceList.name,
    distributor: priceList.distributor,
    ...toEffectiveDates(priceList),
    status: priceList.status,
    lineCount: priceList._count.lines,
    createdAt: priceList.createdAt,
    updatedAt: priceList.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

// Roles whose reads span every distributor. A DISTRIBUTOR-only user is
// scoped to their sole mapped distributor and to ACTIVE lists — drafts and
// retired history are internal commercial data.
function canViewAllPriceLists(user: CurrentUser): boolean {
  return user.roles.some(
    (role) =>
      role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT' || role === 'ACCOUNTANT',
  );
}

function assertPriceListViewAccess(
  user: CurrentUser,
  priceList: { distributorId: string; status: PriceListStatus },
): void {
  if (canViewAllPriceLists(user)) return;
  if (
    user.roles.includes('DISTRIBUTOR') &&
    getSoleDistributorId(user) === priceList.distributorId &&
    priceList.status === 'ACTIVE'
  ) {
    return;
  }
  throw HttpError.forbidden('You do not have access to this price list');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// The overlap exclusion constraint is not representable in the Prisma schema,
// so its violations don't map to a dedicated Prisma error code — detect it by
// constraint name wherever the driver surfaces it.
function isActiveOverlapConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : '';
  return (
    error.message.includes('price_lists_no_overlapping_active_periods') ||
    meta.includes('price_lists_no_overlapping_active_periods')
  );
}

function previousDay(date: Date): Date {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

function assertValidPeriod(effectiveFrom: Date | null, effectiveTo: Date | null): void {
  if (effectiveTo && !effectiveFrom) {
    throw HttpError.badRequest('An effective-to date requires an effective-from date');
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw HttpError.badRequest('Effective-to date cannot be before the effective-from date');
  }
}

function assertDraft(priceList: { status: PriceListStatus }): void {
  if (priceList.status !== 'DRAFT') {
    throw HttpError.badRequest('Only DRAFT price lists can be modified');
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listPriceLists(
  actor: CurrentUser,
  filters: { search?: string; distributorId?: string; status?: PriceListStatus; effectiveOn?: string },
) {
  const scoped = !canViewAllPriceLists(actor);
  const distributorId = scoped ? getSoleDistributorId(actor) : filters.distributorId;
  const status = scoped ? 'ACTIVE' : filters.status;
  const effectiveOn = filters.effectiveOn ? toDateOnly(filters.effectiveOn) : undefined;

  const where: Prisma.PriceListWhereInput = {
    distributorId,
    status,
    AND: effectiveOn
      ? [
          { effectiveFrom: { lte: effectiveOn } },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveOn } }] },
        ]
      : undefined,
    OR: filters.search
      ? [
          { code: { contains: filters.search, mode: 'insensitive' } },
          { name: { contains: filters.search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  const priceLists = await prisma.priceList.findMany({
    where,
    include: priceListSummaryInclude,
    orderBy: { createdAt: 'desc' },
  });

  return priceLists.map(toPriceListSummaryView);
}

export async function getPriceListDetail(actor: CurrentUser, id: string) {
  const priceList = await prisma.priceList.findUnique({ where: { id }, include: priceListInclude });
  if (!priceList) throw HttpError.notFound('Price list not found');
  assertPriceListViewAccess(actor, priceList);
  return toPriceListView(priceList);
}

export async function getDistributorPriceListHistory(actor: CurrentUser, distributorId: string) {
  if (!canViewAllPriceLists(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this distributor');
  }

  const distributor = await prisma.distributor.findUnique({ where: { id: distributorId } });
  if (!distributor) throw HttpError.notFound('Distributor not found');

  const priceLists = await prisma.priceList.findMany({
    where: {
      distributorId,
      status: canViewAllPriceLists(actor) ? undefined : 'ACTIVE',
    },
    include: priceListSummaryInclude,
    orderBy: [{ effectiveFrom: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });

  return priceLists.map(toPriceListSummaryView);
}

export async function lookupPriceForActor(
  actor: CurrentUser,
  input: { distributorId: string; styleId: string; date: string },
): Promise<PriceLookupResult> {
  if (!canViewAllPriceLists(actor) && getSoleDistributorId(actor) !== input.distributorId) {
    throw HttpError.forbidden('You do not have access to this distributor');
  }
  return lookupDistributorPrice(input);
}

// ---------------------------------------------------------------------------
// Draft mutations
// ---------------------------------------------------------------------------

export async function createPriceList(
  actor: CurrentUser,
  input: {
    distributorId: string;
    name: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  },
) {
  const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) throw HttpError.badRequest('Unknown distributor');
  if (distributor.status !== 'ACTIVE') {
    throw HttpError.badRequest('Cannot create a price list for an inactive distributor');
  }

  const effectiveFrom = input.effectiveFrom ? toDateOnly(input.effectiveFrom) : null;
  const effectiveTo = input.effectiveTo ? toDateOnly(input.effectiveTo) : null;
  assertValidPeriod(effectiveFrom, effectiveTo);

  const id = createId();
  const code = await generatePriceListCode();

  try {
    await prisma.priceList.create({
      data: {
        id,
        code,
        name: input.name,
        distributorId: input.distributorId,
        effectiveFrom,
        effectiveTo,
        status: 'DRAFT',
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A price list with this code already exists — retry the request');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_CREATED',
    entityType: 'PriceList',
    entityId: id,
    metadata: {
      code,
      distributorId: input.distributorId,
      effectiveFrom: effectiveFrom ? toDateOnlyString(effectiveFrom) : null,
      effectiveTo: effectiveTo ? toDateOnlyString(effectiveTo) : null,
    },
  });

  return getPriceListDetail(actor, id);
}

export async function updatePriceListDraft(
  actor: CurrentUser,
  id: string,
  input: { name?: string; effectiveFrom?: string | null; effectiveTo?: string | null },
) {
  const existing = await prisma.priceList.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Price list not found');
  assertDraft(existing);

  const effectiveFrom =
    input.effectiveFrom !== undefined
      ? input.effectiveFrom
        ? toDateOnly(input.effectiveFrom)
        : null
      : existing.effectiveFrom;
  const effectiveTo =
    input.effectiveTo !== undefined
      ? input.effectiveTo
        ? toDateOnly(input.effectiveTo)
        : null
      : existing.effectiveTo;
  assertValidPeriod(effectiveFrom, effectiveTo);

  await prisma.priceList.update({
    where: { id },
    data: {
      name: input.name,
      effectiveFrom: input.effectiveFrom !== undefined ? effectiveFrom : undefined,
      effectiveTo: input.effectiveTo !== undefined ? effectiveTo : undefined,
    },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_UPDATED',
    entityType: 'PriceList',
    entityId: id,
    metadata: {
      before: { name: existing.name, ...toEffectiveDates(existing) },
      after: {
        name: input.name ?? existing.name,
        effectiveFrom: effectiveFrom ? toDateOnlyString(effectiveFrom) : null,
        effectiveTo: effectiveTo ? toDateOnlyString(effectiveTo) : null,
      },
    },
  });

  return getPriceListDetail(actor, id);
}

export async function addPriceListLine(
  actor: CurrentUser,
  priceListId: string,
  input: { styleId: string; unitPrice: number },
) {
  const priceList = await prisma.priceList.findUnique({ where: { id: priceListId } });
  if (!priceList) throw HttpError.notFound('Price list not found');
  assertDraft(priceList);

  const style = await prisma.style.findUnique({ where: { id: input.styleId } });
  if (!style) throw HttpError.badRequest('Unknown style');
  if (style.status !== 'ACTIVE') {
    throw HttpError.badRequest(`Style ${style.styleNumber} is not active`);
  }

  const lineId = createId();
  try {
    await prisma.priceListLine.create({
      data: { id: lineId, priceListId, styleId: input.styleId, unitPrice: input.unitPrice },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(`Style ${style.styleNumber} is already priced in this price list`);
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_LINE_ADDED',
    entityType: 'PriceList',
    entityId: priceListId,
    metadata: { lineId, styleId: input.styleId, unitPrice: input.unitPrice },
  });

  return getPriceListDetail(actor, priceListId);
}

export async function updatePriceListLine(
  actor: CurrentUser,
  priceListId: string,
  lineId: string,
  input: { unitPrice: number },
) {
  const priceList = await prisma.priceList.findUnique({ where: { id: priceListId } });
  if (!priceList) throw HttpError.notFound('Price list not found');
  assertDraft(priceList);

  const line = await prisma.priceListLine.findUnique({ where: { id: lineId } });
  if (!line || line.priceListId !== priceListId) {
    throw HttpError.notFound('Price list line not found');
  }

  await prisma.priceListLine.update({ where: { id: lineId }, data: { unitPrice: input.unitPrice } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_LINE_UPDATED',
    entityType: 'PriceList',
    entityId: priceListId,
    metadata: {
      lineId,
      styleId: line.styleId,
      before: { unitPrice: line.unitPrice.toNumber() },
      after: { unitPrice: input.unitPrice },
    },
  });

  return getPriceListDetail(actor, priceListId);
}

export async function removePriceListLine(actor: CurrentUser, priceListId: string, lineId: string) {
  const priceList = await prisma.priceList.findUnique({ where: { id: priceListId } });
  if (!priceList) throw HttpError.notFound('Price list not found');
  assertDraft(priceList);

  const line = await prisma.priceListLine.findUnique({ where: { id: lineId } });
  if (!line || line.priceListId !== priceListId) {
    throw HttpError.notFound('Price list line not found');
  }

  await prisma.priceListLine.delete({ where: { id: lineId } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_LINE_REMOVED',
    entityType: 'PriceList',
    entityId: priceListId,
    metadata: { lineId, styleId: line.styleId, unitPrice: line.unitPrice.toNumber() },
  });

  return getPriceListDetail(actor, priceListId);
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export async function activatePriceList(actor: CurrentUser, id: string) {
  const existing = await prisma.priceList.findUnique({ where: { id }, select: { distributorId: true } });
  if (!existing) throw HttpError.notFound('Price list not found');

  let endedPrevious: { id: string; code: string; effectiveTo: Date } | null = null;
  let activated: { effectiveFrom: Date; effectiveTo: Date | null; distributorId: string } | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Serializes activations per distributor so two concurrent requests
      // cannot both pass the overlap validation below. The exclusion
      // constraint on price_lists remains the database-level backstop.
      // ::text because the pg adapter cannot deserialize the function's void return
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('price_list_activation:' || ${existing.distributorId}, 0))::text`;

      const priceList = await tx.priceList.findUnique({
        where: { id },
        include: {
          distributor: { select: { id: true, status: true } },
          lines: { include: { style: { select: { styleNumber: true, status: true } } } },
        },
      });
      if (!priceList) throw HttpError.notFound('Price list not found');
      if (priceList.status !== 'DRAFT') {
        throw HttpError.badRequest('Only DRAFT price lists can be activated');
      }
      if (priceList.distributor.status !== 'ACTIVE') {
        throw HttpError.badRequest('Cannot activate a price list for an inactive distributor');
      }
      if (!priceList.effectiveFrom) {
        throw HttpError.badRequest('An effective-from date is required before activation');
      }
      assertValidPeriod(priceList.effectiveFrom, priceList.effectiveTo);
      if (priceList.lines.length === 0) {
        throw HttpError.badRequest('Cannot activate a price list with no lines');
      }
      for (const line of priceList.lines) {
        if (line.style.status !== 'ACTIVE') {
          throw HttpError.badRequest(
            `Cannot activate: style ${line.style.styleNumber} is not active`,
          );
        }
        if (line.unitPrice.lessThanOrEqualTo(0)) {
          throw HttpError.badRequest(
            `Cannot activate: style ${line.style.styleNumber} has a non-positive price`,
          );
        }
      }

      const overlapping = await tx.priceList.findMany({
        where: {
          distributorId: priceList.distributorId,
          status: 'ACTIVE',
          id: { not: id },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: priceList.effectiveFrom } }] },
            priceList.effectiveTo ? { effectiveFrom: { lte: priceList.effectiveTo } } : {},
          ],
        },
      });

      // Deterministic replacement rule: an open-ended predecessor that started
      // before the new list is ended the day before the new list takes effect
      // (it stays ACTIVE for its now-bounded historical period). Any other
      // overlap is an explicit conflict and is rejected.
      if (overlapping.length === 1) {
        const previous = overlapping[0]!;
        const canEndPrevious =
          previous.effectiveTo === null && previous.effectiveFrom! < priceList.effectiveFrom;
        if (!canEndPrevious) {
          throw HttpError.conflict(
            `Effective period conflicts with active price list ${previous.code}`,
          );
        }
        const newEnd = previousDay(priceList.effectiveFrom);
        await tx.priceList.update({ where: { id: previous.id }, data: { effectiveTo: newEnd } });
        endedPrevious = { id: previous.id, code: previous.code, effectiveTo: newEnd };
      } else if (overlapping.length > 1) {
        throw HttpError.conflict('Effective period conflicts with multiple active price lists');
      }

      await tx.priceList.update({ where: { id }, data: { status: 'ACTIVE' } });
      activated = {
        effectiveFrom: priceList.effectiveFrom,
        effectiveTo: priceList.effectiveTo,
        distributorId: priceList.distributorId,
      };
    });
  } catch (error) {
    if (isActiveOverlapConstraintError(error)) {
      throw HttpError.conflict('Effective period conflicts with an active price list');
    }
    throw error;
  }

  if (endedPrevious) {
    const superseded: { id: string; code: string; effectiveTo: Date } = endedPrevious;
    await recordAuditLog({
      actorId: actor.id,
      action: 'PRICE_LIST_SUPERSEDED',
      entityType: 'PriceList',
      entityId: superseded.id,
      metadata: {
        supersededByPriceListId: id,
        effectiveTo: toDateOnlyString(superseded.effectiveTo),
      },
    });
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_ACTIVATED',
    entityType: 'PriceList',
    entityId: id,
    metadata: {
      distributorId: activated!.distributorId,
      effectiveFrom: toDateOnlyString(activated!.effectiveFrom),
      effectiveTo: activated!.effectiveTo ? toDateOnlyString(activated!.effectiveTo) : null,
      endedPreviousPriceListId: endedPrevious ? (endedPrevious as { id: string }).id : null,
    },
  });

  return getPriceListDetail(actor, id);
}

export async function retirePriceList(actor: CurrentUser, id: string) {
  const existing = await prisma.priceList.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Price list not found');
  if (existing.status !== 'ACTIVE') {
    throw HttpError.badRequest('Only ACTIVE price lists can be retired');
  }

  // Status-only transition: lines and effective dates are preserved untouched
  // so prices already used by historical transactions stay readable as-is.
  await prisma.priceList.update({ where: { id }, data: { status: 'EXPIRED' } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'PRICE_LIST_RETIRED',
    entityType: 'PriceList',
    entityId: id,
    metadata: { from: 'ACTIVE', to: 'EXPIRED', ...toEffectiveDates(existing) },
  });

  return getPriceListDetail(actor, id);
}
