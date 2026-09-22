// Dry-run step output writer (H1 plan §17/§21/§22). Produces the Dev-aware
// artifacts — dev-reconciliation.json, migration-approval.json, and the
// human sign-off file human-review.md — strictly after read-only Dev
// reconciliation; never writes any application record.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourceStagingRecord } from './staging.service.js';
import type { ReconciledRecord } from './reconciliation.service.js';
import type { ProcessFlowVersionPin } from './process-flow-pin.js';
import type { SourceManifest } from './source-manifest.js';
import type { NumberingAnalysisResult } from './numbering-analysis.js';

export type IdentityRecommendation = 'legacyReferenceNumber' | 'Season + legacyReferenceNumber';

/**
 * Evidence-based, not assumed upfront (H1 plan §15). A composite
 * `Season + legacyReferenceNumber` key is only recommended when adding
 * Season would actually resolve a real collision — i.e. cross-season
 * reuse (the same reference under two different seasons). A repeat
 * WITHIN one season is a different problem: Season is already identical
 * for both occurrences, so prefixing it changes nothing — that kind of
 * repeat is a source-document data-quality issue (e.g. a copy-paste error
 * in one PDF's own printed order-number field) that must be corrected by
 * a human before H2, not something either identity formula can silently
 * paper over. Both kinds are reported, but only cross-season reuse moves
 * the recommendation.
 */
export function recommendIdentityRule(numbering: NumberingAnalysisResult): {
  recommendation: IdentityRecommendation;
  rationale: string;
  withinSeasonConflictsRequiringManualResolution: Array<{ legacyReferenceNumber: string; sourceFileNames: string[]; season: string }>;
} {
  const withinSeasonConflicts = numbering.bySeason.flatMap((s) =>
    s.repeatedReferences.map((r) => ({ ...r, season: s.season })),
  );
  const anyCrossSeasonReuse = numbering.crossSeasonReuse.length > 0;

  if (!anyCrossSeasonReuse) {
    return {
      recommendation: 'legacyReferenceNumber',
      rationale:
        withinSeasonConflicts.length === 0
          ? 'No repeated references within either season and no cross-season reuse was found across the full archive scan — legacyReferenceNumber alone is sufficient as the historic identity/idempotency key.'
          : `No cross-season reuse was found, so a Season prefix would not resolve anything — legacyReferenceNumber alone remains the recommended key. However, ${withinSeasonConflicts.length} within-season repeat(s) were found (see withinSeasonConflictsRequiringManualResolution) — these are source-document data-quality issues that must be resolved by a human (which file's printed reference is correct) before H2, independent of which identity formula is used.`,
      withinSeasonConflictsRequiringManualResolution: withinSeasonConflicts,
    };
  }
  return {
    recommendation: 'Season + legacyReferenceNumber',
    rationale: `The same reference was reused across two different seasons — legacyReferenceNumber alone is ambiguous there, so Season must be part of the identity key.${withinSeasonConflicts.length > 0 ? ` Separately, ${withinSeasonConflicts.length} within-season repeat(s) were also found and still require manual resolution — adding Season does not fix those.` : ''}`,
    withinSeasonConflictsRequiringManualResolution: withinSeasonConflicts,
  };
}

export interface DryRunSummary {
  totalSourceDocuments: number;
  ready: number;
  reviewRequired: number;
  blocked: number;
  seasonMatched: number;
  seasonUnmatched: number;
  factoryMatched: number;
  factoryUnmatched: number;
  styleMatched: number;
  styleUnmatched: number;
  imageDispositionCounts: Record<string, number>;
}

function summarize(records: ReconciledRecord[]): DryRunSummary {
  const count = (predicate: (r: ReconciledRecord) => boolean) => records.filter(predicate).length;
  const imageDispositionCounts: Record<string, number> = {};
  for (const r of records) imageDispositionCounts[r.image.disposition] = (imageDispositionCounts[r.image.disposition] ?? 0) + 1;
  return {
    totalSourceDocuments: records.length,
    ready: count((r) => r.classification === 'READY'),
    reviewRequired: count((r) => r.classification === 'REVIEW_REQUIRED'),
    blocked: count((r) => r.classification === 'BLOCKED'),
    seasonMatched: count((r) => r.season.status === 'MATCHED'),
    seasonUnmatched: count((r) => r.season.status !== 'MATCHED'),
    factoryMatched: count((r) => r.factory.status === 'MATCHED'),
    factoryUnmatched: count((r) => r.factory.status !== 'MATCHED'),
    styleMatched: count((r) => r.style.status === 'MATCHED'),
    styleUnmatched: count((r) => r.style.status !== 'MATCHED'),
    imageDispositionCounts,
  };
}

export interface WriteDryRunOutputsOptions {
  outputDir: string;
  batchLabel: string;
  stagingRecords: SourceStagingRecord[];
  reconciledRecords: ReconciledRecord[];
  processFlowPin: ProcessFlowVersionPin;
  manifest: SourceManifest;
  numbering: NumberingAnalysisResult;
  devTargetDatabase: string;
  /** H2A plan §10/§11/§24: traceability only — which reviewed mapping/override artifacts (if any) fed this run, and which per-file fields an APPROVED override actually changed. */
  factoryMappingFilePath?: string;
  sizeMappingFilePath?: string;
  sourceOverridesFilePath?: string;
  appliedOverridesByFile?: Record<string, string[]>;
  effectiveParseStatusChangesByFile?: Record<string, { from: string; to: string; resolvedWarnings: string[] }>;
  /** H2A plan §18/§20/§21: explicit gate status for decisions this story is allowed to resolve itself (Process Flow) vs. must leave for the user (EI26031/32 identity, the truncated order-date, the EI26042 LMIX anomaly). Never marks a business-identity decision APPROVED on the tool's own authority. */
  h2aApprovals?: {
    processFlowVersion: { status: 'APPROVED' | 'UNRESOLVED'; rationale: string };
    resolvedApprovals?: Array<{ topic: string; resolution: string; evidenceFile: string }>;
    pendingUserApprovals: Array<{ topic: string; recommendation: string; evidenceFile: string }>;
  };
}

