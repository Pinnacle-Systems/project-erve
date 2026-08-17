import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type {
  DistributorStatus,
  FactoryStatus,
  ProcessFlowVersionStatus,
  SizeStatus,
  SizeType,
  StyleStatus,
} from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { toStyleImageView } from './style-images.service.js';

const styleInclude = {
  styleSeasons: { include: { season: true }, orderBy: { season: { name: 'asc' } } },
  styleSizes: { include: { size: true }, orderBy: { size: { sortOrder: 'asc' } } },
  styleFactoryMappings: { include: { factory: true }, orderBy: { factory: { name: 'asc' } } },
  images: {
    include: { file: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.StyleInclude;

const processFlowInclude = {
  versions: {
    orderBy: { versionNumber: 'desc' },
    include: {
      _count: { select: { stages: { where: { activityType: 'QUALITY' } } } },
    },
  },
} satisfies Prisma.ProcessFlowInclude;

const processFlowVersionInclude = {
  processFlow: true,
  stages: {
    orderBy: { sequence: 'asc' },
    include: {
      qualityFormVersion: { include: { qualityForm: true } },
      associatedProductionActivity: true,
    },
  },
} satisfies Prisma.ProcessFlowVersionInclude;

type StyleRecord = Prisma.StyleGetPayload<{ include: typeof styleInclude }>;
type ProcessFlowRecord = Prisma.ProcessFlowGetPayload<{ include: typeof processFlowInclude }>;
type ProcessFlowVersionRecord = Prisma.ProcessFlowVersionGetPayload<{
  include: typeof processFlowVersionInclude;
}>;

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toStyleView(style: StyleRecord) {
  return {
    id: style.id,
    styleNumber: style.styleNumber,
    styleName: style.styleName,
    description: style.description,
    categoryDescription: style.categoryDescription,
    itemNameGroup: style.itemNameGroup,
    ipName: style.ipName,
    licensor: style.licensor,
    colour: style.colour,
    lmixNumber: style.lmixNumber,
    hsnCode: style.hsnCode,
    hsnDescription: style.hsnDescription,
    finalMrp: decimalToNumber(style.finalMrp),
    royaltyPercentage: decimalToNumber(style.royaltyPercentage),
    status: style.status,
    seasons: style.styleSeasons.map(({ season }) => ({
      id: season.id,
      code: season.code,
      name: season.name,
      financialYear: season.financialYear,
      displayName: `${season.code} ${season.financialYear}`,
      status: season.status,
    })),
    sizes: style.styleSizes.map((mapping) => ({
      id: mapping.size.id,
      code: mapping.size.code,
      label: mapping.size.label,
      sizeType: mapping.size.sizeType,
      sortOrder: mapping.size.sortOrder,
      status: mapping.size.status,
      mappingStatus: mapping.status,
      importedSizeRangeLabel: mapping.importedSizeRangeLabel,
    })),
    factories: style.styleFactoryMappings.map((mapping) => ({
      id: mapping.factory.id,
      code: mapping.factory.code,
      name: mapping.factory.name,
      status: mapping.factory.status,
      mappingStatus: mapping.status,
      exFactoryPrice: decimalToNumber(mapping.exFactoryPrice),
    })),
    images: style.images.map(toStyleImageView),
    createdAt: style.createdAt,
    updatedAt: style.updatedAt,
  };
}

function toProcessFlowView(flow: ProcessFlowRecord) {
  return {
    id: flow.id,
    code: flow.code,
    name: flow.name,
    description: flow.description,
    status: flow.status,
    versions: flow.versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      hasQualityActivities: version._count.stages > 0,
      effectiveFrom: version.effectiveFrom,
      createdAt: version.createdAt,
    })),
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

function toProcessFlowVersionView(version: ProcessFlowVersionRecord) {
  return {
    id: version.id,
    processFlowId: version.processFlowId,
    processFlowCode: version.processFlow.code,
    processFlowName: version.processFlow.name,
    versionNumber: version.versionNumber,
    status: version.status,
    effectiveFrom: version.effectiveFrom,
    stages: version.stages.map((stage) => ({
      id: stage.id,
      sequence: stage.sequence,
      name: stage.name,
      code: stage.code,
      status: stage.status,
      activityType: stage.activityType,
      qualityFormVersionId: stage.qualityFormVersionId,
      qualityFormVersion: stage.qualityFormVersion
        ? {
            id: stage.qualityFormVersion.id,
            versionNumber: stage.qualityFormVersion.versionNumber,
            status: stage.qualityFormVersion.status,
            qualityForm: {
              id: stage.qualityFormVersion.qualityForm.id,
              code: stage.qualityFormVersion.qualityForm.code,
              name: stage.qualityFormVersion.qualityForm.name,
            },
          }
        : null,
      qualityExecutionMode: stage.qualityExecutionMode,
      associatedProductionActivityId: stage.associatedProductionActivityId,
      associatedProductionActivity: stage.associatedProductionActivity
        ? {
            id: stage.associatedProductionActivity.id,
            name: stage.associatedProductionActivity.name,
            code: stage.associatedProductionActivity.code,
          }
        : null,
      qualityAvailabilityPolicy: stage.qualityAvailabilityPolicy,
      progressThresholdPercent: decimalToNumber(stage.progressThresholdPercent),
    })),
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

export async function listStyles(filters: {
  search?: string;
  status?: StyleStatus;
  ipName?: string;
  licensor?: string;
}) {
  const where: Prisma.StyleWhereInput = {
    status: filters.status,
    ipName: filters.ipName ? { contains: filters.ipName, mode: 'insensitive' } : undefined,
    licensor: filters.licensor ? { contains: filters.licensor, mode: 'insensitive' } : undefined,
    OR: filters.search
      ? [
          { styleNumber: { contains: filters.search, mode: 'insensitive' } },
          { styleName: { contains: filters.search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  const styles = await prisma.style.findMany({
    where,
    include: styleInclude,
    orderBy: { styleNumber: 'asc' },
  });
  return styles.map(toStyleView);
}

export async function getStyleById(id: string) {
  const style = await prisma.style.findUnique({ where: { id }, include: styleInclude });
  if (!style) {
    throw HttpError.notFound('Style not found');
  }
  return toStyleView(style);
}

export async function createStyle(
  actor: CurrentUser,
  input: {
    styleNumber: string;
    styleName: string;
    finalMrp: number;
    status?: StyleStatus;
    [key: string]: unknown;
  },
) {
  const styleId = createId();
  const seasonIds = input.seasonIds as string[];
  await assertActiveSeasons(seasonIds);

  try {
    await prisma.style.create({
      data: {
        id: styleId,
        ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'seasonIds')),
        status: input.status ?? 'ACTIVE',
        styleSeasons: { create: seasonIds.map((seasonId) => ({ seasonId })) },
      } as Prisma.StyleUncheckedCreateInput,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A style with this style number already exists');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_CREATED',
    entityType: 'Style',
    entityId: styleId,
  });

  return getStyleById(styleId);
}

export async function updateStyle(
  actor: CurrentUser,
  styleId: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.style.findUnique({
    where: { id: styleId },
    include: { styleSeasons: true },
  });
  if (!existing) {
    throw HttpError.notFound('Style not found');
  }

  const seasonIds = input.seasonIds as string[] | undefined;
  // An inactive master can remain on an existing Style during edits, but it
  // cannot be newly assigned.
  if (seasonIds) {
    const retainedInactiveIds = new Set(existing.styleSeasons.map((mapping) => mapping.seasonId));
    await assertActiveSeasons(seasonIds.filter((seasonId) => !retainedInactiveIds.has(seasonId)));
  }
  try {
    await prisma.style.update({
      where: { id: styleId },
      data: {
        ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'seasonIds')),
        ...(seasonIds
          ? {
              styleSeasons: { deleteMany: {}, create: seasonIds.map((seasonId) => ({ seasonId })) },
            }
          : {}),
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A style with this style number already exists');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_UPDATED',
    entityType: 'Style',
    entityId: styleId,
    metadata: seasonIds ? { seasonIds } : undefined,
  });

  return getStyleById(styleId);
}

function toSeasonView(season: {
  id: string;
  code: string;
  name: string;
  financialYear: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...season, displayName: `${season.code} ${season.financialYear}` };
}

export async function listSeasons(filters: { status?: string; search?: string }) {
  const seasons = await prisma.season.findMany({
    where: {
      status: filters.status,
      OR: filters.search
        ? [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { financialYear: { contains: filters.search } },
          ]
        : undefined,
    },
    orderBy: [{ financialYear: 'desc' }, { name: 'asc' }],
  });
  return seasons.map(toSeasonView);
}
export async function getSeasonById(id: string) {
  const season = await prisma.season.findUnique({ where: { id } });
  if (!season) throw HttpError.notFound('Season not found');
  return toSeasonView(season);
}

async function assertActiveSeasons(ids: string[]) {
  const seasons = await prisma.season.findMany({ where: { id: { in: ids }, status: 'ACTIVE' } });
  if (seasons.length !== ids.length)
    throw HttpError.badRequest('Every selected Season must exist and be active');
}

export async function createSeason(
  actor: CurrentUser,
  input: { code: string; name: string; financialYear: string; status?: 'ACTIVE' | 'INACTIVE' },
) {
  try {
    const season = await prisma.season.create({
      data: { id: createId(), ...input, status: input.status ?? 'ACTIVE' },
    });
    await recordAuditLog({
      actorId: actor.id,
      action: 'SEASON_CREATED',
      entityType: 'Season',
      entityId: season.id,
      metadata: { code: season.code, name: season.name, financialYear: season.financialYear },
    });
    return toSeasonView(season);
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw HttpError.conflict('A Season with this name and financial year already exists');
    throw error;
  }
}
export async function updateSeason(
  actor: CurrentUser,
  id: string,
  input: { code?: string; name?: string; financialYear?: string },
) {
  const existing = await prisma.season.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Season not found');
  if (
    (input.code === undefined || input.code === existing.code) &&
    (input.name === undefined || input.name === existing.name) &&
    (input.financialYear === undefined || input.financialYear === existing.financialYear)
  )
    return toSeasonView(existing);
  try {
    const season = await prisma.season.update({ where: { id }, data: input });
    await recordAuditLog({
      actorId: actor.id,
      action: 'SEASON_UPDATED',
      entityType: 'Season',
      entityId: id,
      metadata: { ...input },
    });
    return toSeasonView(season);
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw HttpError.conflict('A Season with this name and financial year already exists');
    throw error;
  }
}
export async function updateSeasonStatus(
  actor: CurrentUser,
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
) {
  const existing = await prisma.season.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Season not found');
  if (existing.status === status) return toSeasonView(existing);
  const season = await prisma.season.update({ where: { id }, data: { status } });
  await recordAuditLog({
    actorId: actor.id,
    action: `SEASON_${status}`,
    entityType: 'Season',
    entityId: id,
    metadata: { code: season.code, name: season.name, financialYear: season.financialYear },
  });
  return toSeasonView(season);
}

export async function updateStyleStatus(actor: CurrentUser, styleId: string, status: StyleStatus) {
  const existing = await prisma.style.findUnique({ where: { id: styleId } });
  if (!existing) {
    throw HttpError.notFound('Style not found');
  }

  await prisma.style.update({ where: { id: styleId }, data: { status } });
  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_STATUS_CHANGED',
    entityType: 'Style',
    entityId: styleId,
    metadata: { from: existing.status, to: status },
  });

  return getStyleById(styleId);
}

export async function addStyleSize(
  actor: CurrentUser,
  styleId: string,
  input: { sizeId: string; importedSizeRangeLabel?: string | null },
) {
  const [style, size] = await Promise.all([
    prisma.style.findUnique({ where: { id: styleId } }),
    prisma.size.findUnique({ where: { id: input.sizeId } }),
  ]);
  if (!style) {
    throw HttpError.notFound('Style not found');
  }
  if (!size) {
    throw HttpError.badRequest('Unknown size');
  }
  if (size.status !== 'ACTIVE') {
    throw HttpError.badRequest('Cannot map an inactive size to a style');
  }

  try {
    await prisma.styleSize.create({
      data: {
        id: createId(),
        styleId,
        sizeId: input.sizeId,
        importedSizeRangeLabel: input.importedSizeRangeLabel,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('Style already has this size');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_SIZE_ADDED',
    entityType: 'Style',
    entityId: styleId,
    metadata: { sizeId: input.sizeId },
  });

  return getStyleById(styleId);
}

export async function removeStyleSize(actor: CurrentUser, styleId: string, sizeId: string) {
  const deleted = await prisma.styleSize.deleteMany({ where: { styleId, sizeId } });
  if (deleted.count === 0) {
    throw HttpError.notFound('Style size mapping not found');
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_SIZE_REMOVED',
    entityType: 'Style',
    entityId: styleId,
    metadata: { sizeId },
  });

  return getStyleById(styleId);
}

export async function addStyleFactory(
  actor: CurrentUser,
  styleId: string,
  input: { factoryId: string; exFactoryPrice: number },
) {
  const [style, factory] = await Promise.all([
    prisma.style.findUnique({ where: { id: styleId } }),
    prisma.factory.findUnique({ where: { id: input.factoryId } }),
  ]);
  if (!style) {
    throw HttpError.notFound('Style not found');
  }
  if (!factory) {
    throw HttpError.badRequest('Unknown factory');
  }
  if (factory.status !== 'ACTIVE') {
    throw HttpError.badRequest('Cannot map an inactive factory to a style');
  }

  try {
    await prisma.styleFactoryMapping.create({
      data: {
        id: createId(),
        styleId,
        factoryId: input.factoryId,
        exFactoryPrice: input.exFactoryPrice,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('Style already has this factory mapping');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_FACTORY_MAPPING_ADDED',
    entityType: 'Style',
    entityId: styleId,
    metadata: { factoryId: input.factoryId },
  });

  return getStyleById(styleId);
}

export async function removeStyleFactory(actor: CurrentUser, styleId: string, factoryId: string) {
  const deleted = await prisma.styleFactoryMapping.deleteMany({ where: { styleId, factoryId } });
  if (deleted.count === 0) {
    throw HttpError.notFound('Style factory mapping not found');
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'STYLE_FACTORY_MAPPING_REMOVED',
    entityType: 'Style',
    entityId: styleId,
    metadata: { factoryId },
  });

  return getStyleById(styleId);
}

export async function listSizes(filters: { status?: string; search?: string }) {
  const sizes = await prisma.size.findMany({
    where: {
      status: filters.status as SizeStatus | undefined,
      OR: filters.search
        ? [
            { code: { contains: filters.search, mode: 'insensitive' } },
            { label: { contains: filters.search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  return sizes;
}

export async function getSizeById(id: string) {
  const size = await prisma.size.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          styleSizes: true,
          purchaseOrderLineSizes: true,
          jobOrderLineSizes: true,
        },
      },
    },
  });
  if (!size) throw HttpError.notFound('Size not found');
  const { _count, ...record } = size;
  return {
    ...record,
    usage: {
      styleMappings: _count.styleSizes,
      purchaseOrderLines: _count.purchaseOrderLineSizes,
      jobOrderLines: _count.jobOrderLineSizes,
    },
  };
}

export async function createSize(
  actor: CurrentUser,
  input: {
    code: string;
    label: string;
    sizeType: SizeType;
    sortOrder: number;
    status?: SizeStatus;
  },
) {
  try {
    const size = await prisma.size.create({
      data: { id: createId(), ...input, status: input.status ?? 'ACTIVE' },
    });
    await recordAuditLog({
      actorId: actor.id,
      action: 'SIZE_CREATED',
      entityType: 'Size',
      entityId: size.id,
    });
    return size;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A size with this code already exists');
    }
    throw error;
  }
}

export async function updateSize(actor: CurrentUser, id: string, input: Record<string, unknown>) {
  const existing = await prisma.size.findUnique({
    where: { id },
    include: {
      _count: { select: { purchaseOrderLineSizes: true, jobOrderLineSizes: true } },
    },
  });
  if (!existing) throw HttpError.notFound('Size not found');
  const historicallyUsed =
    existing._count.purchaseOrderLineSizes > 0 || existing._count.jobOrderLineSizes > 0;
  if (
    historicallyUsed &&
    ((typeof input.code === 'string' && input.code !== existing.code) ||
      (typeof input.sizeType === 'string' && input.sizeType !== existing.sizeType))
  ) {
    throw HttpError.conflict(
      'Code and size type cannot be changed after a size is used in a transaction',
    );
  }

  try {
    const size = await prisma.size.update({
      where: { id },
      data: input as Prisma.SizeUncheckedUpdateInput,
    });
    await recordAuditLog({
      actorId: actor.id,
      action: 'SIZE_UPDATED',
      entityType: 'Size',
      entityId: id,
      metadata: { before: existing, after: size },
    });
    return size;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw HttpError.notFound('Size not found');
    }
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A size with this code already exists');
    }
    throw error;
  }
}

export async function updateSizeStatus(actor: CurrentUser, id: string, status: SizeStatus) {
  const existing = await prisma.size.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Size not found');
  const size = await prisma.size.update({ where: { id }, data: { status } });
  await recordAuditLog({
    actorId: actor.id,
    action: 'SIZE_STATUS_CHANGED',
    entityType: 'Size',
    entityId: id,
    metadata: { from: existing.status, to: status },
  });
  return size;
}

export async function listFactories(
  actor: CurrentUser,
  filters: { status?: string; search?: string },
) {
  const factoryIds =
    actor.roles.includes('FACTORY_USER') &&
    !actor.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER')
      ? actor.factoryIds
      : undefined;

  const factories = await prisma.factory.findMany({
    where: {
      id: factoryIds ? { in: factoryIds } : undefined,
      status: filters.status as FactoryStatus | undefined,
      OR: filters.search
        ? [
            { code: { contains: filters.search, mode: 'insensitive' } },
            { name: { contains: filters.search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: { name: 'asc' },
  });
  return factories;
}

export async function getFactoryById(actor: CurrentUser, id: string) {
  if (
    actor.roles.includes('FACTORY_USER') &&
    !actor.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER') &&
    !actor.factoryIds.includes(id)
  ) {
    throw HttpError.forbidden();
  }

  const factory = await prisma.factory.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          styleFactoryMappings: true,
          jobOrders: true,
          userFactories: true,
        },
      },
    },
  });
  if (!factory) {
    throw HttpError.notFound('Factory not found');
  }
  const { _count, ...record } = factory;
  return {
    ...record,
    usage: {
      styleMappings: _count.styleFactoryMappings,
      jobOrders: _count.jobOrders,
      mappedUsers: _count.userFactories,
    },
  };
}

export async function createFactory(
  actor: CurrentUser,
  input: Omit<Prisma.FactoryUncheckedCreateInput, 'id'>,
) {
  const existingByName = await prisma.factory.findFirst({ where: { name: input.name } });
  if (existingByName) {
    throw HttpError.conflict('A factory with this code or name already exists');
  }

  try {
    const factory = await prisma.factory.create({
      data: { id: createId(), status: 'ACTIVE', ...input },
    });
    await recordAuditLog({
      actorId: actor.id,
      action: 'FACTORY_CREATED',
      entityType: 'Factory',
      entityId: factory.id,
    });
    return factory;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A factory with this code or name already exists');
    }
    throw error;
  }
}

export async function updateFactory(
  actor: CurrentUser,
  id: string,
  input: Record<string, unknown>,
) {
  if (typeof input.name === 'string') {
    const existingByName = await prisma.factory.findFirst({
      where: { name: input.name, NOT: { id } },
    });
    if (existingByName) {
      throw HttpError.conflict('A factory with this code or name already exists');
    }
  }

  try {
    const existing = await prisma.factory.findUnique({ where: { id } });
    if (!existing) throw HttpError.notFound('Factory not found');
    const factory = await prisma.factory.update({
      where: { id },
      data: input as Prisma.FactoryUncheckedUpdateInput,
    });
    await recordAuditLog({
      actorId: actor.id,
      action: 'FACTORY_UPDATED',
      entityType: 'Factory',
      entityId: id,
      metadata: { before: existing, after: factory },
    });
    return factory;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw HttpError.notFound('Factory not found');
    }
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A factory with this code or name already exists');
    }
    throw error;
  }
}

export async function updateFactoryStatus(actor: CurrentUser, id: string, status: FactoryStatus) {
  const existing = await prisma.factory.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Factory not found');
  const factory = await prisma.factory.update({ where: { id }, data: { status } });
  await recordAuditLog({
    actorId: actor.id,
    action: 'FACTORY_STATUS_CHANGED',
    entityType: 'Factory',
    entityId: id,
    metadata: { from: existing.status, to: status },
  });
  return factory;
}

export async function listFactoryUsers(factoryId: string) {
  const factory = await prisma.factory.findUnique({ where: { id: factoryId } });
  if (!factory) throw HttpError.notFound('Factory not found');
  const mappings = await prisma.userFactory.findMany({
    where: { factoryId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      },
    },
    orderBy: { user: { name: 'asc' } },
  });
  return mappings.map(({ user }) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roles: user.userRoles.map(({ role }) => role.name),
  }));
}

