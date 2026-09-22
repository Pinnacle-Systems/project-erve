// Positive Dev-target verification for the historical-import tooling.
//
// Every historical-import command that touches a database (the schema-only
// Dev migration in the `historical-import-dev-migrate` CLI, and the
// read-only Dev reconciliation in the `historical-import:dry-run` CLI) must
// prove its target *is* the operator's explicitly configured Dev validation
// database, not merely that it "doesn't look like Production" — a
// hostname/IP blocklist is not sufficient, since Production could move or
// be reached through a different endpoint later. The operator sets
// HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL once, alongside DATABASE_URL,
// naming exactly the database these commands are allowed to touch; every
// run re-checks DATABASE_URL against it before doing anything.
//
// Mirrors the fail-closed shape of ../../test/database-safety.ts
// (requireSafeTestDatabaseUrl), but the two are not merged: that guard
// asserts the target is a *disposable test* database (name contains
// "test"); this one asserts the target is exactly the *one explicitly
// approved Dev* database.

export interface DevTargetGuardInput {
  /** DATABASE_URL — the connection this command is actually about to use. */
  actualDatabaseUrl?: string;
  /** HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL — the operator's one-time positive declaration of the intended Dev database. */
  expectedDevDatabaseUrl?: string;
}

export interface DevTargetReport {
  expectedEnvironment: 'DEV';
  expectedDatabase: string;
  actualEnvironment: 'DEV';
  actualHost: string;
  actualDatabase: string;
  targetValidation: 'PASSED';
}

export class DevTargetGuardError extends Error {}

// A defense-in-depth tripwire only — never the primary check. The primary
// check is exact equality against the operator's explicit, positive
// declaration above; this just refuses even that declaration if it somehow
// pointed at the known Production host.
const KNOWN_PRODUCTION_HOSTS = new Set(['187.127.135.42']);

function parsePostgresUrl(value: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DevTargetGuardError(`${variableName} must be a valid PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new DevTargetGuardError(`${variableName} must use the postgres or postgresql protocol`);
  }
  if (!url.hostname || !url.pathname || url.pathname === '/') {
    throw new DevTargetGuardError(`${variableName} must explicitly name a database`);
  }
  return url;
}

function canonicalTarget(url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

/**
 * Fail-closed contract: throws DevTargetGuardError unless DATABASE_URL is
 * positively, exactly the database the operator declared as Dev via
 * HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL. Never printed: credentials.
 */
export function requireVerifiedDevDatabaseTarget(input: DevTargetGuardInput): DevTargetReport {
  const actualValue = input.actualDatabaseUrl?.trim();
  if (!actualValue) {
    throw new DevTargetGuardError('DATABASE_URL is required');
  }
  const expectedValue = input.expectedDevDatabaseUrl?.trim();
  if (!expectedValue) {
    throw new DevTargetGuardError(
      'Refusing to proceed: HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL is not set. Set it once, in this ' +
        "machine's local env, to exactly the Dev validation database this tooling is approved to touch " +
        '(e.g. the same value as DATABASE_URL when DATABASE_URL already points at erve_dev). This command ' +
        'will not infer or guess the Dev target.',
    );
  }

  const actualUrl = parsePostgresUrl(actualValue, 'DATABASE_URL');
  const expectedUrl = parsePostgresUrl(expectedValue, 'HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL');

  for (const url of [actualUrl, expectedUrl]) {
    if (KNOWN_PRODUCTION_HOSTS.has(url.hostname)) {
      throw new DevTargetGuardError(
        `Refusing to proceed: "${url.hostname}" is a known Production host and must never be targeted by historical-import tooling`,
      );
    }
  }

  if (canonicalTarget(actualUrl) !== canonicalTarget(expectedUrl)) {
    throw new DevTargetGuardError(
      'Refusing to proceed: DATABASE_URL does not match HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL.\n' +
        `  actual:   ${canonicalTarget(actualUrl)}\n` +
        `  expected: ${canonicalTarget(expectedUrl)}\n` +
        'This command only ever runs against the one database the operator explicitly declared as Dev.',
    );
  }

  return {
    expectedEnvironment: 'DEV',
    expectedDatabase: databaseName(expectedUrl),
    actualEnvironment: 'DEV',
    actualHost: `${actualUrl.hostname}:${actualUrl.port || '5432'}`,
    actualDatabase: databaseName(actualUrl),
    targetValidation: 'PASSED',
  };
}

/** Renders the report block shown in every plan revision, e.g. before `prisma migrate deploy` or the dry-run reconciliation. */
export function formatDevTargetReport(
  report: DevTargetReport,
  mode: 'SCHEMA MIGRATION ONLY' | 'READ ONLY BUSINESS DATA' | 'DEV MASTER-DATA PREPARATION',
): string {
  return [
    `Expected environment: ${report.expectedEnvironment}`,
    `Expected database: ${report.expectedDatabase}`,
    '',
    `Actual environment: ${report.actualEnvironment}`,
    `Actual host: ${report.actualHost}`,
    `Actual database: ${report.actualDatabase}`,
    '',
    `Target validation: ${report.targetValidation}`,
    `Mode: ${mode}`,
  ].join('\n');
}
