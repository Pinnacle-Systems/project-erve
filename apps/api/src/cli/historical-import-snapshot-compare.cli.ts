#!/usr/bin/env node
// H3A — compares two --snapshot files from historical-import-production.cli.ts.
// Pure file comparison, no database access. Any change outside the expected
// historical inserts (a modified or deleted pre-existing row anywhere, a
// changed non-insert table, a rewound sequence, or a sequence other than
// HISTORICAL_JOB_ORDER moving) is reported as a violation (exit 1).
//
// Usage: tsx src/cli/historical-import-snapshot-compare.cli.ts <before.json> <after.json> [<report.json>]
import { readFile, writeFile } from 'node:fs/promises';
import { compareSnapshots, type DatabaseSnapshot } from '../modules/historical-import/h3a/production-import.service.js';

async function main(): Promise<void> {
  const [beforePath, afterPath, reportPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('Usage: historical-import-snapshot-compare <before.json> <after.json> [<report.json>]');
  const before = JSON.parse(await readFile(beforePath, 'utf8')) as DatabaseSnapshot;
  const after = JSON.parse(await readFile(afterPath, 'utf8')) as DatabaseSnapshot;
  if (before.database !== after.database) throw new Error(`Snapshots are from different databases (${before.database} vs ${after.database})`);
  const comparison = compareSnapshots(before, after, (s) => s.documentType === 'HISTORICAL_JOB_ORDER');
  const report = { before: before.capturedAt, after: after.capturedAt, database: before.database, sequencesBefore: before.allSequences, sequencesAfter: after.allSequences, ...comparison };
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Unchanged tables: ${comparison.unchangedTables.length}`);
  console.log(`Insert-only tables: ${JSON.stringify(comparison.insertOnlyTables)}`);
  console.log(`Session noise: ${JSON.stringify(comparison.sessionNoise)}`);
  console.log(`Violations: ${comparison.violations.length}`);
  for (const v of comparison.violations) console.log(`  VIOLATION ${v}`);
  if (!comparison.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
