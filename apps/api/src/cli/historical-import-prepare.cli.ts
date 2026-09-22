#!/usr/bin/env node
// Structurally read-only — no database access, no write-service reference
// anywhere in this command's dependency chain (H1 plan §16).
//
// Usage (from apps/api):
//   tsx src/cli/historical-import-prepare.cli.ts \
//     --aw25-dir "C:\Users\kalay\Downloads\reerveindiaaw25po" \
//     --ss26-dir "C:\Users\kalay\Downloads\reerveindiass26po" \
//     --output "C:\Users\kalay\workspace\project-erve\.artifacts\historical-import\AW25-SS26"
import { HistoricalImportPrepareError, runHistoricalImportPrepare } from './historical-import-prepare.js';

function parseArgs(argv: string[]): { aw25Dir: string; ss26Dir: string; outputDir: string } {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const aw25Dir = get('--aw25-dir');
  const ss26Dir = get('--ss26-dir');
  const outputDir = get('--output');
  if (!aw25Dir) throw new HistoricalImportPrepareError('--aw25-dir is required');
  if (!ss26Dir) throw new HistoricalImportPrepareError('--ss26-dir is required');
  if (!outputDir) throw new HistoricalImportPrepareError('--output is required');
  return { aw25Dir, ss26Dir, outputDir };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log('historical-import:prepare — structurally read-only, no database access');
  console.log(`  AW25 source: ${options.aw25Dir}`);
  console.log(`  SS26 source: ${options.ss26Dir}`);
  console.log(`  Output: ${options.outputDir}`);
  console.log('');

  const result = await runHistoricalImportPrepare(options);

  console.log(`Parsed ${result.manifest.totalCount} source documents (AW25: ${result.manifest.aw25Count}, SS26: ${result.manifest.ss26Count})`);
  console.log(`  source-staging.json:  ${result.sourceStagingPath}`);
  console.log(`  source-manifest.json: ${result.sourceManifestPath}`);
  console.log(`  parse-report.json:    ${result.parseReportPath}`);
  console.log(`  images:               ${result.imagesDir}`);
  console.log(`  aggregate manifest SHA-256: ${result.manifest.aggregateSha256}`);
  console.log('');
  for (const season of result.numbering.bySeason) {
    console.log(
      `${season.season}: ${season.totalSourceDocuments} docs, serials ${season.minSerial ?? '?'}-${season.maxSerial ?? '?'}, ${season.missingSerials.length} gap(s), ${season.malformedCount} malformed, ${season.repeatedReferences.length} repeated`,
    );
  }
  if (result.numbering.crossSeasonReuse.length > 0) {
    console.log(`Cross-season reference reuse: ${result.numbering.crossSeasonReuse.length}`);
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof HistoricalImportPrepareError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while preparing the historical import batch:');
      console.error(error);
    }
    process.exitCode = 1;
  });
