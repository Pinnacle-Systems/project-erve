import { ROLES, type Role } from '@erve/types';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { ensureAllRoles, type RoleUpsertClient } from './roles.js';
import { describeDatabaseTarget } from './describe-database-target.js';

export class RolesBootstrapError extends Error {}

export interface RolesBootstrapResult {
  roles: Role[];
}

export interface RolesBootstrapOptions {
  nodeEnv: string;
  confirmProduction: boolean;
}

// Deliberately plain Promise-returning signature — same reasoning as
// AdminBootstrapPrismaClient (lets tests substitute a fake client without
// fighting Prisma's generated fluent-client return types).
export interface RolesBootstrapPrismaClient {
  $transaction: <T>(fn: (tx: RoleUpsertClient) => Promise<T>) => Promise<T>;
}

// Standalone counterpart to admin-bootstrap's own internal role-ensuring
// step: idempotently ensures every RoleName/ROLES value has a Role row,
// without creating or touching any user. Useful when reference role data
// needs to exist ahead of (or independently of) ever running
// admin-bootstrap — e.g. preparing a fresh production database for
// non-admin user creation via the API. Never deletes, renames, or
// duplicates a role, and never touches any other table.
export async function runRolesBootstrap(
  options: RolesBootstrapOptions,
  deps: { prisma?: RolesBootstrapPrismaClient; databaseUrl: string },
): Promise<RolesBootstrapResult> {
  const client: RolesBootstrapPrismaClient = deps.prisma ?? defaultPrisma;

  if (options.nodeEnv === 'production' && !options.confirmProduction) {
    throw new RolesBootstrapError(
      `Target database: ${describeDatabaseTarget(deps.databaseUrl)}\n` +
        'Production execution requires --confirm-production.',
    );
  }

  await client.$transaction((tx) => ensureAllRoles(tx));

  return { roles: [...ROLES] };
}
