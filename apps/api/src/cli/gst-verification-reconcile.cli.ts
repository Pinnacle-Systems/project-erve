#!/usr/bin/env node
// Audited, one-operation-at-a-time decision on a held GSTINAPI verification claim.
// Makes no provider request and never retries a verification. Releasing a claim
// is NOT proof the provider did not charge credits; see DEPLOYMENT.md §12.7.
//
// Usage (standalone Node.js 24 from api/, or via tsx from apps/api):
//   node gst-verification-reconcile.js --help
import {
  DocumentSequenceBaselineError,
  inspectLiveDatabase,
  loadRuntimeEnvironment,
  parseTargetEnvironment,
  verifyDatabaseTarget,
} from './sequence-target-guard.js';

function printHelp(): void {
  console.log(`
ERVE India — GST Verification Claim Reconciliation CLI
Records one reviewed decision on one held GSTINAPI verification claim.
Makes no provider request, consumes no credits, and never retries a verification.

Usage:
  node gst-verification-reconcile.js \\
    --target <local|dev|staging|production|test> \\
    --expect-database <name> [--expect-schema <schema>] [--expect-host <host>] \\
    --operation-id <id> --claim-fingerprint <8hex> --expect-outcome <DISPATCHED|UNCERTAIN> \\
    --decision <NOT_CHARGED|CHARGED_NO_RESULT|UNKNOWN|IN_PROGRESS> \\
    --operator-email <email> --reason <text> \\
    [--evidence-type <type> --evidence-ref <reference>] \\
    [--evidence-window-start <ISO> --evidence-window-end <ISO>] \\
    [--charged-credits <n>] [--no-active-worker-assessment <text>] \\
    [--confirm-demo-sample] [--confirm-production] [--dry-run] [--env-file <path>]

Decisions:
  NOT_CHARGED         RELEASES the claim. Needs provider evidence (type, reference, and the
                      reviewed window covering the operation), or the Demo sample classification
                      for a DEMO claim. A DISPATCHED claim must be >= 15 minutes old and needs
                      --no-active-worker-assessment.
  CHARGED_NO_RESULT   Audit only; the claim is RETAINED. Needs provider evidence and
                      --charged-credits. Release needs separately authorized duplicate-charge handling.
  UNKNOWN             Audit only; the claim is RETAINED.
  IN_PROGRESS         Audit only; the claim is RETAINED.

Evidence types: PROVIDER_DASHBOARD_LEDGER, PROVIDER_SUPPORT_CONFIRMATION,
  PROVIDER_INVOICE_STATEMENT, and for DEMO claims only DEMO_SAMPLE_IDENTITY
  (requires --confirm-demo-sample). Daily aggregate usage is not evidence.

Operator: --operator-email is an attribution field, not authentication. The operator
must be an ACTIVE user with the ACCOUNTANT or ADMIN role. Run only on the server.
Production requires NODE_ENV=production, --confirm-production and --expect-schema.
Use --dry-run to run every check under lock and write nothing.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function getEarlyArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
loadRuntimeEnvironment({ explicitEnvFile: getEarlyArg('--env-file'), scriptPath: process.argv[1] });

// Prisma (and its env validation) must load only after the environment file.
const { prisma } = await import('../db/prisma.js');
const reconciliation = await import('./gst-verification-reconciliation.js');

async function main(): Promise<void> {
  const args = reconciliation.parseReconcileArgs(process.argv.slice(2));
  const target = parseTargetEnvironment(args.target);
  const live = await inspectLiveDatabase(prisma, process.env.DATABASE_URL);
  verifyDatabaseTarget(
    {
      target,
      nodeEnv: process.env.NODE_ENV,
      configuredDatabaseUrl: process.env.DATABASE_URL,
      expectedDatabase: args.expectDatabase,
      expectedHost: args.expectHost,
      expectedSchema: args.expectSchema,
      confirmProduction: args.confirmProduction,
      isMutation: true,
    },
    live,
  );
  const { input } = args;
  console.log(
    `Target: ${target} | database ${live.databaseName} (schema ${live.schema}) at ${live.configuredHost}:${live.configuredPort}`,
  );
  console.log(
    `Operation ${input.operationId} | decision ${input.decision} | operator ${input.operatorEmail} | ${input.dryRun ? 'DRY RUN' : 'EXECUTE'}`,
  );
  const result = await reconciliation.reconcileGstVerificationClaim(input);
  console.log(`Previous outcome: ${result.previousOutcome} (unchanged)`);
  console.log(
    `Claim: ${result.claimDisposition}${result.auditAction ? ` | audit entry ${result.auditAction}` : ''}`,
  );
  console.log(result.note);
}

main()
  .catch((error: unknown) => {
    if (
      error instanceof DocumentSequenceBaselineError ||
      error instanceof reconciliation.GstReconciliationError
    ) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error('Unexpected error while reconciling a GST verification claim:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
