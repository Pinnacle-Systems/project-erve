#!/usr/bin/env node
// Idempotent production-safe Financial Year reference-data bootstrap.
//
// Usage (from apps/api, or the packaged api/ release directory):
//   node financial-year-bootstrap.js [--confirm-production]
//
// Ensures a rolling window of Financial Year rows exist (3 years back
// through 5 years ahead of today's business date) so GET /financial-years,
// GET /financial-years/current, and Season creation never depend on a
// Purchase Order or Job Order having been created first. No ordering
// dependency on admin-bootstrap/roles-bootstrap/quality-bootstrap —
// FinancialYear has no foreign-key relationship to Role, User, QualityForm,
// or ProcessFlow. See DEPLOYMENT.md.
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { runFinancialYearBootstrap, FinancialYearBootstrapError } from './financial-year-bootstrap.js';

async function main(): Promise<void> {
  const confirmProduction = process.argv.slice(2).includes('--confirm-production');

  const result = await runFinancialYearBootstrap(
    { nodeEnv: env.NODE_ENV, confirmProduction },
    { databaseUrl: env.DATABASE_URL },
  );

  console.log(`financial years ensured: ${result.financialYears.map((fy) => fy.code).join(', ')}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof FinancialYearBootstrapError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while bootstrapping Financial Years:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
