# Job Order browser acceptance

Runs the real web application and existing API against a disposable PostgreSQL database. Uses the repository CDP driver and installed Chromium; no browser framework dependency is added.

The database must be a freshly provisioned, isolated loopback `erve_batch1_test`. The runner refuses remote targets, other database names, schema overrides, and a target matching `DATABASE_URL`. Never point it at a shared development database. CI provisions its own Postgres 18 service for every run.

After installing dependencies and generating Prisma, apply committed migrations to that disposable target, then run:

```sh
TEST_DATABASE_URL=postgresql://postgres:disposable-password@127.0.0.1:55441/erve_batch1_test pnpm --filter @erve/web test:job-order-browser
```

Set `CHROME_BINARY` if Chromium is outside the detected Windows/Ubuntu paths. `BATCH1_EVIDENCE_ROOT` can select an existing directory outside the repository; each run creates a unique child directory and prints its location. Standard PR CI uploads only measurements, assertions and synthetic screenshots. Fixture credentials, browser profiles and API logs are excluded from artifacts.

Acceptance covers long names and both Merchandiser/Factory action groups at 1440/1280/1024/390 px across all four active tabs, plus recorded Season fallback/conflict presentation, keyboard-opened authenticated original Style images, confirmation acknowledgement/version/idempotency/role boundaries and real Prepared Quantity save/GET/reload persistence (including zero). Component tests exercise actual refetch dismissal and failed-save draft retention.

The header thumbnail intentionally occupies the leading gutter; its title is inset beside the image. Geometry compares the shared header content row, tab content wrapper and active tab-panel boundaries with a 1 CSS pixel tolerance; nested panel padding is intentional. No document-level horizontal overflow is allowed.

Batch 6 also checks Factory and QA authenticated thumbnails/original viewers, direct unauthorized image denial without broad Style Master access, parallel PP Sample/PPM actions, later-gate and Inline-PASS production eligibility, prepared-quantity Final batch eligibility, read-only roles, and keyboard navigation at 1440/390 px. All records and uploaded images are synthetic.