type ProcessStageInput = {
  activityKey?: string;
  sequence?: number;
  name: string;
  code?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  activityType?: 'PRODUCTION' | 'QUALITY';
  qualityFormVersionId?: string;
  qualityExecutionMode?: 'SEQUENTIAL_GATE' | 'IN_PROCESS';
  associatedProductionActivityKey?: string;
  qualityAvailabilityPolicy?: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' | 'PROGRESS_PERCENTAGE';
  progressThresholdPercent?: number;
};

function normalizedStageData(stages: ProcessStageInput[]) {
  const ids = new Map(
    stages.map((stage, index) => [stage.activityKey ?? `activity-${index + 1}`, createId()]),
  );
  return stages.map((stage, index) => {
    const activityType = stage.activityType ?? 'PRODUCTION';
    return {
      id: ids.get(stage.activityKey ?? `activity-${index + 1}`)!,
      sequence: index + 1,
      name: stage.name.trim(),
      code: stage.code?.trim() || null,
      status: stage.status ?? 'ACTIVE',
      activityType,
      qualityFormVersionId:
        activityType === 'QUALITY' ? (stage.qualityFormVersionId ?? null) : null,
      qualityExecutionMode:
        activityType === 'QUALITY' ? (stage.qualityExecutionMode ?? null) : null,
      associatedProductionActivityId:
        stage.qualityExecutionMode === 'IN_PROCESS'
          ? (ids.get(stage.associatedProductionActivityKey!) ?? null)
          : null,
      qualityAvailabilityPolicy:
        stage.qualityExecutionMode === 'IN_PROCESS'
          ? (stage.qualityAvailabilityPolicy ?? null)
          : null,
      progressThresholdPercent:
        stage.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE'
          ? (stage.progressThresholdPercent ?? null)
          : null,
    };
  });
}

