# ERVE Bulk Import Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add Season, Size and HSN imports and safely support Excel Picture-in-Cell images.

**Architecture:** Extend the existing shared import workflow and domain service transaction hooks. Add rich-data extraction and asynchronous PNG normalization behind the existing image interface.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Express, React, SheetJS, fast-xml-parser, adm-zip, sharp, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-master-imports-images-design.md`

## Global constraints

- No production mutations, migrations, deployment, seeds or historical Job Order imports.
- No customer data or credentials committed.
- Existing domain validation, audit, permissions and create-only semantics remain authoritative.

## Review focus

- Numeric HSN cells with padded display formats must fail instead of reconstructing leading zeroes.
- Inactive exact reference records must skip; omitted nullable metadata must conflict with populated existing metadata.
- Rich-data indices and structure-key positions can vary; resolve each layer explicitly.
- Duplicate image contents are not duplicate physical associations.
- Concurrent master creation and interrupted uploads must leave atomic provenance and verifiable storage.

## Task 1: Reference master backend

Files: `packages/types/src/master-import.ts`, existing `master-import.*`, `master-data.service.ts`, `tax-rules/hsn.service.ts`, Prisma schema/migration, parser/service/routes tests.
Interfaces: extend MasterImportKind with seasons/sizes/hsns; keep plan/execute/history signatures; optional onCreatedInTransaction hook on domain creation.

- [x] Write parser and integration tests for required columns, literal codes, FY/serial/status rules, duplicates, conflicts, permission separation, stale confirmations, retries, concurrent creation and audit/provenance rollback. Run to observe failures.
- [x] Implement parser and master-specific validation/classification/authorization; preserve existing import behaviors. Extend creation services transactionally. Verify the existing raw SQL case-insensitive Season identity index and expand import-kind database checks.
- [x] Apply migrations only to a new disposable test database. Run existing and new import/domain integration suites; verify audit and provenance counts and existing Season uniqueness enforcement.
- [x] Commit backend changes.

## Task 2: Rich-data extraction and normalized images

Files: `cli/xlsx-embedded-images.ts`, synthetic image tests, `style-bulk-import.service.ts`, Style preview/template.
Interfaces: preserve extractEmbeddedImagesByRow(buffer, sheet); add async extraction/normalization result with original provenance and physical cell references.

- [x] Write failing synthetic tests for varied vm/type/future/rich structure indices, cached web/local images, JPEG under png filename, selected sheet, blank/reordered rows, mixed formats, repeated bytes, missing/corrupt media and unsupported anchors.
- [x] Implement relationship-based resolution and sharp normalization. Fail preflight when declared image metadata yields zero images; preserve plain workbooks. Carry original and normalized provenance through recovery.
- [x] Verify actual persisted files and Style associations, retry/rollback behavior and existing Style tests on isolated media/database. Reconcile local AW26 image counts and physical rows without committing evidence.
- [x] Commit image changes.

## Task 3: Shared UI and delivery

Files: shared import page/tests, Season/Size/HSN listing pages, AppRoutes/tests, delivery documentation.
Interfaces: `/master-imports/:kind/{template,worksheets,preflight,exceptions,execute,history}`; existing history detail/exception endpoints; listing import routes.

- [x] Write frontend tests for new master columns/entry routes and HSN accountant permissions; observe failures.
- [x] Add shared master-specific preview columns/help, listing actions and protected routes. Explain both Excel image approaches.
- [x] Run backend/frontend regression suites, typecheck, lint and production builds. Review branch for acceptance and data safety.
- [x] Document verified results, unresolved limitations, forward-only deployment preflight/smoke tests; commit and report branch/commit/status.

## Execution rulings

- The supplied request authorized implementation after audit; no additional design approval was required.
- Used an isolated feature branch in the existing checkout. Unrelated concurrent PDF edits were preserved and excluded from the feature commit.
- Raw SQL migration history and direct database testing establish existing case-insensitive Season identity enforcement; no new Season index was added.
- Kept the coupled shared types, backend and UI in one final feature commit to provide a coherent buildable review snapshot.
- Final backend regression invocation encountered one timeout during a long runtime pause. The affected barcode suite was rerun successfully without changing business logic; do not describe that full invocation as an uninterrupted green run.
