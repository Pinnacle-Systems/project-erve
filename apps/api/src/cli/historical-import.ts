// Structurally read-only dry-run step (H1 plan §17). Reads master data
// from the verified Dev database read-only; writes ZERO application
// records. There is no `dryRun:false` mode and no `--commit` flag
// anywhere in this file's dependency chain — H2 introduces the first
// commit command separately, on top of the already-tested
// historical-import.service.ts (which this file never imports).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { prisma } from '../db/prisma.js';
import { requireVerifiedDevDatabaseTarget, formatDevTargetReport, DevTargetGuardError } from '../modules/historical-import/dev-target-guard.js';
import { resolveProcessFlowVersionPin, ProcessFlowPinError } from '../modules/historical-import/process-flow-pin.js';
import { reconcileBatch, type ReconciledRecord } from '../modules/historical-import/reconciliation.service.js';
import { analyzeLegacyNumbering } from '../modules/historical-import/numbering-analysis.js';
import { buildSourceManifest } from '../modules/historical-import/source-manifest.js';
import { writeDryRunOutputs } from '../modules/historical-import/dry-run-report.service.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';
import type { ParsedPurchaseOrderRecord } from '../modules/historical-import/po-pdf-parser.types.js';
import type { ExtractedImageCandidate } from '../modules/historical-import/style-image-extractor.js';

export class HistoricalImportDryRunError extends Error {}

function stagingToParsedRecord(staging: SourceStagingRecord): ParsedPurchaseOrderRecord {
  return {
    sourceFileName: staging.sourceFileName,
    sourceRelativePath: staging.sourceRelativePath,
    sourceChecksumSha256: staging.sourceChecksumSha256,
    sourceSizeBytes: staging.sourceSizeBytes,
    sourceSeasonFolder: staging.sourceSeasonFolder,
    parseStatus: staging.parseStatus,
    warnings: staging.warnings,
    ...staging.fields,
  };
}

function stagingToImageCandidate(staging: SourceStagingRecord): ExtractedImageCandidate {
  return {
    method: staging.imageExtractionMethod,
    pageNumber: 1,
    imageBytes: null,
    widthPx: staging.imageWidthPx,
    heightPx: staging.imageHeightPx,
    sha256: staging.imageSha256,
    notes: staging.imageNotes,
  };
}

export interface RunHistoricalImportDryRunOptions {
  batchLabel: string;
  stagingFilePath: string;
  processFlowVersionId?: string;
}

export interface HistoricalImportDryRunResult {
  outputDir: string;
  devReconciliationPath: string;
  migrationApprovalPath: string;
  humanReviewPath: string;
  reconciledRecords: ReconciledRecord[];
  summary: Awaited<ReturnType<typeof writeDryRunOutputs>>['summary'];
  identity: Awaited<ReturnType<typeof writeDryRunOutputs>>['identity'];
  processFlowVersionId: string;
  processFlowLogicalIdentityFingerprint: string;
}

export async function runHistoricalImportDryRun(options: RunHistoricalImportDryRunOptions): Promise<HistoricalImportDryRunResult> {
  const target = requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
  });
  console.log(formatDevTargetReport(target, 'READ ONLY BUSINESS DATA'));
  console.log('');

  const outputDir = dirname(options.stagingFilePath);
  let stagingRecords: SourceStagingRecord[];
  try {
    stagingRecords = JSON.parse(await readFile(options.stagingFilePath, 'utf8')) as SourceStagingRecord[];
  } catch (error) {
    throw new HistoricalImportDryRunError(`Could not read staging file "${options.stagingFilePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifestPath = join(outputDir, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ReturnType<typeof buildSourceManifest>;

  let processFlowPin;
  try {
    processFlowPin = await resolveProcessFlowVersionPin(prisma, options.processFlowVersionId);
  } catch (error) {
    if (error instanceof ProcessFlowPinError) throw new HistoricalImportDryRunError(error.message);
    throw error;
  }

  const items = stagingRecords.map((staging) => ({ parsed: stagingToParsedRecord(staging), image: stagingToImageCandidate(staging) }));
  const reconciledRecords = await reconcileBatch(prisma, items);
  const numbering = analyzeLegacyNumbering(
    stagingRecords.map((s) => ({ sourceFileName: s.sourceFileName, sourceSeasonFolder: s.sourceSeasonFolder, legacyReferenceNumber: s.fields.legacyReferenceNumber.value })),
  );

  const { devReconciliationPath, migrationApprovalPath, humanReviewPath, summary, identity } = await writeDryRunOutputs({
    outputDir,
    batchLabel: options.batchLabel,
    stagingRecords,
    reconciledRecords,
    processFlowPin,
    manifest,
    numbering,
    devTargetDatabase: target.actualDatabase,
  });

  return {
    outputDir,
    devReconciliationPath,
    migrationApprovalPath,
    humanReviewPath,
    reconciledRecords,
    summary,
    identity,
    processFlowVersionId: processFlowPin.devProcessFlowVersionId,
    processFlowLogicalIdentityFingerprint: processFlowPin.logicalIdentity.fingerprint,
  };
}

export { DevTargetGuardError };
