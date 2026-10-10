#!/usr/bin/env node
// Create-only bulk Style import (DEMO-001): creates NEW Styles (with Sizes,
// Factory mappings, barcodes, and PNG images embedded directly in the
// workbook) from an .xlsx file. Never overwrites or modifies an existing
// Style. See style-bulk-import.service.ts for the exact workbook contract
// and the idempotent-retry behavior for an interrupted run.
//
// Usage (from apps/api):
//   tsx src/cli/style-bulk-import.cli.ts --file styles.xlsx --dry-run
//   tsx src/cli/style-bulk-import.cli.ts --file styles.xlsx --execute --confirm-write --actor-user-id <id> [--confirm-production]
//
// Exactly one of --dry-run / --execute is required (no default). Re-running
// the same (or a corrected) file is safe: existing Styles are left alone,
// and a Style this tool previously created but failed to fully attach an
// image to is recovered rather than duplicated.
import { readFile } from 'node:fs/promises';
import { prisma } from '../db/prisma.js';
import { currentUserSelect, toCurrentUser } from '../auth/current-user.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeBulkStyleImport,
  planBulkStyleImport,
  summarizeBulkStyleImportPlan,
  type BulkStyleImportPlanRow,
} from '../modules/master-data/style-bulk-import.service.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');
  const fileIndex = argv.indexOf('--file');
  const file = fileIndex >= 0 ? argv[fileIndex + 1] : undefined;
  if (!file) throw new CliError('--file <path to .xlsx> is required');
  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  const actorUserIdIndex = argv.indexOf('--actor-user-id');
  const actorUserId = actorUserIdIndex >= 0 ? argv[actorUserIdIndex + 1] : undefined;
  if (execute && !actorUserId) {
    throw new CliError('--execute requires --actor-user-id <id> (the authorized User this import is attributed to)');
  }
  return { file, execute, actorUserId };
}

function printRows(title: string, rows: BulkStyleImportPlanRow[]) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length}):`);
  for (const row of rows.slice(0, 50)) {
    console.log(`  row ${row.rowNumber} [${row.styleNumber || '(no Style Number)'}]: ${row.reason ?? row.status} - ${row.detail ?? ''}`);
  }
  if (rows.length > 50) console.log(`  ... ${rows.length - 50} more`);
}

async function main(): Promise<void> {
  const { file, execute, actorUserId } = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  const buffer = await readFile(file);
  const plan = await planBulkStyleImport(buffer);
  console.table(summarizeBulkStyleImportPlan(plan));
  printRows('Rejected', plan.rows.filter((row) => row.status === 'REJECTED'));
  printRows('Resumable (created by a prior interrupted run, image pending)', plan.rows.filter((row) => row.status === 'RESUME_IMAGE_PENDING'));

  if (plan.fileLevelImageWarnings.length > 0) {
    console.log(`\nFile-level image warnings (${plan.fileLevelImageWarnings.length}) — these embedded images could not be attributed to any row and were never attached to any Style:`);
    for (const warning of plan.fileLevelImageWarnings) console.log(`  ${warning.reason}: ${warning.detail}`);
  }

  if (!execute) {
    console.log('\nDry run complete — nothing was written.');
    return;
  }

  const userRecord = await prisma.user.findUniqueOrThrow({ where: { id: actorUserId! }, select: currentUserSelect });
  const actor = toCurrentUser(userRecord);
  const summary = await executeBulkStyleImport(actor, plan, file);

  const byOutcome = summary.results.reduce<Record<string, number>>((counts, result) => {
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`\nRun ${summary.runId} complete:`, byOutcome);

  const needsAttention = summary.results.filter((result) => result.outcome === 'FAILED' || result.outcome === 'IMAGE_PENDING');
  if (needsAttention.length > 0) {
    console.log('\nRows needing attention:');
    for (const result of needsAttention) {
      console.log(`  row ${result.rowNumber} [${result.styleNumber}] ${result.outcome}: ${result.detail ?? ''}`);
    }
    console.log('\nIMAGE_PENDING rows are safe to retry — re-run this exact command again once the issue is fixed.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
