import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { Prisma, DocumentType } from '../db/prisma.js';

export class DocumentSequenceBaselineError extends Error {}

export type TargetEnvironment = 'LOCAL' | 'DEV' | 'STAGING' | 'PRODUCTION' | 'TEST';

export const VALID_TARGETS: TargetEnvironment[] = ['LOCAL', 'DEV', 'STAGING', 'PRODUCTION', 'TEST'];

export interface LiveDatabaseTarget {
  databaseName: string;
  serverAddress: string;   // live server address reported by postgres via inet_server_addr()
  serverPort: string;      // live server port reported by postgres via inet_server_port()
  configuredHost: string;  // host parsed from DATABASE_URL
  configuredPort: string;  // port parsed from DATABASE_URL
  schema: string;          // live schema reported by current_schema()
}

export interface SequenceTargetGuardOptions {
  target: TargetEnvironment;
  nodeEnv?: string;
  configuredDatabaseUrl?: string;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedSchema?: string;
  confirmProduction?: boolean;
  isMutation?: boolean; // true for baseline setting, false for read-only preflight
}

export interface LoadEnvOptions {
  explicitEnvFile?: string;
  scriptPath?: string;
  cwd?: string;
}

/**
 * Predictably loads runtime environment configuration:
 * 1. Explicit --env-file <path> if provided (throws if missing).
 * 2. Next to the executed script (e.g. /var/www/erve/current/api/.env on VPS).
 * 3. VPS shared directory /var/www/erve/shared/api.env if present.
 * 4. Current working directory .env.
 * 5. Monorepo development directory apps/api/.env.
 */
export function loadRuntimeEnvironment(options?: LoadEnvOptions): {
  loadedPath?: string;
  configuredUrl?: string;
} {
  const cwd = options?.cwd || process.cwd();

  if (options?.explicitEnvFile) {
    const resolvedPath = path.resolve(cwd, options.explicitEnvFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new DocumentSequenceBaselineError(
        `Specified --env-file not found: "${resolvedPath}"`,
      );
    }
    dotenv.config({ path: resolvedPath });
    return { loadedPath: resolvedPath, configuredUrl: process.env.DATABASE_URL };
  }

  const candidatePaths: string[] = [];

  // 1. Next to the script itself (e.g. api/.env in production release)
  if (options?.scriptPath) {
    candidatePaths.push(path.join(path.dirname(path.resolve(options.scriptPath)), '.env'));
  } else if (process.argv[1]) {
    candidatePaths.push(path.join(path.dirname(path.resolve(process.argv[1])), '.env'));
  }

  // 2. Production VPS shared directory
  candidatePaths.push('/var/www/erve/shared/api.env');

  // 3. Current working directory
  candidatePaths.push(path.join(cwd, '.env'));

  // 4. Monorepo development directory
  candidatePaths.push(path.join(cwd, 'apps', 'api', '.env'));

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        return { loadedPath: candidate, configuredUrl: process.env.DATABASE_URL };
      }
    } catch {
      // Ignore filesystem permission or path resolution errors on candidates
    }
  }

  // Default dotenv fallback if no candidate file matched
  dotenv.config();
  return { loadedPath: undefined, configuredUrl: process.env.DATABASE_URL };
}

/**
 * Normalizes and validates the target environment string.
 */
export function parseTargetEnvironment(targetRaw: string | undefined): TargetEnvironment {
  if (!targetRaw || !targetRaw.trim()) {
    throw new DocumentSequenceBaselineError(
      `--target is required and must be one of: ${VALID_TARGETS.map((t) => t.toLowerCase()).join(', ')}`,
    );
  }
  const normalized = targetRaw.trim().toUpperCase() as TargetEnvironment;
  if (!VALID_TARGETS.includes(normalized)) {
    throw new DocumentSequenceBaselineError(
      `Invalid --target "${targetRaw}". Must be one of: ${VALID_TARGETS.map((t) => t.toLowerCase()).join(', ')}`,
    );
  }
  return normalized;
}

/**
 * Parses connection parameters from DATABASE_URL safely, without credentials.
 */
export function parseConfiguredDatabaseTarget(databaseUrl?: string): {
  host: string;
  port: string;
  database: string;
  schema: string;
} {
  if (!databaseUrl) {
    return { host: 'unknown', port: '5432', database: 'unknown', schema: 'public' };
  }
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname || 'localhost';
    const port = parsed.port || '5432';
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'unknown';
    const schema = parsed.searchParams.get('schema') || 'public';
    return { host, port, database, schema };
  } catch {
    return { host: 'unparseable', port: '5432', database: 'unknown', schema: 'public' };
  }
}

