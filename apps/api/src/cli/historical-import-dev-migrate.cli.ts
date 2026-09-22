#!/usr/bin/env node
// Safe wrapper around `prisma migrate deploy` for applying the additive
// historical-import schema migration to the Dev validation database.
//
// This is the ONLY historical-import command allowed to write to Dev in
// Story H1, and it writes schema only — no historical/business-data rows
// (no JobOrder, ImportBatch, HistoricalDocument, image, or audit rows) are
// ever inserted by this script. `prisma migrate deploy` is Prisma's own
// command, not custom CLI code, so the positive Dev-target check below runs
// as an explicit preflight immediately before invoking it, rather than
// being built into Prisma itself.
//
// Usage (from apps/api):
//   tsx src/cli/historical-import-dev-migrate.cli.ts
//
// Requires (see .env.example):
//   DATABASE_URL                                  — the target to migrate
//   HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL   — the operator's positive
//     declaration of exactly which database that's allowed to be
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { DevTargetGuardError, formatDevTargetReport, requireVerifiedDevDatabaseTarget } from '../modules/historical-import/dev-target-guard.js';

function main(): void {
  const report = requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
  });
  console.log(formatDevTargetReport(report, 'SCHEMA MIGRATION ONLY'));
  console.log('');
  console.log('Target verified. Applying committed migrations (schema only) via `prisma migrate deploy`...');

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCommand, ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error: unknown) {
  if (error instanceof DevTargetGuardError) {
    console.error(error.message);
  } else {
    console.error('Unexpected error while migrating the Dev validation database:');
    console.error(error);
  }
  process.exitCode = 1;
}
