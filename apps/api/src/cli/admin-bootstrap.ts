import { z } from 'zod';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { prisma as defaultPrisma, type Prisma, type UserStatus } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { ensureAllRoles } from './roles.js';
import { describeDatabaseTarget } from './describe-database-target.js';

type PrismaClientInstance = typeof defaultPrisma;

// Same field rules as apps/api/src/modules/users/users.validation.ts
// (createUserSchema) — kept in sync deliberately so an operator-created
// admin obeys the exact same input rules as an admin created through the
// API.
const inputSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
});

const passwordSchema = z.string().min(8);

export class AdminBootstrapError extends Error {}

export type AdminBootstrapOutcome = 'created' | 'role_added' | 'already_configured' | 'password_reset';

export interface AdminBootstrapResult {
  outcome: AdminBootstrapOutcome;
  userId: string;
  email: string;
  roleAdded: boolean;
  passwordReset: boolean;
  // Role reference rows that did not already exist and were created this
  // run — populated regardless of outcome, since role reference data is
  // ensured on every successful (non-refused) execution, including
  // "already configured". Empty once a production database has been
  // bootstrapped once and nothing new needs creating.
  rolesEnsured: Role[];
}

export interface AdminBootstrapOptions {
  email: string;
  name: string;
  resetPassword: boolean;
  nodeEnv: string;
  confirmProduction: boolean;
  // Invoked lazily and at most once, only when a password is actually
  // required (new user, or an existing user with --reset-password) — so
  // callers backed by an interactive prompt never prompt unnecessarily.
  getPassword: () => Promise<string>;
}

interface MinimalUser {
  id: string;
  email: string;
  status: UserStatus;
}

// Deliberately plain Promise-returning signatures for the non-transactional
// reads/writes (rather than Prisma's generated fluent-client method types)
// so tests can supply a fake client to force a mid-transaction failure and
// assert atomicity — real interactive-transaction failures are otherwise
// impractical to trigger through legitimate inputs, since every write here
// is guarded by an idempotency check first. The real PrismaClient's methods
// satisfy this structurally (their fluent return types extend Promise), so
// no cast is needed to pass the real client through unchanged. $transaction
// itself keeps its exact real type — its callback still gets a fully-typed
// transaction client.
export interface AdminBootstrapPrismaClient {
  $transaction: PrismaClientInstance['$transaction'];
  user: {
    findUnique: (args: { where: { email: string } }) => Promise<MinimalUser | null>;
    update: (args: { where: { id: string }; data: { passwordHash: string } }) => Promise<unknown>;
  };
  userRole: {
    findFirst: (args: { where: { userId: string; role: { name: 'ADMIN' } } }) => Promise<unknown>;
  };
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

export { describeDatabaseTarget };

async function resolveValidPassword(getPassword: () => Promise<string>): Promise<string> {
  const password = await getPassword();
  const check = passwordSchema.safeParse(password);
  if (!check.success) {
    throw new AdminBootstrapError(formatZodError(check.error));
  }
  return password;
}

export async function runAdminBootstrap(
  options: AdminBootstrapOptions,
  deps: { prisma?: AdminBootstrapPrismaClient; databaseUrl: string },
): Promise<AdminBootstrapResult> {
  const client: AdminBootstrapPrismaClient = deps.prisma ?? defaultPrisma;

  const parsedInput = inputSchema.safeParse({ email: options.email, name: options.name });
  if (!parsedInput.success) {
    throw new AdminBootstrapError(formatZodError(parsedInput.error));
  }
  const { email, name } = parsedInput.data;

  if (options.nodeEnv === 'production' && !options.confirmProduction) {
    throw new AdminBootstrapError(
      `Target database: ${describeDatabaseTarget(deps.databaseUrl)}\n` +
        'Production execution requires --confirm-production.',
    );
  }

  const existing = await client.user.findUnique({ where: { email } });

  if (existing && existing.status !== 'ACTIVE') {
    // Refuses outright — deliberately zero database writes here, including
    // no role-reference ensure. A non-ACTIVE match means something about
    // this account already needs manual attention; silently ensuring role
    // reference data as a side effect of a call that otherwise changes
    // nothing would blur "did this run touch the database at all" for an
    // operator re-running the command to investigate the refusal.
    throw new AdminBootstrapError(
      `User ${email} exists with status ${existing.status}, not ACTIVE — resolve this manually ` +
        '(this command never changes user status as a side effect).',
    );
  }

  const hasAdminRole = existing
    ? Boolean(
        await client.userRole.findFirst({ where: { userId: existing.id, role: { name: 'ADMIN' } } }),
      )
    : false;

  // Only resolve a password when one is actually required: creating a new
  // user, or an explicit --reset-password against an existing one. Resolved
  // before the transaction (it may prompt interactively or read a file) so
  // no I/O happens while a database transaction is open.
  const needsPassword = !existing || options.resetPassword;
  const password = needsPassword ? await resolveValidPassword(options.getPassword) : undefined;

  // Every remaining path — including "already configured", where nothing
  // about the user changes at all — ensures all 7 role reference rows
  // first, inside the same transaction as whatever user/role-mapping
  // write (if any) follows. A fresh production database has an empty
  // roles table, and the admin account can easily have been bootstrapped
  // before some other role was ever needed (or by an older version of
  // this command that only ensured ADMIN) — role reference data must
  // never depend on the admin account itself needing a change on this
  // particular run.
  return client.$transaction(async (tx) => {
    const { ids: roleIds, created: rolesEnsured } = await ensureAllRoles(tx);

    if (!existing) {
      if (!password) {
        throw new AdminBootstrapError('Internal error: password was not resolved for a new admin user.');
      }
      const passwordHash = await hashPassword(password);
      const userId = createId();

      await tx.user.create({
        data: {
          id: userId,
          email,
          name,
          passwordHash,
          status: 'ACTIVE',
          userRoles: { create: { id: createId(), roleId: roleIds.ADMIN } },
        },
      });

      return { outcome: 'created', userId, email, roleAdded: true, passwordReset: false, rolesEnsured };
    }

    if (!hasAdminRole) {
      await tx.userRole.create({ data: { id: createId(), userId: existing.id, roleId: roleIds.ADMIN } });

      if (password) {
        const passwordHash = await hashPassword(password);
        await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
      }

      return {
        outcome: options.resetPassword ? 'password_reset' : 'role_added',
        userId: existing.id,
        email: existing.email,
        roleAdded: true,
        passwordReset: options.resetPassword,
        rolesEnsured,
      };
    }

    if (options.resetPassword && password) {
      const passwordHash = await hashPassword(password);
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
      return {
        outcome: 'password_reset',
        userId: existing.id,
        email: existing.email,
        roleAdded: false,
        passwordReset: true,
        rolesEnsured,
      };
    }

    return {
      outcome: 'already_configured',
      userId: existing.id,
      email: existing.email,
      roleAdded: false,
      passwordReset: false,
      rolesEnsured,
    };
  });
}

export type { Prisma };
