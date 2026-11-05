# E-Way Bill browser acceptance (Track B / B5)

Engineering acceptance for the Accountant E-Way Bill workflow. It drives the
real React app in headless Chrome against the real API, RBAC, B2B services and
Prisma persistence. The **only** double is the E-Way Bill provider: a local mock
injected through `createApp({ ewayBillProvider })`, with a call journal.

Passing this does **not** prove the actual GSTINAPI Demo endpoint or any Live
filing contract, and it is not customer UAT.

## Safety (fail closed)

`apps/api/src/test/eway-bill-acceptance-guard.ts` refuses to start unless all of:

- `EWAY_ACCEPTANCE_AUTHORIZED=true`, `NODE_ENV=test`
- `EWAY_ACCEPTANCE_DATABASE_URL` is a loopback PostgreSQL database named exactly
  `erve_eway_acceptance_test`, and `DATABASE_URL` equals it
- `GST_VERIFICATION_API_KEY` is the synthetic key, no portal credentials, no Live
  flag, and Demo generation not pre-authorized

The QA API additionally refuses every non-loopback `fetch` and counts attempts.
Control routes (mock mode, Demo authorization, read faults, DB evidence) exist
only on a loopback control port protected by a per-run token.

## Run locally

Start a disposable Postgres, create the database, apply migrations, then:

```sh
export EWAY_ACCEPTANCE_AUTHORIZED=true NODE_ENV=test
export EWAY_ACCEPTANCE_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:<port>/erve_eway_acceptance_test
export DATABASE_URL=$EWAY_ACCEPTANCE_DATABASE_URL
export GST_VERIFICATION_API_KEY=eway-acceptance-synthetic-key-never-transmitted
export EWAY_ACCEPTANCE_CHROME_BINARY=/path/to/chrome
(cd apps/api && pnpm prisma:migrate:deploy)
node scripts/eway-bill-acceptance/run.mjs
```

`run.mjs` seeds synthetic invoices (real API), starts the QA API and web app,
runs the scenarios and always stops every child process. Output goes to
`.artifacts/eway-bill-acceptance/`: `results.json`, `results.md`, `evidence/*.png`
and the API/web logs. `EWAY_ACCEPTANCE_ONLY=S4,S5` runs a subset (scenarios
consume their own invoices, so reseed between full runs).
