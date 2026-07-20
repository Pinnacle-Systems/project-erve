import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { prisma, Prisma, type UserStatus } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { hashPassword } from '../../auth/password.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';

const userWithRelationsInclude = {
  userRoles: { include: { role: true } },
  userDistributors: { include: { distributor: true } },
  userFactories: { include: { factory: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userWithRelationsInclude }>;

export interface UserView {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  status: UserStatus;
  roles: Role[];
  distributors: Array<{ id: string; code: string; name: string }>;
  factories: Array<{ id: string; code: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}

function toUserView(user: UserWithRelations): UserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    status: user.status,
    roles: user.userRoles.map((userRole) => userRole.role.name as Role),
    distributors: user.userDistributors.map((mapping) => ({
      id: mapping.distributor.id,
      code: mapping.distributor.code,
      name: mapping.distributor.name,
    })),
    factories: user.userFactories.map((mapping) => ({
      id: mapping.factory.id,
      code: mapping.factory.code,
      name: mapping.factory.name,
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// Serializes the small set of operations that can leave the system with zero
// active administrators (role removal, deactivation) behind one global lock
// so concurrent last-admin mutations can't both see a stale "count > 1".
async function assertNotLastActiveAdmin(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-lockout', 0))::text`;
  const activeAdminCount = await tx.user.count({
    where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'ADMIN' } } } },
  });
  if (activeAdminCount <= 1) {
    throw HttpError.badRequest('This action would leave the system with no active administrator');
  }
}

export interface CreateUserInput {
  name: string;
  email: string;
  mobile?: string;
  password: string;
  roles: Role[];
}

export async function createUser(actor: CurrentUser, input: CreateUserInput): Promise<UserView> {
  const passwordHash = await hashPassword(input.password);
  const userId = createId();

  const roles = await prisma.role.findMany({ where: { name: { in: input.roles } } });

  if (roles.length !== input.roles.length) {
    throw HttpError.badRequest('One or more roles are invalid');
  }

  try {
    await prisma.user.create({
      data: {
        id: userId,
        name: input.name,
        email: input.email,
        mobile: input.mobile,
        passwordHash,
        userRoles: { create: roles.map((role) => ({ id: createId(), roleId: role.id })) },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A user with this email or mobile number already exists');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: userId,
  });

  return getUserById(userId);
}

export interface ListUsersFilters {
  search?: string;
  status?: UserStatus;
  role?: Role;
}

export async function listUsers(filters: ListUsersFilters = {}): Promise<UserView[]> {
  const users = await prisma.user.findMany({
    where: {
      status: filters.status,
      userRoles: filters.role ? { some: { role: { name: filters.role } } } : undefined,
      OR: filters.search
        ? [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    include: userWithRelationsInclude,
    orderBy: { createdAt: 'asc' },
  });
  return users.map(toUserView);
}

export async function getUserById(id: string): Promise<UserView> {
  const user = await prisma.user.findUnique({ where: { id }, include: userWithRelationsInclude });
  if (!user) {
    throw HttpError.notFound('User not found');
  }
  return toUserView(user);
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

// Profile fields only — roles, status, and mappings are changed through
// their own dedicated endpoints so a profile edit never silently touches them.
export async function updateUser(
  actor: CurrentUser,
  userId: string,
  input: UpdateUserInput,
): Promise<UserView> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    throw HttpError.notFound('User not found');
  }

  if (input.email && input.email !== existing.email) {
    const emailTaken = await prisma.user.findFirst({
      where: { email: input.email, NOT: { id: userId } },
    });
    if (emailTaken) {
      throw HttpError.conflict('A user with this email already exists');
    }
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { name: input.name, email: input.email },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('A user with this email already exists');
    }
    throw error;
  }

  const changes: Record<string, { from: string; to: string }> = {};
  if (input.name && input.name !== existing.name) {
    changes.name = { from: existing.name, to: input.name };
  }
  if (input.email && input.email !== existing.email) {
    changes.email = { from: existing.email, to: input.email };
  }

  if (Object.keys(changes).length > 0) {
    await recordAuditLog({
      actorId: actor.id,
      action: 'USER_PROFILE_UPDATED',
      entityType: 'User',
      entityId: userId,
      metadata: changes,
    });
  }

  return getUserById(userId);
}

export async function updateUserStatus(
  actor: CurrentUser,
  userId: string,
  status: UserStatus,
): Promise<UserView> {
  const now = new Date();
  let previousStatus: UserStatus | undefined;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('user_status:' || ${userId}, 0))::text`;

    const existing = await tx.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!existing) {
      throw HttpError.notFound('User not found');
    }
    previousStatus = existing.status;

    const isDeactivating = existing.status === 'ACTIVE' && status !== 'ACTIVE';

    if (isDeactivating) {
      if (actor.id === userId) {
        throw HttpError.badRequest('You cannot deactivate your own account');
      }
      const isAdmin = existing.userRoles.some((userRole) => userRole.role.name === 'ADMIN');
      if (isAdmin) {
        await assertNotLastActiveAdmin(tx);
      }
    }

    await tx.user.update({ where: { id: userId }, data: { status } });

    if (isDeactivating) {
      // Blocks refresh/session continuation immediately; requireAuth already
      // rejects the (short-lived) access token on its next per-request re-check.
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: userId,
    metadata: { from: previousStatus, to: status },
  });

  return getUserById(userId);
}

export async function resetPassword(
  actor: CurrentUser,
  userId: string,
  newPassword: string,
): Promise<UserView> {
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  // authVersion is bumped with Prisma's atomic `increment`, not a
  // read-then-write of a previously fetched value, so concurrent resets on
  // the same user serialize on the row and both increments are preserved —
  // no explicit advisory lock is needed for that part. Validating the user,
  // hashing in the new password, bumping the version, revoking sessions, and
  // writing the audit record all happen in one transaction so a failure
  // (including a failed audit insert) leaves none of them applied.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw HttpError.notFound('User not found');
    }

    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    await tx.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: userId,
      },
      tx,
    );
  });

  return getUserById(userId);
}

export async function assignRole(
  actor: CurrentUser,
  userId: string,
  roleName: Role,
): Promise<UserView> {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    }),
    prisma.role.findUnique({ where: { name: roleName } }),
  ]);

  if (!user) {
    throw HttpError.notFound('User not found');
  }
  if (!role) {
    throw HttpError.badRequest('Unknown role');
  }

  try {
    await prisma.userRole.create({ data: { id: createId(), userId, roleId: role.id } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('User already has this role');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'ROLE_ASSIGNED',
    entityType: 'User',
    entityId: userId,
    metadata: { role: roleName },
  });

  return getUserById(userId);
}

export async function removeRole(
  actor: CurrentUser,
  userId: string,
  roleName: Role,
): Promise<UserView> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw HttpError.badRequest('Unknown role');
  }

  await prisma.$transaction(async (tx) => {
    // Serializes concurrent role changes for this user (e.g. two admins
    // removing different roles from the same user at once).
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('user_roles:' || ${userId}, 0))::text`;

    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!user) {
      throw HttpError.notFound('User not found');
    }

    const currentRoles = user.userRoles.map((userRole) => userRole.role.name);
    if (!currentRoles.includes(roleName)) {
      throw HttpError.notFound('User does not have this role');
    }
    if (currentRoles.length === 1) {
      throw HttpError.badRequest('A user must have at least one role');
    }

    if (roleName === 'DISTRIBUTOR') {
      const mappingCount = await tx.userDistributor.count({ where: { userId } });
      if (mappingCount > 0) {
        throw HttpError.badRequest(
          'Remove the distributor mapping before removing the DISTRIBUTOR role',
        );
      }
    }
    if (roleName === 'FACTORY_USER') {
      const mappingCount = await tx.userFactory.count({ where: { userId } });
      if (mappingCount > 0) {
        throw HttpError.badRequest(
          'Remove all factory mappings before removing the FACTORY_USER role',
        );
      }
    }

    if (roleName === 'ADMIN') {
      if (actor.id === userId) {
        throw HttpError.badRequest('You cannot remove your own ADMIN role');
      }
      if (user.status === 'ACTIVE') {
        await assertNotLastActiveAdmin(tx);
      }
    }

    await tx.userRole.deleteMany({ where: { userId, roleId: role.id } });
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'ROLE_REMOVED',
    entityType: 'User',
    entityId: userId,
    metadata: { role: roleName },
  });

  return getUserById(userId);
}

