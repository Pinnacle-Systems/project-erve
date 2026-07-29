export interface TestDatabaseSafetyInput {
  testDatabaseUrl?: string;
  developmentDatabaseUrl?: string;
}

export interface SafeTestDatabaseTarget {
  url: string;
  databaseName: string;
}

function parsePostgresUrl(value: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${variableName} must use the postgres or postgresql protocol`);
  }
  if (!url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error(`${variableName} must explicitly name a database`);
  }
  return url;
}

function canonicalTarget(url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}

/** Fail-closed contract for the destructive integration suite. */
export function requireSafeTestDatabaseUrl(input: TestDatabaseSafetyInput): SafeTestDatabaseTarget {
  const value = input.testDatabaseUrl?.trim();
  if (!value) {
    throw new Error(
      'Refusing to run API integration tests: TEST_DATABASE_URL is required and must point to a disposable test database',
    );
  }

  const testUrl = parsePostgresUrl(value, 'TEST_DATABASE_URL');
  const databaseName = decodeURIComponent(testUrl.pathname.slice(1));
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error(
      `Refusing destructive API tests: database "${databaseName}" does not contain a standalone test marker`,
    );
  }

  if (input.developmentDatabaseUrl?.trim()) {
    const developmentUrl = parsePostgresUrl(input.developmentDatabaseUrl, 'DATABASE_URL');
    if (canonicalTarget(testUrl) === canonicalTarget(developmentUrl)) {
      throw new Error('Refusing destructive API tests: TEST_DATABASE_URL matches DATABASE_URL');
    }
  }

  return { url: value, databaseName };
}
