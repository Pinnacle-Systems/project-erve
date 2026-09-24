#!/usr/bin/env node
// H2B — the explicit, controlled Dev commit path for the approved AW25/SS26
// historical Job Orders (plus their source-PDF evidence and Style images).
// There is no default action: exactly one mode flag must be given.
//
//   --plan                 read-only: full pre-import gate + CREATE/VERIFY/CONFLICT plan
//   --confirm-dev-write    gate, then commit (idempotent; an exact rerun creates nothing)
//   --verify               read-only: post-import reconciliation of the committed batch
//
// Usage (from apps/api):
//   FILE_STORAGE_DIR="C:\...\project-erve\apps\api\.data\uploads" \
//   tsx src/cli/historical-import-commit-job-orders.cli.ts \
//     --artifacts-root "C:\...\project-erve\.artifacts\historical-import\AW25-SS26" \
//     --batch AW25-SS26 \
//     --aw25-dir "C:\Users\...\Downloads\reerveindiaaw25po" \
//     --ss26-dir "C:\Users\...\Downloads\reerveindiass26po" \
//     --admin-email admin@erve.local \
//     --plan | --confirm-dev-write | --verify
//
// Requires DATABASE_URL and HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL to
// be the same erve_dev database, and NODE_ENV=development. A JSON report of
// every run is written to <artifacts-root>/h2b/ (gitignored, never committed).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../db/prisma.js';
import {
  commitHistoricalJobOrders,
  findImportBatchByLabel,
  HistoricalCommitError,
  planHistoricalJobOrderCommit,
  snapshotDownstreamTableCounts,
  snapshotJobOrderSequences,
  verifyCommittedBatch,
} from '../modules/historical-import/historical-job-order-commit.service.js';
import { HistoricalImportCommitPreflightError, prepareApprovedCommitInput } from './historical-import-commit.js';
import {
  DevTargetGuardError,
  HistoricalImportCliError,
  requireArg,
  requireExplicitDevStorageRoot,
  resolveAdminImporter,
  verifyDevWriteTarget,
} from './historical-import-cli-support.js';

type Mode = 'plan' | 'commit' | 'verify';

function resolveMode(argv: string[]): Mode {
  const modes: Mode[] = [];
  if (argv.includes('--plan')) modes.push('plan');
  if (argv.includes('--confirm-dev-write')) modes.push('commit');
  if (argv.includes('--verify')) modes.push('verify');
  if (modes.length !== 1) {
    throw new HistoricalImportCliError('Pass exactly one of --plan, --confirm-dev-write, or --verify (there is no default action)');
  }
  return modes[0]!;
}

