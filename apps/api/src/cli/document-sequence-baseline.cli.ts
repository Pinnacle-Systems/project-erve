#!/usr/bin/env node
// Operational cutover helper for Financial-Year-aware document numbering.
// Raises (never lowers) a Purchase Order / Job Order / Tax Invoice
// sequence's high-water mark to align with an already-issued external/
// manual numbering series before this scheme's numbers are treated as
// durable business identifiers. Not a public HTTP endpoint — deliberately
// a script, run once per cutover.
//
// Usage (standalone Node.js 24 from api/ or apps/api):
//   node document-sequence-baseline.js \
//     --target <local|dev|staging|production|test> \
//     --document-type <PURCHASE_ORDER|JOB_ORDER|TAX_INVOICE> \
//     --financial-year <YYYY-YY> \
//     --serial <N> \
//     [--expect-database <name>] \
//     [--expect-schema <schema>] \
//     [--expect-host <host>] \
//     [--env-file <path>] \
//     [--confirm-production] \
//     [--dry-run]
//
// TAX_INVOICE usage is the INV-012 EI numbering cutover procedure (see
// docs/EI_NUMBERING_CUTOVER_RUNBOOK.md) — INV-006's finalization path
// (assertTaxInvoiceSequenceBaselined in tax-invoice.service.ts) refuses to
// auto-seed a TAX_INVOICE sequence at serial 1 in production, so this
// baseline command must run against the verified external high-water mark
// before the first production Tax Invoice can ever be finalized.

import type { DocumentType } from '../db/prisma.js';
import {
  parseTargetEnvironment,
  loadRuntimeEnvironment,
  inspectLiveDatabase,
  verifyDatabaseTarget,
  formatOperationSummary,
} from './sequence-target-guard.js';
import type { TargetEnvironment } from './sequence-target-guard.js';
import { DocumentSequenceBaselineError } from './document-sequence-baseline.js';

export function printHelp(): void {
  console.log(`
ERVE India — Document Sequence Baseline CLI
Raises or initializes the last allocated serial high-water mark for document numbering.

Usage:
  node document-sequence-baseline.js \\
    --target <local|dev|staging|production|test> \\
    --document-type <PURCHASE_ORDER|JOB_ORDER|TAX_INVOICE> \\
    --financial-year <YYYY-YY> \\
    --serial <N> \\
    [--expect-database <name>] \\
    [--expect-schema <schema>] \\
    [--expect-host <host>] \\
    [--env-file <path>] \\
    [--confirm-production] \\
    [--dry-run]

Required arguments:
  --target            Target environment: local, dev, staging, production, or test.
  --document-type     Document type: PURCHASE_ORDER, JOB_ORDER, or TAX_INVOICE.
  --financial-year    Indian Financial Year code in YYYY-YY format (e.g. 2026-27).
  --serial            Non-negative integer representing the last allocated serial.
                      Baseline 0 allows the first allocated document to receive serial 1.
                      Baseline 100 makes the next allocated serial 101.

Production Safeguards:
  --expect-database   Expected PostgreSQL database name (e.g. erve_prod). Required for production.
  --expect-schema     Expected PostgreSQL schema name (e.g. public). Required for production mutation.
  --expect-host       Expected PostgreSQL host name (optional extra check).
  --confirm-production Explicit confirmation flag required whenever targeting production or when
                      NODE_ENV=production.

Environment & Operational Flags:
  --env-file          Explicit path to environment file (e.g. /var/www/erve/shared/api.env).
  --dry-run           Validates targets, checks prerequisites, and executes inside a transaction
                      that is immediately rolled back. Zero persistent mutations performed.
  --help, -h          Show this help message.

Examples:
  # Internal UAT Tax Invoice sequence initialization (fresh sequence starting at serial 1):
  node document-sequence-baseline.js \\
    --target production \\
    --document-type TAX_INVOICE \\
    --financial-year 2026-27 \\
    --serial 0 \\
    --expect-database erve_prod \\
    --expect-schema public \\
    --confirm-production

  # Advance Tax Invoice sequence to verified external high-water mark:
  node document-sequence-baseline.js \\
    --target production \\
    --document-type TAX_INVOICE \\
    --financial-year 2026-27 \\
    --serial 100 \\
    --expect-database erve_prod \\
    --expect-schema public \\
    --confirm-production

  # Preview with dry-run mode:
  node document-sequence-baseline.js \\
    --target production \\
    --document-type TAX_INVOICE \\
    --financial-year 2026-27 \\
    --serial 100 \\
    --expect-database erve_prod \\
    --expect-schema public \\
    --confirm-production \\
    --dry-run
`);
}

// 1. Help check runs first — zero dependencies, zero environment required!
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

// 2. Predictable runtime environment configuration loading
function getEarlyArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
loadRuntimeEnvironment({
  explicitEnvFile: getEarlyArg('--env-file'),
  scriptPath: process.argv[1],
});

// 3. Dynamically import Prisma Client only after environment is loaded
const { prisma } = await import('../db/prisma.js');
const { runDocumentSequenceBaseline } = await import('./document-sequence-baseline.js');

const DOCUMENT_TYPES: DocumentType[] = ['PURCHASE_ORDER', 'JOB_ORDER', 'TAX_INVOICE'];

export interface ParsedBaselineCliArgs {
  target: TargetEnvironment;
  documentType: DocumentType;
  financialYearCode: string;
  approvedLastAllocatedSerial: number;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedSchema?: string;
  confirmProduction: boolean;
  dryRun: boolean;
  envFile?: string;
}

