// Structurally read-only preparation step (H1 plan §16). Scans the AW25/
// SS26 source folders, parses every PDF and extracts a Style image
// candidate for each, and writes only environment-independent artifacts:
// source-staging.json, source-manifest.json, a parse report, and the
// extracted image files. NO database access, NO write-service reference —
// this file never imports historical-import.service.ts.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { processHistoricalPurchaseOrderPdf } from '../modules/historical-import/historical-po-pdf-processor.js';
import { writePrepareOutputs, type PrepareOutput } from '../modules/historical-import/staging.service.js';

export class HistoricalImportPrepareError extends Error {}

function resolveParserGitCommitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export interface RunHistoricalImportPrepareOptions {
  aw25Dir: string;
  ss26Dir: string;
  outputDir: string;
}

export async function runHistoricalImportPrepare(options: RunHistoricalImportPrepareOptions): Promise<PrepareOutput> {
  const seasonFolders: Array<{ season: 'AW25' | 'SS26'; dir: string }> = [
    { season: 'AW25', dir: options.aw25Dir },
    { season: 'SS26', dir: options.ss26Dir },
  ];

  const items: Array<Awaited<ReturnType<typeof processHistoricalPurchaseOrderPdf>>> = [];
  for (const { season, dir } of seasonFolders) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      throw new HistoricalImportPrepareError(`Could not read source directory "${dir}": ${error instanceof Error ? error.message : String(error)}`);
    }
    const pdfFiles = entries.filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
    if (pdfFiles.length === 0) {
      throw new HistoricalImportPrepareError(`No .pdf files found in "${dir}"`);
    }
    for (const fileName of pdfFiles) {
      const filePath = join(dir, fileName);
      const processed = await processHistoricalPurchaseOrderPdf({ filePath, relativePath: fileName, sourceSeasonFolder: season });
      items.push(processed);
    }
  }

  return writePrepareOutputs(options.outputDir, items, {
    parserVersion: '1.0.0',
    parserGitCommitSha: resolveParserGitCommitSha(),
  });
}
