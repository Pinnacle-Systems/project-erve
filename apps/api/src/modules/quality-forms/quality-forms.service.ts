import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { HttpError } from '../../errors/http-error.js';
import type { QualityFormDefinitionInput } from './quality-forms.validation.js';

const versionInclude = {
  qualityForm: true,
  sections: {
    orderBy: { sequence: 'asc' as const },
    include: { components: { orderBy: { sequence: 'asc' as const } } },
  },
} satisfies Prisma.QualityFormVersionInclude;
const formInclude = {
  versions: { orderBy: { versionNumber: 'desc' as const } },
} satisfies Prisma.QualityFormInclude;

type VersionSemantics = {
  activityType: 'MEETING' | 'INSPECTION';
  executionScope: 'JOB_ORDER' | 'SIZE';
};
type FormInput = VersionSemantics & {
  code: string;
  name: string;
  description?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
};
type MasterUpdateInput = Pick<FormInput, 'code' | 'name' | 'description'>;

type FormRecord = Prisma.QualityFormGetPayload<{ include: typeof formInclude }>;
const toFormView = (form: FormRecord) => {
  const currentVersion =
    form.versions.find((version) => version.status === 'PUBLISHED') ?? form.versions[0];
  return {
    ...form,
    activityType: currentVersion?.activityType ?? null,
    executionScope: currentVersion?.executionScope ?? null,
  };
};

const definitionCreate = (definition: QualityFormDefinitionInput) => ({
  create: definition.sections.map((section, sectionIndex) => ({
    id: createId(),
    sequence: sectionIndex + 1,
    title: section.title,
    description: section.description || null,
    components: {
      create: section.components.map((component, componentIndex) => ({
        id: createId(),
        sequence: componentIndex + 1,
        type: component.type,
        title: component.title,
        description: component.description || null,
        config: component.config as Prisma.InputJsonValue,
      })),
    },
  })),
});

const definitionSummary = (definition: QualityFormDefinitionInput) =>
  definition.sections.map((section, sectionIndex) => ({
    sequence: sectionIndex + 1,
    title: section.title,
    componentTypes: section.components.map((component) => component.type),
  }));

const canonicalDefinition = (definition: QualityFormDefinitionInput) =>
  definition.sections.map((section) => ({
    title: section.title,
    description: section.description || null,
    components: section.components.map((component) => ({
      type: component.type,
      title: component.title,
      description: component.description || null,
      config: component.config,
    })),
  }));

function uniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function listQualityForms(filters: {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  activityType?: 'MEETING' | 'INSPECTION';
  executionScope?: 'JOB_ORDER' | 'SIZE';
}) {
  return prisma.qualityForm
    .findMany({
      where: {
        status: filters.status,
        OR: filters.search
          ? [
              { code: { contains: filters.search, mode: 'insensitive' } },
              { name: { contains: filters.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: formInclude,
      orderBy: { code: 'asc' },
    })
    .then((forms) =>
      forms
        .map(toFormView)
        .filter(
          (form) =>
            (!filters.activityType || form.activityType === filters.activityType) &&
            (!filters.executionScope || form.executionScope === filters.executionScope),
        ),
    );
}

export async function getQualityForm(id: string) {
  const form = await prisma.qualityForm.findUnique({ where: { id }, include: formInclude });
  if (!form) throw HttpError.notFound('Quality Form not found');
  return toFormView(form);
}

export async function getQualityFormVersion(id: string) {
  const version = await prisma.qualityFormVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw HttpError.notFound('Quality Form version not found');
  return version;
}

export async function createQualityForm(
  actor: CurrentUser,
  input: FormInput,
  definition: QualityFormDefinitionInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const { activityType, executionScope, ...master } = input;
      const form = await tx.qualityForm.create({
        data: {
          id: createId(),
          ...master,
          description: input.description || null,
          versions: {
            create: {
              id: createId(),
              versionNumber: 1,
              activityType,
              executionScope,
              sections: definitionCreate(definition),
            },
          },
        },
        include: formInclude,
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'QUALITY_FORM_CREATED',
          entityType: 'QualityForm',
          entityId: form.id,
          metadata: {
            code: form.code,
            versionNumber: 1,
            definition: definitionSummary(definition),
          },
        },
        tx,
      );
      return toFormView(form);
    });
  } catch (error) {
    if (uniqueError(error))
      throw HttpError.conflict('A Quality Form with this code already exists');
    throw error;
  }
}

export async function updateQualityForm(
  actor: CurrentUser,
  id: string,
  input: Partial<MasterUpdateInput>,
) {
  const existing = await prisma.qualityForm.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Quality Form not found');
  const data = {
    ...input,
    description: input.description === undefined ? undefined : input.description || null,
  };
  const changed = Object.entries(data).some(
    ([key, value]) => value !== undefined && value !== existing[key as keyof typeof existing],
  );
  if (!changed) return getQualityForm(id);
  try {
    const form = await prisma.qualityForm.update({ where: { id }, data, include: formInclude });
    await recordAuditLog({
      actorId: actor.id,
      action: 'QUALITY_FORM_UPDATED',
      entityType: 'QualityForm',
      entityId: id,
      metadata: { before: existing, after: form },
    });
    return toFormView(form);
  } catch (error) {
    if (uniqueError(error))
      throw HttpError.conflict('A Quality Form with this code already exists');
    throw error;
  }
}

export async function updateQualityFormStatus(
  actor: CurrentUser,
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
) {
  const existing = await prisma.qualityForm.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Quality Form not found');
  if (existing.status === status) return getQualityForm(id);
  const form = await prisma.qualityForm.update({
    where: { id },
    data: { status },
    include: formInclude,
  });
  await recordAuditLog({
    actorId: actor.id,
    action: 'QUALITY_FORM_STATUS_CHANGED',
    entityType: 'QualityForm',
    entityId: id,
    metadata: { from: existing.status, to: status },
  });
  return toFormView(form);
}

export async function createQualityFormVersion(
  actor: CurrentUser,
  qualityFormId: string,
  semantics: VersionSemantics,
  definition: QualityFormDefinitionInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const form = await tx.qualityForm.findUnique({ where: { id: qualityFormId } });
      if (!form) throw HttpError.notFound('Quality Form not found');
      const latest = await tx.qualityFormVersion.findFirst({
        where: { qualityFormId },
        orderBy: { versionNumber: 'desc' },
      });
      const version = await tx.qualityFormVersion.create({
        data: {
          id: createId(),
          qualityFormId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          ...semantics,
          sections: definitionCreate(definition),
        },
        include: versionInclude,
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'QUALITY_FORM_VERSION_CREATED',
          entityType: 'QualityFormVersion',
          entityId: version.id,
          metadata: {
            qualityFormId,
            versionNumber: version.versionNumber,
            ...semantics,
            definition: definitionSummary(definition),
          },
        },
        tx,
      );
      return version;
    });
  } catch (error) {
    if (uniqueError(error))
      throw HttpError.conflict('A version was created concurrently; retry the request');
    throw error;
  }
}

