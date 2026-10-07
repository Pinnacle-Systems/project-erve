#!/usr/bin/env node
// Backfills the new Hsn master from existing Style.hsnCode/hsnDescription
// data (see hsn-master-backfill.ts). Never overwrites an existing
// Style.hsnId; never invents a code or picks between conflicting
// descriptions.
//
// Usage (from apps/api):
//   tsx src/cli/hsn-master-backfill.cli.ts --dry-run [--details]
//   tsx src/cli/hsn-master-backfill.cli.ts --execute --confirm-write [--confirm-production]
//
//   --dry-run   read-only report (exactly one of --dry-run / --execute is required)
//   --execute   write the HSNs and Style links the plan identified; needs
//               --confirm-write, plus --confirm-production when NODE_ENV=production
import { prisma } from '../db/prisma.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeHsnMasterBackfill,
  loadStyleHsnRows,
  planHsnMasterBackfill,
  summarizePlan,
  type PlannedHsn,
  type SkippedStyle,
} from './hsn-master-backfill.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');
  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  return { execute, details: argv.includes('--details') };
}

function printConflicts(hsns: PlannedHsn[]) {
  const withConflicts = hsns.filter((hsn) => hsn.conflictingDescriptions.length > 0);
  if (withConflicts.length === 0) return;
  console.log(`\nHSNs with conflicting descriptions (code still established, description left blank) (${withConflicts.length}):`);
  for (const hsn of withConflicts) {
    console.log(`  ${hsn.code} (${hsn.styleCount} style(s)): ${hsn.conflictingDescriptions.join(' | ')}`);
  }
}

function printSkipped(rows: SkippedStyle[]) {
  if (rows.length === 0) return;
  console.log(`\nStyles that cannot be linked (${rows.length}):`);
  for (const row of rows.slice(0, 30)) {
    console.log(`  ${row.styleNumber}: ${row.reason} (hsnCode=${row.hsnCode ?? '(null)'})`);
  }
  if (rows.length > 30) console.log(`  ... ${rows.length - 30} more`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(options.execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  const plan = planHsnMasterBackfill(await loadStyleHsnRows());
  console.table(summarizePlan(plan));
  if (options.details || !options.execute) {
    printConflicts(plan.hsnsToCreate);
    printSkipped(plan.skipped);
  }

  if (!options.execute) {
    console.log('\nDry run complete - nothing was written.');
    return;
  }
  const result = await executeHsnMasterBackfill(plan);
  console.log(
    `\nCreated ${result.hsnsCreated} HSN(s) (${result.hsnsAlreadyExisted} already existed), linked ${result.stylesLinked} Style(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
