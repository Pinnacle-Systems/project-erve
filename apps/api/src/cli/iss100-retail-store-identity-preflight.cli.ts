#!/usr/bin/env node
/**
 * Read-Only ISS-100 Retail Store Identity Preflight CLI.
 * Story: ISS-100 — Retail Store Identity in Erve Packing List and Dispatch.
 *
 * Reports (never modifies) the state of existing data against the new
 * retail-store-identity rule, so an operator can review what — if anything —
 * needs manual cleanup in Retail Store / Dispatch Order master data BEFORE
 * this change is deployed to that environment. No automatic backfill, no
 * inference of a Retail Store from address/name similarity: every finding
 * here is reported for a human to resolve through the real UI/API.
 *
 * GUARANTEE: Never writes, never backfills, never assigns a Retail Store.
 *
 * Usage (standalone Node.js from api/ or apps/api):
 *   node iss100-retail-store-identity-preflight.js \
 *     --target <local|dev|staging|production|test> \
 *     [--expect-database <name>] \
 *     [--expect-host <host>] \
 *     [--expect-schema <schema>] \
 *     [--env-file <path>] \
 *     [--json]
 */

import type { Prisma } from '../db/prisma.js';
import {
  loadRuntimeEnvironment,
  parseTargetEnvironment,
  inspectLiveDatabase,
  verifyDatabaseTarget,
  type TargetEnvironment,
} from './sequence-target-guard.js';

