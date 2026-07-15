#!/usr/bin/env node
// Idempotent production-safe role reference-data bootstrap.
//
// Usage (from apps/api, or the packaged api/ release directory):
//   node roles-bootstrap.js [--confirm-production]
//
// Ensures every supported role (ADMIN, MERCHANDISER, FACTORY_USER,
// QA_USER, ACCOUNTANT, DISTRIBUTOR, SENIOR_MANAGEMENT) exists as a Role
// row. `admin-bootstrap.js` already does this as part of its own
// transaction, so running this on its own is only needed when you want
// role reference data in place without creating/touching the admin user
// (see DEPLOYMENT.md, "Admin user bootstrap").
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { runRolesBootstrap, RolesBootstrapError } from './roles-bootstrap.js';

async function main(): Promise<void> {
  const confirmProduction = process.argv.slice(2).includes('--confirm-production');

  const result = await runRolesBootstrap(
    { nodeEnv: env.NODE_ENV, confirmProduction },
    { databaseUrl: env.DATABASE_URL },
  );

  console.log(`roles ensured: ${result.roles.join(', ')}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof RolesBootstrapError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while bootstrapping roles:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
