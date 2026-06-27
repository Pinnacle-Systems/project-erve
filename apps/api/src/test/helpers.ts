import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import type { UserStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/jwt.js';

// Test users/roles live on top of the seeded reference data (roles), so
// only the per-test rows need clearing between tests.
export async function resetDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.userDistributor.deleteMany();
  await prisma.userFactory.deleteMany();
  await prisma.user.deleteMany();
}

export interface CreateTestUserOptions {
  email: string;
  mobile?: string;
  password: string;
  roles?: Role[];
  status?: UserStatus;
}

export async function createTestUser(options: CreateTestUserOptions): Promise<string> {
  const passwordHash = await hashPassword(options.password);
  const userId = createId();

  const roles = options.roles?.length
    ? await prisma.role.findMany({ where: { name: { in: options.roles } } })
    : [];

  await prisma.user.create({
    data: {
      id: userId,
      email: options.email,
      mobile: options.mobile,
      name: 'Test User',
      passwordHash,
      status: options.status ?? 'ACTIVE',
      userRoles: roles.length
        ? { create: roles.map((role) => ({ id: createId(), roleId: role.id })) }
        : undefined,
    },
  });

  return userId;
}

// Issues a valid access token directly for a given user/roles, bypassing
// the HTTP login round trip — useful for tests that only need an
// authenticated caller, not to exercise login itself.
export async function createTestUserAndToken(
  options: CreateTestUserOptions,
): Promise<{ userId: string; token: string }> {
  const userId = await createTestUser(options);
  const token = signAccessToken({ sub: userId, roles: options.roles ?? [] });
  return { userId, token };
}