export function printHelp(): void {
  console.log(`
ERVE India — ISS-100 Retail Store Identity Preflight Diagnostic CLI
Read-only diagnostics for existing data against the "one Retail Store = one
destination" rule. Reports only — never writes, never backfills.

Usage:
  node iss100-retail-store-identity-preflight.js \\
    --target <local|dev|staging|production|test> \\
    [--expect-database <name>] \\
    [--expect-host <host>] \\
    [--expect-schema <schema>] \\
    [--env-file <path>] \\
    [--json]

Required arguments:
  --target            Target environment: local, dev, staging, production, or test.

Safety & Verification Options:
  --expect-database   Expected database name to verify against live connected database.
                      Required when target is production.
  --expect-host       Expected database host to verify against live connected host.
  --expect-schema     Expected database schema to verify against live connected schema.
  --env-file          Explicit path to environment file (e.g. /var/www/erve/shared/api.env).
  --json              Output report in machine-readable JSON format.
  --help, -h          Show this help message.

Example:
  node iss100-retail-store-identity-preflight.js \\
    --target production \\
    --expect-database erve_prod
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
loadRuntimeEnvironment({
  explicitEnvFile: getEarlyArg('--env-file'),
  scriptPath: process.argv[1],
});

const { prisma } = await import('../db/prisma.js');

interface Args {
  target: TargetEnvironment;
  jsonOutput: boolean;
  expectDatabase?: string;
  expectHost?: string;
  expectSchema?: string;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);
  return {
    target: parseTargetEnvironment(get('--target')),
    jsonOutput: has('--json'),
    expectDatabase: get('--expect-database'),
    expectHost: get('--expect-host'),
    expectSchema: get('--expect-schema'),
  };
}

interface NullStoreDestinationRow {
  id: string;
  saleOrderId: string;
  addressLine1: string;
  city: string;
  state: string;
  createdAt: Date;
}

interface InconsistentStoreOwnerRow {
  destinationId: string;
  saleOrderId: string;
  retailStoreId: string;
  destinationDistributorId: string;
  storeDistributorId: string | null;
  storeExists: boolean;
}

interface LegacyMatchKeyRow {
  id: string;
  ervePackingListNumber: string;
  destinationMatchKey: string | null;
  distributorId: string | null;
  createdAt: Date;
}

interface MixedStoreOpenEiplRow {
  id: string;
  ervePackingListNumber: string;
  distinctStores: bigint;
  cartonsMissingStore: bigint;
  cartonCount: bigint;
}

export interface Iss100PreflightReport {
  timestamp: string;
  environment: TargetEnvironment;
  destinationsWithNullRetailStoreId: { count: number; sample: NullStoreDestinationRow[] };
  destinationsWithInconsistentStoreOwnership: {
    count: number;
    sample: InconsistentStoreOwnerRow[];
  };
  openEiplsWithLegacyMatchKey: { count: number; sample: LegacyMatchKeyRow[] };
  openEiplsWithMixedOrMissingStores: { count: number; sample: MixedStoreOpenEiplRow[] };
  verdict: 'CLEAN' | 'FINDINGS REPORTED';
}

const SAMPLE_LIMIT = 20;

/**
 * Check 1 — Dispatch Order destinations with no linked Retail Store at all.
 * Under the new rule these are the destinations that must be corrected
 * (by editing the Dispatch Order and selecting a real Store) before they can
 * ever participate in Erve consolidation again.
 */
async function findNullRetailStoreDestinations(
  client: Prisma.TransactionClient,
): Promise<{ count: number; sample: NullStoreDestinationRow[] }> {
  const [{ count }] = await client.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM sale_order_destinations WHERE retail_store_id IS NULL
  `;
  const sample = await client.$queryRaw<NullStoreDestinationRow[]>`
    SELECT id, sale_order_id AS "saleOrderId", address_line1 AS "addressLine1",
      city, state, created_at AS "createdAt"
    FROM sale_order_destinations
    WHERE retail_store_id IS NULL
    ORDER BY created_at ASC
    LIMIT ${SAMPLE_LIMIT}
  `;
  return { count: Number(count), sample };
}

/**
 * Check 2 — A linked Retail Store that is either missing entirely (dangling
 * reference) or belongs to a different Distributor than the destination's
 * own Distributor group. Both are already DB-trigger/FK-enforced at write
 * time, so a non-empty result here would indicate the invariant was
 * bypassed outside the normal API (e.g. a direct SQL session) — reported,
 * never auto-corrected.
 */
async function findInconsistentStoreOwnership(
  client: Prisma.TransactionClient,
): Promise<{ count: number; sample: InconsistentStoreOwnerRow[] }> {
  const rows = await client.$queryRaw<
    Array<{
      destinationId: string;
      saleOrderId: string;
      retailStoreId: string;
      destinationDistributorId: string;
      storeDistributorId: string | null;
      storeExists: boolean;
    }>
  >`
    SELECT d.id AS "destinationId", d.sale_order_id AS "saleOrderId",
      d.retail_store_id AS "retailStoreId", g.distributor_id AS "destinationDistributorId",
      s.distributor_id AS "storeDistributorId", (s.id IS NOT NULL) AS "storeExists"
    FROM sale_order_destinations d
    JOIN sale_order_distributors g ON g.id = d.sale_order_distributor_id
    LEFT JOIN retail_stores s ON s.id = d.retail_store_id
    WHERE d.retail_store_id IS NOT NULL
      AND (s.id IS NULL OR s.distributor_id <> g.distributor_id)
    ORDER BY d.created_at ASC
    LIMIT ${SAMPLE_LIMIT}
  `;
  const [{ count }] = await client.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM sale_order_destinations d
    JOIN sale_order_distributors g ON g.id = d.sale_order_distributor_id
    LEFT JOIN retail_stores s ON s.id = d.retail_store_id
    WHERE d.retail_store_id IS NOT NULL
      AND (s.id IS NULL OR s.distributor_id <> g.distributor_id)
  `;
  return { count: Number(count), sample: rows };
}

/**
 * Check 3 — OPEN Erve Packing Lists still carrying a pre-ISS-100
 * address-based destinationMatchKey (anything non-null that isn't the new
 * "STORE:<id>" format). These can no longer accept Add Carton or Finalize
 * under the new rule (the code already fails them closed), but they are
 * listed here explicitly so an operator can decide whether to leave them
 * as-is (still finalizable with their current members, if ever reopened for
 * review) or recreate them after Retail Store cleanup.
 */
async function findLegacyMatchKeyOpenEipls(
  client: Prisma.TransactionClient,
): Promise<{ count: number; sample: LegacyMatchKeyRow[] }> {
  const [{ count }] = await client.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM erve_packing_lists
    WHERE status = 'OPEN' AND destination_match_key IS NOT NULL
      AND destination_match_key NOT LIKE 'STORE:%'
  `;
  const sample = await client.$queryRaw<LegacyMatchKeyRow[]>`
    SELECT id, erve_packing_list_number AS "ervePackingListNumber",
      destination_match_key AS "destinationMatchKey", distributor_id AS "distributorId",
      created_at AS "createdAt"
    FROM erve_packing_lists
    WHERE status = 'OPEN' AND destination_match_key IS NOT NULL
      AND destination_match_key NOT LIKE 'STORE:%'
    ORDER BY created_at ASC
    LIMIT ${SAMPLE_LIMIT}
  `;
  return { count: Number(count), sample };
}

/**
 * Check 4 — OPEN Erve Packing Lists whose current (non-retired) member
 * cartons already span more than one distinct Retail Store, or include a
 * carton whose destination has no linked Store at all. These were only
 * possible because of the OLD address-based matching and must be reported
 * for manual review/recreation — they are never safe to finalize as-is
 * under the new rule, and the code's finalize-time cross-check will reject
 * them if attempted.
 */
async function findMixedOrMissingStoreOpenEipls(
  client: Prisma.TransactionClient,
): Promise<{ count: number; sample: MixedStoreOpenEiplRow[] }> {
  const rows = await client.$queryRaw<MixedStoreOpenEiplRow[]>`
    SELECT epl.id, epl.erve_packing_list_number AS "ervePackingListNumber",
      COUNT(DISTINCT d.retail_store_id)::bigint AS "distinctStores",
      COUNT(*) FILTER (WHERE d.retail_store_id IS NULL)::bigint AS "cartonsMissingStore",
      COUNT(*)::bigint AS "cartonCount"
    FROM erve_packing_lists epl
    JOIN factory_packing_cartons c ON c.erve_packing_list_id = epl.id AND c.retired_at IS NULL
    JOIN sale_order_destinations d ON d.id = c.destination_id
    WHERE epl.status = 'OPEN'
    GROUP BY epl.id, epl.erve_packing_list_number
    HAVING COUNT(DISTINCT d.retail_store_id) > 1
      OR COUNT(*) FILTER (WHERE d.retail_store_id IS NULL) > 0
    ORDER BY epl.id
    LIMIT ${SAMPLE_LIMIT}
  `;
  return { count: rows.length, sample: rows };
}

export async function runIss100Preflight(
  client: Prisma.TransactionClient,
  environment: TargetEnvironment,
): Promise<Iss100PreflightReport> {
  const [nullStore, inconsistentOwnership, legacyMatchKey, mixedStoreEipls] = await Promise.all([
    findNullRetailStoreDestinations(client),
    findInconsistentStoreOwnership(client),
    findLegacyMatchKeyOpenEipls(client),
    findMixedOrMissingStoreOpenEipls(client),
  ]);
  const anyFindings =
    nullStore.count > 0 ||
    inconsistentOwnership.count > 0 ||
    legacyMatchKey.count > 0 ||
    mixedStoreEipls.count > 0;
  return {
    timestamp: new Date().toISOString(),
    environment,
    destinationsWithNullRetailStoreId: nullStore,
    destinationsWithInconsistentStoreOwnership: inconsistentOwnership,
    openEiplsWithLegacyMatchKey: legacyMatchKey,
    openEiplsWithMixedOrMissingStores: mixedStoreEipls,
    verdict: anyFindings ? 'FINDINGS REPORTED' : 'CLEAN',
  };
}

function printFormattedReport(report: Iss100PreflightReport): void {
  console.log('======================================================================');
  console.log('ERVE India — ISS-100 Retail Store Identity Preflight Diagnostic Report');
  console.log('======================================================================');
  console.log(`Timestamp:            ${report.timestamp}`);
  console.log(`Target Environment:   ${report.environment}`);
  console.log(`Verdict:              ${report.verdict}`);
  console.log('----------------------------------------------------------------------');
  console.log(
    `1. Destinations with no linked Retail Store:          ${report.destinationsWithNullRetailStoreId.count}`,
  );
  console.log(
    `2. Destinations with inconsistent/invalid Store ref:   ${report.destinationsWithInconsistentStoreOwnership.count}`,
  );
  console.log(
    `3. OPEN EIPLs with a legacy address-based match key:    ${report.openEiplsWithLegacyMatchKey.count}`,
  );
  console.log(
    `4. OPEN EIPLs spanning >1 Store or a storeless carton:  ${report.openEiplsWithMixedOrMissingStores.count}`,
  );
  console.log('----------------------------------------------------------------------');
  if (report.destinationsWithNullRetailStoreId.count > 0) {
    console.log(`Sample — destinations with no linked Retail Store (up to ${SAMPLE_LIMIT}):`);
    for (const row of report.destinationsWithNullRetailStoreId.sample) {
      console.log(
        `  destination ${row.id} (Dispatch Order ${row.saleOrderId}): ${row.addressLine1}, ${row.city}, ${row.state}`,
      );
    }
    console.log('');
  }
  if (report.destinationsWithInconsistentStoreOwnership.count > 0) {
    console.log(`Sample — inconsistent/invalid Store references (up to ${SAMPLE_LIMIT}):`);
    for (const row of report.destinationsWithInconsistentStoreOwnership.sample) {
      console.log(
        `  destination ${row.destinationId} (Dispatch Order ${row.saleOrderId}): retailStoreId=${row.retailStoreId}, storeExists=${row.storeExists}, destinationDistributorId=${row.destinationDistributorId}, storeDistributorId=${row.storeDistributorId ?? 'N/A'}`,
      );
    }
    console.log('');
  }
  if (report.openEiplsWithLegacyMatchKey.count > 0) {
    console.log(`Sample — OPEN EIPLs with a legacy match key (up to ${SAMPLE_LIMIT}):`);
    for (const row of report.openEiplsWithLegacyMatchKey.sample) {
      console.log(`  ${row.ervePackingListNumber} (${row.id}): destinationMatchKey="${row.destinationMatchKey}"`);
    }
    console.log('');
  }
  if (report.openEiplsWithMixedOrMissingStores.count > 0) {
    console.log(`Sample — OPEN EIPLs spanning multiple Stores / missing a Store (up to ${SAMPLE_LIMIT}):`);
    for (const row of report.openEiplsWithMixedOrMissingStores.sample) {
      console.log(
        `  ${row.ervePackingListNumber} (${row.id}): ${row.cartonCount} cartons, ${row.distinctStores} distinct Stores, ${row.cartonsMissingStore} storeless cartons`,
      );
    }
    console.log('');
  }
  console.log('======================================================================');
  if (report.verdict === 'CLEAN') {
    console.log('VERDICT: CLEAN — no findings. No cleanup required before deploying ISS-100.');
  } else {
    console.log(
      'VERDICT: FINDINGS REPORTED — review each category above and correct through the real UI/API ' +
        '(Retail Store selection, Dispatch Order edit) before relying on cross-Dispatch-Order Erve ' +
        'consolidation for the affected records. Nothing has been modified by this script.',
    );
  }
  console.log('======================================================================');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const liveTarget = await inspectLiveDatabase(prisma, process.env.DATABASE_URL);
  verifyDatabaseTarget(
    {
      target: args.target,
      nodeEnv: process.env.NODE_ENV,
      configuredDatabaseUrl: process.env.DATABASE_URL,
      expectedDatabase: args.expectDatabase,
      expectedHost: args.expectHost,
      expectedSchema: args.expectSchema,
      isMutation: false,
    },
    liveTarget,
  );

  const report = await runIss100Preflight(prisma, args.target);

  if (args.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printFormattedReport(report);
  }

  process.exitCode = report.verdict === 'CLEAN' ? 0 : 1;
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('iss100-retail-store-identity-preflight.cli.ts') ||
    process.argv[1].endsWith('iss100-retail-store-identity-preflight.js') ||
    process.argv[1].endsWith('iss100-retail-store-identity-preflight.ts') ||
    process.argv[1].endsWith('iss100-retail-store-identity-preflight'))
) {
  main()
    .catch((err: unknown) => {
      console.error('ISS-100 preflight diagnostic execution failed:');
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
