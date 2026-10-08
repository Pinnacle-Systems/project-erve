import {
  createId,
  hasAnyRole,
  RETAIL_STORE_MANAGE_ROLES,
  RETAIL_STORE_VIEW_ROLES,
} from '@erve/shared';
import type { z } from 'zod';
import { prisma, Prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { listAllOrPage } from '../../utils/pagination.js';
import type {
  createRetailStoreSchema,
  updateRetailStoreSchema,
  listRetailStoresSchema,
  retailStoreOptionsSchema,
} from './retail-stores.validation.js';

function assertAccess(actor: CurrentUser, mutation = false) {
  if (!hasAnyRole(actor, mutation ? RETAIL_STORE_MANAGE_ROLES : RETAIL_STORE_VIEW_ROLES))
    throw HttpError.forbidden();
}
const include = { distributor: { select: { id: true, code: true, name: true } } };
function searchWhere(search?: string): Prisma.RetailStoreWhereInput {
  return search
    ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
}
export async function listRetailStores(
  actor: CurrentUser,
  query: z.infer<typeof listRetailStoresSchema>,
) {
  assertAccess(actor);
  return listAllOrPage(query, (page) =>
    prisma.retailStore.findMany({
      where: {
        distributorId: query.distributorId,
        status: query.status,
        ...searchWhere(query.search),
      },
      include,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...page,
    }),
  );
}
export async function retailStoreOptions(
  actor: CurrentUser,
  query: z.infer<typeof retailStoreOptionsSchema>,
) {
  assertAccess(actor);
  return prisma.retailStore.findMany({
    where: { distributorId: query.distributorId, status: 'ACTIVE', ...searchWhere(query.search) },
    take: query.limit,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}
export async function getRetailStore(actor: CurrentUser, id: string) {
  assertAccess(actor);
  const store = await prisma.retailStore.findUnique({ where: { id }, include });
  if (!store) throw HttpError.notFound('Retail Store not found');
  return store;
}
async function withDuplicateGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw HttpError.conflict('Store Code must be unique within this Distributor');
    throw error;
  }
}
export async function createRetailStore(
  actor: CurrentUser,
  input: z.infer<typeof createRetailStoreSchema>,
) {
  assertAccess(actor, true);
  return withDuplicateGuard(() =>
    prisma.$transaction(async (tx) => {
      const distributor = await tx.distributor.findUnique({ where: { id: input.distributorId } });
      if (!distributor) throw HttpError.badRequest('Distributor not found');
      const store = await tx.retailStore.create({ data: { id: createId(), ...input }, include });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'retail_store.created',
          entityType: 'RetailStore',
          entityId: store.id,
          metadata: { after: input },
        },
        tx,
      );
      return store;
    }),
  );
}
export async function updateRetailStore(
  actor: CurrentUser,
  id: string,
  input: z.infer<typeof updateRetailStoreSchema>,
) {
  assertAccess(actor, true);
  return withDuplicateGuard(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-store-${id}`}))`;
      const before = await tx.retailStore.findUnique({ where: { id } });
      if (!before) throw HttpError.notFound('Retail Store not found');
      const store = await tx.retailStore.update({ where: { id }, data: input, include });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'retail_store.updated',
          entityType: 'RetailStore',
          entityId: id,
          metadata: { before: JSON.parse(JSON.stringify(before)), changes: input },
        },
        tx,
      );
      return store;
    }),
  );
}
