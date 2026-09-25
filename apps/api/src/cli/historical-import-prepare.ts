// Structurally read-only preparation step (H1 plan §16). Scans the AW25/
// SS26 source folders, parses every PDF and extracts a Style image
// candidate for each, and writes only environment-independent artifacts:
// source-staging.json, source-manifest.json, a parse report, and the
// extracted image files. NO database access, NO write-service reference —
// this file never imports historical-import.service.ts.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { processHistoricalPurchaseOrderPdf } from '../modules/historical-import/historical-po-pdf-processor.js';
import { writePrepareOutputs, type ImageOutputIdentityResolver, type PrepareOutput } from '../modules/historical-import/staging.service.js';
import { parseSourceOverridesArtifact, resolveApprovedOverridesForRecord } from '../modules/historical-import/source-overrides.js';

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
  /** Approved checksum-bound source-overrides.json — makes images name by the EFFECTIVE legacy reference, not the printed one. */
  sourceOverridesPath?: string;
}

/** Effective legacy reference = an APPROVED checksum-bound override when one exists, else the printed value. */
async function effectiveIdentityResolver(sourceOverridesPath: string): Promise<ImageOutputIdentityResolver> {
  const entries = parseSourceOverridesArtifact(JSON.parse(await readFile(sourceOverridesPath, 'utf8')));
  return (parsed) => {
    const override = resolveApprovedOverridesForRecord(entries, parsed).find((o) => o.field === 'legacyReferenceNumber');
    if (override && typeof override.approvedValue === 'string') return { identity: override.approvedValue, source: 'EFFECTIVE_OVERRIDE' };
    if (parsed.legacyReferenceNumber.value) return { identity: parsed.legacyReferenceNumber.value, source: 'PRINTED_REFERENCE' };
    return { identity: parsed.sourceFileName.replace(/\.pdf$/i, ''), source: 'SOURCE_FILE_NAME' };
  };
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
    resolveImageIdentity: options.sourceOverridesPath ? await effectiveIdentityResolver(options.sourceOverridesPath) : undefined,
  });
}
