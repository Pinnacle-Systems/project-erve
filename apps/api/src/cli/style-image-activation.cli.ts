#!/usr/bin/env node
// SM-001: activates (uploads) historical Style images from a reviewed
// manifest — generalized, so it can run against ANY approved manifest,
// including a fresh revalidation of the existing 91-Style AW25/SS26 batch
// against current artifacts. See style-image-activation.ts for the exact
// safety behavior (checksum-verified twice, never auto-replaces a
// conflicting image, idempotent on re-run).
//
// Usage (from apps/api):
//   tsx src/cli/style-image-activation.cli.ts --manifest manifest.json --images-dir ./images --dry-run
//   tsx src/cli/style-image-activation.cli.ts --manifest manifest.json --images-dir ./images --execute --confirm-write --actor-user-id <id> [--confirm-production]
//
// Manifest format (JSON): { "records": [{ "styleNumber": "...", "imageRelativePath": "...", "sha256": "..." }] }
import { readFile } from 'node:fs/promises';
import { prisma } from '../db/prisma.js';
import { currentUserSelect, toCurrentUser } from '../auth/current-user.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeImageActivation,
  planImageActivation,
  summarizeImageActivationPlan,
  type ImageActivationManifest,
  type ImageActivationPlanRow,
} from './style-image-activation.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');

  const manifestIndex = argv.indexOf('--manifest');
  const manifest = manifestIndex >= 0 ? argv[manifestIndex + 1] : undefined;
  if (!manifest) throw new CliError('--manifest <path to manifest.json> is required');

  const imagesDirIndex = argv.indexOf('--images-dir');
  const imagesDir = imagesDirIndex >= 0 ? argv[imagesDirIndex + 1] : undefined;
  if (!imagesDir) throw new CliError('--images-dir <path> is required');

  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  const actorUserIdIndex = argv.indexOf('--actor-user-id');
  const actorUserId = actorUserIdIndex >= 0 ? argv[actorUserIdIndex + 1] : undefined;
  if (execute && !actorUserId) {
    throw new CliError('--execute requires --actor-user-id <id> (the authorized User this activation is attributed to)');
  }

  return { manifest, imagesDir, execute, actorUserId };
}

function printRows(title: string, rows: ImageActivationPlanRow[]) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length}):`);
  for (const row of rows.slice(0, 50)) {
    console.log(`  ${row.styleNumber} [${row.imageRelativePath}]: ${row.action} - ${row.note}`);
  }
  if (rows.length > 50) console.log(`  ... ${rows.length - 50} more`);
}

async function main(): Promise<void> {
  const { manifest: manifestPath, imagesDir, execute, actorUserId } = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as ImageActivationManifest;
  const plan = await planImageActivation(manifest, imagesDir);
  console.table(summarizeImageActivationPlan(plan));

  printRows('Not uploadable', plan.filter((row) => row.action !== 'UPLOAD' && row.action !== 'SKIP_ALREADY_PRESENT'));
  printRows('Already present (no-op)', plan.filter((row) => row.action === 'SKIP_ALREADY_PRESENT'));

  if (!execute) {
    console.log('\nDry run complete — nothing was written.');
    return;
  }

  const userRecord = await prisma.user.findUniqueOrThrow({ where: { id: actorUserId! }, select: currentUserSelect });
  const actor = toCurrentUser(userRecord);
  const results = await executeImageActivation(actor, plan, imagesDir);

  const byOutcome = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
    return counts;
  }, {});
  console.log('\nActivation complete:', byOutcome);
  for (const result of results.filter((r) => r.outcome === 'SKIPPED_NOT_UPLOADABLE')) {
    console.log(`  ${result.styleNumber} [${result.imageRelativePath}]: ${result.note}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