function stageSummary(
  stages: Array<{
    id: string;
    sequence: number;
    name: string;
    code?: string | null;
    status: string;
    activityType?: string;
    qualityFormVersionId?: string | null;
    qualityExecutionMode?: string | null;
    associatedProductionActivityId?: string | null;
    qualityAvailabilityPolicy?: string | null;
    progressThresholdPercent?: number | Prisma.Decimal | null;
  }>,
) {
  const activityById = new Map(stages.map((stage) => [stage.id, stage]));
  return stages.map(({ sequence, name, code, status, ...quality }) => ({
    sequence,
    name,
    code: code ?? null,
    status,
    activityType: quality.activityType ?? 'PRODUCTION',
    qualityFormVersionId: quality.qualityFormVersionId ?? null,
    qualityExecutionMode: quality.qualityExecutionMode ?? null,
    associatedProductionActivity: quality.associatedProductionActivityId
      ? (() => {
          const associated = activityById.get(quality.associatedProductionActivityId);
          return associated
            ? {
                sequence: associated.sequence,
                name: associated.name,
                code: associated.code ?? null,
              }
            : null;
        })()
      : null,
    qualityAvailabilityPolicy: quality.qualityAvailabilityPolicy ?? null,
    progressThresholdPercent:
      quality.progressThresholdPercent instanceof Prisma.Decimal
        ? quality.progressThresholdPercent.toNumber()
        : (quality.progressThresholdPercent ?? null),
  }));
}