/**
 * Reads live database parameters directly over the active database connection.
 * Explicitly separates server-reported address (inet_server_addr) from configured endpoint.
 */
export async function inspectLiveDatabase(
  client: { $queryRaw: Prisma.TransactionClient['$queryRaw'] },
  configuredDatabaseUrl?: string,
): Promise<LiveDatabaseTarget> {
  const configured = parseConfiguredDatabaseTarget(configuredDatabaseUrl);

  const rows = await client.$queryRaw<
    Array<{
      db: string;
      addr: string | null;
      port: string | null;
      schema: string;
    }>
  >`
    SELECT
      current_database() AS db,
      coalesce(inet_server_addr()::text, '') AS addr,
      coalesce(inet_server_port()::text, '') AS port,
      current_schema() AS schema
  `;

  const row = rows[0];
  const liveDb = row?.db ?? configured.database;
  const liveSchema = row?.schema ?? configured.schema;
  const serverAddr = row?.addr || '';
  const serverPort = row?.port || '';

  return {
    databaseName: liveDb,
    serverAddress: serverAddr,
    serverPort: serverPort,
    configuredHost: configured.host,
    configuredPort: configured.port,
    schema: liveSchema,
  };
}

/**
 * Enforces production-target safety rules:
 * - Reject contradictory environment configuration (e.g. NODE_ENV=production but target=dev, or target=production but NODE_ENV=development).
 * - For production mutation (baseline CLI):
 *     1. Require explicit confirmation via --confirm-production.
 *     2. Require --expect-database <name> and independently verify against live current_database().
 *     3. Require --expect-schema <schema> and independently verify against live current_schema().
 * - For production read-only preflight:
 *     1. Require --expect-database <name> and independently verify against live current_database().
 *     2. Verify --expect-schema if provided.
 *     3. Do not require --confirm-production (preflight never mutates).
 * - Distinguish server-reported address from configured endpoint; verify --expect-host when supplied.
 * - Never leak database passwords, connection strings, or credentials.
 * - Fails closed on any ambiguity.
 */
export function verifyDatabaseTarget(
  options: SequenceTargetGuardOptions,
  liveTarget: LiveDatabaseTarget,
): void {
  const {
    target,
    nodeEnv,
    expectedDatabase,
    expectedHost,
    expectedSchema,
    confirmProduction,
    isMutation = true,
  } = options;
  const normalizedNodeEnv = nodeEnv?.trim().toLowerCase();

  // 1. Contradictory environment configuration checks (fail-closed)
  if (normalizedNodeEnv === 'production' && target !== 'PRODUCTION') {
    throw new DocumentSequenceBaselineError(
      `Conflicting environment configuration: NODE_ENV is "production" but --target was specified as "${target.toLowerCase()}". ` +
        'Production environments cannot be targeted as non-production.',
    );
  }

  if (target === 'PRODUCTION') {
    if (normalizedNodeEnv === 'development') {
      throw new DocumentSequenceBaselineError(
        'Conflicting environment configuration: --target is "production" but NODE_ENV is "development".',
      );
    }
    if (normalizedNodeEnv === 'test') {
      throw new DocumentSequenceBaselineError(
        'Conflicting environment configuration: --target is "production" but NODE_ENV is "test".',
      );
    }

    // 2. Mandatory independent database verification for production (both mutation and read-only)
    if (!expectedDatabase || !expectedDatabase.trim()) {
      throw new DocumentSequenceBaselineError(
        'Production target requires --expect-database <name> to independently verify connected database identity.',
      );
    }

    // 3. Mutation-specific production safeguards
    if (isMutation) {
      if (!confirmProduction) {
        throw new DocumentSequenceBaselineError(
          'Production execution requires explicit confirmation via --confirm-production.',
        );
      }

      // Mandatory expected schema for production mutation
      if (!expectedSchema || !expectedSchema.trim()) {
        throw new DocumentSequenceBaselineError(
          'Production mutation requires --expect-schema <schema> (e.g. "public") to explicitly verify target database schema.',
        );
      }
    }
  }

  // 4. Expected database comparison (if provided or enforced above)
  if (expectedDatabase && expectedDatabase.trim()) {
    const trimmedExpected = expectedDatabase.trim();
    if (liveTarget.databaseName.toLowerCase() !== trimmedExpected.toLowerCase()) {
      throw new DocumentSequenceBaselineError(
        `Database identity mismatch: live current_database() is "${liveTarget.databaseName}", ` +
          `but --expect-database specified "${trimmedExpected}".`,
      );
    }
  }

  // 5. Expected schema comparison (if provided or enforced above)
  if (expectedSchema && expectedSchema.trim()) {
    const trimmedExpectedSchema = expectedSchema.trim().toLowerCase();
    const liveSchemaNormalized = liveTarget.schema.toLowerCase();
    if (liveSchemaNormalized !== trimmedExpectedSchema) {
      throw new DocumentSequenceBaselineError(
        `Database schema mismatch: connected schema is "${liveTarget.schema}", ` +
          `but --expect-schema specified "${trimmedExpectedSchema}".`,
      );
    }
  }

  // 6. Expected host comparison (if provided)
  // Compares against both configured endpoint host and server-reported address
  if (expectedHost && expectedHost.trim()) {
    const trimmedExpectedHost = expectedHost.trim().toLowerCase();
    const configuredHostMatch = liveTarget.configuredHost.toLowerCase() === trimmedExpectedHost;
    const serverAddressMatch = liveTarget.serverAddress.toLowerCase() === trimmedExpectedHost;

    if (!configuredHostMatch && !serverAddressMatch) {
      const serverAddrDisplay = liveTarget.serverAddress || 'unavailable';
      throw new DocumentSequenceBaselineError(
        `Database host mismatch: configured endpoint host is "${liveTarget.configuredHost}" ` +
          `and server-reported address is "${serverAddrDisplay}", but --expect-host specified "${trimmedExpectedHost}".`,
      );
    }
  }
}

