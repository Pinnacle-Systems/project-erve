import type { Prisma, DocumentType } from '../db/prisma.js';
import { DocumentSequenceBaselineError } from './document-sequence-baseline.js';

export type TargetEnvironment = 'LOCAL' | 'DEV' | 'STAGING' | 'PRODUCTION' | 'TEST';

export const VALID_TARGETS: TargetEnvironment[] = ['LOCAL', 'DEV', 'STAGING', 'PRODUCTION', 'TEST'];

export interface LiveDatabaseTarget {
  databaseName: string;
  serverHost: string;
  serverPort: string;
  schema: string;
}

export interface SequenceTargetGuardOptions {
  target: TargetEnvironment;
  nodeEnv?: string;
  configuredDatabaseUrl?: string;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedSchema?: string;
  confirmProduction?: boolean;
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
  const liveHost = configured.host !== 'unknown' && configured.host !== 'unparseable'
    ? configured.host
    : (row?.addr || 'localhost');
  const livePort = configured.port || (row?.port || '5432');

  return {
    databaseName: liveDb,
    serverHost: liveHost,
    serverPort: livePort,
    schema: liveSchema,
  };
}

/**
 * Enforces production-target safety rules:
 * - Reject contradictory environment configuration (e.g. NODE_ENV=production but target=dev, or target=production but NODE_ENV=development).
 * - Require explicit --confirm-production when target is PRODUCTION or NODE_ENV is production.
 * - Require --expect-database for PRODUCTION targets and independently verify connected database name.
 * - Verify --expect-host and --expect-schema when supplied.
 * - Never leak database passwords or credentials.
 */
export function verifyDatabaseTarget(
  options: SequenceTargetGuardOptions,
  liveTarget: LiveDatabaseTarget,
): void {
  const { target, nodeEnv, expectedDatabase, expectedHost, expectedSchema, confirmProduction } = options;
  const normalizedNodeEnv = nodeEnv?.trim().toLowerCase();

  // 1. Contradictory environment configuration checks
  if (normalizedNodeEnv === 'production' && target !== 'PRODUCTION') {
    throw new DocumentSequenceBaselineError(
      `Conflicting environment configuration: NODE_ENV is "production" but --target was specified as "${target.toLowerCase()}". ` +
        'Production environments cannot be targeted as non-production.',
    );
  }

  if (target === 'PRODUCTION') {
    if (normalizedNodeEnv === 'development') {
      throw new DocumentSequenceBaselineError(
        `Conflicting environment configuration: --target is "production" but NODE_ENV is "development".`,
      );
    }
    if (normalizedNodeEnv === 'test') {
      throw new DocumentSequenceBaselineError(
        `Conflicting environment configuration: --target is "production" but NODE_ENV is "test".`,
      );
    }

    // 2. Production authorization confirmation check
    if (!confirmProduction) {
      throw new DocumentSequenceBaselineError(
        'Production execution requires explicit confirmation via --confirm-production.',
      );
    }

    // 3. Mandatory independent database verification for production
    if (!expectedDatabase || !expectedDatabase.trim()) {
      throw new DocumentSequenceBaselineError(
        'Production target requires --expect-database <name> to independently verify connected database identity.',
      );
    }
  }

  // 4. Expected database comparison (if provided)
  if (expectedDatabase && expectedDatabase.trim()) {
    const trimmedExpected = expectedDatabase.trim();
    if (liveTarget.databaseName.toLowerCase() !== trimmedExpected.toLowerCase()) {
      throw new DocumentSequenceBaselineError(
        `Database identity mismatch: live current_database() is "${liveTarget.databaseName}", ` +
          `but --expect-database specified "${trimmedExpected}".`,
      );
    }
  }

  // 5. Expected host comparison (if provided)
  if (expectedHost && expectedHost.trim()) {
    const trimmedExpectedHost = expectedHost.trim().toLowerCase();
    const liveHostNormalized = liveTarget.serverHost.toLowerCase();
    if (liveHostNormalized !== trimmedExpectedHost) {
      throw new DocumentSequenceBaselineError(
        `Database host mismatch: connected host is "${liveTarget.serverHost}", ` +
          `but --expect-host specified "${trimmedExpectedHost}".`,
      );
    }
  }

  // 6. Expected schema comparison (if provided)
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
}

/**
 * Renders a sanitized multiline operation summary for operator review.
 * Credentials, passwords, and sensitive connection strings are NEVER included.
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

  const lines = [
    '======================================================================',
    `ERVE India — Document Sequence Baseline ${dryRun ? '[DRY RUN] ' : ''}Operation Summary`,
    '======================================================================',
    `Target Environment:  ${target}`,
    `Database Host:       ${liveTarget.serverHost}:${liveTarget.serverPort}`,
    `Database Name:       ${liveTarget.databaseName}`,
    `Database Schema:     ${liveTarget.schema}`,
    `Document Type:       ${documentType}`,
    `Financial Year:      ${financialYearCode}`,
    `Requested Serial:    ${approvedSerial}`,
    `Current Baseline:    ${sequenceExists === false ? 'Uninitialized (row does not exist)' : (currentBaseline ?? 'Unknown')}`,
    `Action:              ${actionDescription}`,
    '======================================================================',
  ];

  return lines.join('\n');
}
