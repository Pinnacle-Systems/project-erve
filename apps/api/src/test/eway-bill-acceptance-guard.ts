import { requireSafeTestDatabaseUrl } from './database-safety.js';

/**
 * Fail-closed environment contract for the E-Way Bill browser acceptance
 * harness (Track B / B5). Every acceptance entrypoint (fixtures, QA server)
 * calls this BEFORE importing anything that opens a database connection or
 * reads credentials, so an unsafe target or an unexpected credential stops the
 * process instead of being worked around.
 */
export const EWAY_ACCEPTANCE_DATABASE_NAME = 'erve_eway_acceptance_test';
/** The only provider key this harness accepts. It is never a real credential. */
export const EWAY_ACCEPTANCE_SYNTHETIC_KEY = 'eway-acceptance-synthetic-key-never-transmitted';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface EwayAcceptanceTarget {
  databaseUrl: string;
  databaseName: string;
}

type Environment = Record<string, string | undefined>;

export function requireEwayAcceptanceEnvironment(environment: Environment): EwayAcceptanceTarget {
  if (environment.EWAY_ACCEPTANCE_AUTHORIZED !== 'true') {
    throw new Error('E-Way Bill acceptance refused: EWAY_ACCEPTANCE_AUTHORIZED=true is required');
  }
  if (environment.NODE_ENV !== 'test') {
    throw new Error('E-Way Bill acceptance refused: NODE_ENV must be "test"');
  }
  const target = environment.EWAY_ACCEPTANCE_DATABASE_URL?.trim();
  const safe = requireSafeTestDatabaseUrl({ testDatabaseUrl: target });
  if (safe.databaseName !== EWAY_ACCEPTANCE_DATABASE_NAME) {
    throw new Error(
      `E-Way Bill acceptance refused: the database must be named ${EWAY_ACCEPTANCE_DATABASE_NAME}`,
    );
  }
  if (!LOOPBACK_HOSTS.has(new URL(safe.url).hostname.toLowerCase())) {
    throw new Error('E-Way Bill acceptance refused: the database host must be loopback');
  }
  // The application connects through DATABASE_URL (and dotenv never overrides
  // an existing value), so it must be exactly the acceptance target.
  if (environment.DATABASE_URL?.trim() !== target) {
    throw new Error('E-Way Bill acceptance refused: DATABASE_URL must equal EWAY_ACCEPTANCE_DATABASE_URL');
  }

  const apiKey = environment.GST_VERIFICATION_API_KEY?.trim();
  if (apiKey !== EWAY_ACCEPTANCE_SYNTHETIC_KEY) {
    throw new Error('E-Way Bill acceptance refused: GST_VERIFICATION_API_KEY must be the synthetic key');
  }
  if (environment.EWAY_BILL_PORTAL_USERNAME?.trim() || environment.EWAY_BILL_PORTAL_PASSWORD?.trim()) {
    throw new Error('E-Way Bill acceptance refused: no portal credential may be configured');
  }
  if (
    environment.GST_COMPLIANCE_LIVE_AUTHORIZED === 'true' ||
    environment.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED === 'true'
  ) {
    throw new Error('E-Way Bill acceptance refused: no Live authorization flag may be enabled');
  }
  if (environment.EWAY_BILL_DEMO_GENERATION_AUTHORIZED === 'true') {
    // Demo authorization is toggled only through the QA server control port so
    // the "not authorized" state is always the starting point.
    throw new Error(
      'E-Way Bill acceptance refused: EWAY_BILL_DEMO_GENERATION_AUTHORIZED must start unset or false',
    );
  }
  return { databaseUrl: safe.url, databaseName: safe.databaseName };
}
