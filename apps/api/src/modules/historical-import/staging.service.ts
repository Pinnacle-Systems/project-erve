// Prepare-step output writer (H1 plan §16/§19/§20/§21). Writes only
// environment-independent, source-oriented artifacts — no DB access, no DB
// IDs baked in anywhere here. source-staging.json is immutable once
// written; the dry-run step reads it but never modifies it.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  /** H3A: the reference literally printed in the PDF — provenance only, never the image's output identity. */
  imagePrintedLegacyReference?: string | null;
  /** H3A: the identity the image file is named by (effective legacy reference after approved overrides). */
  imageOutputIdentity?: string | null;
  imageOutputIdentitySource?: ImageOutputIdentitySource;
  imageOutcome?: ImageWriteOutcome;
  /** Set only when imageOutcome is COLLISION_REVIEW_REQUIRED — nothing was written for this record. */
  imageCollision?: ImageCollision | null;
}

export type ImageOutputIdentitySource = 'EFFECTIVE_OVERRIDE' | 'PRINTED_REFERENCE' | 'SOURCE_FILE_NAME';
export type ImageWriteOutcome = 'WRITTEN' | 'IDENTICAL_NO_OP' | 'COLLISION_REVIEW_REQUIRED' | 'NO_IMAGE';
export interface ImageCollision {
  targetRelativePath: string;
  existingSha256: string;
  candidateSha256: string;
  existingFrom: 'THIS_RUN' | 'DISK';
}

/**
 * Resolves the identity an image file is named by. H1 originally named each
 * image by the reference PRINTED in its PDF; EI26032.pdf prints "EI26031",
 * so its image silently overwrote EI26031's. Callers now supply the
 * effective (approved-override-aware) legacy reference; the printed value
 * is kept only as provenance.
 */
export type ImageOutputIdentityResolver = (parsed: ParsedPurchaseOrderRecord) => {
  identity: string;
  source: ImageOutputIdentitySource;
};

export class PrepareOutputError extends Error {}

export interface PrepareOutput {
  outputDir: string;
  sourceStagingPath: string;
  sourceManifestPath: string;
  parseReportPath: string;
  imagesDir: string;
  manifest: ReturnType<typeof buildSourceManifest>;
  numbering: NumberingAnalysisResult;
  imageOutcomes: Record<ImageWriteOutcome, number>;
  imageCollisions: Array<{ sourceFileName: string; printedLegacyReference: string | null; outputIdentity: string | null; collision: ImageCollision }>;
}

function safeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function writePrepareOutputs(
  outputDir: string,
  items: Array<{ parsed: ParsedPurchaseOrderRecord; image: ExtractedImageCandidate }>,
  options: { parserVersion: string; parserGitCommitSha?: string | null; resolveImageIdentity?: ImageOutputIdentityResolver },
): Promise<PrepareOutput> {
  // source-staging.json is an immutable approved artifact once written —
  // never regenerate it in place over an existing prepare output.
  const stagingExists = await access(join(outputDir, 'source-staging.json')).then(
    () => true,
    () => false,
  );
  if (stagingExists) {
    throw new PrepareOutputError(`Refusing to overwrite existing ${join(outputDir, 'source-staging.json')} — prepare into a fresh output directory`);
  }
  const imagesDir = join(outputDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  const stagingRecords: SourceStagingRecord[] = [];
  const manifestFiles: SourceManifestFileEntry[] = [];
  const writtenThisRun = new Map<string, string>();
  const resolveIdentity: ImageOutputIdentityResolver =
    options.resolveImageIdentity ??
    ((parsed) =>
      parsed.legacyReferenceNumber.value
        ? { identity: parsed.legacyReferenceNumber.value, source: 'PRINTED_REFERENCE' }
        : { identity: parsed.sourceFileName.replace(/\.pdf$/i, ''), source: 'SOURCE_FILE_NAME' });

  for (const { parsed, image } of items) {
    let imageRelativePath: string | null = null;
    let imageOutputIdentity: string | null = null;
    let imageOutputIdentitySource: ImageOutputIdentitySource | undefined;
    let imageOutcome: ImageWriteOutcome = 'NO_IMAGE';
    let imageCollision: ImageCollision | null = null;
    if (image.imageBytes) {
      const resolved = resolveIdentity(parsed);
      imageOutputIdentity = resolved.identity;
      imageOutputIdentitySource = resolved.source;
      const targetRelativePath = join('images', parsed.sourceSeasonFolder, `${safeFileToken(resolved.identity)}.png`);
      const candidateSha256 = createHash('sha256').update(image.imageBytes).digest('hex');
      const priorThisRun = writtenThisRun.get(targetRelativePath);
      const priorOnDisk =
        priorThisRun === undefined
          ? await readFile(join(outputDir, targetRelativePath)).then(
              (bytes) => createHash('sha256').update(bytes).digest('hex'),
              () => undefined,
            )
          : undefined;
      const existingSha256 = priorThisRun ?? priorOnDisk;
      if (existingSha256 === undefined) {
        await mkdir(join(outputDir, 'images', parsed.sourceSeasonFolder), { recursive: true });
        // 'wx' fails rather than overwrite, even against a concurrent writer.
        await writeFile(join(outputDir, targetRelativePath), image.imageBytes, { flag: 'wx' });
        writtenThisRun.set(targetRelativePath, candidateSha256);
        imageRelativePath = targetRelativePath;
        imageOutcome = 'WRITTEN';
      } else if (existingSha256 === candidateSha256) {
        imageRelativePath = targetRelativePath;
        imageOutcome = 'IDENTICAL_NO_OP';
      } else {
        // HARD COLLISION: same output identity, different bytes. Never
        // overwrite; the record keeps no image path and is flagged for review.
        imageOutcome = 'COLLISION_REVIEW_REQUIRED';
        imageCollision = { targetRelativePath, existingSha256, candidateSha256, existingFrom: priorThisRun !== undefined ? 'THIS_RUN' : 'DISK' };
      }
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
      imagePrintedLegacyReference: parsed.legacyReferenceNumber.value,
      imageOutputIdentity,
      imageOutputIdentitySource,
      imageOutcome,
      imageCollision,
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

  const imageOutcomes: Record<ImageWriteOutcome, number> = { WRITTEN: 0, IDENTICAL_NO_OP: 0, COLLISION_REVIEW_REQUIRED: 0, NO_IMAGE: 0 };
  for (const record of stagingRecords) imageOutcomes[record.imageOutcome ?? 'NO_IMAGE']++;
  const imageCollisions = stagingRecords
    .filter((record) => record.imageCollision)
    .map((record) => ({
      sourceFileName: record.sourceFileName,
      printedLegacyReference: record.imagePrintedLegacyReference ?? null,
      outputIdentity: record.imageOutputIdentity ?? null,
      collision: record.imageCollision!,
    }));
  return { outputDir, sourceStagingPath, sourceManifestPath, parseReportPath, imagesDir, manifest, numbering, imageOutcomes, imageCollisions };
}