async function assertUsableQualityFormVersions(
  tx: Prisma.TransactionClient,
  stages: ProcessStageInput[],
  allowedExistingReferences: Map<string, string> = new Map(),
) {
  const selectedIds = [
    ...new Set(
      stages.flatMap((stage) =>
        stage.activityType === 'QUALITY' && stage.qualityFormVersionId
          ? [stage.qualityFormVersionId]
          : [],
      ),
    ),
  ];
  if (selectedIds.length === 0) return;
  const versions = await tx.qualityFormVersion.findMany({
    where: { id: { in: selectedIds } },
    select: { id: true, status: true, qualityForm: { select: { status: true } } },
  });
  const byId = new Map(versions.map((version) => [version.id, version]));
  for (const stage of stages) {
    if (stage.activityType !== 'QUALITY' || !stage.qualityFormVersionId) continue;
    const id = stage.qualityFormVersionId;
    const version = byId.get(id);
    if (!version) throw HttpError.badRequest('Quality Form version not found');
    const preservesExistingReference =
      Boolean(stage.activityKey) && allowedExistingReferences.get(stage.activityKey!) === id;
    if (
      !preservesExistingReference &&
      (version.status !== 'PUBLISHED' || version.qualityForm.status !== 'ACTIVE')
    ) {
      throw HttpError.badRequest(
        'New Process Flow Quality activities must use a published version of an active Quality Form',
      );
    }
  }
}