export function parseArgs(argv: string[]): ParsedBaselineCliArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const target = parseTargetEnvironment(get('--target'));

  const documentTypeRaw = get('--document-type');
  const financialYearCode = get('--financial-year');
  const serialRaw = get('--serial');

  if (!documentTypeRaw || !DOCUMENT_TYPES.includes(documentTypeRaw as DocumentType)) {
    throw new DocumentSequenceBaselineError(
      `--document-type is required and must be one of: ${DOCUMENT_TYPES.join(', ')}`,
    );
  }
  if (!financialYearCode) {
    throw new DocumentSequenceBaselineError('--financial-year is required, e.g. --financial-year 2026-27');
  }
  const approvedLastAllocatedSerial = Number(serialRaw);
  if (!serialRaw || !Number.isInteger(approvedLastAllocatedSerial) || approvedLastAllocatedSerial < 0) {
    throw new DocumentSequenceBaselineError('--serial is required and must be a non-negative integer (e.g. --serial 0 or --serial 100)');
  }

  const expectedDatabase = get('--expect-database');
  const expectedHost = get('--expect-host');
  const expectedSchema = get('--expect-schema');
  const confirmProduction = has('--confirm-production');
  const dryRun = has('--dry-run');
  const envFile = get('--env-file');

  return {
    target,
    documentType: documentTypeRaw as DocumentType,
    financialYearCode,
    approvedLastAllocatedSerial,
    expectedDatabase,
    expectedHost,
    expectedSchema,
    confirmProduction,
    dryRun,
    envFile,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // 1. Inspect live database target directly over connection
  const liveTarget = await inspectLiveDatabase(prisma, process.env.DATABASE_URL);

  // 2. Enforce database target and environment safety guards for mutation
  verifyDatabaseTarget(
    {
      target: options.target,
      nodeEnv: process.env.NODE_ENV,
      configuredDatabaseUrl: process.env.DATABASE_URL,
      expectedDatabase: options.expectedDatabase,
      expectedHost: options.expectedHost,
      expectedSchema: options.expectedSchema,
      confirmProduction: options.confirmProduction,
      isMutation: true,
    },
    liveTarget,
  );

  // 3. Inspect existing sequence state for reporting
  const financialYear = await prisma.financialYear.findUnique({
    where: { code: options.financialYearCode },
  });

  let existingSequence: { lastAllocatedSerial: number } | null = null;
  if (financialYear) {
    existingSequence = await prisma.documentSequence.findUnique({
      where: {
        documentType_financialYearId: {
          documentType: options.documentType,
          financialYearId: financialYear.id,
        },
      },
    });
  }

  // 4. Output sanitized operation summary before mutation
  console.log(
    formatOperationSummary({
      target: options.target,
      liveTarget,
      documentType: options.documentType,
      financialYearCode: options.financialYearCode,
      approvedSerial: options.approvedLastAllocatedSerial,
      currentBaseline: existingSequence?.lastAllocatedSerial,
      sequenceExists: existingSequence !== null,
      dryRun: options.dryRun,
    }),
  );

  // 5. Run sequence baseline adjustment (or dry-run simulation)
  const result = await runDocumentSequenceBaseline({
    documentType: options.documentType,
    financialYearCode: options.financialYearCode,
    approvedLastAllocatedSerial: options.approvedLastAllocatedSerial,
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    console.log('[DRY RUN] Verification passed. Transaction rolled back; zero persistent mutations performed.');
    if (result.created) {
      console.log(
        `[DRY RUN] Would initialize ${result.documentType} sequence for FY ${result.financialYearCode} at ${result.current} (next allocated serial will be ${result.current + 1})`,
      );
    } else if (result.changed) {
      console.log(
        `[DRY RUN] Would advance ${result.documentType} sequence for FY ${result.financialYearCode} from ${result.previous} to ${result.current} (next allocated serial will be ${result.current + 1})`,
      );
    } else {
      console.log(
        `[DRY RUN] No change: ${result.documentType} sequence for FY ${result.financialYearCode} is already at ${result.current}`,
      );
    }
    return;
  }

  if (result.created) {
    console.log(
      `initialized: ${result.documentType} sequence for FY ${result.financialYearCode} at ${result.current} (next allocated serial will be ${result.current + 1})`,
    );
    return;
  }

  if (!result.changed) {
    console.log(
      `no-op: ${result.documentType} sequence for FY ${result.financialYearCode} is already at ${result.current} (next allocated serial will be ${result.current + 1})`,
    );
    return;
  }

  console.log(
    `raised: ${result.documentType} sequence for FY ${result.financialYearCode} from ${result.previous} to ${result.current} (next allocated serial will be ${result.current + 1})`,
  );
}

// Only execute when run directly as CLI entrypoint
if (process.argv[1] && (process.argv[1].endsWith('document-sequence-baseline.cli.ts') || process.argv[1].endsWith('document-sequence-baseline.js') || process.argv[1].endsWith('document-sequence-baseline.ts') || process.argv[1].endsWith('document-sequence-baseline'))) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      if (error instanceof DocumentSequenceBaselineError) {
        console.error(`ERROR: ${error.message}`);
      } else if (error instanceof Error && error.message.includes('Refusing')) {
        console.error(`ERROR: ${error.message}`);
      } else {
        console.error('Unexpected error while adjusting the document sequence baseline:');
        console.error(error);
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
