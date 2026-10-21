# Phase 1B isolated database authorization and migration plan

The user explicitly authorized creation, migrations, synthetic seeding, integration
tests and browser tests on 21 October 2026. Preserve this environment for review.

- New container: `erve-gst-phase1b-qa-pg`.
- New dedicated volume: `erve_gst_phase1b_qa_data`.
- Database: `erve_gst_phase1b_qa`.
- PostgreSQL image: locally available `docker.io/library/postgres:18`.
- Connection: `127.0.0.1:55433`, dedicated synthetic database owner.
- Container and volume existence checks both returned exit 1 (absent); no listener
  was found on the selected port before creation.
- No production, development, shared or Phase 1A database may be accessed.

Before migration: inspect the new container id, exact localhost port mapping and
volume mount, then query `current_database()`, `current_user`, and server version
inside this new container. Verify database name before running Prisma.

Migration plan: replay unchanged existing migrations, then additive
`20261021120000_gstin_verification`. No historical migration edits, resets, or
business record rewrites. The new migration was generated offline using Prisma
schema diff against `origin/main`; no database was consulted during generation.

The subsequent additive `20261021121000_gstin_confirmation_cache` adds only nullable
`cache_evidence_id` to the new operation table. It binds refresh confirmation to
the old evidence so two pending refreshes reuse the first successful newer result.
Container id, database identity and port were checked again before applying it.
All 93 migrations are now applied to the dedicated Phase 1B database only.

Tests use only this exact authorized connection. A dedicated QA setup must reject
other names/ports/hosts, rather than weakening the repository's normal test-name
guard. Provider calls are mocked; paid Live requests remain prohibited. Real
provider Demo testing is NOT VERIFIED until a safe configured key is available.

Credentials are random local QA values in ignored artifacts and environment
files; they are omitted from public reports. Container/volume are retained.