async function createVersionActivities(
  tx: Prisma.TransactionClient,
  processFlowVersionId: string,
  stages: ReturnType<typeof normalizedStageData>,
) {
  const data = stages.map((stage) => ({ ...stage, processFlowVersionId }));
  const production = data.filter((stage) => stage.activityType === 'PRODUCTION');
  const quality = data.filter((stage) => stage.activityType === 'QUALITY');
  if (production.length > 0) await tx.processFlowVersionStage.createMany({ data: production });
  if (quality.length > 0) await tx.processFlowVersionStage.createMany({ data: quality });
}

function canonicalActivityConfiguration(
  stages: Array<{
    id: string;
    sequence: number;
    name: string;
    code?: string | null;
    status: string;
    activityType: string;
    qualityFormVersionId?: string | null;
    qualityExecutionMode?: string | null;
    associatedProductionActivityId?: string | null;
    qualityAvailabilityPolicy?: string | null;
    progressThresholdPercent?: number | Prisma.Decimal | null;
  }>,
) {
  const sequenceById = new Map(stages.map((stage) => [stage.id, stage.sequence]));
  return stages.map((stage) => ({
    sequence: stage.sequence,
    name: stage.name,
    code: stage.code ?? null,
    status: stage.status,
    activityType: stage.activityType,
    qualityFormVersionId: stage.qualityFormVersionId ?? null,
    qualityExecutionMode: stage.qualityExecutionMode ?? null,
    associatedProductionSequence: stage.associatedProductionActivityId
      ? (sequenceById.get(stage.associatedProductionActivityId) ?? null)
      : null,
    qualityAvailabilityPolicy: stage.qualityAvailabilityPolicy ?? null,
    progressThresholdPercent:
      stage.progressThresholdPercent instanceof Prisma.Decimal
        ? stage.progressThresholdPercent.toNumber()
        : (stage.progressThresholdPercent ?? null),
  }));
}