/**
 * Renders a sanitized multiline operation summary for operator review.
 * Credentials, passwords, and sensitive connection strings are NEVER included.
 * Separates configured DB endpoint from server-reported address.
 */
export function formatOperationSummary(params: {
  target: TargetEnvironment;
  liveTarget: LiveDatabaseTarget;
  documentType: DocumentType;
  financialYearCode: string;
  approvedSerial: number;
  currentBaseline?: number;
  sequenceExists?: boolean;
  dryRun?: boolean;
}): string {
  const {
    target,
    liveTarget,
    documentType,
    financialYearCode,
    approvedSerial,
    currentBaseline,
    sequenceExists,
    dryRun,
  } = params;

  let actionDescription: string;
  if (sequenceExists === false) {
    actionDescription = `INITIALIZE sequence at ${approvedSerial} (next allocated serial will be ${approvedSerial + 1})`;
  } else if (currentBaseline !== undefined && approvedSerial === currentBaseline) {
    actionDescription = `NO-OP (sequence is already at baseline ${approvedSerial})`;
  } else if (currentBaseline !== undefined && approvedSerial > currentBaseline) {
    actionDescription = `ADVANCE sequence from ${currentBaseline} to ${approvedSerial} (next allocated serial will be ${approvedSerial + 1})`;
  } else {
    actionDescription = `SET sequence baseline to ${approvedSerial} (next allocated serial will be ${approvedSerial + 1})`;
  }

  const serverAddressDisplay = liveTarget.serverAddress
    ? `${liveTarget.serverAddress}:${liveTarget.serverPort}`
    : 'local socket / unavailable';

  const lines = [
    '======================================================================',
    `ERVE India — Document Sequence Baseline ${dryRun ? '[DRY RUN] ' : ''}Operation Summary`,
    '======================================================================',
    `Target Environment:      ${target}`,
    `Configured Endpoint:     ${liveTarget.configuredHost}:${liveTarget.configuredPort}`,
    `Server-Reported Address: ${serverAddressDisplay}`,
    `Database Name:           ${liveTarget.databaseName}`,
    `Database Schema:         ${liveTarget.schema}`,
    `Document Type:           ${documentType}`,
    `Financial Year:          ${financialYearCode}`,
    `Requested Serial:        ${approvedSerial}`,
    `Current Baseline:        ${sequenceExists === false ? 'Uninitialized (row does not exist)' : (currentBaseline ?? 'Unknown')}`,
    `Action:                  ${actionDescription}`,
    '======================================================================',
  ];

  return lines.join('\n');
}
