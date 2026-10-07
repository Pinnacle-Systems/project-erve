#!/usr/bin/env node
// Idempotent, production-safe installer for the current garment GST Rule
// Set (GST-GARMENT-STD, <=2500: 5%, >2500: 18%) — see
// ensureCurrentGarmentGstRuleSet in gst-rule-sets.service.ts, the same
// function prisma/seed.ts calls for dev/test fixtures (one definition,
// shared, same pattern as quality-bootstrap-definitions.ts).
//
// Usage (from apps/api, or the packaged api/ release directory):
//   node gst-rule-set-bootstrap.js [--confirm-production]
//
// Safe to run repeatedly: a second run against an already-current database
// makes zero changes (it only ever creates the rule set + its first ACTIVE
// version if neither already exists).
import { prisma } from '../db/prisma.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import { ensureCurrentGarmentGstRuleSet } from '../modules/tax-rules/gst-rule-sets.service.js';

class CliError extends Error {}

function parseArgs(argv: string[]) {
  if (process.env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) {
    throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
  }
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeDatabaseTarget(process.env.DATABASE_URL ?? '')}`);

  const result = await ensureCurrentGarmentGstRuleSet(null);
  console.log(`GST Rule Set ${result.gstRuleSetId}: ${result.action}`);
  console.log(`ACTIVE version: ${result.versionId}`);
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
