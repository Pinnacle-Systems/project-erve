#!/usr/bin/env node
// Idempotent, production-safe installer for the current garment GST Rule
// Set identity and band DEFINITION (GST-GARMENT-STD, <=2500: 5%, >2500:
// 18%) — see ensureCurrentGarmentGstRuleSet in gst-rule-sets.service.ts,
// the same function prisma/seed.ts calls for dev/test fixtures (one
// definition, shared, same pattern as quality-bootstrap-definitions.ts).
//
// Usage (from apps/api, or the packaged api/ release directory):
//   node gst-rule-set-bootstrap.js [--confirm-production]
//
// Deliberately does NOT activate the version or assert an effective date —
// no authoritative project data establishes when this rate became
// effective. It seeds a DRAFT version only; an authorized master-data user
// must supply the real effectiveFrom and activate it through the GST Rule
// Sets UI/API before it applies to anything.
//
// Safe to run repeatedly: a second run against an already-current database
// makes zero changes (idempotent by band content, not by status — it will
// not create a duplicate even after the seeded version has been activated
// or superseded).
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
  console.log(`Version ${result.versionId} (DRAFT if just created — no effective date was assumed).`);
  console.log('An authorized master-data user must supply a real effectiveFrom and activate it before use.');
}

main()
  .catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