export async function replaceQualityFormDefinition(
  actor: CurrentUser,
  id: string,
  semantics: VersionSemantics,
  definition: QualityFormDefinitionInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.qualityFormVersion.findUnique({
      where: { id },
      include: versionInclude,
    });
    if (!existing) throw HttpError.notFound('Quality Form version not found');
    if (existing.status !== 'DRAFT')
      throw HttpError.conflict('Published and retired Quality Form versions are immutable');
    const storedDefinition = existing.sections.map((section) => ({
      title: section.title,
      description: section.description,
      components: section.components.map((component) => ({
        type: component.type,
        title: component.title,
        description: component.description,
        config: component.config,
      })),
    }));
    if (
      existing.activityType === semantics.activityType &&
      existing.executionScope === semantics.executionScope &&
      JSON.stringify(storedDefinition) === JSON.stringify(canonicalDefinition(definition))
    ) {
      return existing;
    }
    await tx.qualityFormSection.deleteMany({ where: { qualityFormVersionId: id } });
    const version = await tx.qualityFormVersion.update({
      where: { id },
      data: { ...semantics, sections: definitionCreate(definition) },
      include: versionInclude,
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'QUALITY_FORM_DEFINITION_UPDATED',
        entityType: 'QualityFormVersion',
        entityId: id,
        metadata: {
          qualityFormId: existing.qualityFormId,
          versionNumber: existing.versionNumber,
          beforeSemantics: {
            activityType: existing.activityType,
            executionScope: existing.executionScope,
          },
          afterSemantics: semantics,
          definition: definitionSummary(definition),
        },
      },
      tx,
    );
    return version;
  });
}

export async function publishQualityFormVersion(actor: CurrentUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.qualityFormVersion.findUnique({
      where: { id },
      include: versionInclude,
    });
    if (!existing) throw HttpError.notFound('Quality Form version not found');
    if (existing.status !== 'DRAFT')
      throw HttpError.conflict('Only draft Quality Form versions can be published');
    if (
      !existing.sections.length ||
      existing.sections.some((section) => !section.components.length)
    )
      throw HttpError.conflict('A version must contain sections and components before publishing');
    const publishedAt = new Date();
    const priorPublished = await tx.qualityFormVersion.findMany({
      where: { qualityFormId: existing.qualityFormId, status: 'PUBLISHED' },
      select: { id: true, versionNumber: true },
    });
    await tx.qualityFormVersion.updateMany({
      where: { qualityFormId: existing.qualityFormId, status: 'PUBLISHED' },
      data: { status: 'RETIRED' },
    });
    for (const retired of priorPublished) {
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'QUALITY_FORM_VERSION_RETIRED',
          entityType: 'QualityFormVersion',
          entityId: retired.id,
          metadata: {
            qualityFormId: existing.qualityFormId,
            versionNumber: retired.versionNumber,
            replacedByVersionId: id,
          },
        },
        tx,
      );
    }
    const version = await tx.qualityFormVersion.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt },
      include: versionInclude,
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'QUALITY_FORM_VERSION_PUBLISHED',
        entityType: 'QualityFormVersion',
        entityId: id,
        metadata: { qualityFormId: existing.qualityFormId, versionNumber: existing.versionNumber },
      },
      tx,
    );
    return version;
  });
}
