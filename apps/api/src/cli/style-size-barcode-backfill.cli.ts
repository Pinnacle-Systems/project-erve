#!/usr/bin/env node
// Backfills blank Style+Size barcodes (see style-size-barcode-backfill.ts).
// Never overwrites an existing barcode; never guesses an unreadable source.
//
// Usage (from apps/api):
//   tsx src/cli/style-size-barcode-backfill.cli.ts --dry-run [--assume-serial AW25=1 ...] [--details]
//   tsx src/cli/style-size-barcode-backfill.cli.ts --execute --confirm-write [--confirm-production]
//
//   --dry-run         read-only report (exactly one of --dry-run / --execute is required)
//   --assume-serial   dry-run only: pretend a Season with no Barcode Serial has
//                     this one, to preview collisions before an admin sets it
//   --execute         write the generatable rows; needs --confirm-write, plus
//                     --confirm-production when NODE_ENV=production
import { prisma } from '../db/prisma.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeBarcodeBackfill,
  loadBackfillRows,
  planBarcodeBackfill,
  summarizePlan,
  type BackfillRow,
} from './style-size-barcode-backfill.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');

  const assumeSerials = new Map<string, number>();
  argv.forEach((arg, index) => {
    if (arg !== '--assume-serial') return;
    const [code, serial] = (argv[index + 1] ?? '').split('=');
    const value = Number(serial);
    if (!code || !Number.isInteger(value) || value <= 0) throw new CliError('--assume-serial expects SEASONCODE=<positive integer>');
    assumeSerials.set(code.toUpperCase(), value);
  });
  if (execute && assumeSerials.size > 0) throw new CliError('--assume-serial is a dry-run preview and cannot be combined with --execute');
  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  return { execute, assumeSerials, details: argv.includes('--details') };
}

function printRows(title: string, rows: BackfillRow[]) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length}):`);
  for (const row of rows.slice(0, 20)) {
    console.log(`  ${row.styleNumber} [${row.seasonCode} ${row.lmixNumber || '(blank LMIX)'}] size ${row.sizeLabel}: ${row.detail}`);
  }
  if (rows.length > 20) console.log(`  ... ${rows.length - 20} more`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(options.execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  const plan = planBarcodeBackfill(await loadBackfillRows(), { assumeSerials: options.assumeSerials });
  console.table(summarizePlan(plan));
  if (options.details || !options.execute) {
    printRows('Missing Season Barcode Serial', plan.skipped.MISSING_SEASON_SERIAL);
    printRows('Invalid LMIX', plan.skipped.INVALID_LMIX);
    printRows('Ambiguous Size', plan.skipped.AMBIGUOUS_SIZE);
    printRows('Collisions', plan.skipped.COLLISION);
  }

  if (!options.execute) {
    console.log('\nDry run complete - nothing was written.');
    return;
  }
  const result = await executeBarcodeBackfill(plan);
  console.log(`\nWrote ${result.written} barcode(s); ${result.skippedFilled} row(s) were filled by someone else and left alone.`);
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
