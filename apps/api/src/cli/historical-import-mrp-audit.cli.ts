#!/usr/bin/env node
// Usage (from apps/api):
//   HISTORICAL_IMPORT_MRP_WORKBOOK_PATH="C:\...\MRP & Ex factory cost.xlsx" \
//     tsx src/cli/historical-import-mrp-audit.cli.ts
//
// Structurally read-only (see historical-import-mrp-audit.ts) — reads the
// immutable business workbook and Dev master data, writes ONLY the
// diagnostic artifacts under .artifacts/historical-import/AW25-SS26/h2a/.
// Never creates a Style, StyleSize, StyleFactoryMapping, or any
// transaction row.
import { prisma } from '../db/prisma.js';
import { runMrpAudit, DevTargetGuardError, MrpAuditError } from './historical-import-mrp-audit.js';

async function main(): Promise<void> {
  const workbookPath = process.env.HISTORICAL_IMPORT_MRP_WORKBOOK_PATH;
  if (!workbookPath) {
    throw new MrpAuditError('HISTORICAL_IMPORT_MRP_WORKBOOK_PATH environment variable is required (path to the real, gitignored "MRP & Ex factory cost.xlsx")');
  }
  const outputDir = process.argv[2] ?? '.artifacts/historical-import/AW25-SS26/h2a';
  const stagingFilePath = process.argv[3] ?? '.artifacts/historical-import/AW25-SS26/source-staging.json';
  const sourceOverridesFilePath = process.argv[4] ?? '.artifacts/historical-import/AW25-SS26/h2a/source-overrides.json';
  const factoryMappingFilePath = process.argv[5] ?? '.artifacts/historical-import/AW25-SS26/h2a/factory-mapping.json';

  const result = await runMrpAudit({ workbookPath, stagingFilePath, sourceOverridesFilePath, factoryMappingFilePath, outputDir });

  console.log(`Workbook SHA-256: ${result.manifest.sha256}`);
  console.log(`Workbook size: ${result.manifest.sizeBytes} bytes`);
  console.log(`Sheets: ${result.manifest.sheetNames.join(', ')}`);
  console.log(`Data rows parsed: ${result.manifest.totalDataRows}`);
  console.log('');
  console.log(`MRP reconciliation: ${result.identityVerification.matched} RESOLVED / ${result.mrpRecords.filter((r) => r.disposition === 'REVIEW_REQUIRED').length} REVIEW_REQUIRED / ${result.identityVerification.unmatched} BLOCKED (of ${result.identityVerification.expectedIdentityCount} required identities)`);
  console.log(`Extra workbook rows (outside current historical scope): ${result.extraWorkbookRows.length}`);
  console.log(`Duplicate workbook identities: ${result.identityVerification.duplicateWorkbookIdentities.length}`);
  console.log('');
  console.log(`Ex-factory: ${result.exFactoryRecords.filter((r) => r.disposition === 'MATCH').length} MATCH / ${result.exFactoryRecords.filter((r) => r.disposition === 'NEW_MAPPING_RATE').length} NEW_MAPPING_RATE / ${result.exFactoryRecords.filter((r) => r.disposition === 'REVIEW_CONFLICT').length} REVIEW_CONFLICT`);
  console.log('');
  console.log(`Wrote: ${result.manifestPath}`);
  console.log(`Wrote: ${result.mrpReconciliationPath}`);
  console.log(`Wrote: ${result.exFactoryReconciliationPath}`);
  console.log(`Wrote: ${result.identityVerificationPath}`);
  console.log('');
  console.log('No Style, StyleSize, Style<->Factory mapping, or transaction row was created or modified.');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof MrpAuditError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while auditing the MRP workbook:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
