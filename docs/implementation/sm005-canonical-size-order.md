# SM-005 canonical Size ordering

This implements derived technical acceptance criteria from the repository's existing Size master ordering. No external tracker or original acceptance criteria were supplied or verified.

## Behavior and compatibility

The Size master list/options already order by `sortOrder ASC, code ASC`. Dispatch Order, Factory Packing Queue, Factory Packing List/cartons/Packing Audit, eligible Erve cartons, consolidated cartons/summary, and Factory Invoice line responses now expose additive optional `sizeSortOrder` metadata. The server always reads the required persisted `Size.sortOrder`; the public field remains optional for older clients, fixtures, and response inputs.

The shared operational and financial presentation helpers use finite ranks first, then Size code, with missing/nonfinite ranks last. Zero and negative ranks are valid. When no finite ranks exist, they preserve the previous first-appearance order, including each individual Style's breakdown order. This mixed/legacy compatibility policy is inferred. For duplicate Size identities, any available finite rank is retained; conflicting finite ranks defensively use the lowest rank.

Style/group order, identity, quantity aggregation, financial compatibility groups, authoritative amounts, inactive referenced Sizes, and access rules are preserved. Raw Factory Packing Queue retrieval/cursors still use `(created_at, id)`; only presentation helpers sort Sizes. No additional Size master request or role permission is needed. Issued Tax Invoice snapshot behavior is unchanged.

Existing shared helper consumers inherit canonical matrix/compact-breakdown ordering, including Dispatch Order, Factory Packing List, Packing Audit, carton labels, and Factory Invoice PDFs. Erve matrix consumers introduced separately by ISS-023 Phase 3 can consume the metadata without a further API change; this branch is based on main before that matrix change.

## Derived acceptance checks

- Scrambled input yields rank/code ordered columns and compact breakdowns.
- Equal ranks use code; zero/negative ranks remain valid; missing/nonfinite ranks follow known ranks.
- Entirely legacy inputs retain first appearance. Duplicate identities remain aggregated.
- Style order and quantity/amount totals do not change.
- Packing/carton projections carry persisted ranks, including inactive referenced Sizes.
- Queue projection includes metadata without changing raw page membership, SQL ordering, or cursor identity.
- Existing role restrictions and issued Tax Invoice grouping remain covered by existing tests.

## Validation

The helper regressions first failed in three expected ordering assertions. Two DB-free API projection regressions first failed because response metadata was absent, then passed after propagation. Tests use the actual projection/queue functions with a mocked database; they do not connect to or mutate a database.

Prisma client generation used a placeholder database URL only. No schema changes, migrations, database resets, deployment, or production operations are included.

Verification completed:

- Focused web UI/helper/PDF/Tax Invoice grouping regression run: 10 files, 167 tests passed on the final run. This includes `style-size-grouping`, `PackingListPage`, `FactoryPackingQueuePage`, `PackingAuditCartonDetailPage`, the carton label/Factory Packing List/Packing Audit/Dispatch Order/Factory Invoice PDF view-model suites, and Tax Invoice grouping.
- `pnpm --filter @erve/api exec vitest run --config vitest.unit.config.ts`: 9 files, 113 tests passed.
- `pnpm --filter @erve/api typecheck`: passed.
- `pnpm --filter @erve/api build`: passed.
- `pnpm --filter @erve/web build`: passed, including web TypeScript checking. Vite reported its large-chunk advisory.
- `pnpm --filter @erve/api lint` and `pnpm --filter @erve/web lint`: passed.

Full web tests, live database integration tests, browser acceptance, and performance benchmarks are outside this focused verification run.

## Next dependency

Add/Edit Carton quantity matrix work can now consume ordered columns from the same helper. It still needs per-cell remaining capacity, editing-carton contribution addback, destination reset, and positive-only mutation payloads under the existing business rules. This change does not modify picker behavior.
