#!/usr/bin/env node
// Usage (from apps/api):
//   HISTORICAL_IMPORT_MRP_WORKBOOK_PATH="C:\...\MRP & Ex factory cost.xlsx" \
//     tsx src/cli/historical-import-style-prep.cli.ts --plan
//   HISTORICAL_IMPORT_MRP_WORKBOOK_PATH="C:\...\MRP & Ex factory cost.xlsx" \
//     tsx src/cli/historical-import-style-prep.cli.ts --confirm-dev-master-write \
//     --aw25-dir "C:\...\reerveindiaaw25po" --ss26-dir "C:\...\reerveindiass26po" \
//     --report-dir ".artifacts\historical-import\AW25-SS26\h2b2"
//
// Requires the same Dev target env vars as historical-import-master-prep.cli.ts,
// plus an existing ACTIVE ADMIN user and the AW25/SS26 Seasons already
// created (run historical-import:master-prep first).
//
// H2B.2 Stage A: --aw25-dir/--ss26-dir are optional. When given, hsnCode is
// re-derived straight from the source PDFs with the CURRENT extractHsnCode
// implementation (hsn-refresh.ts) instead of the immutable, possibly-stale
// staging.json cache — this is what recovers the 37 previously-null HSN
// codes on an already-populated Dev. --report-dir, when given, writes the
// categoryDescription/hsnCode field-reconciliation audit (CSV + JSON).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../db/prisma.js';
import { toCurrentUser, currentUserSelect } from '../auth/current-user.js';
import { refreshHsnCodesFromSourcePdfs, indexHsnRefreshBySourceChecksum } from '../modules/historical-import/hsn-refresh.js';
import {
  planStyles,
  applyStyles,
  verifyDevTarget,
  formatDevTargetReport,
  DevTargetGuardError,
  StylePrepError,
  type StylePrepOptions,
  type StyleFieldReconciliationDetail,
  type ApplyStylesResult,
} from './historical-import-style-prep.js';

async function resolveAdminActor() {
  const admin = await prisma.user.findFirst({
    where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'ADMIN' } } } },
    select: currentUserSelect,
  });
  if (!admin) throw new StylePrepError('No ACTIVE ADMIN user exists in this Dev database — cannot record an audit-log actor for Style creation');
  return toCurrentUser(admin);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function resolveOptions(args: string[]): Promise<StylePrepOptions> {
  const workbookPath = process.env.HISTORICAL_IMPORT_MRP_WORKBOOK_PATH;
  if (!workbookPath) {
    throw new StylePrepError('HISTORICAL_IMPORT_MRP_WORKBOOK_PATH environment variable is required (path to the real, gitignored "MRP & Ex factory cost.xlsx")');
  }
  const aw25Dir = flagValue(args, '--aw25-dir');
  const ss26Dir = flagValue(args, '--ss26-dir');
  let hsnRefreshBySourceChecksum: Map<string, string | null> | undefined;
  if (aw25Dir && ss26Dir) {
    const refreshed = await refreshHsnCodesFromSourcePdfs({ aw25Dir, ss26Dir });
    // Only a genuinely unreadable/corrupt PDF (FAILED) blocks this — a
    // PARTIAL status from an unrelated field (e.g. EI26002's known,
    // H2A-approved truncated-orderDate source defect; see
    // .artifacts/historical-import/AW25-SS26/h2a/partial-record-investigation.md)
    // must not block an HSN-only refresh when hsnCode itself parsed fine.
    const unreadable = refreshed.filter((r) => r.parseStatus === 'FAILED');
    if (unreadable.length) {
      throw new StylePrepError(`HSN refresh: ${unreadable.length} source PDF(s) could not be read at all: ${unreadable.map((f) => f.sourceFileName).join(', ')}`);
    }
    const noHsn = refreshed.filter((r) => r.hsnCode === null);
    if (noHsn.length) {
      console.log(`HSN refresh: ${noHsn.length} source PDF(s) have no extractable *HS line even after the fixed regex — left as null, will not overwrite an existing value: ${noHsn.map((f) => f.sourceFileName).join(', ')}`);
    }
    hsnRefreshBySourceChecksum = indexHsnRefreshBySourceChecksum(refreshed);
    console.log(`HSN refresh: re-parsed ${refreshed.length} source PDFs directly (bypassing staging.json cache) for hsnCode, keyed by source checksum.`);
  } else if (aw25Dir || ss26Dir) {
    throw new StylePrepError('--aw25-dir and --ss26-dir must both be given, or neither');
  }
  // Positional overrides (unchanged from before this change): only usable
  // when none of the new named flags are present, since argv indices would
  // otherwise collide with --aw25-dir/--ss26-dir/--report-dir and their values.
  // The named --staging/--source-overrides/--factory-mapping/--size-mapping
  // equivalents can be used alongside those new flags instead.
  const positional = !['--aw25-dir', '--ss26-dir', '--report-dir', '--staging', '--source-overrides', '--factory-mapping', '--size-mapping'].some((flag) => args.includes(flag));
  return {
    workbookPath,
    stagingFilePath: flagValue(args, '--staging') ?? (positional ? process.argv[3] : undefined) ?? '.artifacts/historical-import/AW25-SS26/source-staging.json',
    sourceOverridesFilePath: flagValue(args, '--source-overrides') ?? (positional ? process.argv[4] : undefined) ?? '.artifacts/historical-import/AW25-SS26/h2a/source-overrides.json',
    factoryMappingFilePath: flagValue(args, '--factory-mapping') ?? (positional ? process.argv[5] : undefined) ?? '.artifacts/historical-import/AW25-SS26/h2a/factory-mapping.json',
    sizeMappingFilePath: flagValue(args, '--size-mapping') ?? (positional ? process.argv[6] : undefined) ?? '.artifacts/historical-import/AW25-SS26/h2a/size-mapping.json',
    hsnRefreshBySourceChecksum,
  };
}

