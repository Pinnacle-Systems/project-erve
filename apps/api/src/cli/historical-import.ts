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
import { parseSizeMappingArtifact, type SizeMappingRow } from '../modules/historical-import/size-mapping.js';
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

export function stagingToParsedRecord(staging: SourceStagingRecord): ParsedPurchaseOrderRecord {
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
  /** H2A continuation §3: optional path to a human-reviewed size-mapping.json. Consulted only after exact Size-code matching fails; never fuzzy. */
  sizeMappingFilePath?: string;
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

  let sizeMappings: SizeMappingRow[] | undefined;
  if (options.sizeMappingFilePath) {
    const raw = JSON.parse(await readFile(options.sizeMappingFilePath, 'utf8'));
    sizeMappings = parseSizeMappingArtifact(raw);
  }

  let overrideEntries: SourceOverrideEntry[] = [];
  if (options.sourceOverridesFilePath) {
    const raw = JSON.parse(await readFile(options.sourceOverridesFilePath, 'utf8'));
    overrideEntries = parseSourceOverridesArtifact(raw);
  }

  const appliedOverridesByFile: Record<string, string[]> = {};
  const effectiveParseStatusChangesByFile: Record<string, { from: string; to: string; resolvedWarnings: string[] }> = {};
  const items = stagingRecords.map((staging) => {
    const parsed = stagingToParsedRecord(staging);
    const approvedOverrides = resolveApprovedOverridesForRecord(overrideEntries, {
      sourceFileName: staging.sourceFileName,
      sourceChecksumSha256: staging.sourceChecksumSha256,
    });
    const { record, appliedFields, resolvedWarnings } = applyApprovedOverrides(parsed, approvedOverrides);
    if (appliedFields.length > 0) appliedOverridesByFile[staging.sourceFileName] = appliedFields;
    if (record.parseStatus !== parsed.parseStatus) {
      effectiveParseStatusChangesByFile[staging.sourceFileName] = { from: parsed.parseStatus, to: record.parseStatus, resolvedWarnings };
    }
    return { parsed: record, image: stagingToImageCandidate(staging) };
  });
  const reconciledRecords = await reconcileBatch(prisma, items, factoryMappings, sizeMappings);
  // Uses the EFFECTIVE (post-approved-override) legacyReferenceNumber, not
  // the raw staging value — otherwise an approved identity correction (e.g.
  // EI26032) would leave this recommendation citing a "repeat" that
  // reconciliation itself no longer sees (H2A continuation §1/§6).
  const numbering = analyzeLegacyNumbering(
    items.map((item, i) => ({
      sourceFileName: stagingRecords[i]!.sourceFileName,
      sourceSeasonFolder: stagingRecords[i]!.sourceSeasonFolder,
      legacyReferenceNumber: item.parsed.legacyReferenceNumber.value,
    })),
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
    sizeMappingFilePath: options.sizeMappingFilePath,
    sourceOverridesFilePath: options.sourceOverridesFilePath,
    appliedOverridesByFile,
    effectiveParseStatusChangesByFile,
    h2aApprovals: {
      processFlowVersion: {
        status: 'APPROVED',
        rationale:
          "Verified logically: ERVE_PRODUCTION_QUALITY v3 is the only ACTIVE version of the named apparel production+quality flow (v1/v2 are RETIRED); its 8 stages (PP Sample, PPM, Cutting, Printing, Sewing, Inline Inspection, Finishing, Final Inspection) match ERVE's documented quality-gated apparel process. The competing ACTIVE flow, DEFAULT_PRODUCTION v1, has only 4 bare production stages with no quality gates and no stage codes — a minimal seed/bootstrap flow, not the intended historical apparel flow. Fingerprint is deterministic/reproducible across repeated resolution and excludes all environment-specific DB ids.",
      },
      resolvedApprovals: [
        {
          topic: 'EI26031/EI26032 legacyReferenceNumber identity conflict',
          resolution:
            "APPROVED by the project owner. EI26032.pdf's printed order number (EI26031) was confirmed a source-document numbering error; effective legacyReferenceNumber for EI26032.pdf is now EI26032, applied via an APPROVED, checksum-bound override — see source-overrides.json and appliedOverridesByFile above. All 91 effective legacy references are now confirmed unique (see historicalIdentityRecommendation).",
          evidenceFile: 'h2a/ei26031-ei26032-investigation.md',
        },
        {
          topic: 'EI26002 truncated order date',
          resolution:
            'APPROVED by the project owner. orderDate for EI26002.pdf, truncated in the source PDF itself (19/02/202), is now 2026-02-19 via an APPROVED, checksum-bound override; the record\'s effective parseStatus was upgraded PARTIAL -> OK (see effectiveParseStatusChangesByFile above) since that was the only cause of its PARTIAL status.',
          evidenceFile: 'h2a/partial-record-investigation.md',
        },
        {
          topic: 'EI26042 licenseStyleLmix source anomaly',
          resolution:
            "APPROVED by the project owner. Fixed at the parser level (not a one-off hack): explicit header LMIX now takes precedence over the table's Artwork-column fallback, and a new standalone-header-region lookup finds the header's own unlabeled LMIX value when the 'License Style' label text is itself absent from the source (an authentic template variant affecting 10 real SS26 documents, not just EI26042). EI26042.pdf now parses LMIX42026010 natively; an APPROVED override is additionally recorded for audit/diagnostic history. Rerun across all 91 real PDFs confirmed 0 regressions (90 OK / 1 PARTIAL / 0 FAILED, unchanged; 0 filename-vs-parsed LMIX mismatches, down from 1).",
          evidenceFile: 'h2a/lmix42026007-lmix42026010-investigation.md',
        },
        {
          topic: 'Size-code naming convention (source bare digits vs Dev AGE_<n>)',
          resolution:
            'APPROVED by the project owner. A historical-import-specific size-mapping.json mechanism (analogous to factory-mapping.json, no fuzzy matching, portable Size.code business key) now maps all 12 source codes ("3".."14") to their current Dev Size.code ("AGE_3".."AGE_14"). Every row was verified against the CURRENT Dev Size.label set at generation time, not assumed — 12/12 approved.',
          evidenceFile: 'h2a/size-mapping.json',
        },
        {
          topic: 'Style.finalMrp has no source equivalent (H2A continuation — MRP/Ex-Factory Reconciliation)',
          resolution:
            'RESOLVED. The business supplied "MRP & Ex factory cost.xlsx" (91 required Season+LMIX identities, 92 workbook rows, 1 extra row outside current scope). The workbook has no explicit LMIX column; its numeric "Base code" column resolves to the already-approved historical LMIX either directly (all 49 SS26 rows) or via a verified, deterministic digit-transposition at positions 4-5 (all 42 AW25 rows) — never fuzzy, never by description/colour/rate alone (see mrp-workbook.ts/mrp-reconciliation.ts). All 91 identities RESOLVED with 0 REVIEW_REQUIRED/BLOCKED and 100% ex-factory-cost agreement against the historical PO supplier rate (91/91), strongly corroborating the match. 91 Styles, 546 StyleSizes, and 91 Style<->Factory mappings were created in Dev via the same controlled, idempotent, dev-target-guarded write path as historical-import-master-prep.ts (see historical-import-style-prep.ts) — never raw SQL, never a historical Job Order/ImportBatch/HistoricalDocument row.',
          evidenceFile: 'h2a/mrp-reconciliation.json',
        },
        {
          topic: 'Ex-factory cost reconciliation (H2A plan §7)',
          resolution:
            'RESOLVED. All 91 Style<->Factory mappings were NEW_MAPPING_RATE (no current Dev mapping existed yet) with an unambiguous business workbook rate; a rerun after creation confirms all 91 now MATCH. Historical PO supplier rate is left unaltered as documentary evidence — never overwritten by the new workbook.',
          evidenceFile: 'h2a/ex-factory-reconciliation.json',
        },
        {
          topic: 'Style.styleNumber for migration-created historical Styles',
          resolution:
            'APPROVED by the project owner. Style.styleNumber for imported historical master preparation is system-generated as `{Season}-{LMIX digits}` (e.g. SS26-25426009) because no authoritative historical Style Number is available. It is not asserted to be a source-document value; LMIX and Season remain the source-backed identity. Bare LMIX digits were rejected because Style.styleNumber is globally unique and three unrelated pre-existing DEFAULT-season Styles already use the bare digits of LMIX39026006/25426015/25426009.',
          evidenceFile: 'h2a/mrp-reconciliation.json',
        },
      ],
      pendingUserApprovals: [],
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
