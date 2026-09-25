#!/usr/bin/env node
// H3A — forward-only historical import of the sealed AW25/SS26 bundle.
// Bundled into the production release as historical-import-production.js
// (same pattern as admin-bootstrap.js). There is no default action:
//
//   --preflight   READ-ONLY (Postgres READ ONLY transaction): full plan + gate
//   --execute     gate, then create only what is missing (idempotent)
//   --verify      READ-ONLY post-import reconciliation
//   --snapshot <file.json>   READ-ONLY table-content hashes for before/after comparison
//
// Required:  --bundle <dir>  --profile production|dev  --expect-database <name>
//            --report-dir <dir>   (not for --snapshot)
// Optional:  --expect-bundle-sha256 <hex>  --admin-email <email>
// --execute: --confirm-write, plus --confirm-production when NODE_ENV=production.
//
// Usage on the server (from <DEPLOY_ROOT>/current/api, as the site user):
//   node historical-import-production.js --preflight --bundle <dir> --profile production \
//     --expect-database erve_prod --expect-bundle-sha256 <hex> --report-dir <dir>
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { loadVerifiedBundle, H3aBundleError, type LoadedBundle } from '../modules/historical-import/h3a/bundle.js';
import { getTargetProfile, type TargetProfile } from '../modules/historical-import/h3a/target-profiles.js';
import {
  captureDatabaseSnapshot,
  executeH3aImport,
  H3aImportError,
  planH3aImport,
  runReadOnly,
  verifyH3aImport,
  type H3aPlan,
  type H3aVerification,
} from '../modules/historical-import/h3a/production-import.service.js';
import { HistoricalCommitError } from '../modules/historical-import/historical-job-order-commit.service.js';

class CliError extends Error {}

type Mode = 'preflight' | 'execute' | 'verify' | 'snapshot';

function arg(argv: string[], flag: string, required: boolean): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) throw new CliError(`${flag} is required`);
  return value && !value.startsWith('--') ? value : undefined;
}

function resolveMode(argv: string[]): Mode {
  const modes = (['preflight', 'execute', 'verify', 'snapshot'] as const).filter((m) => argv.includes(`--${m}`));
  if (modes.length !== 1) throw new CliError('Pass exactly one of --preflight, --execute, --verify, --snapshot (there is no default action)');
  return modes[0]!;
}

