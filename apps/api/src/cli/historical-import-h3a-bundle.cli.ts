#!/usr/bin/env node
// H3A — builds the sealed, environment-independent historical import
// bundle from the APPROVED H2A/H2B sources. NO database access: every
// value comes from the approved artifacts, the real source PDFs (re-hashed
// against the approved manifest) and the business MRP workbook, through
// the same source-side code the verified Dev import used
// (prepareApprovedSourceInput, buildStyleSourceSpecs).
//
// Usage (from apps/api):
//   tsx src/cli/historical-import-h3a-bundle.cli.ts \
//     --artifacts-root "C:\...\project-erve\.artifacts\historical-import\AW25-SS26" \
//     --aw25-dir "C:\...\reerveindiaaw25po" --ss26-dir "C:\...\reerveindiass26po" \
//     --workbook "C:\...\MRP & Ex factory cost.xlsx" \
//     --output "<new, non-existent directory>" \
//     [--h2b1-staging "<...>\h2b1\commit-...\source-staging-h2b1.json"]   (cross-check only)
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareApprovedSourceInput } from './historical-import-commit.js';
import { buildStyleSourceSpecs } from './historical-import-style-prep.js';
import { REQUIRED_SEASONS } from './historical-import-master-prep.js';
import { reextractDocumentaryStaging } from '../modules/historical-import/documentary-staging.js';
import { refreshHsnCodesFromSourcePdfs, indexHsnRefreshBySourceChecksum } from '../modules/historical-import/hsn-refresh.js';
import { resolveApprovedFactoryMapping } from '../modules/historical-import/factory-mapping.js';
import { computeStageStructureFingerprint, type ProcessFlowVersionLogicalIdentity } from '../modules/historical-import/process-flow-pin.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';
import {
  H3A_BATCH_LABEL,
  H3A_BUNDLE_FORMAT,
  H3A_MIGRATION_VERSION,
  loadVerifiedBundle,
  money,
  sha256Hex,
  type BundleFileRef,
  type BundleJobOrderSpec,
  type BundleStyleSpec,
  type H3aBundle,
} from '../modules/historical-import/h3a/bundle.js';

class BundleBuildError extends Error {}

