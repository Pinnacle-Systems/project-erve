#!/usr/bin/env node
/**
 * Read-Only EI Numbering Cutover Preflight CLI.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 *
 * Runs diagnostic checks to determine readiness for continuing the EI Tax Invoice series.
 * GUARANTEE: Never modifies database state, never allocates numbers, never seeds sequences.
 *
 * Usage (from apps/api):
 *   tsx src/cli/ei-numbering-preflight.cli.ts \
 *     --financial-year 2026-27 \
 *     [--external-high-water-mark 250] \
 *     [--external-records-file ./ledger.json] \
 *     [--manifest-file ./manifest.json] \
 *     [--target local|dev|staging|production] \
 *     [--json]
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { runEiNumberingPreflight } from '../modules/fulfillment/ei-numbering-preflight.service.js';
import type {
  PreflightOptions,
  PreflightReport,
  TargetEnvironment,
  AuthoritativeExternalRecord,
  ExternalSourceManifest,
} from '../modules/fulfillment/ei-numbering-preflight.types.js';

function parseArgs(argv: string[]): {
  financialYearCode: string;
  externalHighWaterMark?: number;
  externalRecordsFile?: string;
  manifestFile?: string;
  target: TargetEnvironment;
  jsonOutput: boolean;
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

  return {
    financialYearCode,
    externalHighWaterMark,
    externalRecordsFile,
    manifestFile,
    target: targetRaw,
    jsonOutput,
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
