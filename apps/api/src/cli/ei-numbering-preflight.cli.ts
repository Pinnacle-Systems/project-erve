#!/usr/bin/env node
/**
 * Read-Only EI Numbering Cutover Preflight CLI.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 *
 * Runs diagnostic checks to determine readiness for continuing the EI Tax Invoice series.
 * GUARANTEE: Never modifies database state, never allocates numbers, never seeds sequences.
 *
 * Usage (standalone Node.js 24 from api/ or apps/api):
 *   node ei-numbering-preflight.js \
 *     --target <local|dev|staging|production|test> \
 *     --financial-year <YYYY-YY> \
 *     [--external-high-water-mark <N>] \
 *     [--external-records-file <path>] \
 *     [--manifest-file <path>] \
 *     [--expect-database <name>] \
 *     [--expect-host <host>] \
 *     [--expect-schema <schema>] \
 *     [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type {
  PreflightOptions,
  PreflightReport,
  TargetEnvironment,
  AuthoritativeExternalRecord,
  ExternalSourceManifest,
} from '../modules/fulfillment/ei-numbering-preflight.types.js';

export function printHelp(): void {
  console.log(`
ERVE India — EI Numbering Cutover Preflight Diagnostic CLI
Read-only diagnostics to evaluate readiness for the EI Tax Invoice series cutover.

Usage:
  node ei-numbering-preflight.js \\
    --target <local|dev|staging|production|test> \\
    --financial-year <YYYY-YY> \\
    [--external-high-water-mark <N>] \\
    [--external-records-file <path>] \\
    [--manifest-file <path>] \\
    [--expect-database <name>] \\
    [--expect-host <host>] \\
    [--expect-schema <schema>] \\
    [--json]

Required arguments:
  --target                 Target environment: local, dev, staging, production, or test.
  --financial-year         Indian Financial Year code in YYYY-YY format (e.g. 2026-27).

Authoritative Source Options:
  --external-records-file  Path to JSON file containing authoritative historical invoice records.
  --manifest-file          Path to JSON file containing accountant-signed source manifest.
  --external-high-water-mark Explicitly asserted external high-water mark serial.

Safety & Verification Options:
  --expect-database        Expected database name to verify against live connected database.
  --expect-host            Expected database host to verify against live connected host.
  --expect-schema          Expected database schema to verify against live connected schema.
  --json                   Output diagnostic report in machine-readable JSON format.
  --help, -h               Show this help message.

Examples:
  # Inspect production sequence state and readiness (read-only):
  node ei-numbering-preflight.js \\
    --target production \\
    --financial-year 2026-27 \\
    --expect-database erve_prod

  # Full commercial cutover preflight with external ledger and manifest:
  node ei-numbering-preflight.js \\
    --target production \\
    --financial-year 2026-27 \\
    --external-records-file /secure/path/ledger.json \\
    --manifest-file /secure/path/manifest.json \\
    --expect-database erve_prod
`);
}

// 1. Help check runs first — zero dependencies, zero environment required!
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

// 2. Load .env from cwd or fallback to apps/api/.env if run from monorepo root
dotenv.config();
const localApiEnv = path.join(process.cwd(), 'apps', 'api', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(localApiEnv)) {
  dotenv.config({ path: localApiEnv });
}

// 3. Dynamically import modules requiring environment configuration
const { prisma } = await import('../db/prisma.js');
const { runEiNumberingPreflight } = await import('../modules/fulfillment/ei-numbering-preflight.service.js');
const {
  inspectLiveDatabase,
  verifyDatabaseTarget,
} = await import('./sequence-target-guard.js');

export function parseArgs(argv: string[]): {
  financialYearCode: string;
  externalHighWaterMark?: number;
  externalRecordsFile?: string;
  manifestFile?: string;
  target: TargetEnvironment;
  jsonOutput: boolean;
  expectDatabase?: string;
  expectHost?: string;
  expectSchema?: string;
} {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const financialYearCode = get('--financial-year');
  if (!financialYearCode) {
    throw new Error('--financial-year is required, e.g. --financial-year 2026-27');
  }

  const hwmRaw = get('--external-high-water-mark');
  let externalHighWaterMark: number | undefined;
  if (hwmRaw !== undefined) {
    externalHighWaterMark = Number.parseInt(hwmRaw, 10);
    if (Number.isNaN(externalHighWaterMark) || externalHighWaterMark < 0) {
      throw new Error('--external-high-water-mark must be a non-negative integer');
    }
  }

  const externalRecordsFile = get('--external-records-file');
  const manifestFile = get('--manifest-file');

  const targetRaw = (get('--target') ?? 'local').toUpperCase() as TargetEnvironment;
  const validTargets: TargetEnvironment[] = ['LOCAL', 'DEV', 'STAGING', 'PRODUCTION', 'TEST'];
  if (!validTargets.includes(targetRaw)) {
    throw new Error(`--target must be one of: ${validTargets.join(', ')}`);
  }

  const jsonOutput = has('--json');
  const expectDatabase = get('--expect-database');
  const expectHost = get('--expect-host');
  const expectSchema = get('--expect-schema');

  return {
    financialYearCode,
    externalHighWaterMark,
    externalRecordsFile,
    manifestFile,
    target: targetRaw,
    jsonOutput,
    expectDatabase,
    expectHost,
    expectSchema,
  };
}

function printFormattedReport(report: PreflightReport): void {
  console.log('======================================================================');
  console.log(`ERVE India — EI Numbering Cutover Preflight Diagnostic Report`);
  console.log('======================================================================');
  console.log(`Timestamp:            ${report.timestamp}`);
  console.log(`Target Environment:   ${report.environment}`);
  console.log(`Target FY:            ${report.targetFinancialYear}`);
  console.log(`Readiness Verdict:    ${report.verdict}`);
  console.log(
    `Check Summary:        ${report.summary.passed} PASS, ${report.summary.warned} WARN, ${report.summary.blocked} BLOCKED (${report.summary.total} total)`,
  );
  console.log('----------------------------------------------------------------------');
  console.log(
    `Sequence State:       ${report.sequenceState.exists ? `Initialized (last = ${report.sequenceState.lastAllocatedSerial})` : 'Uninitialized'}`,
  );
  console.log(`External Max Serial:  ${report.highWaterMark.externalMaxSerial ?? 'Not provided'}`);
  console.log(`ERVE Max Serial:      ${report.highWaterMark.erveMaxSerial ?? 'None'}`);
  console.log(
    `Verified Live HWM:    ${report.highWaterMark.verifiedHighWaterMark ?? 'Unresolved'}`,
  );
  console.log(`Next Proposed Number: ${report.highWaterMark.nextProposedInvoiceNumber ?? 'N/A'}`);
  console.log('----------------------------------------------------------------------');
  console.log('READINESS BREAKDOWN:');
  console.log(
    `  INV-012 Preparation:       ${report.readinessBreakdown.isPreparationReady ? 'COMPLETE' : 'INCOMPLETE'}`,
  );
  console.log(
    `  Schema / Config (INV-006): ${report.readinessBreakdown.isSchemaConfigReady ? 'READY' : 'PENDING MIGRATION'}`,
  );
  console.log(
    `  Baseline Reconciliation:   ${report.readinessBreakdown.isBaselineReconciliationReady ? 'AUTHORIZED (EVIDENCE VERIFIED)' : 'BLOCKED / PENDING PREREQUISITES'}`,
  );
  console.log(
    `  Production Cutover:        ${report.readinessBreakdown.isProductionCutoverReady ? 'READY FOR ACTIVATION' : 'BLOCKED / NOT READY'}`,
  );
  console.log('----------------------------------------------------------------------');
  console.log('DIAGNOSTIC CHECKS:');
  console.log('----------------------------------------------------------------------');

  for (const check of report.checks) {
    const statusTag = `[${check.status}]`.padEnd(9);
    console.log(`${statusTag} ${check.checkId}: ${check.title}`);
    console.log(`          ${check.message}`);
    if (check.actionRequired) {
      console.log(`          >> Action: ${check.actionRequired}`);
    }
    console.log('');
  }

  console.log('======================================================================');
  if (report.verdict === 'BLOCKED') {
    console.log(
      'VERDICT: BLOCKED — Cutover cannot proceed until all blocking conditions are resolved.',
    );
  } else if (report.verdict === 'READY WITH CONDITIONS') {
    console.log(
      'VERDICT: READY WITH CONDITIONS — Warnings present. Requires Accountant sign-off before baseline.',
    );
  } else {
    console.log('VERDICT: READY — All preflight diagnostic checks passed.');
  }
  console.log('======================================================================');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // If safety verification parameters were provided, verify connected database identity
  if (args.expectDatabase || args.expectHost || args.expectSchema) {
    const liveTarget = await inspectLiveDatabase(prisma, process.env.DATABASE_URL);
    verifyDatabaseTarget(
      {
        target: args.target,
        nodeEnv: process.env.NODE_ENV,
        configuredDatabaseUrl: process.env.DATABASE_URL,
        expectedDatabase: args.expectDatabase,
        expectedHost: args.expectHost,
        expectedSchema: args.expectSchema,
        // Preflight is strictly read-only, so confirmProduction is not required for read-only inspection
        confirmProduction: true,
      },
      liveTarget,
    );
  }

  let externalRecords: AuthoritativeExternalRecord[] | undefined;
  if (args.externalRecordsFile) {
    const resolvedPath = path.resolve(process.cwd(), args.externalRecordsFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`External records file not found: ${resolvedPath}`);
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    externalRecords = JSON.parse(content) as AuthoritativeExternalRecord[];
  }

  let externalSourceManifest: ExternalSourceManifest | undefined;
  if (args.manifestFile) {
    const resolvedPath = path.resolve(process.cwd(), args.manifestFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Manifest file not found: ${resolvedPath}`);
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    externalSourceManifest = JSON.parse(content) as ExternalSourceManifest;
  }

  const options: PreflightOptions = {
    targetFinancialYearCode: args.financialYearCode,
    externalHighWaterMark: args.externalHighWaterMark,
    externalRecords,
    externalSourceManifest,
    environment: args.target,
  };

  const report = await runEiNumberingPreflight(prisma, options);

  if (args.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printFormattedReport(report);
  }

  if (report.verdict === 'BLOCKED') {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

if (process.argv[1] && (process.argv[1].endsWith('ei-numbering-preflight.cli.ts') || process.argv[1].endsWith('ei-numbering-preflight.js') || process.argv[1].endsWith('ei-numbering-preflight.ts') || process.argv[1].endsWith('ei-numbering-preflight'))) {
  main()
    .catch((err: unknown) => {
      console.error('Preflight diagnostic execution failed:');
      if (err instanceof Error) {
        console.error(err.message);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
