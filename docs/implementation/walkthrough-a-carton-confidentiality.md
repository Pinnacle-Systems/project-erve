# Walkthrough PR-A — ISS-074 carton label confidentiality

Base: `9e0401d` (`origin/main` verification for this batch). Branch: `fix/walkthrough-a-carton-confidentiality`. This change is limited to the external carton-label PDF and its focused tests. ISS-075 and general factory/distributor API projections are outside this change.

## Behavior

The label view model now allowlists the Dispatch Order number, distributor, destination snapshot and full delivery address, contact details where present, carton number, packaging measurements, Style/Size quantities and total. It excludes factory name, Factory Dispatch reference and generating operator identity from the subtitle, detail block and rendered metadata section. The source carton and its factory provenance remain available to authorized internal workflows; the mapper does not mutate them.

The existing Print and Download Label actions both call `generateCartonLabelPdfBlob`, which builds this same view model and PDF. The existing Inspected-carton gate remains in the generator. This PR makes no API, schema, migration or database changes.

## Local validation and acceptance evidence

The carton-label tests exercise the view model and actual generated PDFs. One-Style and 35-Style cases extract every page's text and PDF metadata, assert factory and operator markers are absent, and assert carton identity, delivery fields, every Style, Size quantity and total are present. They also verify one-page and two-page output and no source mutation. The new disclosure assertions failed against the old renderer before the fix and passed after it.

Rendered samples for both sizes were inspected at `.artifacts/walkthrough-a-carton-confidentiality/` (ignored local evidence, not committed): `carton-1-styles.pdf`, `carton-35-styles.pdf`, and their three PNG pages. The pages show the retained identity/content and pagination without visible factory or operator fields or clipped rows. The PDF text and metadata assertions cover data not readily apparent in the images. This is generated sample acceptance evidence, not a live browser/database walkthrough.

Validation from this worktree:

- `pnpm --filter @erve/web test -- src/pages/fulfillment/pdf/carton-label`: 3 files, 26 tests passed.
- `pnpm --filter @erve/web build`: passed (`tsc --noEmit` and Vite; existing large-chunk warning).
- `pnpm --filter @erve/web lint`: passed.
- `pnpm exec prettier --check` on all five changed carton-label files: passed.
- `pnpm exec prettier --check docs/implementation/walkthrough-a-carton-confidentiality.md`: passed.
- `git diff --check`: passed.

A broader web test run was attempted and its log is retained in ignored `.artifacts/walkthrough-a-carton-confidentiality/web-test.log`. It reported failures in unchanged `JobOrderCreatePage.test.tsx` and `SaleOrderFormPage.test.tsx`; those failures were not established against a clean baseline and were not changed for ISS-074. Focused carton-label validation is the acceptance gate for this PR.

No CI results were queried, no database writes were made, and no merge or deployment was performed during PR-A local implementation.
