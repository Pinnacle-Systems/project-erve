import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { GstRuleSetStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { listAllOrPage, type OptionalPageQuery } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// Date-only helpers (own copies — see price-lists/price-lookup.ts for the
// identical pattern; duplicated rather than imported to keep this module
// independent of the Price List module).
// ---------------------------------------------------------------------------

export function toDateOnly(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  if (Number.isNaN(date.getTime())) {
    throw HttpError.badRequest('Invalid date');
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function previousDay(date: Date): Date {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

function decimalToNumber(value: Prisma.Decimal | number | null): number | null {
  if (value === null) return null;
  return value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const bandOrderBy = [{ minValue: { sort: 'asc' as const, nulls: 'first' as const } }];

const gstRuleSetInclude = {
  versions: {
    orderBy: { versionNumber: 'desc' as const },
    include: { bands: { orderBy: bandOrderBy } },
  },
} satisfies Prisma.GstRuleSetInclude;

const gstRuleSetSummaryInclude = {
  _count: { select: { versions: true } },
} satisfies Prisma.GstRuleSetInclude;

type GstRuleSetRecord = Prisma.GstRuleSetGetPayload<{ include: typeof gstRuleSetInclude }>;
type GstRuleSetSummaryRecord = Prisma.GstRuleSetGetPayload<{ include: typeof gstRuleSetSummaryInclude }>;

function toBandView(band: {
  id: string;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  gstPercent: Prisma.Decimal;
}) {
  return {
    id: band.id,
    minValue: decimalToNumber(band.minValue),
    maxValue: decimalToNumber(band.maxValue),
    gstPercent: decimalToNumber(band.gstPercent)!,
  };
}

function toVersionView(version: GstRuleSetRecord['versions'][number]) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    effectiveFrom: version.effectiveFrom ? toDateOnlyString(version.effectiveFrom) : null,
    effectiveTo: version.effectiveTo ? toDateOnlyString(version.effectiveTo) : null,
    bands: version.bands.map(toBandView),
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

function toGstRuleSetView(ruleSet: GstRuleSetRecord) {
  return {
    id: ruleSet.id,
    code: ruleSet.code,
    name: ruleSet.name,
    status: ruleSet.status,
    versions: ruleSet.versions.map(toVersionView),
    createdAt: ruleSet.createdAt,
    updatedAt: ruleSet.updatedAt,
  };
}

function toGstRuleSetSummaryView(ruleSet: GstRuleSetSummaryRecord) {
  return {
    id: ruleSet.id,
    code: ruleSet.code,
    name: ruleSet.name,
    status: ruleSet.status,
    versionCount: ruleSet._count.versions,
    createdAt: ruleSet.createdAt,
    updatedAt: ruleSet.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// The overlap exclusion constraint is not representable in the Prisma
// schema, so its violations don't map to a dedicated Prisma error code —
// detect it by constraint name wherever the driver surfaces it (same
// approach as price-lists.service.ts's isActiveOverlapConstraintError).
function isActiveOverlapConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : '';
  return (
    error.message.includes('gst_rule_set_versions_no_overlapping_active_periods') ||
    meta.includes('gst_rule_set_versions_no_overlapping_active_periods')
  );
}

function assertValidPeriod(effectiveFrom: Date | null, effectiveTo: Date | null): void {
  if (effectiveTo && !effectiveFrom) {
    throw HttpError.badRequest('An effective-to date requires an effective-from date');
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw HttpError.badRequest('Effective-to date cannot be before the effective-from date');
  }
}

function assertValidBandRange(minValue: number | null, maxValue: number | null): void {
  if (minValue !== null && maxValue !== null && maxValue <= minValue) {
    throw HttpError.badRequest('maxValue must be greater than minValue');
  }
}

function assertDraftVersion(version: { status: string }): void {
  if (version.status !== 'DRAFT') {
    throw HttpError.badRequest('Only a DRAFT version can be modified');
  }
}

async function getOwnedVersion(gstRuleSetId: string, versionId: string) {
  const version = await prisma.gstRuleSetVersion.findUnique({
    where: { id: versionId },
    include: { bands: true },
  });
  if (!version || version.gstRuleSetId !== gstRuleSetId) {
    throw HttpError.notFound('GST Rule Set version not found');
  }
  return version;
}

// ---------------------------------------------------------------------------
// Value-band ladder validation
//
// A version's bands must form one contiguous, unambiguous ladder: exactly
// one band open-ended at the lower bound (the lowest band) and exactly one
// open-ended at the upper bound (the highest band), and every interior
// boundary must line up exactly — the previous band's maxValue must equal
// the next band's minValue. minValue is always EXCLUSIVE, maxValue always
// INCLUSIVE (see GstValueBand doc comment in schema.prisma), so this alone
// makes "exactly 2500 resolves to 5%, not 18%" true without any min+0.01
// trick, and catches gaps, overlaps and duplicate boundaries uniformly.
// ---------------------------------------------------------------------------

export class BandLadderError extends HttpError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export function validateBandLadder(
  bands: Array<{ minValue: Prisma.Decimal | number | null; maxValue: Prisma.Decimal | number | null }>,
): void {
  if (bands.length === 0) {
    throw new BandLadderError('At least one value band is required before activation');
  }

  const normalized = bands.map((band) => ({
    min: decimalToNumber(band.minValue),
    max: decimalToNumber(band.maxValue),
  }));
  const sorted = [...normalized].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));

  const openLower = sorted.filter((band) => band.min === null);
  if (openLower.length !== 1 || sorted[0]!.min !== null) {
    throw new BandLadderError(
      'Exactly one value band must be open-ended at the lower bound (the lowest band)',
    );
  }

  const openUpper = sorted.filter((band) => band.max === null);
  if (openUpper.length !== 1 || sorted[sorted.length - 1]!.max !== null) {
    throw new BandLadderError(
      'Exactly one value band must be open-ended at the upper bound (the highest band)',
    );
  }

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (previous.max === null) {
      throw new BandLadderError('Only the highest value band may be open-ended at the upper bound');
    }
    if (current.min !== previous.max) {
      throw new BandLadderError(
        `Value bands must be contiguous: the band ending at ${previous.max} must be followed by a band starting immediately after ${previous.max}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listGstRuleSets(
  filters: { search?: string; status?: GstRuleSetStatus } & OptionalPageQuery,
) {
  const where: Prisma.GstRuleSetWhereInput = {
    status: filters.status,
    OR: filters.search
      ? [
          { code: { contains: filters.search, mode: 'insensitive' } },
          { name: { contains: filters.search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  return listAllOrPage(filters, async (page) =>
    (
      await prisma.gstRuleSet.findMany({
        where,
        include: gstRuleSetSummaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      })
    ).map(toGstRuleSetSummaryView),
  );
}

export async function getGstRuleSetDetail(id: string) {
  const ruleSet = await prisma.gstRuleSet.findUnique({ where: { id }, include: gstRuleSetInclude });
  if (!ruleSet) throw HttpError.notFound('GST Rule Set not found');
  return toGstRuleSetView(ruleSet);
}

// ---------------------------------------------------------------------------
// GST Rule Set mutations
// ---------------------------------------------------------------------------

export async function createGstRuleSet(
  actor: CurrentUser,
  input: { code: string; name: string; status?: GstRuleSetStatus },
) {
  const id = createId();
  try {
    await prisma.gstRuleSet.create({
      data: { id, code: input.code, name: input.name, status: input.status ?? 'ACTIVE' },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(`A GST Rule Set with code ${input.code} already exists`);
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_CREATED',
    entityType: 'GstRuleSet',
    entityId: id,
    metadata: { code: input.code, name: input.name },
  });

  return getGstRuleSetDetail(id);
}

export async function updateGstRuleSet(
  actor: CurrentUser,
  id: string,
  input: { code?: string; name?: string; status?: GstRuleSetStatus },
) {
  const existing = await prisma.gstRuleSet.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('GST Rule Set not found');

  try {
    await prisma.gstRuleSet.update({
      where: { id },
      data: { code: input.code, name: input.name, status: input.status },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(`A GST Rule Set with code ${input.code} already exists`);
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_UPDATED',
    entityType: 'GstRuleSet',
    entityId: id,
    metadata: {
      before: { code: existing.code, name: existing.name, status: existing.status },
      after: {
        code: input.code ?? existing.code,
        name: input.name ?? existing.name,
        status: input.status ?? existing.status,
      },
    },
  });

  return getGstRuleSetDetail(id);
}

// ---------------------------------------------------------------------------
// Version mutations (DRAFT lifecycle)
// ---------------------------------------------------------------------------

export async function createGstRuleSetVersion(
  actor: CurrentUser,
  gstRuleSetId: string,
  input: { effectiveFrom?: string | null; effectiveTo?: string | null },
) {
  const ruleSet = await prisma.gstRuleSet.findUnique({ where: { id: gstRuleSetId } });
  if (!ruleSet) throw HttpError.notFound('GST Rule Set not found');

  const effectiveFrom = input.effectiveFrom ? toDateOnly(input.effectiveFrom) : null;
  const effectiveTo = input.effectiveTo ? toDateOnly(input.effectiveTo) : null;
  assertValidPeriod(effectiveFrom, effectiveTo);

  const id = createId();
  const last = await prisma.gstRuleSetVersion.findFirst({
    where: { gstRuleSetId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  await prisma.gstRuleSetVersion.create({
    data: { id, gstRuleSetId, versionNumber, status: 'DRAFT', effectiveFrom, effectiveTo },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_VERSION_CREATED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: { versionId: id, versionNumber },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

export async function updateGstRuleSetVersionWindow(
  actor: CurrentUser,
  gstRuleSetId: string,
  versionId: string,
  input: { effectiveFrom?: string | null; effectiveTo?: string | null },
) {
  const version = await getOwnedVersion(gstRuleSetId, versionId);
  assertDraftVersion(version);

  const effectiveFrom =
    input.effectiveFrom !== undefined
      ? input.effectiveFrom
        ? toDateOnly(input.effectiveFrom)
        : null
      : version.effectiveFrom;
  const effectiveTo =
    input.effectiveTo !== undefined
      ? input.effectiveTo
        ? toDateOnly(input.effectiveTo)
        : null
      : version.effectiveTo;
  assertValidPeriod(effectiveFrom, effectiveTo);

  await prisma.gstRuleSetVersion.update({
    where: { id: versionId },
    data: { effectiveFrom, effectiveTo },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_VERSION_UPDATED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: {
      versionId,
      before: {
        effectiveFrom: version.effectiveFrom ? toDateOnlyString(version.effectiveFrom) : null,
        effectiveTo: version.effectiveTo ? toDateOnlyString(version.effectiveTo) : null,
      },
      after: {
        effectiveFrom: effectiveFrom ? toDateOnlyString(effectiveFrom) : null,
        effectiveTo: effectiveTo ? toDateOnlyString(effectiveTo) : null,
      },
    },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

export async function deleteGstRuleSetVersion(actor: CurrentUser, gstRuleSetId: string, versionId: string) {
  const version = await getOwnedVersion(gstRuleSetId, versionId);
  assertDraftVersion(version);

  await prisma.gstRuleSetVersion.delete({ where: { id: versionId } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_VERSION_DELETED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: { versionId, versionNumber: version.versionNumber },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

// ---------------------------------------------------------------------------
// Value band mutations (DRAFT versions only)
// ---------------------------------------------------------------------------

export async function addGstValueBand(
  actor: CurrentUser,
  gstRuleSetId: string,
  versionId: string,
  input: { minValue?: number | null; maxValue?: number | null; gstPercent: number },
) {
  const version = await getOwnedVersion(gstRuleSetId, versionId);
  assertDraftVersion(version);
  assertValidBandRange(input.minValue ?? null, input.maxValue ?? null);

  const bandId = createId();
  await prisma.gstValueBand.create({
    data: {
      id: bandId,
      gstRuleSetVersionId: versionId,
      minValue: input.minValue ?? null,
      maxValue: input.maxValue ?? null,
      gstPercent: input.gstPercent,
    },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_VALUE_BAND_ADDED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: { versionId, bandId, minValue: input.minValue ?? null, maxValue: input.maxValue ?? null, gstPercent: input.gstPercent },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

export async function updateGstValueBand(
  actor: CurrentUser,
  gstRuleSetId: string,
  versionId: string,
  bandId: string,
  input: { minValue?: number | null; maxValue?: number | null; gstPercent?: number },
) {
  const version = await getOwnedVersion(gstRuleSetId, versionId);
  assertDraftVersion(version);

  const band = version.bands.find((candidate) => candidate.id === bandId);
  if (!band) throw HttpError.notFound('Value band not found');

  const nextMin = input.minValue !== undefined ? input.minValue : decimalToNumber(band.minValue);
  const nextMax = input.maxValue !== undefined ? input.maxValue : decimalToNumber(band.maxValue);
  assertValidBandRange(nextMin, nextMax);

  await prisma.gstValueBand.update({
    where: { id: bandId },
    data: {
      minValue: input.minValue !== undefined ? input.minValue : undefined,
      maxValue: input.maxValue !== undefined ? input.maxValue : undefined,
      gstPercent: input.gstPercent,
    },
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_VALUE_BAND_UPDATED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: {
      versionId,
      bandId,
      before: toBandView(band),
      after: {
        minValue: input.minValue !== undefined ? input.minValue : toBandView(band).minValue,
        maxValue: input.maxValue !== undefined ? input.maxValue : toBandView(band).maxValue,
        gstPercent: input.gstPercent ?? toBandView(band).gstPercent,
      },
    },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

export async function removeGstValueBand(
  actor: CurrentUser,
  gstRuleSetId: string,
  versionId: string,
  bandId: string,
) {
  const version = await getOwnedVersion(gstRuleSetId, versionId);
  assertDraftVersion(version);

  const band = version.bands.find((candidate) => candidate.id === bandId);
  if (!band) throw HttpError.notFound('Value band not found');

  await prisma.gstValueBand.delete({ where: { id: bandId } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_VALUE_BAND_REMOVED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: { versionId, bandId, ...toBandView(band) },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

// ---------------------------------------------------------------------------
// Activation (mirrors price-lists.service.ts activatePriceList exactly:
// advisory-lock-serialized overlap check + deterministic single-predecessor
// supersede rule, with the EXCLUDE constraint as the DB-level backstop).
// ---------------------------------------------------------------------------

export async function activateGstRuleSetVersion(actor: CurrentUser, gstRuleSetId: string, versionId: string) {
  const ruleSet = await prisma.gstRuleSet.findUnique({ where: { id: gstRuleSetId } });
  if (!ruleSet) throw HttpError.notFound('GST Rule Set not found');

  let endedPrevious: { id: string; versionNumber: number; effectiveTo: Date } | null = null;
  let activated: { effectiveFrom: Date; effectiveTo: Date | null } | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Serializes activations per rule set so two concurrent requests
      // cannot both pass the overlap validation below. The exclusion
      // constraint on gst_rule_set_versions remains the database-level
      // backstop.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('gst_rule_set_activation:' || ${gstRuleSetId}, 0))::text`;

      const version = await tx.gstRuleSetVersion.findUnique({
        where: { id: versionId },
        include: { bands: true },
      });
      if (!version || version.gstRuleSetId !== gstRuleSetId) {
        throw HttpError.notFound('GST Rule Set version not found');
      }
      if (version.status !== 'DRAFT') {
        throw HttpError.badRequest('Only a DRAFT version can be activated');
      }
      if (!version.effectiveFrom) {
        throw HttpError.badRequest('An effective-from date is required before activation');
      }
      assertValidPeriod(version.effectiveFrom, version.effectiveTo);
      validateBandLadder(version.bands);

      const overlapping = await tx.gstRuleSetVersion.findMany({
        where: {
          gstRuleSetId,
          status: 'ACTIVE',
          id: { not: versionId },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: version.effectiveFrom } }] },
            version.effectiveTo ? { effectiveFrom: { lte: version.effectiveTo } } : {},
          ],
        },
      });

      // Deterministic replacement rule, identical to activatePriceList: an
      // open-ended predecessor that started before the new version is ended
      // the day before the new version takes effect. Any other overlap is
      // an explicit conflict.
      if (overlapping.length === 1) {
        const previous = overlapping[0]!;
        const canEndPrevious =
          previous.effectiveTo === null && previous.effectiveFrom! < version.effectiveFrom;
        if (!canEndPrevious) {
          throw HttpError.conflict(
            `Effective period conflicts with active version ${previous.versionNumber}`,
          );
        }
        const newEnd = previousDay(version.effectiveFrom);
        await tx.gstRuleSetVersion.update({ where: { id: previous.id }, data: { effectiveTo: newEnd } });
        endedPrevious = { id: previous.id, versionNumber: previous.versionNumber, effectiveTo: newEnd };
      } else if (overlapping.length > 1) {
        throw HttpError.conflict('Effective period conflicts with multiple active versions');
      }

      await tx.gstRuleSetVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE' } });
      activated = { effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo };
    });
  } catch (error) {
    if (isActiveOverlapConstraintError(error)) {
      throw HttpError.conflict('Effective period conflicts with an active version');
    }
    throw error;
  }

  if (endedPrevious) {
    const superseded: { id: string; versionNumber: number; effectiveTo: Date } = endedPrevious;
    await recordAuditLog({
      actorId: actor.id,
      action: 'GST_RULE_SET_VERSION_SUPERSEDED',
      entityType: 'GstRuleSet',
      entityId: gstRuleSetId,
      metadata: {
        supersededVersionId: superseded.id,
        supersededByVersionId: versionId,
        effectiveTo: toDateOnlyString(superseded.effectiveTo),
      },
    });
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'GST_RULE_SET_VERSION_ACTIVATED',
    entityType: 'GstRuleSet',
    entityId: gstRuleSetId,
    metadata: {
      versionId,
      effectiveFrom: toDateOnlyString(activated!.effectiveFrom),
      effectiveTo: activated!.effectiveTo ? toDateOnlyString(activated!.effectiveTo) : null,
      endedPreviousVersionId: endedPrevious ? (endedPrevious as { id: string }).id : null,
    },
  });

  return getGstRuleSetDetail(gstRuleSetId);
}

