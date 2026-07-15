import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { ROLES } from '@erve/types';
import { runRolesBootstrap, RolesBootstrapError } from './roles-bootstrap.js';

const DB_URL = 'postgresql://erve_app:super-secret-pw@10.0.0.5:5432/erve_production?schema=public';

beforeEach(async () => {
  await resetDatabase();
  // Deliberately does NOT delete the `roles` table (shared reference data
  // other test files depend on already being seeded — see
  // admin-bootstrap.test.ts for the incident that established this rule).
  // ensureAllRoles is idempotent regardless of the roles table's starting
  // state, so these tests are valid whether it currently has 0, some, or
  // all 7 rows already.
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('runRolesBootstrap', () => {
  it('ensures every supported role exists', async () => {
    const result = await runRolesBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });

    expect(result.roles.sort()).toEqual([...ROLES].sort());

    const roles = await prisma.role.findMany({ where: { name: { in: [...ROLES] } } });
    expect(roles.map((r) => r.name).sort()).toEqual([...ROLES].sort());
  });

  it('running again changes nothing — no duplicates, same ids', async () => {
    await runRolesBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });
    const before = await prisma.role.findMany({ where: { name: { in: [...ROLES] } }, orderBy: { name: 'asc' } });

    await runRolesBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });
    const after = await prisma.role.findMany({ where: { name: { in: [...ROLES] } }, orderBy: { name: 'asc' } });

    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.description)).toEqual(before.map((r) => r.description));
  });

  it('never creates a user or any other row', async () => {
    await runRolesBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.userRole.count()).resolves.toBe(0);
  });

  it('requires --confirm-production in production and never touches the database first', async () => {
    const before = await prisma.role.count();

    await expect(
      runRolesBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toThrow(RolesBootstrapError);

    await expect(prisma.role.count()).resolves.toBe(before);
  });

  it('the production guard names the DB target but never a credential', async () => {
    await expect(
      runRolesBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('erve_production on 10.0.0.5:5432'),
    });

    try {
      await runRolesBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL });
      expect.unreachable('expected the production guard to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret-pw');
      expect(message).not.toContain('erve_app');
    }
  });

  it('succeeds in production once --confirm-production is supplied', async () => {
    const result = await runRolesBootstrap(
      { nodeEnv: 'production', confirmProduction: true },
      { databaseUrl: DB_URL },
    );
    expect(result.roles.sort()).toEqual([...ROLES].sort());
  });
});
