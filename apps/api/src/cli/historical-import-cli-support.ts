// Shared guard/actor plumbing for the H2B write-capable historical-import
// CLIs (commit-job-orders, reset-batch). Kept separate from the read-only
// dry-run CLI on purpose — nothing here is imported by it.
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from '../auth/current-user.js';
import { resolveFileStorageDir } from '../storage/index.js';
import {
  DevTargetGuardError,
  formatDevTargetReport,
  requireApprovedDevWriteTarget,
  type DevTargetReport,
} from '../modules/historical-import/dev-target-guard.js';

export class HistoricalImportCliError extends Error {}

export function getArg(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function requireArg(argv: string[], flag: string, hint: string): string {
  const value = getArg(argv, flag);
  if (!value || value.startsWith('--')) throw new HistoricalImportCliError(`${flag} is required (${hint})`);
  return value;
}

/** Positive Dev proof: URL == operator declaration, declared db == erve_dev, NODE_ENV=development, and the LIVE connection says erve_dev. */
export async function verifyDevWriteTarget(mode: Parameters<typeof formatDevTargetReport>[1]): Promise<DevTargetReport> {
  const [row] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const report = requireApprovedDevWriteTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    liveCurrentDatabase: row?.db ?? '',
  });
  console.log(formatDevTargetReport(report, mode));
  console.log(`Live current_database(): ${row?.db}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  return report;
}

/**
 * Source evidence must land in the storage root the running Dev API serves
 * from. A worktree's default relative FILE_STORAGE_DIR would silently
 * resolve inside that worktree instead, so writes require it to be set
 * explicitly, as an absolute path.
 */
export function requireExplicitDevStorageRoot(): string {
  const configured = process.env.FILE_STORAGE_DIR;
  if (!configured || !path.isAbsolute(configured)) {
    throw new HistoricalImportCliError(
      'FILE_STORAGE_DIR must be set explicitly to the Dev API\'s absolute upload root (e.g. <main checkout>/apps/api/.data/uploads) for historical-import writes',
    );
  }
  const resolved = resolveFileStorageDir();
  console.log(`File storage root: ${resolved}`);
  return resolved;
}

/** Re-resolves the named importer in the CURRENT database; must be ACTIVE and hold ADMIN. */
export async function resolveAdminImporter(email: string): Promise<CurrentUser> {
  const record = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: currentUserSelect });
  if (!record) throw new HistoricalImportCliError(`Importer "${email}" does not exist in this database`);
  const actor = toCurrentUser(record);
  if (actor.status !== 'ACTIVE') throw new HistoricalImportCliError(`Importer "${email}" is not ACTIVE`);
  if (!actor.roles.includes('ADMIN')) throw new HistoricalImportCliError(`Importer "${email}" is not an ADMIN`);
  console.log(`ADMIN importer: ${actor.name} <${actor.email}> (${actor.id})`);
  return actor;
}

export { DevTargetGuardError };
