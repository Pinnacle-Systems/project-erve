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
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';

const styleInclude = {
  styleSizes: { include: { size: true }, orderBy: { size: { sortOrder: 'asc' } } },
  styleFactoryMappings: { include: { factory: true }, orderBy: { factory: { name: 'asc' } } },
} satisfies Prisma.StyleInclude;

const processFlowInclude = {
  versions: { orderBy: { versionNumber: 'desc' } },
} satisfies Prisma.ProcessFlowInclude;

const processFlowVersionInclude = {
  processFlow: true,
  stages: { orderBy: { sequence: 'asc' } },
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

  try {
    await prisma.style.create({
      data: {
        id: styleId,
        ...input,
        status: input.status ?? 'ACTIVE',
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

export async function updateStyle(actor: CurrentUser, styleId: string, input: Record<string, unknown>) {
  const existing = await prisma.style.findUnique({ where: { id: styleId } });
  if (!existing) {
    throw HttpError.notFound('Style not found');
  }

  try {
    await prisma.style.update({
      where: { id: styleId },
      data: input as Prisma.StyleUncheckedUpdateInput,
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
  });

  return getStyleById(styleId);
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

export async function createStyleImagePlaceholder(styleId: string): Promise<never> {
  const style = await prisma.style.findUnique({ where: { id: styleId } });
  if (!style) {
    throw HttpError.notFound('Style not found');
  }
  throw new HttpError(501, 'NOT_IMPLEMENTED', 'Style image upload storage is not configured yet');
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

export async function createSize(
  input: { code: string; label: string; sizeType: SizeType; sortOrder: number; status?: SizeStatus },
) {
  try {
    return await prisma.size.create({ data: { id: createId(), ...input, status: input.status ?? 'ACTIVE' } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A size with this code already exists');
    }
    throw error;
  }
}

export async function updateSize(id: string, input: Record<string, unknown>) {
  try {
    return await prisma.size.update({ where: { id }, data: input as Prisma.SizeUncheckedUpdateInput });
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

export async function updateSizeStatus(id: string, status: SizeStatus) {
  return updateSize(id, { status });
}

export async function listFactories(actor: CurrentUser, filters: { status?: string; search?: string }) {
  const factoryIds =
    actor.roles.includes('FACTORY_USER') && !actor.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER')
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

  const factory = await prisma.factory.findUnique({ where: { id } });
  if (!factory) {
    throw HttpError.notFound('Factory not found');
  }
  return factory;
}

export async function createFactory(input: Omit<Prisma.FactoryUncheckedCreateInput, 'id'>) {
  const existingByName = await prisma.factory.findFirst({ where: { name: input.name } });
  if (existingByName) {
    throw HttpError.conflict('A factory with this code or name already exists');
  }

  try {
    return await prisma.factory.create({ data: { id: createId(), status: 'ACTIVE', ...input } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A factory with this code or name already exists');
    }
    throw error;
  }
}

export async function updateFactory(id: string, input: Record<string, unknown>) {
  if (typeof input.name === 'string') {
    const existingByName = await prisma.factory.findFirst({ where: { name: input.name, NOT: { id } } });
    if (existingByName) {
      throw HttpError.conflict('A factory with this code or name already exists');
    }
  }

  try {
    return await prisma.factory.update({ where: { id }, data: input as Prisma.FactoryUncheckedUpdateInput });
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

export async function updateFactoryStatus(id: string, status: FactoryStatus) {
  return updateFactory(id, { status });
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

export async function createProcessFlow(input: {
  code: string;
  name: string;
  description?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  stages?: Array<{ sequence: number; name: string; code?: string | null; status?: 'ACTIVE' | 'INACTIVE' }>;
}) {
  const stages = input.stages ?? [
    { sequence: 1, name: 'Cutting' },
    { sequence: 2, name: 'Printing' },
    { sequence: 3, name: 'Sewing' },
    { sequence: 4, name: 'Finishing' },
  ];

  try {
    const flow = await prisma.processFlow.create({
      data: {
        id: createId(),
        code: input.code,
        name: input.name,
        description: input.description,
        status: input.status ?? 'ACTIVE',
        versions: {
          create: {
            id: createId(),
            versionNumber: 1,
            status: 'DRAFT',
            stages: {
              create: stages.map((stage) => ({ id: createId(), ...stage, status: stage.status ?? 'ACTIVE' })),
            },
          },
        },
      },
      include: processFlowInclude,
    });
    return toProcessFlowView(flow);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A process flow with this code already exists');
    }
    throw error;
  }
}

export async function createProcessFlowVersion(
  processFlowId: string,
  input: {
    stages: Array<{ sequence: number; name: string; code?: string | null; status?: 'ACTIVE' | 'INACTIVE' }>;
    effectiveFrom?: Date | null;
  },
) {
  const flow = await prisma.processFlow.findUnique({
    where: { id: processFlowId },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  if (!flow) {
    throw HttpError.notFound('Process flow not found');
  }

  const nextVersionNumber = (flow.versions[0]?.versionNumber ?? 0) + 1;
  const version = await prisma.processFlowVersion.create({
    data: {
      id: createId(),
      processFlowId,
      versionNumber: nextVersionNumber,
      status: 'DRAFT',
      effectiveFrom: input.effectiveFrom,
      stages: {
        create: input.stages.map((stage) => ({ id: createId(), ...stage, status: stage.status ?? 'ACTIVE' })),
      },
    },
    include: processFlowVersionInclude,
  });

  return toProcessFlowVersionView(version);
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

export async function activateProcessFlowVersion(id: string) {
  const existing = await prisma.processFlowVersion.findUnique({ where: { id } });
  if (!existing) {
    throw HttpError.notFound('Process flow version not found');
  }
  if (existing.status !== 'DRAFT') {
    throw HttpError.badRequest('Only DRAFT process flow versions can be activated');
  }

  await prisma.$transaction([
    prisma.processFlowVersion.updateMany({
      where: { processFlowId: existing.processFlowId, status: 'ACTIVE' },
      data: { status: 'RETIRED' },
    }),
    prisma.processFlowVersion.update({
      where: { id },
      data: { status: 'ACTIVE', effectiveFrom: existing.effectiveFrom ?? new Date() },
    }),
  ]);

  return getProcessFlowVersionById(id);
}

export function assertProcessFlowVersionMutable(status: ProcessFlowVersionStatus): void {
  if (status !== 'DRAFT') {
    throw HttpError.badRequest('ACTIVE and RETIRED process flow versions are immutable');
  }
}

export async function listDistributors(filters: { status?: string }) {
  return prisma.distributor.findMany({
    where: { status: filters.status as DistributorStatus | undefined },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, status: true, contactName: true, city: true },
  });
}
