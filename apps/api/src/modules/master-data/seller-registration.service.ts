import { createId } from '@erve/shared';
import { Prisma, prisma, type SellerRegistrationStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { listAllOrPage, type OptionalPageQuery } from '../../utils/pagination.js';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function conflictError(): HttpError {
  return HttpError.conflict('A seller registration with this branch code or GSTIN already exists');
}

export async function listSellerRegistrations(
  filters: { status?: string; search?: string } & OptionalPageQuery,
) {
  return listAllOrPage(filters, (page) =>
    prisma.sellerRegistration.findMany({
      where: {
        status: filters.status as SellerRegistrationStatus | undefined,
        OR: filters.search
          ? [
              { branchCode: { contains: filters.search, mode: 'insensitive' } },
              { legalName: { contains: filters.search, mode: 'insensitive' } },
              { gstin: { contains: filters.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      // legalName is not unique; id breaks ties so cursor pages are stable.
      orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        branchCode: true,
        legalName: true,
        tradeName: true,
        gstin: true,
        city: true,
        state: true,
        status: true,
      },
      ...page,
    }),
  );
}

// ---------------------------------------------------------------------------
// Active-registration lookup (future AINV consumers)
// ---------------------------------------------------------------------------

const sellerRegistrationOptionSelect = {
  id: true,
  branchCode: true,
  legalName: true,
  tradeName: true,
  gstin: true,
  status: true,
} satisfies Prisma.SellerRegistrationSelect;

export type SellerRegistrationOption = Prisma.SellerRegistrationGetPayload<{
  select: typeof sellerRegistrationOptionSelect;
}>;

// Bounded search over ACTIVE registrations only — for future invoice-side
// selectors, never the full master.
export async function listSellerRegistrationOptions(filters: {
  search?: string;
  limit: number;
}): Promise<SellerRegistrationOption[]> {
  const search = filters.search || undefined;

  return prisma.sellerRegistration.findMany({
    where: {
      status: 'ACTIVE',
      OR: search
        ? [
            { branchCode: { contains: search, mode: 'insensitive' } },
            { legalName: { contains: search, mode: 'insensitive' } },
            { gstin: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
    select: sellerRegistrationOptionSelect,
    take: filters.limit,
  });
}

// The single active registration, when there is exactly one — the shape a
// future Tax Invoice flow can use to auto-select a seller identity without
// this master ever enforcing a singleton constraint. Returns null for the
// zero- or multiple-active cases; callers decide what to do about those,
// since that behavior is out of scope for this story.
export async function resolveSoleActiveSellerRegistration(): Promise<SellerRegistrationOption | null> {
  const active = await prisma.sellerRegistration.findMany({
    where: { status: 'ACTIVE' },
    select: sellerRegistrationOptionSelect,
    take: 2,
  });
  return active.length === 1 ? active[0]! : null;
}

export async function getSellerRegistrationById(id: string) {
  const registration = await prisma.sellerRegistration.findUnique({ where: { id } });
  if (!registration) {
    throw HttpError.notFound('Seller registration not found');
  }
  return registration;
}

export async function createSellerRegistration(
  actor: CurrentUser,
  input: Omit<Prisma.SellerRegistrationUncheckedCreateInput, 'id'>,
) {
  let registration;
  try {
    registration = await prisma.sellerRegistration.create({
      data: { id: createId(), status: 'ACTIVE', ...input },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflictError();
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'SELLER_REGISTRATION_CREATED',
    entityType: 'SellerRegistration',
    entityId: registration.id,
  });

  return registration;
}

export async function updateSellerRegistration(
  actor: CurrentUser,
  id: string,
  input: Record<string, unknown>,
) {
  let registration;
  try {
    registration = await prisma.sellerRegistration.update({
      where: { id },
      data: input as Prisma.SellerRegistrationUncheckedUpdateInput,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw HttpError.notFound('Seller registration not found');
    }
    if (isUniqueConstraintError(error)) {
      throw conflictError();
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'SELLER_REGISTRATION_UPDATED',
    entityType: 'SellerRegistration',
    entityId: id,
  });

  return registration;
}

export async function updateSellerRegistrationStatus(
  actor: CurrentUser,
  id: string,
  status: SellerRegistrationStatus,
) {
  const existing = await prisma.sellerRegistration.findUnique({ where: { id } });
  if (!existing) {
    throw HttpError.notFound('Seller registration not found');
  }

  const registration = await prisma.sellerRegistration.update({ where: { id }, data: { status } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'SELLER_REGISTRATION_STATUS_CHANGED',
    entityType: 'SellerRegistration',
    entityId: id,
    metadata: { from: existing.status, to: status },
  });

  return registration;
}
