// Shared by admin-bootstrap.ts and roles-bootstrap.ts for their
// production-confirmation guards. Never includes username/password — only
// host/port/database name.
export function describeDatabaseTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const dbName = url.pathname.replace(/^\//, '') || '(unknown)';
    return `${dbName} on ${url.hostname}:${url.port || '5432'}`;
  } catch {
    return '(unable to parse DATABASE_URL host/database)';
  }
}
