#!/usr/bin/env node
// Repairs Job Orders left stuck by DEMO-013/DEMO-017 (see
// job-order-completion-reconciliation.ts for the exact, strict predicate).
// Dry-run first — it never writes anything.
//
// Usage (from apps/api):
//   tsx src/cli/job-order-completion-reconciliation.cli.ts --dry-run [--details]
//   tsx src/cli/job-order-completion-reconciliation.cli.ts --execute --confirm-write --actor-id <userId> [--confirm-production]
//
//   --dry-run     read-only report (exactly one of --dry-run / --execute is required)
//   --execute     repair every candidate the dry-run plan found; needs
//                 --confirm-write, an existing ADMIN --actor-id to attribute
//                 the audit trail to, and --confirm-production when
//                 NODE_ENV=production
import { prisma } from '../db/prisma.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  executeCompletionReconciliation,
  loadReconciliationCandidateRows,
  planCompletionReconciliation,
  summarizeReconciliationPlan,
  type ReconciliationSkip,
} from './job-order-completion-reconciliation.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) throw new CliError('Pass exactly one of --dry-run or --execute (there is no default action)');

  const actorIdIndex = argv.indexOf('--actor-id');
  const actorId = actorIdIndex >= 0 ? argv[actorIdIndex + 1] : undefined;
  if (execute && !actorId) throw new CliError('--execute requires --actor-id <userId> to attribute the repair audit trail');
  if (execute && !argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
  if (execute && process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
  return { execute, actorId, details: argv.includes('--details') };
}

function printSkips(title: string, skips: ReconciliationSkip[]) {
  if (skips.length === 0) return;
  console.log(`\n${title} (${skips.length}):`);
  for (const skip of skips.slice(0, 20)) {
    console.log(`  ${skip.jobOrderNumber} (${skip.jobOrderId}): ${skip.detail}`);
  }
  if (skips.length > 20) console.log(`  ... ${skips.length - 20} more`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);
  console.log(options.execute ? 'Mode: EXECUTE' : 'Mode: DRY RUN (no data is written)');

  if (options.execute) {
    const operator = await prisma.user.findUnique({ where: { id: options.actorId! }, select: { id: true } });
    if (!operator) throw new CliError(`--actor-id ${options.actorId} does not match any existing user`);
  }

  const rows = await loadReconciliationCandidateRows();
  const plan = planCompletionReconciliation(rows);
  console.table(summarizeReconciliationPlan(plan));

  if (plan.candidates.length > 0) {
    console.log(`\nRepairable (${plan.candidates.length}):`);
    for (const candidate of plan.candidates) {
      console.log(
        `  ${candidate.jobOrderNumber} (${candidate.jobOrderId}): ${candidate.finalStageName} stage; ` +
          `prepared=${candidate.preparedQuantityTotal}, resolvedCoverage=${candidate.resolvedPhysicalCoverage}`,
      );
    }
  }
  if (options.details || !options.execute) {
    const byReason = (reason: ReconciliationSkip['reason']) => plan.skipped.filter((s) => s.reason === reason);
    printSkips('No Final QA activity', byReason('NO_FINAL_QA_ACTIVITY'));
    printSkips('Prepared quantity mismatch', byReason('PREPARED_QUANTITY_MISMATCH'));
    printSkips('Final QA not fully resolved', byReason('FINAL_QA_NOT_FULLY_RESOLVED'));
    printSkips('Final stage not solely open', byReason('FINAL_STAGE_NOT_SOLELY_OPEN'));
  }

  if (!options.execute) {
    console.log('\nDry run complete - nothing was written.');
    return;
  }
  const result = await executeCompletionReconciliation(plan.candidates, options.actorId!);
  console.log(`\nRepaired ${result.repaired.length} Job Order(s); ${result.skippedStale.length} changed since planning and were left alone.`);
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
