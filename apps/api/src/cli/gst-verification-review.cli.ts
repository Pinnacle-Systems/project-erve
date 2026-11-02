#!/usr/bin/env node
// Read-only review of GSTINAPI verification operations and held claims.
// Makes no provider request and writes nothing (the snapshot runs in a
// READ ONLY transaction). Pair with gst-verification-reconcile.cli.ts.
//
// Usage (standalone Node.js 24 from api/, or via tsx from apps/api):
//   node gst-verification-review.js \
//     --target <local|dev|staging|production|test> \
//     --expect-database <name> \
//     [--expect-schema <schema>] [--expect-host <host>] [--env-file <path>] \
//     [--operation-id <id>] [--details]
import {
  DocumentSequenceBaselineError,
  inspectLiveDatabase,
  loadRuntimeEnvironment,
  parseTargetEnvironment,
  verifyDatabaseTarget,
} from './sequence-target-guard.js';

function printHelp(): void {
  console.log(`
ERVE India — GST Verification Claim Review CLI (read-only)
Lists GSTINAPI verification operations by outcome and the held claims that need investigation.
Makes no provider request, consumes no credits, and writes nothing.

Usage:
  node gst-verification-review.js \\
    --target <local|dev|staging|production|test> \\
    --expect-database <name> \\
    [--expect-schema <schema>] \\
    [--expect-host <host>] \\
    [--env-file <path>] \\
    [--operation-id <id>] \\
    [--details]

Required arguments:
  --target            Declared environment. Must agree with NODE_ENV and the live database.
  --expect-database   Expected PostgreSQL database name, verified against current_database().

Optional arguments:
  --expect-schema     Expected schema (verified against current_schema()).
  --expect-host       Expected host (configured endpoint or server-reported address).
  --env-file          Explicit environment file to load.
  --operation-id      Restrict the held/anomaly listing to one operation.
  --details           Also list claims already released through reconciliation.

GSTINs are masked. A released claim is NOT proof the provider did not charge credits.
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
  const args = reconciliation.parseReviewArgs(process.argv.slice(2));
  const target = parseTargetEnvironment(args.target);
  if (!args.expectDatabase?.trim())
    throw new reconciliation.GstReconciliationError('--expect-database is required');
  const live = await inspectLiveDatabase(prisma, process.env.DATABASE_URL);
  verifyDatabaseTarget(
    {
      target,
      nodeEnv: process.env.NODE_ENV,
      configuredDatabaseUrl: process.env.DATABASE_URL,
      expectedDatabase: args.expectDatabase,
      expectedHost: args.expectHost,
      expectedSchema: args.expectSchema,
      confirmProduction: false,
      isMutation: false,
    },
    live,
  );
  console.log(
    `Target: ${target} | database ${live.databaseName} (schema ${live.schema}) at ${live.configuredHost}:${live.configuredPort}`,
  );
  const snapshot = await reconciliation.loadReviewSnapshot({ operationId: args.operationId });
  console.log(reconciliation.formatReviewReport(snapshot, { details: args.details }));
}

main()
  .catch((error: unknown) => {
    if (
      error instanceof DocumentSequenceBaselineError ||
      error instanceof reconciliation.GstReconciliationError
    ) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error('Unexpected error while reviewing GST verification claims:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
