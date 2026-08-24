import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { prisma, type UserStatus } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/jwt.js';

// Test users/roles live on top of the seeded reference data (roles), so
// only the per-test rows need clearing between tests.
export async function resetDatabase(): Promise<void> {
  // Integration tests must be self-contained after a fresh migration replay;
  // do not rely on development seeding for authorization reference data.
  for (const name of [
    'ADMIN',
    'MERCHANDISER',
    'FACTORY_USER',
    'QA_USER',
    'ACCOUNTANT',
    'DISTRIBUTOR',
    'SENIOR_MANAGEMENT',
  ] as const) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { id: createId(), name, description: `Integration test ${name} role` },
    });
  }
  await prisma.auditLog.deleteMany();
  // Repeated rework intentionally forms a historical chain where a reinspection
  // form points to cycle N and cycle N+1 points back to that form. PostgreSQL
  // cannot DELETE either side first, so the disposable test database clears the
  // related QA tables atomically. Production FKs remain restrictive.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "qa_inspection_sessions", "qa_size_inspection_forms", "qa_rework_tasks" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "qa_release_lines", "qa_releases", "quality_activity_executions", "final_quality_batch_allocations", "final_quality_batches" CASCADE',
  );
  await prisma.jobOrderStageStatus.deleteMany();
  await prisma.jobOrderLineSize.deleteMany();
  await prisma.jobOrderLine.deleteMany();
  await prisma.jobOrder.deleteMany();
  await prisma.distributorPurchaseOrderLineSize.deleteMany();
  await prisma.distributorPurchaseOrderLine.deleteMany();
  await prisma.distributorPurchaseOrder.deleteMany();
  await prisma.processFlowVersionStage.deleteMany();
  await prisma.processFlowVersion.deleteMany();
  await prisma.processFlow.deleteMany();
  await prisma.qualityFormComponent.deleteMany();
  await prisma.qualityFormSection.deleteMany();
  await prisma.qualityFormVersion.deleteMany();
  await prisma.qualityForm.deleteMany();
  await prisma.priceListLine.deleteMany();
  await prisma.priceList.deleteMany();
  await prisma.styleFactoryMapping.deleteMany();
  await prisma.styleSize.deleteMany();
  await prisma.styleImage.deleteMany();
  await prisma.file.deleteMany();
  await prisma.style.deleteMany();
  await prisma.season.deleteMany();
  await prisma.size.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.userDistributor.deleteMany();
  await prisma.userFactory.deleteMany();
  await prisma.user.deleteMany();
  await prisma.factory.deleteMany();
  await prisma.distributor.deleteMany();
}

export interface CreateTestUserOptions {
  email: string;
  mobile?: string;
  password: string;
  roles?: Role[];
  status?: UserStatus;
  authVersion?: number;
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
      authVersion: options.authVersion ?? 1,
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
  const token = signAccessToken({
    sub: userId,
    roles: options.roles ?? [],
    authVersion: options.authVersion ?? 1,
  });
  return { userId, token };
}

export async function createTestDistributor(overrides?: {
  code?: string;
  name?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}): Promise<{ id: string; code: string; name: string }> {
  const id = createId();
  const code = overrides?.code ?? `DIST-${id}`;
  const name = overrides?.name ?? 'Test Distributor';
  await prisma.distributor.create({
    data: { id, code, name, status: overrides?.status ?? 'ACTIVE' },
  });
  return { id, code, name };
}

export async function createTestFactory(overrides?: {
  code?: string;
  name?: string;
}): Promise<{ id: string; code: string; name: string }> {
  const id = createId();
  const code = overrides?.code ?? `FAC-${id}`;
  const name = overrides?.name ?? 'Test Factory';
  await prisma.factory.create({ data: { id, code, name } });
  return { id, code, name };
}
