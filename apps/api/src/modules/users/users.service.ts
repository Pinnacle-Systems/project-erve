import { Prisma, type UserStatus } from '@prisma/client';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { prisma } from '../../db/prisma.js';
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

export interface CreateUserInput {
  name: string;
  email: string;
  mobile?: string;
  password: string;
  roles?: Role[];
}

export async function createUser(actor: CurrentUser, input: CreateUserInput): Promise<UserView> {
  const passwordHash = await hashPassword(input.password);
  const userId = createId();

  const roles = input.roles?.length
    ? await prisma.role.findMany({ where: { name: { in: input.roles } } })
    : [];

  if (input.roles?.length && roles.length !== input.roles.length) {
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
        userRoles: roles.length
          ? { create: roles.map((role) => ({ id: createId(), roleId: role.id })) }
          : undefined,
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

export async function listUsers(): Promise<UserView[]> {
  const users = await prisma.user.findMany({
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

export async function updateUserStatus(
  actor: CurrentUser,
  userId: string,
  status: UserStatus,
): Promise<UserView> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    throw HttpError.notFound('User not found');
  }

  await prisma.user.update({ where: { id: userId }, data: { status } });

  await recordAuditLog({
    actorId: actor.id,
    action: 'USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: userId,
    metadata: { from: existing.status, to: status },
  });

  return getUserById(userId);
}

export async function assignRole(actor: CurrentUser, userId: string, roleName: Role): Promise<UserView> {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
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

export async function removeRole(actor: CurrentUser, userId: string, roleName: Role): Promise<UserView> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw HttpError.badRequest('Unknown role');
  }

  const deleted = await prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
  if (deleted.count === 0) {
    throw HttpError.notFound('User does not have this role');
  }

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
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.distributor.findUnique({ where: { id: distributorId } }),
  ]);

  if (!user) {
    throw HttpError.notFound('User not found');
  }
  if (!distributor) {
    throw HttpError.badRequest('Unknown distributor');
  }

  try {
    await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw HttpError.conflict('User is already mapped to this distributor');
    }
    throw error;
  }

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
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.factory.findUnique({ where: { id: factoryId } }),
  ]);

  if (!user) {
    throw HttpError.notFound('User not found');
  }
  if (!factory) {
    throw HttpError.badRequest('Unknown factory');
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