export async function listProcessFlows() {
  const flows = await prisma.processFlow.findMany({
    include: processFlowInclude,
    orderBy: { code: 'asc' },
  });
  return flows.map(toProcessFlowView);
}

export async function getProcessFlowById(id: string) {
  const flow = await prisma.processFlow.findUnique({ where: { id }, include: processFlowInclude });
  if (!flow) {
    throw HttpError.notFound('Process flow not found');
  }
  return toProcessFlowView(flow);
}

export async function createProcessFlow(
  input: {
    code: string;
    name: string;
    description?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
    stages: ProcessStageInput[];
  },
  actor: CurrentUser,
) {
  const flowId = createId();
  const versionId = createId();
  const stages = normalizedStageData(input.stages);

  try {
    const flow = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow_identity', 0))::text`;
      const duplicate = await tx.processFlow.findFirst({
        where: {
          OR: [
            { code: { equals: input.code, mode: 'insensitive' } },
            { name: { equals: input.name, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (duplicate) {
        throw HttpError.conflict('A process flow with this code or name already exists');
      }

      await assertUsableQualityFormVersions(tx, input.stages);

      const created = await tx.processFlow.create({
        data: {
          id: flowId,
          code: input.code,
          name: input.name,
          description: input.description,
          status: input.status ?? 'ACTIVE',
          versions: {
            create: {
              id: versionId,
              versionNumber: 1,
              status: 'DRAFT',
            },
          },
        },
        include: processFlowInclude,
      });
      await createVersionActivities(tx, versionId, stages);
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'PROCESS_FLOW_CREATED',
          entityType: 'ProcessFlow',
          entityId: flowId,
          metadata: { code: input.code, name: input.name, versionId, stages: stageSummary(stages) },
        },
        tx,
      );
      return created;
    });
    return toProcessFlowView(flow);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A process flow with this code or name already exists');
    }
    throw error;
  }
}

export async function createProcessFlowVersion(
  processFlowId: string,
  input: {
    stages?: ProcessStageInput[];
    copyFromVersionId?: string;
    effectiveFrom?: Date | null;
  },
  actor: CurrentUser,
) {
  try {
    const version = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow:' || ${processFlowId}, 0))::text`;
      const flow = await tx.processFlow.findUnique({
        where: { id: processFlowId },
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      });
      if (!flow) {
        throw HttpError.notFound('Process flow not found');
      }

      let source: Prisma.ProcessFlowVersionGetPayload<{ include: { stages: true } }> | null = null;
      if (input.copyFromVersionId) {
        source = await tx.processFlowVersion.findFirst({
          where: { id: input.copyFromVersionId, processFlowId },
          include: { stages: { orderBy: { sequence: 'asc' } } },
        });
        if (!source) {
          throw HttpError.badRequest('Copy source must be a version of this process flow');
        }
      }

      const sourceStages: ProcessStageInput[] = source
        ? source.stages.map(
            ({
              id,
              sequence,
              name,
              code,
              status,
              activityType,
              qualityFormVersionId,
              qualityExecutionMode,
              associatedProductionActivityId,
              qualityAvailabilityPolicy,
              progressThresholdPercent,
            }) => ({
              activityKey: id,
              sequence,
              name,
              code,
              status,
              activityType,
              qualityFormVersionId: qualityFormVersionId ?? undefined,
              qualityExecutionMode: qualityExecutionMode ?? undefined,
              associatedProductionActivityKey: associatedProductionActivityId ?? undefined,
              qualityAvailabilityPolicy: qualityAvailabilityPolicy ?? undefined,
              progressThresholdPercent: progressThresholdPercent?.toNumber(),
            }),
          )
        : (input.stages ?? []);
      if (!source) await assertUsableQualityFormVersions(tx, sourceStages);
      const stages = normalizedStageData(sourceStages);
      const versionId = createId();
      await tx.processFlowVersion.create({
        data: {
          id: versionId,
          processFlowId,
          versionNumber: (flow.versions[0]?.versionNumber ?? 0) + 1,
          status: 'DRAFT',
          effectiveFrom: input.effectiveFrom,
        },
      });
      await createVersionActivities(tx, versionId, stages);
      const created = await tx.processFlowVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: processFlowVersionInclude,
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'PROCESS_FLOW_VERSION_CREATED',
          entityType: 'ProcessFlowVersion',
          entityId: versionId,
          metadata: {
            processFlowId,
            versionNumber: created.versionNumber,
            copyFromVersionId: source?.id ?? null,
            stages: stageSummary(stages),
          },
        },
        tx,
      );
      if (source) {
        await recordAuditLog(
          {
            actorId: actor.id,
            action: 'PROCESS_FLOW_VERSION_COPIED',
            entityType: 'ProcessFlowVersion',
            entityId: versionId,
            metadata: { processFlowId, copyFromVersionId: source.id, stages: stageSummary(stages) },
          },
          tx,
        );
      }
      return created;
    });
    return toProcessFlowVersionView(version);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(
        'A process flow version was created concurrently; retry the request',
      );
    }
    throw error;
  }
}

