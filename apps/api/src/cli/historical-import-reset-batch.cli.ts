#!/usr/bin/env node
// H2B — DEV-ONLY reset of ONE not-yet-accepted historical import batch, so
// the commit can be re-exercised without manual SQL. Not a generic reset:
// it needs the exact ImportBatch id AND its sourceLabel, positive erve_dev
// proof, and an explicit confirmation flag; it deletes only what that batch
// created (see resetHistoricalImportBatch) and never H2A master data.
//
// Usage (from apps/api):
//   FILE_STORAGE_DIR="C:\...\project-erve\apps\api\.data\uploads" \
//   tsx src/cli/historical-import-reset-batch.cli.ts \
//     --import-batch-id <id> --batch AW25-SS26 --admin-email admin@erve.local \
//     --confirm-dev-reset
import { prisma } from '../db/prisma.js';
import { HistoricalCommitError, resetHistoricalImportBatch, snapshotJobOrderSequences } from '../modules/historical-import/historical-job-order-commit.service.js';
import {
  DevTargetGuardError,
  HistoricalImportCliError,
  requireArg,
  requireExplicitDevStorageRoot,
  resolveAdminImporter,
  verifyDevWriteTarget,
} from './historical-import-cli-support.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const importBatchId = requireArg(argv, '--import-batch-id', 'the exact ImportBatch id to reset');
  const batchLabel = requireArg(argv, '--batch', "the batch's sourceLabel, e.g. AW25-SS26");
  const adminEmail = requireArg(argv, '--admin-email', 'the ADMIN performing the reset');
  if (!argv.includes('--confirm-dev-reset')) {
    throw new HistoricalImportCliError('Refusing: pass --confirm-dev-reset to delete this batch\'s historical rows from Dev');
  }

  await verifyDevWriteTarget('DEV HISTORICAL BATCH RESET');
  requireExplicitDevStorageRoot();
  const actor = await resolveAdminImporter(adminEmail);
  console.log('');
  console.log(`Sequences before: ${JSON.stringify(await snapshotJobOrderSequences(prisma))}`);

  const result = await resetHistoricalImportBatch(actor, { importBatchId, expectedSourceLabel: batchLabel });
  console.log(`Reset ImportBatch ${result.importBatchId}:`);
  console.log(`  Job Orders deleted:            ${result.deletedJobOrders}`);
  console.log(`  HistoricalDocuments deleted:   ${result.deletedHistoricalDocuments}`);
  console.log(`  Files deleted:                 ${result.deletedFiles} (storage objects removed: ${result.deletedStorageObjects})`);
  console.log(`  Import audit events deleted:   ${result.deletedImportAuditEvents}`);
  console.log(`Sequences after (never rewound): ${JSON.stringify(await snapshotJobOrderSequences(prisma))}`);
  console.log('H2A master data (Seasons/Styles/Sizes/StyleSizes/Style<->Factory) and Style images were not touched.');
}

main()
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof HistoricalImportCliError || error instanceof HistoricalCommitError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error during the historical batch reset:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