export async function addDistributorMapping(
  actor: CurrentUser,
  userId: string,
  distributorId: string,
): Promise<UserView> {
  const [user, distributor] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    }),
    prisma.distributor.findUnique({ where: { id: distributorId } }),
  ]);

  if (!user) {
    throw HttpError.notFound('User not found');
  }
  if (!user.userRoles.some((userRole) => userRole.role.name === 'DISTRIBUTOR')) {
    throw HttpError.badRequest(
      'Only users with the DISTRIBUTOR role can be mapped to a distributor',
    );
  }
  if (!distributor) {
    throw HttpError.badRequest('Unknown distributor');
  }
  if (distributor.status !== 'ACTIVE') {
    throw HttpError.badRequest('Cannot map a user to an inactive distributor');
  }

  // A distributor user belongs to exactly one distributor. The schema only
  // guarantees uniqueness per (user, distributor) pair, so the one-mapping
  // rule is enforced here: a per-user advisory lock serializes concurrent
  // assignment attempts and the check-then-insert runs in one transaction.
  await prisma.$transaction(async (tx) => {
    // ::text because the pg adapter cannot deserialize the function's void return
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('user_distributor:' || ${userId}, 0))::text`;

    const existing = await tx.userDistributor.findFirst({ where: { userId } });
    if (existing) {
      throw existing.distributorId === distributorId
        ? HttpError.conflict('User is already mapped to this distributor')
        : HttpError.conflict('User is already mapped to a different distributor');
    }

    await tx.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'DISTRIBUTOR_MAPPING_ADDED',
    entityType: 'User',
    entityId: userId,
    metadata: { distributorId },
  });

  return getUserById(userId);
}

export async function removeDistributorMapping(
  actor: CurrentUser,
  userId: string,
  distributorId: string,
): Promise<UserView> {
  const deleted = await prisma.userDistributor.deleteMany({ where: { userId, distributorId } });
  if (deleted.count === 0) {
    throw HttpError.notFound('User is not mapped to this distributor');
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'DISTRIBUTOR_MAPPING_REMOVED',
    entityType: 'User',
    entityId: userId,
    metadata: { distributorId },
  });

  return getUserById(userId);
}

export async function addFactoryMapping(
  actor: CurrentUser,
  userId: string,
  factoryId: string,
): Promise<UserView> {
  const [user, factory] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: { select: { name: true } } } } },
    }),
    prisma.factory.findUnique({ where: { id: factoryId } }),
  ]);

  if (!user) {
    throw HttpError.notFound('User not found');
  }
  if (!user.userRoles.some(({ role }) => role.name === 'FACTORY_USER')) {
    throw HttpError.badRequest('Only users with the FACTORY_USER role can be mapped to a factory');
  }
  if (user.status !== 'ACTIVE') {
    throw HttpError.badRequest('Only active users can be mapped to a factory');
  }
  if (!factory) {
    throw HttpError.badRequest('Unknown factory');
  }
  if (factory.status !== 'ACTIVE') {
    throw HttpError.badRequest('Cannot map a user to an inactive factory');
  }

  try {
    await prisma.userFactory.create({ data: { id: createId(), userId, factoryId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('User is already mapped to this factory');
    }
    throw error;
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'FACTORY_MAPPING_ADDED',
    entityType: 'User',
    entityId: userId,
    metadata: { factoryId },
  });

  return getUserById(userId);
}

export async function removeFactoryMapping(
  actor: CurrentUser,
  userId: string,
  factoryId: string,
): Promise<UserView> {
  const deleted = await prisma.userFactory.deleteMany({ where: { userId, factoryId } });
  if (deleted.count === 0) {
    throw HttpError.notFound('User is not mapped to this factory');
  }

  await recordAuditLog({
    actorId: actor.id,
    action: 'FACTORY_MAPPING_REMOVED',
    entityType: 'User',
    entityId: userId,
    metadata: { factoryId },
  });

  return getUserById(userId);
}