export async function getProcessFlowVersionById(id: string) {
  const version = await prisma.processFlowVersion.findUnique({
    where: { id },
    include: processFlowVersionInclude,
  });
  if (!version) {
    throw HttpError.notFound('Process flow version not found');
  }
  return toProcessFlowVersionView(version);
}

export async function replaceProcessFlowVersionStages(
  id: string,
  input: { stages: ProcessStageInput[] },
  actor: CurrentUser,
) {
  const candidate = await prisma.processFlowVersion.findUnique({
    where: { id },
    select: { processFlowId: true },
  });
  if (!candidate) {
    throw HttpError.notFound('Process flow version not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow:' || ${candidate.processFlowId}, 0))::text`;
    const existing = await tx.processFlowVersion.findUnique({
      where: { id },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });
    if (!existing) {
      throw HttpError.notFound('Process flow version not found');
    }
    if (existing.status !== 'DRAFT') {
      throw HttpError.conflict('This version is no longer a draft and cannot be edited');
    }

    const allowedExistingReferences = new Map(
      existing.stages.flatMap((stage) =>
        stage.qualityFormVersionId ? [[stage.id, stage.qualityFormVersionId] as const] : [],
      ),
    );
    await assertUsableQualityFormVersions(tx, input.stages, allowedExistingReferences);
    const stages = normalizedStageData(input.stages);
    const before = stageSummary(existing.stages);
    if (
      JSON.stringify(canonicalActivityConfiguration(existing.stages)) ===
      JSON.stringify(canonicalActivityConfiguration(stages))
    ) {
      return;
    }
    await tx.processFlowVersionStage.deleteMany({
      where: { processFlowVersionId: id, activityType: 'QUALITY' },
    });
    await tx.processFlowVersionStage.deleteMany({ where: { processFlowVersionId: id } });
    await createVersionActivities(tx, id, stages);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED',
        entityType: 'ProcessFlowVersion',
        entityId: id,
        metadata: { before, after: stageSummary(stages) },
      },
      tx,
    );
  });

  return getProcessFlowVersionById(id);
}

export async function activateProcessFlowVersion(id: string, actor: CurrentUser) {
  const candidate = await prisma.processFlowVersion.findUnique({
    where: { id },
    select: {
      processFlowId: true,
      processFlow: {
        select: {
          versions: {
            where: { status: 'ACTIVE' },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!candidate) {
    throw HttpError.notFound('Process flow version not found');
  }
  const expectedActiveVersionId = candidate.processFlow.versions[0]?.id ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow:' || ${candidate.processFlowId}, 0))::text`;
    const currentActiveVersion = await tx.processFlowVersion.findFirst({
      where: { processFlowId: candidate.processFlowId, status: 'ACTIVE' },
      select: { id: true },
    });
    if ((currentActiveVersion?.id ?? null) !== expectedActiveVersionId) {
      throw HttpError.conflict(
        'The active process flow version changed while this activation was waiting; retry against the updated process flow',
      );
    }

    const existing = await tx.processFlowVersion.findUnique({
      where: { id },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });
    if (!existing) {
      throw HttpError.notFound('Process flow version not found');
    }
    if (existing.status !== 'DRAFT') {
      throw HttpError.conflict('This version is no longer a draft and cannot be activated');
    }
    if (existing.stages.length === 0) {
      throw HttpError.badRequest('At least one stage is required before activation');
    }

    const previousActive = await tx.processFlowVersion.findMany({
      where: { processFlowId: existing.processFlowId, status: 'ACTIVE' },
    });
    if (previousActive.length > 0) {
      await tx.processFlowVersion.updateMany({
        where: { id: { in: previousActive.map((version) => version.id) }, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      for (const retired of previousActive) {
        await recordAuditLog(
          {
            actorId: actor.id,
            action: 'PROCESS_FLOW_VERSION_RETIRED',
            entityType: 'ProcessFlowVersion',
            entityId: retired.id,
            metadata: { replacedByVersionId: id },
          },
          tx,
        );
      }
    }

    const activated = await tx.processFlowVersion.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'ACTIVE', effectiveFrom: existing.effectiveFrom ?? new Date() },
    });
    if (activated.count !== 1) {
      throw HttpError.conflict('This version changed concurrently and could not be activated');
    }
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'PROCESS_FLOW_VERSION_ACTIVATED',
        entityType: 'ProcessFlowVersion',
        entityId: id,
        metadata: {
          processFlowId: existing.processFlowId,
          versionNumber: existing.versionNumber,
          retiredVersionIds: previousActive.map((version) => version.id),
          stages: stageSummary(existing.stages),
        },
      },
      tx,
    );
  });

  return getProcessFlowVersionById(id);
}