function humanReviewBlock(staging: SourceStagingRecord, reconciled: ReconciledRecord): string {
  const lines: string[] = [];
  lines.push(staging.sourceFileName);
  lines.push('');
  const row = (label: string, value: string, status: string) => lines.push(`${label.padEnd(16)} ${value.padEnd(28)} ${status}`);
  row('Legacy Ref', reconciled.legacyReferenceNumber ?? '(none)', reconciled.legacyReferenceNumber ? 'OK' : 'MISSING');
  row('Season', staging.fields.documentSeason.value ?? '(none)', reconciled.season.status);
  row('Factory', staging.fields.factoryName.value ?? '(none)', reconciled.factory.status);
  row('LMIX', staging.fields.licenseStyleLmix.value ?? '(none)', reconciled.style.status === 'MATCHED' ? 'MATCHED' : reconciled.style.status);
  row('Style', reconciled.style.styleId ?? '(unresolved)', reconciled.style.status);
  row('Sizes', reconciled.sizes.map((s) => s.sizeCode).join(',') || '(none)', reconciled.sizes.every((s) => s.status === 'MATCHED') ? 'MATCHED' : 'REVIEW');
  const totalQty = staging.fields.tableTotalQuantity.value;
  row('Ordered Qty', totalQty !== null ? String(totalQty) : '(unknown)', staging.fields.quantitySumMatchesTotal === false ? 'MISMATCH' : 'VALID');
  row('Order Date', staging.fields.orderDate.value ?? '(none)', staging.fields.orderDate.value ? 'OK' : 'MISSING');
  row('Delivery Date', staging.fields.shipmentDate.value ?? '(none)', staging.fields.shipmentDate.value ? 'OK' : 'MISSING');
  row('Rate', staging.fields.unitRate.value ?? '(none)', staging.fields.unitRate.value ? 'OK' : 'MISSING');
  row('Source PDF SHA', staging.sourceChecksumSha256, '');
  row('Image', reconciled.image.disposition, reconciled.image.extractionMethod);
  row('Record Status', reconciled.classification, '');
  if (reconciled.blockedReasons.length + reconciled.reviewReasons.length + staging.warnings.length > 0) {
    lines.push(`Warnings         ${[...staging.warnings, ...reconciled.blockedReasons, ...reconciled.reviewReasons].join('; ')}`);
  } else {
    lines.push('Warnings         (none)');
  }
  return lines.join('\n');
}

export async function writeDryRunOutputs(options: WriteDryRunOutputsOptions): Promise<{
  devReconciliationPath: string;
  migrationApprovalPath: string;
  humanReviewPath: string;
  summary: DryRunSummary;
  identity: ReturnType<typeof recommendIdentityRule>;
}> {
  const summary = summarize(options.reconciledRecords);
  const identity = recommendIdentityRule(options.numbering);

  const devReconciliationPath = join(options.outputDir, 'dev-reconciliation.json');
  await writeFile(devReconciliationPath, JSON.stringify(options.reconciledRecords, null, 2));

  const migrationApprovalPath = join(options.outputDir, 'migration-approval.json');
  await writeFile(
    migrationApprovalPath,
    JSON.stringify(
      {
        batchLabel: options.batchLabel,
        generatedAt: new Date().toISOString(),
        devTargetDatabase: options.devTargetDatabase,
        sourceManifestAggregateSha256: options.manifest.aggregateSha256,
        parserVersion: options.manifest.parserVersion,
        processFlowVersionPin: options.processFlowPin,
        historicalIdentityRecommendation: identity,
        summary,
        numbering: options.numbering,
        factoryMappingArtifact: options.factoryMappingFilePath ?? null,
        sizeMappingArtifact: options.sizeMappingFilePath ?? null,
        sourceOverridesArtifact: options.sourceOverridesFilePath ?? null,
        appliedOverridesByFile: options.appliedOverridesByFile ?? {},
        effectiveParseStatusChangesByFile: options.effectiveParseStatusChangesByFile ?? {},
        h2aApprovals: options.h2aApprovals ?? null,
      },
      null,
      2,
    ),
  );

  const byFile = new Map(options.stagingRecords.map((r) => [r.sourceFileName, r]));
  const blocks = options.reconciledRecords.map((reconciled) => {
    const staging = byFile.get(reconciled.sourceFileName);
    if (!staging) return `${reconciled.sourceFileName}\n\n(no matching staging record found)`;
    return humanReviewBlock(staging, reconciled);
  });
  const humanReviewPath = join(options.outputDir, 'human-review.md');
  await writeFile(humanReviewPath, blocks.join('\n\n---\n\n') + '\n');

  return { devReconciliationPath, migrationApprovalPath, humanReviewPath, summary, identity };
}
