// Prepare-step output writer (H1 plan §16/§19/§20/§21). Writes only
// environment-independent, source-oriented artifacts — no DB access, no DB
// IDs baked in anywhere here. source-staging.json is immutable once
// written; the dry-run step reads it but never modifies it.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import type { ExtractedImageCandidate } from './style-image-extractor.js';
import { buildSourceManifest, type SourceManifestFileEntry } from './source-manifest.js';
import { analyzeLegacyNumbering, type NumberingAnalysisResult } from './numbering-analysis.js';

export interface SourceStagingRecord {
  sourceFileName: string;
  sourceRelativePath: string;
  sourceChecksumSha256: string;
  sourceSizeBytes: number;
  sourceSeasonFolder: 'AW25' | 'SS26';
  parseStatus: ParsedPurchaseOrderRecord['parseStatus'];
  warnings: string[];
  fields: Omit<
    ParsedPurchaseOrderRecord,
    'sourceFileName' | 'sourceRelativePath' | 'sourceChecksumSha256' | 'sourceSizeBytes' | 'sourceSeasonFolder' | 'parseStatus' | 'warnings'
  >;
  imageExtractionMethod: ExtractedImageCandidate['method'];
  imageSha256: string | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
  imageRelativePath: string | null;
  imageNotes: string[];
}

export interface PrepareOutput {
  outputDir: string;
  sourceStagingPath: string;
  sourceManifestPath: string;
  parseReportPath: string;
  imagesDir: string;
  manifest: ReturnType<typeof buildSourceManifest>;
  numbering: NumberingAnalysisResult;
}

function safeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function writePrepareOutputs(
  outputDir: string,
  items: Array<{ parsed: ParsedPurchaseOrderRecord; image: ExtractedImageCandidate }>,
  options: { parserVersion: string; parserGitCommitSha?: string | null },
): Promise<PrepareOutput> {
  const imagesDir = join(outputDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  const stagingRecords: SourceStagingRecord[] = [];
  const manifestFiles: SourceManifestFileEntry[] = [];

  for (const { parsed, image } of items) {
    let imageRelativePath: string | null = null;
    if (image.imageBytes) {
      const baseName = safeFileToken(parsed.legacyReferenceNumber.value ?? parsed.sourceFileName.replace(/\.pdf$/i, ''));
      imageRelativePath = join('images', parsed.sourceSeasonFolder, `${baseName}.png`);
      await mkdir(join(outputDir, 'images', parsed.sourceSeasonFolder), { recursive: true });
      await writeFile(join(outputDir, imageRelativePath), image.imageBytes);
    }

    const { sourceFileName, sourceRelativePath, sourceChecksumSha256, sourceSizeBytes, sourceSeasonFolder, parseStatus, warnings, ...fields } = parsed;
    stagingRecords.push({
      sourceFileName,
      sourceRelativePath,
      sourceChecksumSha256,
      sourceSizeBytes,
      sourceSeasonFolder,
      parseStatus,
      warnings,
      fields,
      imageExtractionMethod: image.method,
      imageSha256: image.sha256,
      imageWidthPx: image.widthPx,
      imageHeightPx: image.heightPx,
      imageRelativePath,
      imageNotes: image.notes,
    });

    manifestFiles.push({
      season: sourceSeasonFolder,
      relativeFilename: sourceRelativePath,
      sizeBytes: sourceSizeBytes,
      sha256: sourceChecksumSha256,
    });
  }

  const manifest = buildSourceManifest(manifestFiles, {
    parserVersion: options.parserVersion,
    parserGitCommitSha: options.parserGitCommitSha,
  });
  const numbering = analyzeLegacyNumbering(
    items.map(({ parsed }) => ({
      sourceFileName: parsed.sourceFileName,
      sourceSeasonFolder: parsed.sourceSeasonFolder,
      legacyReferenceNumber: parsed.legacyReferenceNumber.value,
    })),
  );

  const sourceStagingPath = join(outputDir, 'source-staging.json');
  const sourceManifestPath = join(outputDir, 'source-manifest.json');
  const parseReportPath = join(outputDir, 'parse-report.json');

  await writeFile(sourceStagingPath, JSON.stringify(stagingRecords, null, 2));
  await writeFile(sourceManifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(
    parseReportPath,
    JSON.stringify(
      {
        totalSourceDocuments: items.length,
        parseStatusCounts: {
          OK: items.filter((i) => i.parsed.parseStatus === 'OK').length,
          PARTIAL: items.filter((i) => i.parsed.parseStatus === 'PARTIAL').length,
          FAILED: items.filter((i) => i.parsed.parseStatus === 'FAILED').length,
        },
        imageMethodCounts: {
          EMBEDDED_IMAGE: items.filter((i) => i.image.method === 'EMBEDDED_IMAGE').length,
          TEMPLATE_CROP: items.filter((i) => i.image.method === 'TEMPLATE_CROP').length,
          MANUAL_REVIEW: items.filter((i) => i.image.method === 'MANUAL_REVIEW').length,
        },
        numbering,
      },
      null,
      2,
    ),
  );

  return { outputDir, sourceStagingPath, sourceManifestPath, parseReportPath, imagesDir, manifest, numbering };
}
