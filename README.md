# Erve — Distributor Inventory & Dispatch Tracking System

A pnpm monorepo containing the API, web app, and mobile app for tracking distributor
inventory and dispatch operations.

## Project structure

```
apps/
  api/      Express + TypeScript + Prisma REST API
  web/      React + Vite web app
  mobile/   React + Capacitor mobile app (shares UI with web)

packages/
  shared/         Cross-app utilities (API response helpers, RBAC helpers)
  ui/             Shared React UI components (Button, Input, Card, LoginForm)
  config/         Shared TypeScript configs
  eslint-config/  Shared ESLint flat configs
  types/          Shared TypeScript types (API response, auth, roles)
```

This is a foundation scaffold only — no business logic is implemented yet. It is meant
to run locally as a clean starting point: a health check endpoint, a login placeholder
page, and the shared plumbing (types, auth/RBAC middleware, linting, build tooling)
needed to start building features.

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

The web app starts on `http://localhost:5173` and shows the login placeholder page at
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
pnpm test            # run @erve/client's test suite
```

Note: `pnpm test` intentionally only runs `@erve/client`'s tests. `apps/api` has its own
integration test suite (`pnpm --filter @erve/api test`) that requires a running
PostgreSQL database and truncates its tables between test cases — don't run it against
a database you care about.