function arg(argv: string[], flag: string, required = true): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) throw new BundleBuildError(`${flag} is required`);
  return value;
}

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const artifactsRoot = arg(argv, '--artifacts-root')!;
  const aw25Dir = arg(argv, '--aw25-dir')!;
  const ss26Dir = arg(argv, '--ss26-dir')!;
  const workbookPath = arg(argv, '--workbook')!;
  const outputDir = arg(argv, '--output')!;
  const h2b1StagingPath = arg(argv, '--h2b1-staging', false);

  if (await stat(outputDir).then(() => true, () => false)) throw new BundleBuildError(`--output ${outputDir} already exists — a bundle is only ever built into a fresh directory`);
  const workDir = join(outputDir, '_build');
  await mkdir(workDir, { recursive: true });

  console.log('H3A bundle build — NO database access');
  // 1. Job Order source records: approval, manifest + PDF re-hash, overrides, documentary sections, MRP/ex-factory, images.
  const source = await prepareApprovedSourceInput({ artifactsRoot, batchLabel: H3A_BATCH_LABEL, aw25Dir, ss26Dir });
  for (const check of source.checks) console.log(`  PASS ${check.name}: ${check.detail}`);

  // 2. Style specs from the documentary-reconciled staging (regenerated in memory, identical to H2B.1's).
  const originalStaging = JSON.parse(await readFile(join(artifactsRoot, 'source-staging.json'), 'utf8')) as SourceStagingRecord[];
  const reconciledStaging = await reextractDocumentaryStaging(originalStaging, { aw25Dir, ss26Dir });
  const reconciledStagingPath = join(workDir, 'source-staging-documentary.json');
  await writeFile(reconciledStagingPath, JSON.stringify(reconciledStaging, null, 2));
  if (h2b1StagingPath) {
    const committed = JSON.parse(await readFile(h2b1StagingPath, 'utf8')) as SourceStagingRecord[];
    if (JSON.stringify(committed) !== JSON.stringify(reconciledStaging)) throw new BundleBuildError('Regenerated documentary staging differs from the committed H2B.1 staging');
    console.log('  PASS h2b1: regenerated documentary staging is identical to the committed H2B.1 staging');
  }
  const refreshed = await refreshHsnCodesFromSourcePdfs({ aw25Dir, ss26Dir });
  if (refreshed.some((r) => r.parseStatus === 'FAILED')) throw new BundleBuildError('HSN refresh could not read every source PDF');
  const styleSpecs = await buildStyleSourceSpecs({
    workbookPath,
    stagingFilePath: reconciledStagingPath,
    sourceOverridesFilePath: join(artifactsRoot, 'h2a', 'source-overrides.json'),
    factoryMappingFilePath: join(artifactsRoot, 'h2a', 'factory-mapping.json'),
    sizeMappingFilePath: join(artifactsRoot, 'h2a', 'size-mapping.json'),
    hsnRefreshBySourceChecksum: indexHsnRefreshBySourceChecksum(refreshed),
  });

  const canonicalFactory = (sourceName: string, label: string): string => {
    const target = resolveApprovedFactoryMapping(source.factoryMapping, sourceName);
    if (!target) throw new BundleBuildError(`${label}: source factory "${sourceName}" has no APPROVED H2A factory mapping`);
    return target;
  };

  // 3. Files: source PDFs (named by content hash) and approved images (named by effective legacy reference).
  const writeBundleFile = async (path: string, buffer: Buffer): Promise<BundleFileRef> => {
    const full = join(outputDir, ...path.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buffer, { flag: 'wx' });
    return { path, sha256: sha256Hex(buffer), sizeBytes: buffer.length };
  };

  const jobOrders: BundleJobOrderSpec[] = [];
  const imageByRef = new Map<string, BundleStyleSpec['image']>();
  for (const r of source.records) {
    const pdf = await r.loadSourcePdf();
    if (sha256Hex(pdf) !== r.sourceSha256) throw new BundleBuildError(`${r.legacyReferenceNumber}: source PDF hash changed`);
    const pdfRef = await writeBundleFile(`pdf/${r.sourceSeasonFolder}/${r.sourceSha256}.pdf`, pdf);
    if (r.image) {
      const bytes = await r.image.load();
      if (sha256Hex(bytes) !== r.image.sha256) throw new BundleBuildError(`${r.legacyReferenceNumber}: approved image hash mismatch`);
      const ref = await writeBundleFile(`images/${r.seasonCode}/${r.legacyReferenceNumber}.png`, bytes);
      imageByRef.set(r.legacyReferenceNumber, { ...ref, fileName: r.image.fileName });
    }
    jobOrders.push({
      legacyReferenceNumber: r.legacyReferenceNumber,
      season: r.seasonCode,
      lmix: r.lmix,
      factory: canonicalFactory(r.sourceFactoryName, r.legacyReferenceNumber),
      sourceFactoryName: r.sourceFactoryName,
      historicalBusinessDate: r.historicalBusinessDate,
      requiredDeliveryDate: r.requiredDeliveryDate,
      unitPrice: r.unitPrice,
      sizes: r.sizes,
      disclaimerText: r.disclaimerText ?? null,
      styleDescription: r.styleDescription!,
      styleName: r.styleName!,
      sourceSnapshot: r.sourceSnapshot,
      migrationNotes: r.migrationNotes.replace(/^H2B /, 'H3A '),
      sourcePdf: { ...pdfRef, fileName: r.sourceFileName },
    });
  }

  const recordByKey = new Map(source.records.map((r) => [`${r.seasonCode}|${r.lmix}`, r] as const));
  const styles: BundleStyleSpec[] = styleSpecs.map((s) => {
    const label = `${s.season} ${s.lmix}`;
    const record = recordByKey.get(`${s.season}|${s.lmix}`);
    if (!record) throw new BundleBuildError(`${label}: no Job Order source record`);
    if (record.businessMrp !== s.finalMrp || record.businessExFactoryCost !== s.exFactoryPrice) {
      throw new BundleBuildError(`${label}: MRP/ex-factory disagree between the approved reconciliation artifacts and the workbook`);
    }
    return {
      season: s.season,
      lmix: s.lmix,
      legacyReferenceNumbers: s.legacyReferenceNumbers,
      styleNumber: s.styleNumber,
      styleName: s.styleName,
      description: s.description,
      colour: s.colour,
      categoryDescription: s.categoryDescription,
      categoryRaw: s.categoryRaw,
      categoryNormalizationApplied: s.categoryNormalizationApplied,
      hsnCode: s.hsnCode,
      hsnDescription: s.hsnDescription,
      hsnDescriptionClassification: s.hsnDescriptionClassification,
      hsnCodeSourceSuspect: s.hsnCodeSourceSuspect,
      ipName: s.ipName,
      licensor: s.licensor,
      finalMrp: money(s.finalMrp),
      factory: canonicalFactory(s.sourceFactoryName, label),
      exFactoryPrice: money(s.exFactoryPrice),
      sourceSizeCodes: s.sourceSizeCodes,
      image: imageByRef.get(s.legacyReferenceNumbers[0]!) ?? null,
      sourceChecksumSha256: s.sourceChecksumSha256,
    };
  });

  // 4. Approved process flow identity + its stage-structure fingerprint.
  const approval = JSON.parse(await readFile(join(artifactsRoot, 'migration-approval.json'), 'utf8')) as {
    processFlowVersionPin: { logicalIdentity: ProcessFlowVersionLogicalIdentity };
  };
  const li = approval.processFlowVersionPin.logicalIdentity;

  const bundle: H3aBundle = {
    format: H3A_BUNDLE_FORMAT,
    migrationVersion: H3A_MIGRATION_VERSION,
    batchLabel: H3A_BATCH_LABEL,
    builtAt: new Date().toISOString(),
    builtFromCommit: gitCommit(),
    provenance: {
      description: source.provenance.description,
      sourceArchives: source.provenance.sourceArchives,
      sourceManifestAggregateSha256: source.provenance.sourceManifestAggregateSha256,
      parserVersion: source.provenance.parserVersion,
      sourceOverridesSha256: source.provenance.sourceOverridesSha256 ?? '',
      approvedProcessFlow: {
        processFlowCode: li.processFlowCode,
        versionNumber: li.versionNumber,
        fingerprint: li.fingerprint,
        stageStructureFingerprint: computeStageStructureFingerprint(li.stages),
        stages: li.stages,
      },
    },
    seasons: REQUIRED_SEASONS.map((s) => ({ code: s.code, name: s.name, financialYearCode: s.financialYearCode })),
    styles,
    jobOrders,
  };
  await writeFile(join(outputDir, 'bundle.json'), JSON.stringify(bundle, null, 2));

  // 5. Self-verify exactly as the target server will.
  const loaded = await loadVerifiedBundle(outputDir);
  for (const check of loaded.checks) console.log(`  PASS bundle.${check.name}: ${check.detail}`);
  await writeFile(join(outputDir, 'bundle.sha256'), `${loaded.bundleSha256}  bundle.json\n`);
  console.log('');
  console.log(`Bundle: ${outputDir}`);
  console.log(`bundle.json SHA-256: ${loaded.bundleSha256}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
