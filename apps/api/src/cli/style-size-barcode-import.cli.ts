#!/usr/bin/env node
// Loads authoritative barcodes from a spreadsheet onto EXISTING Style + Size
// rows exactly as supplied (see style-size-barcode-import.ts). Never creates
// Styles/Sizes/mappings, never generates, never overwrites a different value.
//
// Usage (from apps/api):
//   tsx src/cli/style-size-barcode-import.cli.ts --file barcodes.xlsx --dry-run
//   tsx src/cli/style-size-barcode-import.cli.ts --file barcodes.xlsx --execute --confirm-write [--confirm-production]
//
// Exactly one of --dry-run / --execute is required (no default). Columns:
// Barcode, Size, and either "Style Number" or both "Season" + "LMIX".
// --layout legacy-book reads the business Book1 sheet (Season, Style Number =
// LMIX digits, Barcode; no Size column) and derives each size from the barcode
// under the AW25 / SS26 / AW26 regime rules.
import { readFile } from 'node:fs/promises';
import { prisma } from '../db/prisma.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeBarcodeImport,
  loadCatalog,
  parseBarcodeSheet,
  parseLegacyBarcodeBook,
  planBarcodeImport,
  summarizeImport,
  type ImportRow,
} from './style-size-barcode-import.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');
  const fileIndex = argv.indexOf('--file');
  const file = fileIndex >= 0 ? argv[fileIndex + 1] : undefined;
  if (!file) throw new CliError('--file <path to .xlsx/.csv> is required');
  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  const layoutIndex = argv.indexOf('--layout');
  const layout = layoutIndex >= 0 ? argv[layoutIndex + 1] : 'standard';
  if (layout !== 'standard' && layout !== 'legacy-book') throw new CliError('--layout must be standard or legacy-book');
  return { file, execute, layout };
}

function printRows(title: string, rows: ImportRow[]) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length}):`);
  for (const row of rows.slice(0, 25)) console.log(`  row ${row.rowNumber}: ${row.label} [${row.barcode}] - ${row.detail}`);
  if (rows.length > 25) console.log(`  ... ${rows.length - 25} more`);
}

async function main(): Promise<void> {
  const { file, execute, layout } = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  const parse = layout === 'legacy-book' ? parseLegacyBarcodeBook : parseBarcodeSheet;
  const plan = planBarcodeImport(parse(await readFile(file)), await loadCatalog());
  console.table(summarizeImport(plan));
  for (const [reason, rows] of Object.entries(plan.rejected)) printRows(`Rejected: ${reason}`, rows);
  printRows('Repeated identical rows', plan.duplicateRows);

  if (!execute) {
    console.log('\nDry run complete - nothing was written.');
    return;
  }
  if (Object.values(plan.rejected).some((rows) => rows.length > 0)) {
    console.log('\nNote: rejected rows are skipped; only rows counted as wouldSet are written.');
  }
  const result = await executeBarcodeImport(plan);
  console.log(`\nWrote ${result.written} barcode(s); ${result.skippedFilled} row(s) were filled by someone else and left alone.`);
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
