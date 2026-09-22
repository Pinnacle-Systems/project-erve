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
import { parseFactoryMappingArtifact, type FactoryMappingRow } from '../modules/historical-import/factory-mapping.js';
import {
  parseSourceOverridesArtifact,
  resolveApprovedOverridesForRecord,
  applyApprovedOverrides,
  type SourceOverrideEntry,
} from '../modules/historical-import/source-overrides.js';
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
  /** H2A plan §11: optional path to a human-reviewed factory-mapping.json. Consulted only after exact Factory-name matching fails; never fuzzy. */
  factoryMappingFilePath?: string;
  /** H2A plan §8: optional path to a human-reviewed source-overrides.json. Only APPROVED overrides bound to a matching sourceSha256 are ever applied, and only in-memory — source-staging.json is never modified. */
  sourceOverridesFilePath?: string;
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

  let factoryMappings: FactoryMappingRow[] | undefined;
  if (options.factoryMappingFilePath) {
    const raw = JSON.parse(await readFile(options.factoryMappingFilePath, 'utf8'));
    factoryMappings = parseFactoryMappingArtifact(raw);
  }

  let overrideEntries: SourceOverrideEntry[] = [];
  if (options.sourceOverridesFilePath) {
    const raw = JSON.parse(await readFile(options.sourceOverridesFilePath, 'utf8'));
    overrideEntries = parseSourceOverridesArtifact(raw);
  }

  const appliedOverridesByFile: Record<string, string[]> = {};
  const items = stagingRecords.map((staging) => {
    const parsed = stagingToParsedRecord(staging);
    const approvedOverrides = resolveApprovedOverridesForRecord(overrideEntries, {
      sourceFileName: staging.sourceFileName,
      sourceChecksumSha256: staging.sourceChecksumSha256,
    });
    const { record, appliedFields } = applyApprovedOverrides(parsed, approvedOverrides);
    if (appliedFields.length > 0) appliedOverridesByFile[staging.sourceFileName] = appliedFields;
    return { parsed: record, image: stagingToImageCandidate(staging) };
  });
  const reconciledRecords = await reconcileBatch(prisma, items, factoryMappings);
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
    factoryMappingFilePath: options.factoryMappingFilePath,
    sourceOverridesFilePath: options.sourceOverridesFilePath,
    appliedOverridesByFile,
    h2aApprovals: {
      processFlowVersion: {
        status: 'APPROVED',
        rationale:
          "Verified logically: ERVE_PRODUCTION_QUALITY v3 is the only ACTIVE version of the named apparel production+quality flow (v1/v2 are RETIRED); its 8 stages (PP Sample, PPM, Cutting, Printing, Sewing, Inline Inspection, Finishing, Final Inspection) match ERVE's documented quality-gated apparel process. The competing ACTIVE flow, DEFAULT_PRODUCTION v1, has only 4 bare production stages with no quality gates and no stage codes — a minimal seed/bootstrap flow, not the intended historical apparel flow. Fingerprint is deterministic/reproducible across repeated resolution and excludes all environment-specific DB ids.",
      },
      pendingUserApprovals: [
        {
          topic: 'EI26031/EI26032 legacyReferenceNumber identity conflict',
          recommendation: "EI26032.pdf's printed order number (EI26031) is very likely a source-document numbering error; recommended effective legacyReferenceNumber for EI26032.pdf is EI26032.",
          evidenceFile: 'h2a/ei26031-ei26032-investigation.md',
        },
        {
          topic: 'EI26002 truncated order date',
          recommendation: 'orderDate for EI26002.pdf is truncated in the source PDF itself (19/02/202); recommended value 2026-02-19, inferred from the adjacent shipment date and season, not read directly.',
          evidenceFile: 'h2a/partial-record-investigation.md',
        },
        {
          topic: 'EI26042 licenseStyleLmix source anomaly',
          recommendation: "EI26042.pdf's Artwork-table fallback value (LMIX42026007) is very likely a copy/paste carryover from the preceding order EI26041; recommended effective licenseStyleLmix is LMIX42026010, matching the document's own orphaned header value and its filename.",
          evidenceFile: 'h2a/lmix42026007-lmix42026010-investigation.md',
        },
        {
          topic: 'Style.finalMrp has no source equivalent',
          recommendation:
            'Every one of the 90 unique Season+LMIX Style identities is blocked on this required field. Source PDFs give a supplier ex-factory rate, not a consumer MRP, and no documented conversion convention exists. Needs an explicit business decision (a real historical MRP list, or an approved placeholder/default convention) before any historical Style can be created.',
          evidenceFile: 'h2a/master-readiness-plan.json',
        },
        {
          topic: 'Size-code naming convention (source bare digits vs Dev AGE_<n>)',
          recommendation:
            'All 12 source Size codes ("3".."14") fail an exact match against Dev Size.code ("AGE_3".."AGE_14"), even though Dev Size.label already equals the source code exactly. Recommend extending the same explicit-mapping approach used for Factory (map "3"->"AGE_3", etc.) rather than creating duplicate Size masters — needs explicit approval before implementation.',
          evidenceFile: 'h2a/master-readiness-plan.json',
        },
      ],
    },
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
