import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { HsnStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { listAllOrPage, type OptionalPageQuery } from '../../utils/pagination.js';

const hsnInclude = {
  gstRuleSet: { select: { id: true, code: true, name: true, status: true } },
} satisfies Prisma.HsnInclude;

type HsnRecord = Prisma.HsnGetPayload<{ include: typeof hsnInclude }>;

function toHsnView(hsn: HsnRecord) {
  return {
    id: hsn.id,
    code: hsn.code,
    description: hsn.description,
    status: hsn.status,
    gstRuleSet: hsn.gstRuleSet,
    createdAt: hsn.createdAt,
    updatedAt: hsn.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function assertGstRuleSetExists(gstRuleSetId: string): Promise<void> {
  const ruleSet = await prisma.gstRuleSet.findUnique({ where: { id: gstRuleSetId } });
  if (!ruleSet) throw HttpError.badRequest('Unknown GST rule set');
}

export async function listHsns(
  filters: {
    search?: string;
    status?: HsnStatus;
    gstRuleSetId?: string;
  } & OptionalPageQuery,
) {
  const where: Prisma.HsnWhereInput = {
    status: filters.status,
    gstRuleSetId: filters.gstRuleSetId,
    OR: filters.search
      ? [
          { code: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  return listAllOrPage(filters, async (page) =>
    (
      await prisma.hsn.findMany({
        where,
        include: hsnInclude,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        ...page,
      })
    ).map(toHsnView),
  );
}

export async function getHsnDetail(id: string) {
  const hsn = await prisma.hsn.findUnique({ where: { id }, include: hsnInclude });
  if (!hsn) throw HttpError.notFound('HSN not found');
  return toHsnView(hsn);
}

// Option lookup for the Style form's HSN selector (INV-002 review
// correction: HSN master is now the canonical Style selection path). Every
// HSN, any status — mirrors listSeasonOptions's convention exactly: the
// web form offers ACTIVE ones for a *new* assignment but must still be
// able to render/keep an already-assigned INACTIVE one on an existing
// Style, so the status filtering happens client-side, not here.
export async function listHsnOptions() {
  return prisma.hsn.findMany({
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, description: true, status: true },
  });
}

// Minimal option lookup for the Style/Hsn forms' GST Rule Set selector —
// ACTIVE rule sets only, since a new HSN should not be pointed at a retired
// rule set (an existing assignment to an INACTIVE one is left alone; see
// updateHsn, which does not re-validate an unchanged gstRuleSetId).
export async function listGstRuleSetOptionsForHsn() {
  return prisma.gstRuleSet.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, status: true },
  });
}

export async function createHsn(
  actor: CurrentUser,
  input: { code: string; description?: string | null; status?: HsnStatus; gstRuleSetId?: string | null },
) {
  if (input.gstRuleSetId) {
    await assertGstRuleSetExists(input.gstRuleSetId);
  }

  const id = createId();
  try {
    await prisma.hsn.create({
      data: {
        id,
        code: input.code,
        description: input.description ?? null,
        status: input.status ?? 'ACTIVE',
        gstRuleSetId: input.gstRuleSetId ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(`HSN ${input.code} already exists`);
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'HSN_CREATED',
    entityType: 'Hsn',
    entityId: id,
    metadata: { code: input.code, gstRuleSetId: input.gstRuleSetId ?? null },
  });

  return getHsnDetail(id);
}

export async function updateHsn(
  actor: CurrentUser,
  id: string,
  input: { code?: string; description?: string | null; status?: HsnStatus; gstRuleSetId?: string | null },
) {
  const existing = await prisma.hsn.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('HSN not found');

  if (input.gstRuleSetId !== undefined && input.gstRuleSetId !== null && input.gstRuleSetId !== existing.gstRuleSetId) {
    await assertGstRuleSetExists(input.gstRuleSetId);
  }

  try {
    await prisma.hsn.update({
      where: { id },
      data: {
        code: input.code,
        description: input.description,
        status: input.status,
        gstRuleSetId: input.gstRuleSetId,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict(`HSN ${input.code} already exists`);
    }
    throw error;
  }

  // Historical tax-rule assignment changes must remain traceable (same bar
  // as PRICE_LIST_UPDATED) — before/after always captures gstRuleSetId even
  // when it is the only field that changed.
  await recordAuditLog({
    actorId: actor.id,
    action: 'HSN_UPDATED',
    entityType: 'Hsn',
    entityId: id,
    metadata: {
      before: {
        code: existing.code,
        description: existing.description,
        status: existing.status,
        gstRuleSetId: existing.gstRuleSetId,
      },
      after: {
        code: input.code ?? existing.code,
        description: input.description !== undefined ? input.description : existing.description,
        status: input.status ?? existing.status,
        gstRuleSetId: input.gstRuleSetId !== undefined ? input.gstRuleSetId : existing.gstRuleSetId,
      },
    },
  });

  return getHsnDetail(id);
}