function printPlanSummary(plan: Awaited<ReturnType<typeof planStyles>>): void {
  const byAction = { CREATE: 0, VERIFY_EXISTING: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const entry of plan) byAction[entry.action]++;
  console.log(`Style plan: ${byAction.CREATE} CREATE / ${byAction.VERIFY_EXISTING} VERIFY_EXISTING / ${byAction.BLOCKED} BLOCKED (of ${plan.length} required identities)`);
  for (const entry of plan) {
    if (entry.action === 'BLOCKED') {
      console.log(`  BLOCKED ${entry.season} ${entry.lmix}: ${entry.reason}`);
    }
  }
  const sizeCreate = plan.reduce((n, e) => n + e.sizes.filter((s) => s.action === 'CREATE').length, 0);
  const sizeBlocked = plan.reduce((n, e) => n + e.sizes.filter((s) => s.action === 'BLOCKED').length, 0);
  console.log(`StyleSize plan: ${sizeCreate} CREATE, ${sizeBlocked} BLOCKED`);
  const factoryCreate = plan.filter((e) => e.factory?.action === 'CREATE').length;
  const factorySkipped = plan.filter((e) => e.factory?.action === 'SKIPPED').length;
  const factoryBlocked = plan.filter((e) => e.factory?.action === 'BLOCKED').length;
  console.log(`Style<->Factory mapping plan: ${factoryCreate} CREATE, ${factorySkipped} SKIPPED, ${factoryBlocked} BLOCKED`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const planOnly = args.includes('--plan');
  const confirmed = args.includes('--confirm-dev-master-write');

  if (!planOnly && !confirmed) {
    console.log('Nothing to do — pass --plan to preview, or --confirm-dev-master-write to apply.');
    return;
  }

  const target = verifyDevTarget();
  console.log(formatDevTargetReport(target, 'DEV MASTER-DATA PREPARATION'));
  console.log('');

  const options = await resolveOptions(args);
  const plan = await planStyles(options);
  printPlanSummary(plan);

  if (planOnly) return;

  console.log('');
  const actor = await resolveAdminActor();
  const result = await applyStyles(actor, plan);
  console.log('');
  console.log(`Styles created: ${result.stylesCreated.length}`);
  console.log(`Styles verified (already existed): ${result.stylesVerified.length}`);
  console.log(`Styles blocked: ${result.stylesBlocked.length}`);
  for (const b of result.stylesBlocked) console.log(`  ${b.season} ${b.lmix}: ${b.reason}`);
  console.log(`StyleSizes created: ${result.styleSizesCreated}, verified: ${result.styleSizesVerified}`);
  console.log(`Style<->Factory mappings created: ${result.styleFactoryMappingsCreated}, verified: ${result.styleFactoryMappingsVerified}, skipped: ${result.styleFactoryMappingsSkipped}`);
  console.log('');
  await printFieldReconciliationSummary(result);
  console.log('');
  console.log('No historical Job Order, ImportBatch, HistoricalDocument, or transaction row was created.');

  const reportDir = flagValue(args, '--report-dir');
  if (reportDir) {
    await writeFieldReconciliationReport(reportDir, result);
  }
}

async function printFieldReconciliationSummary(result: ApplyStylesResult): Promise<void> {
  const rows = result.fieldReconciliation;
  const categorySet = rows.filter((r) => r.categoryOutcome === 'SET').length;
  const categoryAlreadySet = rows.filter((r) => r.categoryOutcome === 'ALREADY_SET').length;
  const categoryNoSource = rows.filter((r) => r.categoryOutcome === 'NO_SOURCE_VALUE').length;
  const categoryReview = rows.filter((r) => r.categoryOutcome === 'REVIEW_REQUIRED_CONFLICT').length;
  console.log('Category (Style.categoryDescription):');
  console.log(`  source rows = ${rows.length}`);
  console.log(`  populated (set this run + already set) = ${categorySet + categoryAlreadySet}`);
  console.log(`  normalization applied count = ${rows.filter((r) => r.categoryNormalizationApplied).length}`);
  console.log(`  unchanged-clean count (no normalization needed) = ${rows.filter((r) => !r.categoryNormalizationApplied && r.categoryRaw !== null).length}`);
  console.log(`  REVIEW_REQUIRED = ${categoryReview}`);
  if (categoryNoSource) console.log(`  no workbook Category value = ${categoryNoSource}`);

  const hsnSet = rows.filter((r) => r.hsnOutcome === 'SET').length;
  const hsnAlreadySet = rows.filter((r) => r.hsnOutcome === 'ALREADY_SET').length;
  const hsnReview = rows.filter((r) => r.hsnOutcome === 'REVIEW_REQUIRED_CONFLICT').length;
  console.log('HSN (Style.hsnCode):');
  console.log(`  prior populated = ${hsnAlreadySet}`);
  console.log(`  recovered (newly set this run) = ${hsnSet}`);
  console.log(`  final populated = ${hsnSet + hsnAlreadySet}`);
  console.log(`  existing-value changes = 0 (an ALREADY_SET/REVIEW_REQUIRED_CONFLICT value is never overwritten)`);
  console.log(`  conflicts = ${hsnReview}`);
  console.log(`  REVIEW_REQUIRED = ${hsnReview}`);
}

async function writeFieldReconciliationReport(reportDir: string, result: ApplyStylesResult): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  const styleIds = result.fieldReconciliation.map((r) => r.styleId);
  const styles = styleIds.length
    ? await prisma.style.findMany({ where: { id: { in: styleIds } }, select: { id: true, description: true } })
    : [];
  const descriptionById = new Map(styles.map((s) => [s.id, s.description] as const));
  const hsLinePattern = /\*\s*HS[^\n]*/i;

  const records = result.fieldReconciliation.map((r): StyleFieldReconciliationDetail & { pdfHsLine: string | null; hsnDescription: null; result: string; reason: string } => {
    const description = descriptionById.get(r.styleId) ?? null;
    const pdfHsLine = description ? (hsLinePattern.exec(description)?.[0]?.trim() ?? null) : null;
    const conflict = r.categoryOutcome === 'REVIEW_REQUIRED_CONFLICT' || r.hsnOutcome === 'REVIEW_REQUIRED_CONFLICT';
    return {
      ...r,
      pdfHsLine,
      hsnDescription: null,
      result: conflict ? 'REVIEW_REQUIRED' : 'OK',
      reason: conflict
        ? [
            r.categoryOutcome === 'REVIEW_REQUIRED_CONFLICT' ? `categoryDescription conflict: existing="${r.previousCategoryDescription}" proposed="${r.proposedCategoryDescription}"` : null,
            r.hsnOutcome === 'REVIEW_REQUIRED_CONFLICT' ? `hsnCode conflict: existing="${r.previousHsnCode}" proposed="${r.parsedHsnCode}"` : null,
          ].filter(Boolean).join('; ')
        : 'No conflict — set only a previously-null field, never overwrote a populated one.',
    };
  });

  await writeFile(join(reportDir, 'style-field-reconciliation.json'), JSON.stringify(records, null, 2));
  const keys = [
    'season', 'legacyReference', 'lmix', 'styleId', 'styleNumber',
    'categoryRaw', 'categoryNormalized', 'categoryNormalizationApplied', 'previousCategoryDescription', 'proposedCategoryDescription',
    'pdfHsLine', 'previousHsnCode', 'parsedHsnCode', 'hsnChanged', 'hsnDescription',
    'result', 'reason',
  ] as const;
  const csv = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const csvBody = [keys.join(','), ...records.map((r) => keys.map((k) => csv((r as unknown as Record<string, unknown>)[k])).join(','))].join('\r\n');
  await writeFile(join(reportDir, 'style-field-reconciliation.csv'), csvBody);
  console.log(`Field-reconciliation audit written: ${join(reportDir, 'style-field-reconciliation.json')} / .csv (${records.length} records)`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DevTargetGuardError || error instanceof StylePrepError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while preparing Dev Style master data:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
