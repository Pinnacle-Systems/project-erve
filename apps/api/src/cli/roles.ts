import { ROLES, type Role } from '@erve/types';
import { createId } from '@erve/shared';

// Same descriptions as apps/api/prisma/seed.ts's DEFAULT_ROLES — kept in
// sync deliberately, since this module and that seed are the only two
// places that ever create Role rows.
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full administrative access',
  MERCHANDISER: 'Manages styles, price lists, and process flows',
  FACTORY_USER: 'Records production progress at a factory',
  QA_USER: 'Performs quality inspection and approval',
  ACCOUNTANT: 'Manages invoicing and financial records',
  DISTRIBUTOR: 'Manages distributor-facing orders and stock',
  SENIOR_MANAGEMENT: 'Cross-functional oversight and reporting',
};

// Deliberately plain Promise-returning signature (not Prisma's generated
// fluent-client method type) so tests can supply a fake client — same
// reasoning as AdminBootstrapPrismaClient in admin-bootstrap.ts. Uses
// findUnique+create rather than upsert so callers can tell which roles (if
// any) were actually newly created this run, for clearer CLI reporting.
export interface RoleUpsertClient {
  role: {
    findUnique: (args: { where: { name: Role } }) => Promise<{ id: string; name: Role } | null>;
    create: (args: {
      data: { id: string; name: Role; description: string };
    }) => Promise<{ id: string; name: Role }>;
  };
}

export interface EnsureAllRolesResult {
  ids: Record<Role, string>;
  // Roles that did not already have a row and were created this call.
  // Empty when every role already existed — the common case once a
  // production database has been bootstrapped once.
  created: Role[];
}

// Idempotently ensures every role in ROLES (apps/api/src/modules/users
// /users.validation.ts's own source of truth for valid role names) has a
// corresponding Role row — never deletes, renames, or touches any other
// table. Safe to call whether the roles table currently has 0, some, or
// all 7 rows already. Returns each role's id, for callers (like
// admin-bootstrap) that need to attach a UserRole mapping without a
// second round-trip.
export async function ensureAllRoles(client: RoleUpsertClient): Promise<EnsureAllRolesResult> {
  const ids = {} as Record<Role, string>;
  const created: Role[] = [];

  for (const name of ROLES) {
    const existing = await client.role.findUnique({ where: { name } });
    if (existing) {
      ids[name] = existing.id;
      continue;
    }

    const role = await client.role.create({
      data: { id: createId(), name, description: ROLE_DESCRIPTIONS[name] },
    });
    ids[name] = role.id;
    created.push(name);
  }

  return { ids, created };
}