// ---------------------------------------------------------------------------
// Domain-level resolution (NOT an invoice GST calculation — INV-006 owns
// that). Given an HSN (by id or code), a per-piece selling value and a
// business/effective date, this resolves which ACTIVE version applies on
// that date and which value band the value falls into. It never multiplies
// by an amount or produces a tax figure.
// ---------------------------------------------------------------------------

export interface GstRuleResolutionInput {
  hsnId?: string;
  hsnCode?: string;
  date: Date | string;
  value: number;
}

export type GstRuleResolutionMissReason =
  | 'HSN_NOT_FOUND'
  | 'HSN_HAS_NO_GST_RULE_SET'
  | 'NO_ACTIVE_VERSION_FOR_DATE'
  | 'NO_MATCHING_BAND';

export type GstRuleResolutionResult =
  | {
      found: true;
      hsnId: string;
      hsnCode: string;
      gstRuleSetId: string;
      gstRuleSetCode: string;
      versionId: string;
      versionNumber: number;
      effectiveFrom: string;
      effectiveTo: string | null;
      band: { id: string; minValue: number | null; maxValue: number | null; gstPercent: number };
    }
  | { found: false; reason: GstRuleResolutionMissReason };

export async function resolveGstRuleForHsn(input: GstRuleResolutionInput): Promise<GstRuleResolutionResult> {
  if (!input.hsnId && !input.hsnCode) {
    throw HttpError.badRequest('hsnId or hsnCode is required');
  }
  const date = toDateOnly(input.date);

  const hsn = input.hsnId
    ? await prisma.hsn.findUnique({ where: { id: input.hsnId } })
    : await prisma.hsn.findUnique({ where: { code: input.hsnCode! } });
  if (!hsn) return { found: false, reason: 'HSN_NOT_FOUND' };
  if (!hsn.gstRuleSetId) return { found: false, reason: 'HSN_HAS_NO_GST_RULE_SET' };

  const versions = await prisma.gstRuleSetVersion.findMany({
    where: {
      gstRuleSetId: hsn.gstRuleSetId,
      status: 'ACTIVE',
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    include: { bands: true, gstRuleSet: { select: { code: true } } },
  });
  if (versions.length === 0) return { found: false, reason: 'NO_ACTIVE_VERSION_FOR_DATE' };
  // The EXCLUDE constraint makes this unreachable, but resolution must fail
  // loudly rather than silently pick one of two matches if that invariant
  // is ever broken (same defensive stance as price-lookup.ts).
  if (versions.length > 1) {
    throw HttpError.conflict(
      'Multiple active GST Rule Set versions cover this date; resolution is ambiguous',
    );
  }
  const version = versions[0]!;

  const band = version.bands.find((candidate) => {
    const min = decimalToNumber(candidate.minValue);
    const max = decimalToNumber(candidate.maxValue);
    return (min === null || input.value > min) && (max === null || input.value <= max);
  });
  if (!band) return { found: false, reason: 'NO_MATCHING_BAND' };

  return {
    found: true,
    hsnId: hsn.id,
    hsnCode: hsn.code,
    gstRuleSetId: hsn.gstRuleSetId,
    gstRuleSetCode: version.gstRuleSet.code,
    versionId: version.id,
    versionNumber: version.versionNumber,
    effectiveFrom: toDateOnlyString(version.effectiveFrom!),
    effectiveTo: version.effectiveTo ? toDateOnlyString(version.effectiveTo) : null,
    band: toBandView(band),
  };
}

// ---------------------------------------------------------------------------
// Current garment GST rule bootstrap — idempotent, shared by prisma/seed.ts
// (dev/test) and the gst-rule-set-bootstrap CLI (production), same spirit as
// quality-bootstrap-definitions.ts sharing one definition between dev
// seeding and the production installer. Deliberately simple (no
// version-diffing): if the rule set or its current ACTIVE version is
// already present, nothing is written.
// ---------------------------------------------------------------------------

export const CURRENT_GARMENT_GST_RULE_SET_CODE = 'GST-GARMENT-STD';
// India's GST rollout date — the earliest date this slab could ever apply.
export const CURRENT_GARMENT_GST_RULE_EFFECTIVE_FROM = '2017-07-01';

export interface GarmentGstRuleSetBootstrapResult {
  gstRuleSetId: string;
  action: 'unchanged' | 'created';
  versionId: string;
}

export async function ensureCurrentGarmentGstRuleSet(
  actorId: string | null,
): Promise<GarmentGstRuleSetBootstrapResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${CURRENT_GARMENT_GST_RULE_SET_CODE}, 0))::text`;

    const ruleSet = await tx.gstRuleSet.upsert({
      where: { code: CURRENT_GARMENT_GST_RULE_SET_CODE },
      update: {},
      create: {
        id: createId(),
        code: CURRENT_GARMENT_GST_RULE_SET_CODE,
        name: 'Garment GST — Standard (<=2500: 5%, >2500: 18%)',
        status: 'ACTIVE',
      },
    });

    const existingActive = await tx.gstRuleSetVersion.findFirst({
      where: { gstRuleSetId: ruleSet.id, status: 'ACTIVE' },
    });
    if (existingActive) {
      return { gstRuleSetId: ruleSet.id, action: 'unchanged', versionId: existingActive.id };
    }

    const versionId = createId();
    await tx.gstRuleSetVersion.create({
      data: {
        id: versionId,
        gstRuleSetId: ruleSet.id,
        versionNumber: 1,
        status: 'ACTIVE',
        effectiveFrom: toDateOnly(CURRENT_GARMENT_GST_RULE_EFFECTIVE_FROM),
      },
    });
    await tx.gstValueBand.createMany({
      data: [
        { id: createId(), gstRuleSetVersionId: versionId, minValue: null, maxValue: 2500, gstPercent: 5 },
        { id: createId(), gstRuleSetVersionId: versionId, minValue: 2500, maxValue: null, gstPercent: 18 },
      ],
    });

    await recordAuditLog(
      {
        actorId,
        action: 'GST_RULE_SET_VERSION_ACTIVATED',
        entityType: 'GstRuleSet',
        entityId: ruleSet.id,
        metadata: {
          versionId,
          bootstrap: true,
          effectiveFrom: CURRENT_GARMENT_GST_RULE_EFFECTIVE_FROM,
          bands: [
            { minValue: null, maxValue: 2500, gstPercent: 5 },
            { minValue: 2500, maxValue: null, gstPercent: 18 },
          ],
        },
      },
      tx,
    );

    return { gstRuleSetId: ruleSet.id, action: 'created', versionId };
  });
}
