# Disposable API test database

The API integration suite deletes application rows between tests. It never
uses `DATABASE_URL` as an implicit test target.

Create a separate PostgreSQL database whose name contains a standalone
`test` marker, for example `erve_test`, then set both URLs in the untracked
`apps/api/.env` file:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/erve_dev
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/erve_test
```

Apply migrations to the disposable target explicitly, then run the suite:

```powershell
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm --filter @erve/api exec prisma migrate deploy
Remove-Item Env:DATABASE_URL
pnpm --filter @erve/api test
```

Vitest validates `TEST_DATABASE_URL` before importing the application,
verifies that its name is visibly test-only and that it differs from the
development target, and only then replaces the process-local `DATABASE_URL`.
Missing or unsafe configuration fails closed before reset logic can run.

Never point `TEST_DATABASE_URL` at a database containing data to retain.
