# ERVE India — Inventory, Production & Dispatch Management

A pnpm monorepo with an Express/Prisma API, React web portal, and
Capacitor mobile app. The system supports Style and Distributor master data,
Order Sheets, Job Orders, production and QA, Dispatch Orders, carton packing
and audit, factory invoicing, Erve dispatch, and downstream workflows.
See the project documentation and implementation for current feature scope.

## Project structure

```
apps/
  api/      Express + TypeScript + Prisma REST API
  web/      React + Vite web app
  mobile/   React + Capacitor mobile app (shares UI with web)

packages/
  app-components/ Reusable application-level UI components
  client/         API client and shared browser utilities
  data-display/   Tables, loading, empty, and error states
  layout/         Layout components
  primitives/     Form fields and foundational UI components
  theme/          Shared styling and theme
  tokens/         Design tokens
  shared/         Cross-app utilities
  types/          Shared API and domain types
  config/         Shared TypeScript configuration
  eslint-config/  Shared ESLint configuration
  design-system-tests/ Shared UI design-system checks
```

The application contains implemented business modules and role-based authorization,
not just a starter scaffold. The repository also includes API and web tests,
database migrations, deployment workflows, and operational documentation.

## Prerequisites

- Node.js 24 (see `engines` in `package.json`)
- pnpm 11 — run `corepack enable` and pnpm will activate the version pinned in
  `packageManager` automatically
- PostgreSQL (local install or Docker)

## 1. Install dependencies

From the repo root:

```bash
pnpm install
```

This installs dependencies for every app and package in the workspace.

## 2. Configure environment variables

Each app has its own `.env.example`. Copy them to `.env` and fill in real values:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### Setting `DATABASE_URL` (apps/api/.env)

`DATABASE_URL` must point at a running PostgreSQL instance:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

If you don't have PostgreSQL running locally, the quickest option is the included
Docker Compose file:

```bash
docker compose up -d
```

That starts `postgres:18` with the same user/password/database as the default in
`apps/api/.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/erve_dev?schema=public"
```

Also set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to random strings (32+ characters).
You can generate one with:

```bash
openssl rand -hex 32
```

## 3. Run the Prisma migration

With `DATABASE_URL` configured and PostgreSQL reachable:

```bash
pnpm prisma:migrate
```

This runs `prisma migrate dev` against `apps/api/prisma/schema.prisma`, creates the
database schema, and generates the Prisma client. Re-run this any time the schema
changes.

To regenerate the Prisma client only (without creating a migration):

```bash
pnpm prisma:generate
```

## 4. Run the backend

```bash
pnpm dev:api
```

The API starts on `http://localhost:4000` (configurable via `PORT` in `apps/api/.env`).
Verify it's up:

```bash
curl http://localhost:4000/health
```

## 5. Run the web frontend

In a separate terminal:

```bash
pnpm dev:web
```

The web app starts on `http://localhost:5173`, with an implemented login at
`/login`. It expects the API at the URL configured in `apps/web/.env` (`VITE_API_URL`).

## 6. Run the mobile app (browser preview)

```bash
pnpm dev:mobile
```

This runs the Capacitor app's web build in the browser at `http://localhost:5174` for
fast iteration. To run it on a real device/simulator, build first and sync the native
project:

```bash
pnpm --filter @erve/mobile build
pnpm --filter @erve/mobile cap:add:android   # first time only
pnpm --filter @erve/mobile cap:sync
```

Then open the generated `android/` or `ios/` project in Android Studio / Xcode.

## Other useful commands

```bash
pnpm lint           # lint all packages
pnpm typecheck       # type-check all packages
pnpm format          # format the whole repo with Prettier
pnpm build           # build all apps/packages
pnpm test                          # run @erve/client's test suite
pnpm --filter @erve/web test        # web unit/component tests
pnpm --filter @erve/mobile test     # mobile tests
pnpm --filter @erve/api test        # API integration tests (destructive; see below)
```

`pnpm test` at the repo root runs only `@erve/client` tests. The API suite requires
a dedicated, disposable PostgreSQL database configured through `TEST_DATABASE_URL`,
distinct from `DATABASE_URL`, with a `test` marker. It truncates test data between
cases. Never point the API test suite at a development or production database.

The GitHub CI workflow runs typecheck, lint, build, client, web,
design-system, and API checks. See `.github/workflows/ci.yml` for the exact gates.
For release and production procedures, see `DEPLOYMENT.md`.
