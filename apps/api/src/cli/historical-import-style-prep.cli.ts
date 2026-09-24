#!/usr/bin/env node
// Usage (from apps/api):
//   HISTORICAL_IMPORT_MRP_WORKBOOK_PATH="C:\...\MRP & Ex factory cost.xlsx" \
//     tsx src/cli/historical-import-style-prep.cli.ts --plan
//   HISTORICAL_IMPORT_MRP_WORKBOOK_PATH="C:\...\MRP & Ex factory cost.xlsx" \
//     tsx src/cli/historical-import-style-prep.cli.ts --confirm-dev-master-write
//
// Requires the same Dev target env vars as historical-import-master-prep.cli.ts,
// plus an existing ACTIVE ADMIN user and the AW25/SS26 Seasons already
// created (run historical-import:master-prep first).
import { prisma } from '../db/prisma.js';
import { toCurrentUser, currentUserSelect } from '../auth/current-user.js';
import { planStyles, applyStyles, verifyDevTarget, formatDevTargetReport, DevTargetGuardError, StylePrepError, type StylePrepOptions } from './historical-import-style-prep.js';

async function resolveAdminActor() {
  const admin = await prisma.user.findFirst({
    where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'ADMIN' } } } },
    select: currentUserSelect,
  });
  if (!admin) throw new StylePrepError('No ACTIVE ADMIN user exists in this Dev database — cannot record an audit-log actor for Style creation');
  return toCurrentUser(admin);
}

function resolveOptions(): StylePrepOptions {
  const workbookPath = process.env.HISTORICAL_IMPORT_MRP_WORKBOOK_PATH;
  if (!workbookPath) {
    throw new StylePrepError('HISTORICAL_IMPORT_MRP_WORKBOOK_PATH environment variable is required (path to the real, gitignored "MRP & Ex factory cost.xlsx")');
  }
  return {
    workbookPath,
    stagingFilePath: process.argv[3] ?? '.artifacts/historical-import/AW25-SS26/source-staging.json',
    sourceOverridesFilePath: process.argv[4] ?? '.artifacts/historical-import/AW25-SS26/h2a/source-overrides.json',
    factoryMappingFilePath: process.argv[5] ?? '.artifacts/historical-import/AW25-SS26/h2a/factory-mapping.json',
    sizeMappingFilePath: process.argv[6] ?? '.artifacts/historical-import/AW25-SS26/h2a/size-mapping.json',
  };
}

function printPlanSummary(plan: Awaited<ReturnType<typeof planStyles>>): void {
  const byAction = { CREATE: 0, VERIFY_EXISTING: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const entry of plan) byAction[entry.action]++;
  console.log(`Style plan: ${byAction.CREATE} CREATE / ${byAction.VERIFY_EXISTING} VERIFY_EXISTING / ${byAction.BLOCKED} BLOCKED (of ${plan.length} required identities)`);
  for (const entry of plan) {
    if (entry.action === 'BLOCKED') {
      console.log(`  BLOCKED ${entry.season} ${entry.lmix}: ${entry.reason}`);
    }
  }
  const sizeCreate = plan.reduce((n, e) => n + e.sizes.filter((s) => s.action === 'CREATE').length, 0);
  const sizeBlocked = plan.reduce((n, e) => n + e.sizes.filter((s) => s.action === 'BLOCKED').length, 0);
  console.log(`StyleSize plan: ${sizeCreate} CREATE, ${sizeBlocked} BLOCKED`);
  const factoryCreate = plan.filter((e) => e.factory?.action === 'CREATE').length;
  const factorySkipped = plan.filter((e) => e.factory?.action === 'SKIPPED').length;
  const factoryBlocked = plan.filter((e) => e.factory?.action === 'BLOCKED').length;
  console.log(`Style<->Factory mapping plan: ${factoryCreate} CREATE, ${factorySkipped} SKIPPED, ${factoryBlocked} BLOCKED`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const planOnly = args.includes('--plan');
  const confirmed = args.includes('--confirm-dev-master-write');

  if (!planOnly && !confirmed) {
    console.log('Nothing to do — pass --plan to preview, or --confirm-dev-master-write to apply.');
    return;
  }

  const target = verifyDevTarget();
  console.log(formatDevTargetReport(target, 'DEV MASTER-DATA PREPARATION'));
  console.log('');

  const options = resolveOptions();
  const plan = await planStyles(options);
  printPlanSummary(plan);

  if (planOnly) return;

  console.log('');
  const actor = await resolveAdminActor();
  const result = await applyStyles(actor, plan);
  console.log('');
  console.log(`Styles created: ${result.stylesCreated.length}`);
  console.log(`Styles verified (already existed): ${result.stylesVerified.length}`);
  console.log(`Styles blocked: ${result.stylesBlocked.length}`);
  for (const b of result.stylesBlocked) console.log(`  ${b.season} ${b.lmix}: ${b.reason}`);
  console.log(`StyleSizes created: ${result.styleSizesCreated}, verified: ${result.styleSizesVerified}`);
  console.log(`Style<->Factory mappings created: ${result.styleFactoryMappingsCreated}, verified: ${result.styleFactoryMappingsVerified}, skipped: ${result.styleFactoryMappingsSkipped}`);
  console.log('');
  console.log('No historical Job Order, ImportBatch, HistoricalDocument, or transaction row was created.');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof StylePrepError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while preparing Dev Style master data:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