function printVerification(v: Awaited<ReturnType<typeof verifyCommittedBatch>>): void {
  console.log(`ImportBatch rows for label: ${v.importBatchCountForLabel}; batch: ${v.importBatch ? `${v.importBatch.id} ${v.importBatch.status}` : '(none)'}`);
  console.log(`Historical JOs in batch: ${v.jobOrderCountInBatch}; unique legacy refs: ${v.uniqueLegacyReferences}`);
  console.log(`Reconciliation: ${v.exactMatch} EXACT_MATCH / ${v.mismatch} MISMATCH`);
  for (const r of v.perRecord.filter((p) => p.result === 'MISMATCH')) console.log(`  MISMATCH ${r.legacyReferenceNumber}: ${r.differences.join('; ')}`);
  if (v.jobOrderNumbers.length) console.log(`EIJOH range: ${v.jobOrderNumbers[0]} .. ${v.jobOrderNumbers.at(-1)}`);
  console.log(`Importer(s): ${v.importerIds.join(', ') || '(none)'}`);
  console.log(`Documents: ${JSON.stringify(v.documents)}`);
  console.log(`HISTORICAL_JOB_ORDER_IMPORTED audit events: ${v.auditImportEvents}`);
  console.log(`False-history counts: ${JSON.stringify(v.falseHistory)}`);
  console.log(`By season: ${JSON.stringify(v.aggregates.bySeason)}`);
  console.log(`By factory: ${JSON.stringify(v.aggregates.byFactory)}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = resolveMode(argv);
  const artifactsRoot = requireArg(argv, '--artifacts-root', 'the approved main-checkout .artifacts/historical-import/<batch> directory');
  const batchLabel = requireArg(argv, '--batch', 'the approved batch identity, e.g. AW25-SS26');
  const aw25Dir = requireArg(argv, '--aw25-dir', 'the AW25 source PDF directory');
  const ss26Dir = requireArg(argv, '--ss26-dir', 'the SS26 source PDF directory');
  const adminEmail = requireArg(argv, '--admin-email', 'the existing ADMIN user recorded as importer');

  await verifyDevWriteTarget(
    mode === 'commit' ? 'DEV HISTORICAL JOB ORDER COMMIT' : mode === 'plan' ? 'DEV HISTORICAL JOB ORDER PLAN (READ ONLY)' : 'DEV HISTORICAL JOB ORDER VERIFY (READ ONLY)',
  );
  if (mode === 'commit') requireExplicitDevStorageRoot();
  const actor = await resolveAdminImporter(adminEmail);
  console.log(`Artifacts root: ${artifactsRoot}`);
  console.log('');

  const prepared = await prepareApprovedCommitInput({ artifactsRoot, batchLabel, aw25Dir, ss26Dir });
  console.log('PRE-IMPORT INTEGRITY GATE');
  for (const check of prepared.checks) console.log(`  ${check.result} ${check.name}: ${check.detail}`);
  console.log('');

  const report: Record<string, unknown> = {
    mode,
    runAt: new Date().toISOString(),
    batchLabel,
    importer: { id: actor.id, email: actor.email },
    processFlowVersionId: prepared.processFlowPin.devProcessFlowVersionId,
    processFlowFingerprint: prepared.processFlowPin.logicalIdentity.fingerprint,
    preflight: prepared.checks,
  };

  const sequencesBefore = await snapshotJobOrderSequences(prisma);
  const downstreamBefore = await snapshotDownstreamTableCounts(prisma);
  report.sequencesBefore = sequencesBefore;
  report.downstreamBefore = downstreamBefore;
  console.log(`Sequences before: ${JSON.stringify(sequencesBefore)}`);

  const existingBatch = await findImportBatchByLabel(prisma, batchLabel);
  const plan = await planHistoricalJobOrderCommit(prisma, {
    importBatchId: existingBatch?.id ?? null,
    processFlowVersionId: prepared.identity.processFlowVersionId,
    records: prepared.records,
  });
  const planCounts = { CREATE: 0, VERIFY_EXISTING: 0, REVIEW_CONFLICT: 0 };
  for (const p of plan) planCounts[p.action]++;
  report.plan = { counts: planCounts, existingBatchId: existingBatch?.id ?? null, conflicts: plan.filter((p) => p.action === 'REVIEW_CONFLICT') };
  console.log(`Job Order plan: ${planCounts.CREATE} CREATE / ${planCounts.VERIFY_EXISTING} VERIFY_EXISTING / ${planCounts.REVIEW_CONFLICT} REVIEW_CONFLICT (existing batch: ${existingBatch?.id ?? 'none'})`);
  for (const c of plan.filter((p) => p.action === 'REVIEW_CONFLICT')) console.log(`  REVIEW_CONFLICT ${c.legacyReferenceNumber}: ${c.differences.join('; ')}`);

  if (mode === 'commit') {
    console.log('');
    console.log('Committing...');
    const result = await commitHistoricalJobOrders(actor, { identity: prepared.identity, records: prepared.records }, { onProgress: (m) => console.log(m) });
    const imageCounts: Record<string, number> = {};
    for (const i of result.images) imageCounts[i.action] = (imageCounts[i.action] ?? 0) + 1;
    report.commit = {
      importBatchId: result.importBatchId,
      batchCreated: result.batchCreated,
      created: result.created.length,
      verifiedExisting: result.verifiedExisting,
      sourceFileOutcomes: result.created.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.sourceFile]: (acc[c.sourceFile] ?? 0) + 1 }), {}),
      createdJobOrders: result.created,
      imageCounts,
      images: result.images,
    };
    console.log(`Created: ${result.created.length}; verified existing: ${result.verifiedExisting}; batch ${result.importBatchId} ${result.batchStatus}`);
    console.log(`Style images: ${JSON.stringify(imageCounts)}`);
    for (const c of result.images.filter((i) => i.action === 'REVIEW_CONFLICT')) console.log(`  IMAGE REVIEW_CONFLICT ${c.legacyReferenceNumber}: ${c.note}`);
  }

  if (mode !== 'plan') {
    console.log('');
    console.log('POST-IMPORT RECONCILIATION');
    const verification = await verifyCommittedBatch(prisma, {
      sourceLabel: batchLabel,
      processFlowVersionId: prepared.identity.processFlowVersionId,
      records: prepared.records,
    });
    report.verification = verification;
    printVerification(verification);
    const sequencesAfter = await snapshotJobOrderSequences(prisma);
    const downstreamAfter = await snapshotDownstreamTableCounts(prisma);
    const downstreamDelta = Object.fromEntries(
      Object.entries(downstreamAfter).map(([k, v]) => [k, v - (downstreamBefore as Record<string, number>)[k]!]),
    );
    report.sequencesAfter = sequencesAfter;
    report.downstreamAfter = downstreamAfter;
    report.downstreamDelta = downstreamDelta;
    console.log(`Sequences after: ${JSON.stringify(sequencesAfter)}`);
    console.log(`Downstream table totals (whole DB): ${JSON.stringify(downstreamAfter)}`);
    console.log(`Downstream delta this run: ${JSON.stringify(downstreamDelta)}`);
    if (verification.mismatch > 0) process.exitCode = 1;
  }

  const outDir = join(artifactsRoot, 'h2b');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log('');
  console.log(`Report: ${reportPath}`);
}

main()
  .catch((error: unknown) => {
    if (
      error instanceof DevTargetGuardError ||
      error instanceof HistoricalImportCliError ||
      error instanceof HistoricalImportCommitPreflightError ||
      error instanceof HistoricalCommitError
    ) {
      console.error(error.message);
    } else {
      console.error('Unexpected error during the historical Job Order commit:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
