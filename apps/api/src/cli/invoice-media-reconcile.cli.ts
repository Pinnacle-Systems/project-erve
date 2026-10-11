#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { requireVerifiedDevDatabaseTarget } from '../modules/historical-import/dev-target-guard.js';
import { reconcileInvoiceImageArchives } from '../modules/fulfillment/tax-invoice-document.service.js';

// Recovery tooling only. Dry-run by default, explicit verified Dev target,
// no production activation, no draft cleanup or issued-image deletion.
async function main() {
  const { values } = parseArgs({
    options: { 'invoice-id': { type: 'string' }, apply: { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values['invoice-id']) throw new Error('--invoice-id is required');
  if (env.NODE_ENV === 'production')
    throw new Error('Invoice archive reconciliation is not authorized for production');
  requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.INVOICE_ARCHIVE_EXPECTED_DEV_DATABASE_URL,
  });
  console.log(
    JSON.stringify(
      await reconcileInvoiceImageArchives(values['invoice-id'], !values.apply),
      null,
      2,
    ),
  );
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Archive reconciliation failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
