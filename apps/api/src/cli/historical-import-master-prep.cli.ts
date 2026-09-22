#!/usr/bin/env node
// Usage (from apps/api):
//   tsx src/cli/historical-import-master-prep.cli.ts --plan
//   tsx src/cli/historical-import-master-prep.cli.ts --confirm-dev-master-write
//
// Requires (see .env.example): DATABASE_URL and
// HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL pointing at the same,
// explicitly-approved Dev validation database, plus an existing ADMIN user
// in that database (used as the audit-log actor for Season creation —
// resolved by ADMIN role, not hardcoded to a specific email).
import { prisma } from '../db/prisma.js';
import { toCurrentUser, currentUserSelect } from '../auth/current-user.js';
import { applySeasons, planSeasons, DevTargetGuardError, MasterPrepError } from './historical-import-master-prep.js';

async function resolveAdminActor() {
  const admin = await prisma.user.findFirst({
    where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'ADMIN' } } } },
    select: currentUserSelect,
  });
  if (!admin) throw new MasterPrepError('No ACTIVE ADMIN user exists in this Dev database — cannot record an audit-log actor for Season creation');
  return toCurrentUser(admin);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const planOnly = args.includes('--plan');
  const confirmed = args.includes('--confirm-dev-master-write');

  if (!planOnly && !confirmed) {
    console.log('Nothing to do — pass --plan to preview, or --confirm-dev-master-write to apply.');
    return;
  }

  if (planOnly) {
    const plan = await planSeasons();
    console.log('Season master-preparation plan (Dev target not yet checked — read via app services):');
    for (const entry of plan) {
      console.log(`  ${entry.code} (${entry.name}, FY ${entry.financialYearCode}): ${entry.action}${entry.existingSeasonId ? ` [existing id ${entry.existingSeasonId}]` : ''}`);
    }
    return;
  }

  const actor = await resolveAdminActor();
  const result = await applySeasons(actor);
  console.log('');
  console.log(`Created: ${result.created.length} Season(s)`);
  for (const c of result.created) console.log(`  ${c.code} -> ${c.id}`);
  console.log(`Verified (already existed, unchanged): ${result.verified.length} Season(s)`);
  for (const v of result.verified) console.log(`  ${v.code} -> ${v.id}`);
  console.log('');
  console.log('No Style, Size, StyleSize, or Style<->Factory master data was created. No historical Job Order, ImportBatch, or HistoricalDocument row was created.');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof MasterPrepError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while preparing Dev master data:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
