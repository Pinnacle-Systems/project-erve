#!/usr/bin/env node
// Structurally read-only dry-run — no commit branch, no --commit flag, no
// dryRun:false mode anywhere in this command's dependency chain (H1 plan
// §17). H2 introduces the first commit command separately.
//
// Usage (from apps/api):
//   tsx src/cli/historical-import.cli.ts \
//     --batch AW25-SS26 \
//     --input "C:\...\.artifacts\historical-import\AW25-SS26\source-staging.json" \
//     [--process-flow-version-id <id>]
//
// Requires (see .env.example): DATABASE_URL and
// HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL pointing at the same,
// explicitly-approved Dev validation database.
import { prisma } from '../db/prisma.js';
import { DevTargetGuardError, HistoricalImportDryRunError, runHistoricalImportDryRun } from './historical-import.js';
import { ProcessFlowPinError } from '../modules/historical-import/process-flow-pin.js';

function parseArgs(argv: string[]): {
  batchLabel: string;
  stagingFilePath: string;
  processFlowVersionId?: string;
  factoryMappingFilePath?: string;
  sourceOverridesFilePath?: string;
} {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const batchLabel = get('--batch');
  const stagingFilePath = get('--input');
  const processFlowVersionId = get('--process-flow-version-id');
  const factoryMappingFilePath = get('--factory-mapping');
  const sourceOverridesFilePath = get('--source-overrides');
  if (!batchLabel) throw new HistoricalImportDryRunError('--batch is required, e.g. --batch AW25-SS26');
  if (!stagingFilePath) throw new HistoricalImportDryRunError('--input is required (path to source-staging.json from historical-import:prepare)');
  return { batchLabel, stagingFilePath, processFlowVersionId, factoryMappingFilePath, sourceOverridesFilePath };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runHistoricalImportDryRun(options);

  console.log('');
  console.log(`Batch: ${options.batchLabel}`);
  console.log(`Pinned Process Flow Version: ${result.processFlowVersionId} (fingerprint ${result.processFlowLogicalIdentityFingerprint.slice(0, 16)}...)`);
  console.log('');
  console.log('Reconciliation summary:');
  console.log(`  Season matched/unmatched:  ${result.summary.seasonMatched} / ${result.summary.seasonUnmatched}`);
  console.log(`  Factory matched/unmatched: ${result.summary.factoryMatched} / ${result.summary.factoryUnmatched}`);
  console.log(`  Style matched/unmatched:   ${result.summary.styleMatched} / ${result.summary.styleUnmatched}`);
  console.log(`  Image dispositions:        ${JSON.stringify(result.summary.imageDispositionCounts)}`);
  console.log('');
  console.log(`  READY:            ${result.summary.ready}`);
  console.log(`  REVIEW_REQUIRED:  ${result.summary.reviewRequired}`);
  console.log(`  BLOCKED:          ${result.summary.blocked}`);
  console.log('');
  console.log(`Recommended historical identity rule: ${result.identity.recommendation}`);
  console.log(`  ${result.identity.rationale}`);
  console.log('');
  console.log(`dev-reconciliation.json: ${result.devReconciliationPath}`);
  console.log(`migration-approval.json: ${result.migrationApprovalPath}`);
  console.log(`human-review.md:         ${result.humanReviewPath}`);
  console.log('');
  console.log('Zero historical Dev records were committed. This is a read-only dry run.');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof HistoricalImportDryRunError || error instanceof ProcessFlowPinError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while running the historical import dry run:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