export function assertProcessFlowVersionMutable(status: ProcessFlowVersionStatus): void {
  if (status !== 'DRAFT') {
    throw HttpError.badRequest('ACTIVE and RETIRED process flow versions are immutable');
  }
}

function isDistributorScopedUser(actor: CurrentUser): boolean {
  return (
    actor.roles.includes('DISTRIBUTOR') &&
    !actor.roles.some(
      (role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT',
    )
  );
}

export async function listDistributors(
  actor: CurrentUser,
  filters: { status?: string; search?: string },
) {
  const soleDistributorId = isDistributorScopedUser(actor)
    ? getSoleDistributorId(actor)
    : undefined;

  return prisma.distributor.findMany({
    where: {
      id: soleDistributorId,
      status: filters.status as DistributorStatus | undefined,
      OR: filters.search
        ? [
            { code: { contains: filters.search, mode: 'insensitive' } },
            { name: { contains: filters.search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, status: true, contactName: true, city: true },
  });
}

export async function getDistributorById(actor: CurrentUser, id: string) {
  if (isDistributorScopedUser(actor) && getSoleDistributorId(actor) !== id) {
    throw HttpError.forbidden();
  }

  const distributor = await prisma.distributor.findUnique({ where: { id } });
  if (!distributor) {
    throw HttpError.notFound('Distributor not found');
  }
  return distributor;
}

export async function createDistributor(
  actor: CurrentUser,
  input: Omit<Prisma.DistributorUncheckedCreateInput, 'id'>,
) {
  const existingByName = await prisma.distributor.findFirst({ where: { name: input.name } });
  if (existingByName) {
    throw HttpError.conflict('A distributor with this code or name already exists');
  }

  let distributor;
  try {
    distributor = await prisma.distributor.create({
      data: { id: createId(), status: 'ACTIVE', ...input },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A distributor with this code or name already exists');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'DISTRIBUTOR_CREATED',
    entityType: 'Distributor',
    entityId: distributor.id,
  });

  return distributor;
}

export async function updateDistributor(
  actor: CurrentUser,
  id: string,
  input: Record<string, unknown>,
) {
  if (typeof input.name === 'string') {
    const existingByName = await prisma.distributor.findFirst({
      where: { name: input.name, NOT: { id } },
    });
    if (existingByName) {
      throw HttpError.conflict('A distributor with this code or name already exists');
    }
  }

  let distributor;
  try {
    distributor = await prisma.distributor.update({
      where: { id },
      data: input as Prisma.DistributorUncheckedUpdateInput,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw HttpError.notFound('Distributor not found');
    }
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A distributor with this code or name already exists');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'DISTRIBUTOR_UPDATED',
    entityType: 'Distributor',
    entityId: id,
  });

  return distributor;
}

export async function updateDistributorStatus(
  actor: CurrentUser,
  id: string,
  status: DistributorStatus,
) {
  const existing = await prisma.distributor.findUnique({ where: { id } });
  if (!existing) {
    throw HttpError.notFound('Distributor not found');
  }

  const distributor = await prisma.distributor.update({ where: { id }, data: { status } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'DISTRIBUTOR_STATUS_CHANGED',
    entityType: 'Distributor',
    entityId: id,
    metadata: { from: existing.status, to: status },
  });

  return distributor;
}

export async function listDistributorUsers(distributorId: string) {
  const distributor = await prisma.distributor.findUnique({ where: { id: distributorId } });
  if (!distributor) {
    throw HttpError.notFound('Distributor not found');
  }

  const mappings = await prisma.userDistributor.findMany({
    where: { distributorId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      },
    },
    orderBy: { user: { name: 'asc' } },
  });

  return mappings.map((mapping) => ({
    id: mapping.user.id,
    name: mapping.user.name,
    email: mapping.user.email,
    status: mapping.user.status,
    roles: mapping.user.userRoles.map((userRole) => userRole.role.name),
  }));
}
