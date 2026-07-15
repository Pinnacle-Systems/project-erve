import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@erve/shared';
import { ROLES } from '@erve/types';
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { resetDatabase } from '../test/helpers.js';
import { ROLE_DESCRIPTIONS } from './roles.js';
import {
  runAdminBootstrap,
  AdminBootstrapError,
  type AdminBootstrapOptions,
  type AdminBootstrapPrismaClient,
} from './admin-bootstrap.js';

const DB_URL = 'postgresql://erve_app:super-secret-pw@10.0.0.5:5432/erve_production?schema=public';

function baseOptions(overrides: Partial<AdminBootstrapOptions> = {}): AdminBootstrapOptions {
  return {
    email: 'admin@example.test',
    name: 'Bootstrap Admin',
    resetPassword: false,
    nodeEnv: 'test',
    confirmProduction: false,
    getPassword: async () => 'correct-horse-battery',
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  // Deliberately does NOT delete the `roles` table — like the rest of the
  // suite (see test/helpers.ts), Role rows are shared reference data that
  // other test files depend on already being seeded. admin-bootstrap's own
  // ADMIN-role upsert is idempotent by design, so these tests are valid
  // whether or not the ADMIN role already exists going in — the dedicated
  // "rolls back the whole transaction" test below exercises the
  // role-does-not-exist-yet path explicitly and self-contained instead.
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('runAdminBootstrap', () => {
  it('creates an admin when no matching user exists', async () => {
    const result = await runAdminBootstrap(baseOptions(), { databaseUrl: DB_URL });

    expect(result.outcome).toBe('created');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    expect(user.name).toBe('Bootstrap Admin');
    expect(user.status).toBe('ACTIVE');
    expect(await verifyPassword('correct-horse-battery', user.passwordHash)).toBe(true);

    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(['ADMIN']);
  });

  it('ensures every supported role exists, not only ADMIN — a fresh production database starts with an empty roles table', async () => {
    // users.service.ts's createUser/assignRole both expect the Role row to
    // already exist (they 400 rather than creating one on demand), so
    // admin-bootstrap must leave every role usable, not just the one it
    // assigns to the admin user itself.
    await runAdminBootstrap(baseOptions(), { databaseUrl: DB_URL });

    const roles = await prisma.role.findMany();
    expect(roles.map((r) => r.name).sort()).toEqual(
      ['ACCOUNTANT', 'ADMIN', 'DISTRIBUTOR', 'FACTORY_USER', 'MERCHANDISER', 'QA_USER', 'SENIOR_MANAGEMENT'].sort(),
    );
  });

  it('running again does not create a duplicate user', async () => {
    await runAdminBootstrap(baseOptions(), { databaseUrl: DB_URL });

    const result = await runAdminBootstrap(baseOptions(), { databaseUrl: DB_URL });

    expect(result.outcome).toBe('already_configured');
    const users = await prisma.user.findMany({ where: { email: 'admin@example.test' } });
    expect(users).toHaveLength(1);
  });

  it("leaves an existing admin's password unchanged without --reset-password", async () => {
    await runAdminBootstrap(baseOptions(), { databaseUrl: DB_URL });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });

    const result = await runAdminBootstrap(
      baseOptions({
        getPassword: async () => {
          throw new Error('must not be called when no password change is needed');
        },
      }),
      { databaseUrl: DB_URL },
    );

    expect(result.outcome).toBe('already_configured');
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('adds the ADMIN role to an existing user who lacks it, without touching their password', async () => {
    const passwordHash = await hashPassword('original-password123');
    const userId = createId();
    await prisma.user.create({
      data: { id: userId, email: 'staff@example.test', name: 'Staff Member', passwordHash, status: 'ACTIVE' },
    });

    const result = await runAdminBootstrap(
      baseOptions({
        email: 'staff@example.test',
        name: 'Staff Member',
        getPassword: async () => {
          throw new Error('must not be called without --reset-password');
        },
      }),
      { databaseUrl: DB_URL },
    );

    expect(result.outcome).toBe('role_added');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe(passwordHash);

    const roles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(['ADMIN']);
  });

  it('does not duplicate the role mapping when run again after the role was added', async () => {
    const passwordHash = await hashPassword('original-password123');
    const userId = createId();
    await prisma.user.create({
      data: { id: userId, email: 'staff@example.test', name: 'Staff Member', passwordHash, status: 'ACTIVE' },
    });

    await runAdminBootstrap(baseOptions({ email: 'staff@example.test', name: 'Staff Member' }), {
      databaseUrl: DB_URL,
    });
    const second = await runAdminBootstrap(baseOptions({ email: 'staff@example.test', name: 'Staff Member' }), {
      databaseUrl: DB_URL,
    });

    expect(second.outcome).toBe('already_configured');
    const roles = await prisma.userRole.findMany({ where: { userId } });
    expect(roles).toHaveLength(1);
  });

  it('ensures all 7 roles even when the admin is already fully configured and only the ADMIN role row exists', async () => {
    // Reproduces a database bootstrapped by an older version of this
    // command (or roles otherwise pruned down to just ADMIN): the admin
    // user already exists, already has the ADMIN role, and nothing about
    // the user needs to change — but every non-ADMIN role row is missing.
    // Before the fix, the "already configured" path never called
    // ensureAllRoles at all, so this state would persist forever.
    const passwordHash = await hashPassword('original-password123');
    const userId = createId();
    const adminRole = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { id: createId(), name: 'ADMIN', description: 'Full administrative access' },
    });
    await prisma.user.create({
      data: { id: userId, email: 'admin@example.test', name: 'Bootstrap Admin', passwordHash, status: 'ACTIVE' },
    });
    const userRoleId = createId();
    await prisma.userRole.create({ data: { id: userRoleId, userId, roleId: adminRole.id } });

    const otherRoles = [...ROLES].filter((name) => name !== 'ADMIN');
    // Temporarily remove every non-ADMIN role to reproduce "only ADMIN
    // exists". Safe here because this test runs synchronously start to
    // finish on the shared local test database, and the fix under test
    // (ensureAllRoles running unconditionally, even on the "already
    // configured" path) recreates them before any assertion runs. The
    // `finally` block is a belt-and-suspenders restore in case the call
    // itself throws first — this reference-data table must never be left
    // short a role for the tests that run after this one (see the
    // beforeEach comment above for why that rule exists).
    await prisma.role.deleteMany({ where: { name: { in: otherRoles } } });

    try {
      const result = await runAdminBootstrap(
        baseOptions({
          getPassword: async () => {
            throw new Error('must not be called — an already-configured admin never needs a password');
          },
        }),
        { databaseUrl: DB_URL },
      );

      expect(result.outcome).toBe('already_configured');
      expect(result.rolesEnsured.sort()).toEqual(otherRoles.sort());

      const roles = await prisma.role.findMany();
      expect(roles.map((r) => r.name).sort()).toEqual([...ROLES].sort());

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.id).toBe(userId);
      expect(user.passwordHash).toBe(passwordHash);
      expect(user.status).toBe('ACTIVE');

      const userRoles = await prisma.userRole.findMany({ where: { userId } });
      expect(userRoles).toHaveLength(1);
      expect(userRoles[0]?.id).toBe(userRoleId);
      expect(userRoles[0]?.roleId).toBe(adminRole.id);
    } finally {
      for (const name of otherRoles) {
        await prisma.role.upsert({
          where: { name },
          update: {},
          create: { id: createId(), name, description: ROLE_DESCRIPTIONS[name] },
        });
      }
    }
  });

  it('changes the password hash when --reset-password is supplied', async () => {
    await runAdminBootstrap(baseOptions({ getPassword: async () => 'first-password123' }), {
      databaseUrl: DB_URL,
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });

    const result = await runAdminBootstrap(
      baseOptions({ resetPassword: true, getPassword: async () => 'second-password456' }),
      { databaseUrl: DB_URL },
    );

    expect(result.outcome).toBe('password_reset');
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword('second-password456', after.passwordHash)).toBe(true);
    expect(await verifyPassword('first-password123', after.passwordHash)).toBe(false);
  });

  it('rejects missing/invalid required input without touching the database', async () => {
    await expect(runAdminBootstrap(baseOptions({ email: 'not-an-email' }), { databaseUrl: DB_URL })).rejects.toThrow(
      AdminBootstrapError,
    );
    await expect(runAdminBootstrap(baseOptions({ name: '' }), { databaseUrl: DB_URL })).rejects.toThrow(
      AdminBootstrapError,
    );
    await expect(
      runAdminBootstrap(baseOptions({ getPassword: async () => 'short' }), { databaseUrl: DB_URL }),
    ).rejects.toThrow(AdminBootstrapError);

    await expect(prisma.user.findUnique({ where: { email: 'admin@example.test' } })).resolves.toBeNull();
  });

  it('requires --confirm-production in production and never touches the database first', async () => {
    await expect(
      runAdminBootstrap(baseOptions({ nodeEnv: 'production', confirmProduction: false }), { databaseUrl: DB_URL }),
    ).rejects.toThrow(AdminBootstrapError);

    await expect(prisma.user.findUnique({ where: { email: 'admin@example.test' } })).resolves.toBeNull();
  });

  it('the production guard names the DB target but never the password', async () => {
    await expect(
      runAdminBootstrap(baseOptions({ nodeEnv: 'production', confirmProduction: false }), { databaseUrl: DB_URL }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('erve_production on 10.0.0.5:5432'),
    });

    try {
      await runAdminBootstrap(baseOptions({ nodeEnv: 'production', confirmProduction: false }), {
        databaseUrl: DB_URL,
      });
      expect.unreachable('expected the production guard to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret-pw');
      expect(message).not.toContain('erve_app');
    }
  });

  it('succeeds in production once --confirm-production is supplied', async () => {
    const result = await runAdminBootstrap(baseOptions({ nodeEnv: 'production', confirmProduction: true }), {
      databaseUrl: DB_URL,
    });
    expect(result.outcome).toBe('created');
  });

  it('email lookup is an exact match, matching the login flow (no normalization)', async () => {
    await runAdminBootstrap(baseOptions({ email: 'Mixed.Case@Example.test' }), { databaseUrl: DB_URL });

    const exactMatch = await runAdminBootstrap(baseOptions({ email: 'Mixed.Case@Example.test' }), {
      databaseUrl: DB_URL,
    });
    expect(exactMatch.outcome).toBe('already_configured');

    // apps/api/src/modules/auth/auth.service.ts looks up
    // `{ email: identifier }` with no case transform — this command must
    // match that exactly rather than inventing its own normalization.
    const differentCase = await runAdminBootstrap(
      baseOptions({ email: 'mixed.case@example.test', getPassword: async () => 'another-password1' }),
      { databaseUrl: DB_URL },
    );
    expect(differentCase.outcome).toBe('created');

    const users = await prisma.user.findMany({ where: { name: 'Bootstrap Admin' } });
    expect(users).toHaveLength(2);
  });

  it('refuses a non-ACTIVE account without changing its status or writing anything else — including no role-reference ensure', async () => {
    const passwordHash = await hashPassword('irrelevant-password');
    await prisma.user.create({
      data: {
        id: createId(),
        email: 'suspended@example.test',
        name: 'Suspended User',
        passwordHash,
        status: 'SUSPENDED',
      },
    });
    const rolesBefore = await prisma.role.count();

    await expect(
      runAdminBootstrap(baseOptions({ email: 'suspended@example.test' }), { databaseUrl: DB_URL }),
    ).rejects.toThrow(AdminBootstrapError);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'suspended@example.test' } });
    expect(user.status).toBe('SUSPENDED');
    // Deliberate design choice, not an oversight: a refusal makes zero
    // database writes, full stop — see the comment in admin-bootstrap.ts
    // above the non-ACTIVE check for the reasoning.
    await expect(prisma.role.count()).resolves.toBe(rolesBefore);
  });

  it('rolls back the whole transaction — no partial user/role state — when a write fails mid-transaction', async () => {
    const passwordHash = await hashPassword('original-password123');
    const userId = createId();
    await prisma.user.create({
      data: { id: userId, email: 'race@example.test', name: 'Race Condition', passwordHash, status: 'ACTIVE' },
    });
    const adminRole = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { id: createId(), name: 'ADMIN', description: 'Full administrative access' },
    });
    // The role mapping already exists at the DB level. The fake client
    // below reports it as absent (a stale read), forcing runAdminBootstrap
    // down the "add the role" path — so the real tx.userRole.create() call
    // hits a genuine Postgres unique-constraint violation partway through
    // the transaction. This exercises real transaction rollback rather
    // than a mocked one.
    await prisma.userRole.create({ data: { id: createId(), userId, roleId: adminRole.id } });

    const staleReadClient: AdminBootstrapPrismaClient = {
      $transaction: prisma.$transaction.bind(prisma),
      user: {
        findUnique: prisma.user.findUnique.bind(prisma.user),
        update: prisma.user.update.bind(prisma.user),
      },
      userRole: {
        findFirst: async () => null,
      },
    };

    await expect(
      runAdminBootstrap(
        baseOptions({
          email: 'race@example.test',
          resetPassword: true,
          getPassword: async () => 'rolled-back-pw1',
        }),
        { prisma: staleReadClient, databaseUrl: DB_URL },
      ),
    ).rejects.toThrow();

    const rolesAfter = await prisma.userRole.findMany({ where: { userId } });
    expect(rolesAfter).toHaveLength(1);

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(userAfter.passwordHash).toBe(passwordHash);
  });

  it('never calls console.log/console.error itself (pure function — logging is the CLI wrapper\'s job)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'never-log-this-password1';

    try {
      await runAdminBootstrap(baseOptions({ getPassword: async () => secret }), { databaseUrl: DB_URL });
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
