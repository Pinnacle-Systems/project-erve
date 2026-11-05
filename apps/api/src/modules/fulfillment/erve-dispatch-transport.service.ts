import {
  canEditErveDispatchTransport,
  canManageErveDispatchAssignment,
  hasExclusiveTransporterRole,
} from '@erve/shared';
import type { ErveDispatchTransportView, Role } from '@erve/types';
import { prisma, type Prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';

type Client = Prisma.TransactionClient;
const unavailable = () => HttpError.notFound('Dispatch transport information is unavailable');
const transportSelect = {
  id: true,
  erveDispatchNumber: true,
  dispatchDate: true,
  status: true,
  transporter: true,
  vehicleNumber: true,
  lrNumber: true,
  version: true,
  lrUpdatedAt: true,
  transporterUserId: true,
} satisfies Prisma.ErveDispatchSelect;
type TransportRecord = Prisma.ErveDispatchGetPayload<{ select: typeof transportSelect }>;
const accountSelect = {
  id: true,
  name: true,
  status: true,
  authVersion: true,
  userRoles: { select: { role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

// Each boundary reloads current permissions; no assignment or role is trusted from a JWT.
async function currentTransportActor(client: Client, actor: CurrentUser) {
  if (!canEditErveDispatchTransport(actor))
    throw HttpError.forbidden('Transport access is unavailable');
  const account = await client.user.findUnique({ where: { id: actor.id }, select: accountSelect });
  const roles = account?.userRoles.map((entry) => entry.role.name as Role) ?? [];
  const current = { roles };
  if (
    !account ||
    account.status !== 'ACTIVE' ||
    account.authVersion !== actor.authVersion ||
    !canEditErveDispatchTransport(current)
  ) {
    throw HttpError.forbidden('Transport access is unavailable');
  }
  if (hasExclusiveTransporterRole(actor) !== hasExclusiveTransporterRole(current)) {
    throw HttpError.forbidden('Transport access is unavailable');
  }
  return current;
}

// The last restricted SELECT checks account eligibility and assignment together.
// No separate async account check may follow this query before returning its DTO.
function currentAssignmentWhere(actor: CurrentUser): Prisma.ErveDispatchWhereInput {
  return {
    transporterUserId: actor.id,
    transporterUser: {
      is: {
        id: actor.id,
        status: 'ACTIVE',
        authVersion: actor.authVersion,
        userRoles: {
          some: { role: { name: 'TRANSPORTER' } },
          every: { role: { name: 'TRANSPORTER' } },
        },
      },
    },
  };
}

function toTransportView(record: TransportRecord): ErveDispatchTransportView {
  return {
    id: record.id,
    erveDispatchNumber: record.erveDispatchNumber,
    dispatchDate: record.dispatchDate.toISOString(),
    status: record.status,
    transporter: record.transporter,
    vehicleNumber: record.vehicleNumber,
    lrNumber: record.lrNumber,
    version: record.version,
    lrUpdatedAt: record.lrUpdatedAt?.toISOString() ?? null,
  };
}

export async function getDispatchTransport(
  actor: CurrentUser,
  id: string,
): Promise<ErveDispatchTransportView> {
  const current = await currentTransportActor(prisma, actor);
  const restricted = hasExclusiveTransporterRole(current);
  const record = await prisma.erveDispatch.findFirst({
    where: { id, ...(restricted ? { transporterUserId: actor.id } : {}) },
    select: transportSelect,
  });
  if (!record || (restricted && record.transporterUserId !== actor.id)) throw unavailable();
  const result = toTransportView(record);
  if (!restricted) {
    const assigned = record.transporterUserId
      ? await prisma.user.findUnique({
          where: { id: record.transporterUserId },
          select: { id: true, name: true },
        })
      : null;
    result.transporterAssignment = assigned;
  }
  await currentTransportActor(prisma, actor);
  if (restricted) {
    const currentRecord = await prisma.erveDispatch.findFirst({
      where: { id, ...currentAssignmentWhere(actor) },
      select: transportSelect,
    });
    if (!currentRecord || currentRecord.transporterUserId !== actor.id) throw unavailable();
    return toTransportView(currentRecord);
  }
  return result;
}

export async function listAssignedTransport(
  actor: CurrentUser,
  filters: { limit: number; cursor?: string },
) {
  if (!hasExclusiveTransporterRole(await currentTransportActor(prisma, actor)))
    throw HttpError.forbidden();
  const limit = Math.max(1, Math.min(100, filters.limit));
  const records = await prisma.erveDispatch.findMany({
    where: currentAssignmentWhere(actor),
    select: transportSelect,
    orderBy: { id: 'desc' },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = records.length > limit;
  const page = records.slice(0, limit);
  return {
    items: page.map(toTransportView),
    pageInfo: { limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function listTransporterOptions(
  actor: CurrentUser,
  filters: { limit: number; search?: string },
) {
  if (!canManageErveDispatchAssignment(await currentTransportActor(prisma, actor)))
    throw HttpError.forbidden();
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      userRoles: {
        some: { role: { name: 'TRANSPORTER' } },
        every: { role: { name: 'TRANSPORTER' } },
      },
      ...(filters.search
        ? { name: { contains: filters.search, mode: 'insensitive' as const } }
        : {}),
    },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(50, filters.limit)),
  });
}

export interface TransportUpdateInput {
  expectedVersion: number;
  transporter?: string | null;
  vehicleNumber?: string | null;
  lrNumber?: string | null;
}

export async function updateDispatchTransport(
  actor: CurrentUser,
  id: string,
  input: TransportUpdateInput,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;
    const current = await currentTransportActor(tx, actor);
    const restricted = hasExclusiveTransporterRole(current);
    const dispatch = await tx.erveDispatch.findUnique({ where: { id }, select: transportSelect });
    if (!dispatch || (restricted && dispatch.transporterUserId !== actor.id)) throw unavailable();
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    const updated = await tx.erveDispatch.updateMany({
      where: {
        id,
        version: input.expectedVersion,
        ...(restricted ? { transporterUserId: actor.id } : {}),
      },
      data: {
        transporter: input.transporter,
        vehicleNumber: input.vehicleNumber,
        lrNumber: input.lrNumber,
        lrUpdatedById: actor.id,
        lrUpdatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_LR_UPDATED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: { erveDispatchNumber: dispatch.erveDispatchNumber },
      },
      tx,
    );
  });
  return getDispatchTransport(actor, id);
}

export async function assignDispatchTransporter(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; transporterUserId: string | null },
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;
    if (!canManageErveDispatchAssignment(await currentTransportActor(tx, actor)))
      throw HttpError.forbidden();
    const dispatch = await tx.erveDispatch.findUnique({ where: { id }, select: transportSelect });
    if (!dispatch) throw unavailable();
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (input.transporterUserId) {
      const target = await tx.user.findUnique({
        where: { id: input.transporterUserId },
        select: accountSelect,
      });
      if (
        !target ||
        target.status !== 'ACTIVE' ||
        !hasExclusiveTransporterRole({
          roles: target.userRoles.map((entry) => entry.role.name as Role),
        })
      ) {
        throw HttpError.badRequest('Select an active account with only the TRANSPORTER role');
      }
    }
    if (dispatch.transporterUserId === input.transporterUserId) return;
    const updated = await tx.erveDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: { transporterUserId: input.transporterUserId, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_TRANSPORTER_ASSIGNED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: {
          erveDispatchNumber: dispatch.erveDispatchNumber,
          from: dispatch.transporterUserId,
          to: input.transporterUserId,
        },
      },
      tx,
    );
  });
  return getDispatchTransport(actor, id);
}