function applicationCommit(): string | null {
  if (process.env.ERVE_APP_COMMIT) return process.env.ERVE_APP_COMMIT;
  const metadataPath = join(process.cwd(), '..', 'deployment-metadata.json');
  if (existsSync(metadataPath)) {
    try {
      return (JSON.parse(readFileSync(metadataPath, 'utf8')) as { gitCommitSha?: string }).gitCommitSha ?? null;
    } catch {
      /* fall through */
    }
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function migrationState() {
  const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished: boolean; rolled_back: boolean }>>(
    'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY migration_name',
  );
  const effective = new Set(applied.filter((m) => m.finished && !m.rolled_back).map((m) => m.migration_name));
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const shipped = existsSync(migrationsDir) ? (await readdir(migrationsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort() : null;
  return {
    appliedCount: effective.size,
    latestApplied: [...effective].sort().at(-1) ?? null,
    failedOrRolledBack: applied.filter((m) => !m.finished || m.rolled_back).map((m) => m.migration_name),
    shippedCount: shipped?.length ?? null,
    pending: shipped ? shipped.filter((m) => !effective.has(m)) : null,
  };
}

const csvCell = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

function planCsv(plan: H3aPlan): string {
  const rows: unknown[][] = [
    ...plan.factories.map((f) => ['Factory', f.canonicalName, f.code, f.action, f.detail]),
    ...plan.seasons.map((s) => ['Season', s.code, s.financialYearCode, s.action, s.detail]),
    ...plan.sizes.map((s) => ['Size', s.sourceSizeCode, s.targetSizeCode, s.action, s.detail]),
    ['ProcessFlow', plan.processFlow.processFlowCode, `v${plan.processFlow.versionNumber}`, plan.processFlow.versionId ? 'EXACT_EXISTING' : 'CONFLICT', plan.processFlow.detail],
    ...plan.styles.map((s) => [
      'Style',
      `${s.season}|${s.lmix}`,
      s.styleNumber,
      s.action,
      [
        `sizes create ${s.sizesToCreate.length}/existing ${s.sizesExisting}`,
        `mapping ${s.mapping}`,
        `image ${s.image}`,
        Object.keys(s.backfill).length ? `backfill ${Object.keys(s.backfill).join('+')}` : '',
        ...s.differences,
      ].filter(Boolean).join('; '),
    ]),
    ...plan.jobOrders.map((j) => ['JobOrder', j.legacyReferenceNumber, j.jobOrderNumber ?? '', j.action, j.differences.join('; ')]),
  ];
  return toCsv(['entity', 'key', 'target', 'action', 'detail'], rows);
}

function planSummary(title: string, plan: H3aPlan, context: Record<string, unknown>, bundle: LoadedBundle): string {
  const lines = [
    `# ${title}`,
    '',
    `- Planned at: ${plan.plannedAt}`,
    ...Object.entries(context).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    `- Bundle SHA-256: \`${bundle.bundleSha256}\``,
    `- Target profile: ${plan.targetProfile}`,
    `- Importer (ADMIN): ${plan.admin ? `${plan.admin.name} (${plan.admin.id})` : 'UNRESOLVED'}`,
    `- Process flow: ${plan.processFlow.detail}`,
    `- ImportBatch: ${plan.importBatch.id ?? '(none)'} ${plan.importBatch.status ?? ''} — ${plan.importBatch.detail}`,
    `- Sequences (JOB_ORDER / HISTORICAL_JOB_ORDER): ${JSON.stringify(plan.sequences)}`,
    `- Existing historical rows: ${JSON.stringify(plan.existingHistorical)}`,
    '',
    '## Bundle integrity',
    ...bundle.checks.map((c) => `- PASS ${c.name}: ${c.detail}`),
    '',
    '## Entity resolution',
    ...Object.entries(plan.counts).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
    '',
    `## Gate: ${plan.gateOk ? 'PASS' : 'FAIL'}${plan.noOp ? ' (no-op: everything already present and exact)' : ''}`,
    ...(plan.problems.length ? plan.problems.map((p) => `- ${p}`) : ['- 0 conflicts, 0 ambiguous identities, 0 silent overwrites planned']),
    '',
  ];
  return lines.join('\n');
}

function verificationCsv(v: H3aVerification): string {
  return toCsv(
    ['legacyReferenceNumber', 'jobOrderNumber', 'season', 'lmix', 'styleNumber', 'factory', 'orderedPieces', 'historicalBusinessDate', 'requiredDeliveryDate', 'finalMrp', 'exFactoryPrice', 'categoryDescription', 'hsnCode', 'hsnDescription', 'imageSha256', 'sourceDocumentSha256', 'result', 'differences'],
    v.records.map((r) => [r.legacyReferenceNumber, r.jobOrderNumber, r.season, r.lmix, r.styleNumber, r.factory, r.orderedPieces, r.historicalBusinessDate, r.requiredDeliveryDate, r.finalMrp, r.exFactoryPrice, r.categoryDescription, r.hsnCode, r.hsnDescription, r.imageSha256, r.sourceDocumentSha256, r.result, r.differences.join('; ')]),
  );
}

function verificationSummary(v: H3aVerification, context: Record<string, unknown>): string {
  return [
    '# H3A historical import — reconciliation',
    '',
    `- Verified at: ${v.verifiedAt}`,
    ...Object.entries(context).map(([k, val]) => `- ${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`),
    `- ImportBatch: ${v.batch.importBatch?.id ?? '(none)'} ${v.batch.importBatch?.status ?? ''} (startedBy ${v.batch.importBatch?.startedById ?? '-'}, completedAt ${v.batch.importBatch?.completedAt ?? '-'})`,
    `- EIJOH range: ${JSON.stringify(v.totals.eijohRange)}`,
    '',
    '## Totals',
    ...Object.entries(v.totals).map(([k, val]) => `- ${k}: ${JSON.stringify(val)}`),
    '',
    `## Checks: ${v.ok ? 'ALL PASS' : 'FAILED'}`,
    ...v.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = resolveMode(argv);
  const expectDatabase = arg(argv, '--expect-database', true)!;
  const [row] = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
  const liveDatabase = row?.db ?? '';
  if (liveDatabase !== expectDatabase) throw new CliError(`Refusing: live current_database() is "${liveDatabase}", not the expected "${expectDatabase}"`);
  console.log(`Target database: ${liveDatabase} (NODE_ENV=${env.NODE_ENV})`);

  if (mode === 'snapshot') {
    const out = arg(argv, '--snapshot', true)!;
    const snapshot = await runReadOnly((tx) => captureDatabaseSnapshot(tx));
    await writeFile(out, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot (read-only) of ${Object.keys(snapshot.tables).length} tables written to ${out}`);
    return;
  }

  const profile: TargetProfile = getTargetProfile(arg(argv, '--profile', true)!);
  if (env.NODE_ENV === 'production' && profile.name !== 'production') throw new CliError('Refusing: NODE_ENV=production requires --profile production');
  if (mode === 'execute') {
    if (!argv.includes('--confirm-write')) throw new CliError('Refusing: --execute requires --confirm-write');
    if (env.NODE_ENV === 'production' && !argv.includes('--confirm-production')) throw new CliError('Refusing: NODE_ENV=production requires --confirm-production');
    if (!process.env.FILE_STORAGE_DIR || !isAbsolute(process.env.FILE_STORAGE_DIR)) throw new CliError('Refusing: FILE_STORAGE_DIR must be set explicitly to an absolute path for --execute');
  }
  const reportDir = arg(argv, '--report-dir', true)!;
  await mkdir(reportDir, { recursive: true });
  const adminEmail = arg(argv, '--admin-email', false);
  const loaded = await loadVerifiedBundle(arg(argv, '--bundle', true)!, arg(argv, '--expect-bundle-sha256', false));
  for (const c of loaded.checks) console.log(`  PASS bundle.${c.name}: ${c.detail}`);
  const commit = applicationCommit();
  const context = { database: liveDatabase, nodeEnv: env.NODE_ENV, applicationCommit: commit ?? '(unknown)', migrations: await migrationState() };
  console.log(`Application commit: ${context.applicationCommit}`);
  console.log(`Migrations: ${JSON.stringify(context.migrations)}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (mode === 'preflight') {
    const plan = await runReadOnly((tx) => planH3aImport(tx, loaded, profile, { adminEmail }));
    await writeFile(join(reportDir, 'production-preflight.json'), JSON.stringify({ mode, context, bundleSha256: loaded.bundleSha256, bundleChecks: loaded.checks, plan }, null, 2));
    await writeFile(join(reportDir, 'production-preflight.csv'), planCsv(plan));
    await writeFile(join(reportDir, 'production-preflight-summary.md'), planSummary('H3A historical import — preflight (READ ONLY)', plan, context, loaded));
    console.log(`Plan: ${JSON.stringify(plan.counts)}`);
    console.log(`Gate: ${plan.gateOk ? 'PASS' : 'FAIL'}${plan.noOp ? ' (no-op)' : ''}`);
    for (const p of plan.problems) console.log(`  PROBLEM ${p}`);
    if (!plan.gateOk) process.exitCode = 2;
    return;
  }

  if (mode === 'execute') {
    const result = await executeH3aImport(loaded, profile, { adminEmail, applicationCommit: commit, onProgress: (m) => console.log(m) });
    const report = { mode, context, bundleSha256: loaded.bundleSha256, outcome: result.outcome, created: result.created, commit: result.commit, before: result.before, after: result.after };
    await writeFile(join(reportDir, `execute-${stamp}.json`), JSON.stringify(report, null, 2));
    if (result.commit) {
      await writeFile(
        join(reportDir, `image-upload-manifest-${stamp}.json`),
        JSON.stringify(
          result.commit.images.map((i) => {
            const spec = loaded.bundle.styles.find((s) => s.legacyReferenceNumbers.includes(i.legacyReferenceNumber));
            return { ...i, styleNumber: spec?.styleNumber, season: spec?.season, lmix: spec?.lmix, imageSha256: spec?.image?.sha256 ?? null, bundlePath: spec?.image?.path ?? null };
          }),
          null,
          2,
        ),
      );
    }
    console.log(`Outcome: ${result.outcome}; created ${JSON.stringify(result.created)}`);
    if (result.commit) console.log(`ImportBatch ${result.commit.importBatchId}; Job Orders created ${result.commit.created.length}, verified ${result.commit.verifiedExisting}`);
    console.log(`After: ${JSON.stringify(result.after.counts)}; sequences ${JSON.stringify(result.after.sequences)}`);
    return;
  }

  const verification = await runReadOnly((tx) => verifyH3aImport(tx, loaded, profile, { adminEmail }));
  await writeFile(join(reportDir, 'production-reconciliation.json'), JSON.stringify({ mode, context, bundleSha256: loaded.bundleSha256, ...verification }, null, 2));
  await writeFile(join(reportDir, 'production-reconciliation.csv'), verificationCsv(verification));
  await writeFile(join(reportDir, 'production-reconciliation-summary.md'), verificationSummary(verification, context));
  for (const c of verification.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  console.log(`Verification: ${verification.ok ? 'ALL PASS' : 'FAILED'}`);
  if (!verification.ok) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    if (error instanceof CliError || error instanceof H3aBundleError || error instanceof H3aImportError || error instanceof HistoricalCommitError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error during the H3A historical import:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

