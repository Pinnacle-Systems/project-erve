#!/usr/bin/env node
// Idempotent production-safe Quality Form / Process Flow bootstrap.
//
// Usage (from apps/api, or the packaged api/ release directory):
//   node quality-bootstrap.js [--confirm-production] [--dry-run]
//
// Installs or upgrades the canonical Quality Forms (SAMPLE, PPM, INLINE,
// FINAL) and the ERVE_PRODUCTION_QUALITY Process Flow, reusing an existing
// semantically-matching version wherever one already exists instead of
// minting a duplicate. Safe to run repeatedly: a second run against an
// already-current database makes zero changes. No dependency on
// admin-bootstrap/roles-bootstrap — Quality Forms and Process Flows have no
// foreign-key relationship to Role or User.
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import {
  runQualityBootstrap,
  QualityBootstrapError,
  type QualityBootstrapResult,
  type QualityFormBootstrapOutcome,
  type ProcessFlowBootstrapOutcome,
} from './quality-bootstrap.js';

function parseArgs(argv: string[]): { confirmProduction: boolean; dryRun: boolean } {
  return {
    confirmProduction: argv.includes('--confirm-production'),
    dryRun: argv.includes('--dry-run'),
  };
}

function formatFormSection(outcome: QualityFormBootstrapOutcome): string {
  const lines = [outcome.code];
  switch (outcome.action) {
    case 'unchanged':
      lines.push(`  Current canonical definition found: v${outcome.versionNumber}`);
      lines.push('  No change');
      break;
    case 'created_version':
      lines.push('  Current definition differs');
      if (outcome.historicalMatch) {
        lines.push(
          `  Canonical definition matches historical ${outcome.historicalMatch.status.toLowerCase()} ` +
            `v${outcome.historicalMatch.versionNumber}.`,
        );
        lines.push(`  Historical version will remain ${outcome.historicalMatch.status.toLowerCase()}.`);
      }
      lines.push(`  Created canonical version: v${outcome.versionNumber}`);
      break;
  }
  if (outcome.retiredVersionNumbers.length > 0) {
    lines.push(`  Retired: ${outcome.retiredVersionNumbers.map((v) => `v${v}`).join(', ')}`);
  }
  return lines.join('\n');
}

function formatProcessFlowSection(processFlow: ProcessFlowBootstrapOutcome): string {
  const lines = [processFlow.code];
  switch (processFlow.action) {
    case 'unchanged':
      lines.push(`  Existing ACTIVE definition matches the canonical definition: v${processFlow.versionNumber}`);
      lines.push('  No change');
      break;
    case 'created_version':
      lines.push('  Existing ACTIVE definition differs');
      if (processFlow.historicalMatch) {
        lines.push(
          `  Canonical definition matches historical ${processFlow.historicalMatch.status.toLowerCase()} ` +
            `v${processFlow.historicalMatch.versionNumber}.`,
        );
        lines.push(`  Historical version will remain ${processFlow.historicalMatch.status.toLowerCase()}.`);
      }
      lines.push(`  Created canonical definition: v${processFlow.versionNumber}`);
      break;
  }

  const inline = processFlow.stages.find((stage) => stage.code === 'INLINE');
  const final = processFlow.stages.find((stage) => stage.code === 'FINAL');
  lines.push('');
  if (inline) lines.push(`  INLINE -> ${inline.associatedProductionActivityCode}`);
  if (final) {
    lines.push(`  FINAL -> ${final.associatedProductionActivityCode}`);
    lines.push(`  FINAL multiplicity -> ${final.executionMultiplicity}`);
    lines.push(`  FINAL coverage -> ${final.coverageTarget}`);
  }

  if (processFlow.retiredVersionNumbers.length > 0 || processFlow.action !== 'unchanged') {
    lines.push('');
    if (processFlow.retiredVersionNumbers.length > 0) {
      lines.push(`  Retired: ${processFlow.retiredVersionNumbers.map((v) => `v${v}`).join(', ')}`);
    }
    if (processFlow.action !== 'unchanged') {
      lines.push(`  Activated v${processFlow.versionNumber}`);
    }
  }
  return lines.join('\n');
}

function formatReport(result: QualityBootstrapResult): string {
  const inline = result.processFlow.stages.find((stage) => stage.code === 'INLINE');
  const final = result.processFlow.stages.find((stage) => stage.code === 'FINAL');

  const lines = [
    'Quality configuration bootstrap',
    result.dryRun ? '(dry run — no changes will be written)' : undefined,
    '',
    ...result.forms.flatMap((form) => [formatFormSection(form), '']),
    formatProcessFlowSection(result.processFlow),
    '',
    'Production percentage completion configuration: NONE',
    'Inline PRODUCTION_PROGRESS component: NONE in canonical definition',
    `Inline association: ${inline?.associatedProductionActivityCode ?? 'NONE'}`,
    `Final association: ${final?.associatedProductionActivityCode ?? 'NONE'}`,
    `Final multiplicity: ${final?.executionMultiplicity ?? 'NONE'}`,
    `Final coverage: ${final?.coverageTarget ?? 'NONE'}`,
    '',
    result.dryRun ? 'Dry run completed successfully — no changes were written.' : 'Bootstrap completed successfully',
  ].filter((line): line is string => line !== undefined);

  return lines.join('\n');
}

async function main(): Promise<void> {
  const { confirmProduction, dryRun } = parseArgs(process.argv.slice(2));

  const result = await runQualityBootstrap(
    { nodeEnv: env.NODE_ENV, confirmProduction, dryRun },
    { databaseUrl: env.DATABASE_URL },
  );

  console.log(formatReport(result));
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof QualityBootstrapError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while bootstrapping quality configuration:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
